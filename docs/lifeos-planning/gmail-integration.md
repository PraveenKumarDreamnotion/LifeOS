# Gmail Integration + AI Email Assistant — Architecture & Research

> **Status:** All 5 planned phases built. Phases 1–2 verified LIVE (2026-07-15); Phases 3–5 test-green (live-drive pending). Semantic search over the whole mailbox is a separate future effort.
> **Owner:** LifeOS / Yogi · **Created:** 2026-07-14 · **Updated:** 2026-07-15
> **Scope discipline:** the spec mandates phase-gating — *"Do not proceed to the next phase until the previous is complete and verified."* This document is the durable research + design artifact written before code; it also carries the manual testing guide.

---

## 1. Objective

Let a LifeOS user securely connect their **own** Gmail account once, after which Yogi behaves like a real AI email assistant: it notices new mail, keeps email context **on-device**, answers natural-language questions about it ("Any new emails?", "What did Amazon send?", "Summarize today's emails", "Why did my flight get delayed?", "Draft a reply", "Remind me if they don't reply in 3 days"), and — only when useful and opt-in — does web research to enrich an email.

This must hold LifeOS's line: **privacy-first, local-first, user-controlled AI, production quality, extensible** to Outlook/IMAP later without a rewrite.

---

## 2. Research summary (the 20 areas + the decisions they forced)

### 2.1 OAuth 2.0 for a desktop app — **Loopback IP + PKCE**
- Google's **Out-Of-Band (OOB)** flow is **removed**. **Loopback IP redirect** (`http://127.0.0.1:<ephemeral-port>` or `http://localhost:<port>`) is the flow Google **still supports and recommends for the *Desktop app* OAuth client type** (it is being retired only for iOS/Android/Chrome client types). ([native-app guide](https://developers.google.com/identity/protocols/oauth2/native-app), [loopback migration](https://developers.google.com/identity/protocols/oauth2/resources/loopback-migration))
- Mechanism: open the **system browser** to the consent URL, run a **one-shot local HTTP server** on `127.0.0.1:0` (OS-assigned free port) to catch the `?code=…&state=…` redirect, then exchange the code for tokens. The redirect URI is **not** pre-registered in the Cloud console for Desktop clients — any loopback port is accepted.
- **PKCE (S256)** is used even though a Desktop client also has a secret, because the client secret in an installed app is not truly confidential; PKCE binds the code to the launching process and defeats code interception.
- **CSRF:** a random `state` nonce is generated per attempt and verified on the redirect.
- **Two flags that are load-bearing:** the auth URL **must** include `access_type=offline` **and** `prompt=consent`. Google returns a `refresh_token` **only on the first consent** otherwise; without `prompt=consent`, a "Reconnect" gets a fresh access token but **no refresh token**, silently breaking auto-refresh. We always send both.

### 2.2 Token refresh & lifecycle
- Access tokens live ~1h; we refresh proactively when within a safety margin of `expiry` (`getValidAccessToken()`), using the stored `refresh_token`.
- `invalid_grant` on refresh = the user revoked access, changed password, or the grant expired → we surface **"reconnect needed"** (never a crash), clear local tokens, and stop sync.

### 2.3 Secure local token storage — **Electron `safeStorage` (DPAPI on Windows)**
- Matches the app's existing OpenAI-key pattern exactly. Tokens are encrypted with `safeStorage` (Windows DPAPI, tied to the user account) and the **base64 ciphertext is stored in a settings row**; plaintext is produced **only in main**, and **never crosses IPC**. No plaintext-on-disk fallback: if OS encryption is unavailable we refuse to store and tell the user. OS keychains (keytar) were rejected to avoid a native module — `safeStorage` is already the app's trusted primitive.

### 2.4 Push notifications (watch + Pub/Sub) vs polling — **poll by default, push deferred**
- True Gmail push requires: create a Cloud **Pub/Sub topic**, grant `gmail-api-push@system.gserviceaccount.com` the Publisher role, create a subscription, call `users.watch` (re-called **at least weekly**, recommended daily), and consume messages. A **pull** subscription *can* run serverlessly from the desktop, but it still forces every user to stand up a GCP topic + subscription + IAM — **far too heavy for a consumer, privacy-first desktop app**. ([Gmail push guide](https://developers.google.com/workspace/gmail/api/guides/push), [Unipile guide](https://www.unipile.com/gmail-api-push-notifications/))
- **Decision (spec-sanctioned):** the reliable spine is **incremental `history.list` polling keyed on a stored `historyId` checkpoint**, on an adaptive interval + a manual "Sync now". The sync engine (Phase 2) is written so a **future Pub/Sub *pull* feed plugs into the same incremental path** (both just hand the engine a `historyId` to catch up from). Push becomes an optional "advanced" mode, not a requirement.

### 2.5 History API & incremental sync
- Initial sync: `users.messages.list` (paged) to seed, storing the mailbox's current `historyId`.
- Incremental: `users.history.list?startHistoryId=<checkpoint>` returns `messagesAdded/Deleted`, `labelsAdded/Removed` — this is how read/unread, star, label, and delete deltas arrive **without** re-fetching. Advance the checkpoint only after a batch is fully persisted (crash-safe).
- **Recovery:** a `404` on `history.list` means the `historyId` is too old (expired) → fall back to a bounded re-list and reseed the checkpoint.
- **Dedup:** `gmail_message_id` is UNIQUE; upserts are idempotent, so a retried/duplicated notification never doubles a row.

### 2.6 Quotas & rate limits
- Gmail API uses **per-method quota units** against a **per-user-per-second** and daily budget (`messages.get` costs more than `list`). We batch, request `format=metadata` for list/scan and `format=full` only on demand, honor `429`/`403 rateLimitExceeded` with **exponential backoff + jitter**, and cap concurrency. Polling (not per-message push) keeps steady-state unit spend low.

### 2.7 Threads, attachments, labels, search
- **Threads:** `users.threads.get` returns the ordered message list; we store `thread_id` on every message and can reconstruct a conversation. "Include Thread History" gates whether thread context is pulled into AI prompts.
- **Attachments:** metadata (filename, mimeType, size, `attachment_id`) is cheap and always stored; **bytes are downloaded only if "Download Attachments" is on**, via `users.messages.attachments.get`. Architecture is **OCR-ready** (a later text-extraction pass can populate a `text_content` column without schema churn).
- **Labels:** `users.labels.list` for the label set; per-message labels via the join table. Gmail's system labels (`INBOX`, `UNREAD`, `STARRED`, `IMPORTANT`, `CATEGORY_*`) drive unread/starred/folder semantics locally.
- **Search:** Gmail search operators (`from:`, `subject:`, `has:attachment`, `after:`, `label:`) map to **local SQL/FTS**; we do not proxy every query to Gmail. Semantic search is Phase 3.

### 2.8 Security recommendations honored
- Minimal scopes, incremental: Phase 1 requests **`gmail.readonly` only**. `gmail.modify` / `gmail.send` are reserved for the phases that actually need them (draft/send), requested incrementally so a read-only user never grants write. **Do NOT add `gmail.metadata`** — when a token carries the metadata scope, Gmail restricts `messages.get` to `format=metadata|minimal` and returns **403** for `format=full` *even if `readonly` is also granted* (metadata poisons the token). `readonly` already covers metadata + bodies + attachments. `include_granted_scopes` is intentionally omitted so a reconnect doesn't carry a previously-granted metadata scope forward.
- **Disconnect performs a server-side token revoke** (`POST https://oauth2.googleapis.com/revoke`) — not just a local delete — so the grant is actually torn down on Google's side. Then local ciphertext + account row are cleared and sync stops.
- Never log tokens or email contents (the logger already redacts secrets); tokens never cross IPC; client secret encrypted at rest.

### 2.9 IMAP vs Gmail API, and product survey
- **Gmail API > IMAP** here: native `historyId` incremental sync, labels/threads as first-class, push option, structured metadata, and OAuth (no password storage). IMAP would mean full-scan syncing and app-passwords. We use the Gmail API for Gmail and keep a **`MailProvider` seam** so an IMAP/Outlook adapter can be added later.
- **How the good ones do it (Superhuman, Shortwave, Spark, Notion Mail):** local index for instant search; AI summaries/triage over stored context; thread-aware context windows; "ask about my inbox" grounded in the local store; explicit, per-action send confirmation. LifeOS's differentiator is doing this **on-device by default**, cloud AI strictly opt-in and keyed to the user.

---

## 3. Architecture (how it slots into LifeOS)

LifeOS already has clean seams; Gmail reuses every one of them rather than inventing parallel infrastructure.

```
core/gmail/                pure, framework-free
  types.ts                 domain types (Account, MailMessage, Thread, Label, …)
  oauth.ts                 PKCE + state + auth-URL + token/refresh/revoke REQUEST SHAPES (no fetch)
  mail-provider.ts         MailProvider interface (the Outlook/IMAP extensibility seam)

electron/
  services/gmail-token-store.ts   safeStorage ciphertext for tokens + client secret (mirrors ApiKeyStore)
  gmail/gmail-auth.ts             loopback server + fetch: connect / refresh / revoke / getProfile
  gmail/gmail-provider.ts         [Phase 2] Gmail impl of MailProvider (list/get/history/watch)
  gmail/sync-engine.ts            [Phase 2] historyId-checkpoint incremental sync
  database/gmail-repository.ts    all Gmail SQL (parameterized), mirrors reminder-repository
  main/ipc/gmail.ts               guard()ed IPC handlers (connect/disconnect/test/credentials/deleteCache)

src/features/settings/GmailSection.tsx   the Integrations → Gmail UI
```

- **Network:** Gmail's token/API calls use Node `fetch` from **main**, exactly like `OpenAiLlmProvider`. Node's global fetch does **not** pass through `session.defaultSession.webRequest`, so the default-deny allowlist in `session.ts` is **not** involved for these main-process calls — privacy is enforced by **provider gating** (call Google only when connected + the relevant feature is enabled), identical to how OpenAI is gated today. The consent page opens via a direct main-process `shell.openExternal`. **No `session.ts`/CSP change is needed** until/unless remote email *content* is rendered inside a window (a later phase; it will be sanitized + remote images proxied/blocked, and CSP `connect`/`img` adjusted then).
- **Notifications (Phase 2):** reuse `electron/notifications/notifier.ts`.
- **Scheduling (Phase 2):** the sync loop follows the wall-clock `reconcile`/tick discipline of `electron/scheduler/scheduler.ts` (no long `setTimeout`s).
- **Yogi capabilities:** the reminder-execution capability taxonomy **already reserves** `email_read` / `email_send` (`core/types/reminder-execution.ts`), and the Action union (`core/actions/action.ts`) is additively extensible — so "read my email" (auto) and "send/draft" (confirmation-gated) land without new plumbing.

---

## 4. Database schema

One additive, forward-only migration (`M006_GMAIL`, bumps `user_version` 5 → 6). **Only the tables Phases 1–2 exercise are created now.** `email_ai_context`, `email_embeddings`, and `web_research` are **deliberately deferred** to their own later migrations because their shape depends on decisions not yet made (notably local-vs-OpenAI embeddings) — and migrations being additive, deferring costs nothing.

| Table | Purpose |
| --- | --- |
| `gmail_accounts` | one row per connected account: address, historyId checkpoint holder link, connected_at, scopes |
| `gmail_sync_state` | per-account sync cursor: `history_id`, `last_sync_at`, `last_full_sync_at`, `watch_expiry` (push, future), `status` |
| `gmail_threads` | thread id, snippet, last message date, message count |
| `gmail_messages` | the core row: `gmail_message_id` (UNIQUE), `thread_id`, `internal_date`, `from`, `subject`, `snippet`, `is_unread`, `is_starred`, size, `history_id`, raw label ids denormalized for fast filtering |
| `gmail_participants` | normalized from/to/cc/bcc per message (name + address + role) |
| `gmail_labels` | Gmail label id → name/type/colour |
| `gmail_message_labels` | message ↔ label join |
| `gmail_attachments` | per-message attachment metadata (+ nullable local path, +future `text_content` for OCR) |

Indexes: `gmail_messages(account_id, internal_date DESC)`, UNIQUE `gmail_messages(gmail_message_id)`, `gmail_messages(thread_id)`, `gmail_messages(is_unread)`, join-table PKs, `gmail_participants(address)`.

**Phase-1 usage:** only `gmail_accounts` + `gmail_sync_state` are read/written (connect stores the account; disconnect clears it). The message tables exist so Phase 2 needs no migration.

---

## 5. Settings & IPC surface (Phase 1)

- **Settings keys** (`SETTING_DEFAULTS`): `gmail_enabled`, `gmail_client_id`, `gmail_notifications`, `gmail_ai_summaries`, `gmail_store_context`, `gmail_auto_research`, `gmail_download_attachments`, `gmail_include_threads`, `gmail_sync_mode`, `gmail_max_stored`, plus ciphertext keys `gmail_token_ciphertext`, `gmail_client_secret_ciphertext`.
- **Safe DTO:** the settings DTO exposes only **`gmailConnected: boolean`**, **`connectedEmail?: string`**, **`hasGmailClientSecret: boolean`**, plus the non-secret feature toggles/`gmail_client_id`. Both ciphertext keys are excluded from `getAllSafe()` — **secrets never cross IPC**, mirroring `ai_key_ciphertext`.
- **Channels:** `GMAIL_CONNECT`, `GMAIL_DISCONNECT`, `GMAIL_TEST`, `GMAIL_SET_CREDENTIALS`, `GMAIL_DELETE_CACHE`, and a `gmail:status` broadcast. Handlers are `guard()`ed and return the `Result<T>` envelope; the renderer wrapper (`src/lib/ipc.ts`) unwraps to throw `AppError`.

---

## 6. Phased plan & current state

| Phase | Contents | State |
| --- | --- | --- |
| **1 — Foundation** | Research/arch doc · schema · secure token store · OAuth loopback connect/reconnect/disconnect(+revoke) · test connection · Settings UI · IPC | ✅ built |
| **2 — Sync + Notifications** | `MailProvider` Gmail impl · `historyId` sync engine (initial/incremental/recovery/dedup) · read/star/label/delete deltas · wall-clock scheduler · new-mail desktop notification | ✅ **built** (test-green, live-unverified) |
| **3 — Conversational email + AI context** | `email_ai_context` (summary/intent/action items/dates/priority) · **each new email → its own chat** · **spoken (TTS) heads-up** · **talk to Yogi about it** (grounded via the delivered turn) · clickable notification → opens the chat | ✅ **built** (test-green; semantic search/embeddings deferred to a later phase) |
| **4 — Web research** | opt-in auto-research (Yogi decides worthiness) · `web_research` cache + dedup · research appended into the email chat (cross-questions use it) · manual "research this" already works via the engine | ✅ **built** (test-green) |
| **5 — Hardening** | startup catch-up (no backlog burst) · 403 rate-limit retry · resume-triggered sync · migration coverage M006–M008 · edge-case docs | ✅ **built** (test-green) |

---

### 6.1 Phase 2 implementation notes (decisions worth recording)

- **Metadata-only fetch by default.** Sync stores `format=metadata` (headers + labels + snippet + internalDate + sizeEstimate + threadId + historyId) — cheap and scope-safe. `format=full` (the MIME tree needed for attachment *parts*) is requested **only** when "Download Attachments" is on. This sidesteps any assumption about whether `metadata` returns `payload.parts`.
- **Crash-safe checkpoint.** The `historyId` cursor advances **only after** a delta batch fully persists. A crash mid-batch re-runs from the same checkpoint; adds dedup via a unique message id, deletes and label-updates are idempotent.
- **New-mail detection.** A notification fires for an *added* message that is **INBOX + UNREAD and not already stored** (existence checked **before** upsert). Self-sent mail carries `SENT` not `INBOX`, so it's excluded. Initial sync never notifies (no whole-inbox storm).
- **`gmail_store_context` is a real gate.** Off ⇒ sync still advances the cursor and still notifies, but persists **no** message rows.
- **Deleted vs Trash.** A history `messageDeleted` deletes the row; a `TRASH` label change is applied as a normal label update (the message's label set loses `INBOX`, so inbox-scoped views drop it) — the message isn't hard-deleted so it can be recovered.
- **Notification buttons deferred by choice.** Windows Electron `Notification` has no action buttons; the codebase's actionable-alert precedent is the reminder **popup window**, not the toast. Phase 2 uses click→open (there's no email view to open into yet); real "Open / Ask Yogi / Dismiss" buttons are a later popup-style surface.
- **Scheduler.** Wall-clock periodic due-check against `last_sync_at` (not a `setTimeout` to a future time). Modes: 5min / 15min = interval polling; manual = explicit "Sync now" only; push = treated as 5min (push not built). Connect kicks a background initial sync.
- **Unverified base carries forward.** Phase 2 sits on the Phase-1 OAuth path, which has still never done a real token exchange here. The engine/provider/notifier are verified **by construction + mocks only** (no live Gmail, no display). Green tests are not proof sync works against Gmail — the manual pass in §10 (extended below) is required.

### 6.2 Phase 3 implementation notes (conversational email)

The requirement: *"with the notification, Yogi should treat each new email as a new chat, speak (TTS) while notifying, and let the user interact about the email."* Built by extending the reminder-delivery pattern, not new infrastructure.

- **New email → its own chat.** On a genuinely-new INBOX+UNREAD arrival, the coordinator creates a chat (`createEmailSession`, linked via `chat_sessions.email_message_id`) and records an **assistant-only `kind='email'` delivery turn** whose text is the AI summary (sender, subject, 1–2 sentence summary, action items, key dates).
- **Grounded Q&A for free.** The engine's context is `recentTurns`, so the delivered summary is *already* in Yogi's context — "summarize this / who sent it / what action?" work with **no engine or system-prompt change**. The projection was hardened: a delivery turn (empty `userText`) now projects **assistant-only** keyed on the invariant (empty user text), not a per-kind label — so it can never inject an empty user message.
- **Grounding ceiling (honest).** Answers cover summary/sender/intent/action items/dates. **Deep body questions** ("the exact tracking number", "full text") are **not** answerable — the body isn't in context. The `chat_sessions → email_message_id` link is the future hook to inject the body without rework; not built this phase.
- **AI context.** `EmailContextService` generates via the **gated `makeLlmProvider` seam** (key + AI-assist + consent) *and* `gmail_ai_summaries`; results cached in `email_ai_context`. Degrades cleanly: summaries off / no key / LLM error → deliver with the snippet + a generic spoken line ("New email from X"). Notify fast, enrich async.
- **TTS.** Exactly **one** spoken line per batch (sender + gist for one; "N new emails" for many), spoken via the shared audio window, and **skipped while audio is already playing** (a live conversation/reminder) so it never overlaps. Best-effort; no full pause/resume this phase.
- **Voice-continuity safety (the load-bearing one).** Email chats are created **quietly**: they do NOT move the shared active-session pointer and do NOT force any window to switch view. The launcher's cold-start fallback and the main window's mount both resume the most-recent **non-email** chat (`mostRecentConversation()` / filter on `emailMessageId`), so a delivered email never hijacks "continue my conversation." Email chats open **only** via the notification click or a sidebar click.
- **Notification click → opens the email's chat** (`GMAIL_OPEN_CHAT` broadcast; App switches to Chat and selects the session, race-free via a prop). Windows toast action-buttons remain deferred (docs §3).
- **Bounds.** Dedup by email id (a re-processed id never spawns a second chat); ≤10 chats per batch (a flood shows one summary notification); summaries run at bounded concurrency.

### 6.3 Phase 4 implementation notes (web research)

- **Manual "research this email" reuses the engine (no Phase-4 code) — but is UNVERIFIED.** An email chat is a normal `ConversationEngine` session with the summary in context, so typing "research this" *should* route through the engine's `research` intent → forced web search → grounded answer. What's **tested** is the engine forcing search once a turn is classified `research` (cont.4 units); what's **not** verified is that gpt-4o-mini classifies a bare "research this" (referent only in the delivered summary) as `research` — a model-dependent call, and exactly the kind our `needsWebSearch` history shows is flaky. Precondition: the **web-search chain** (AI-assist + key + consent + `web_search_enabled`), same gate as auto-research; without it the reply is "web search is turned off." If the bare phrase under-triggers, the robust fallback is "**research this email about the flight delay**." Phase 4's own new code is only the *automatic* trigger + the cache.
- **Auto-research decision rides on the summary.** The one summary LLM call also returns `researchWorthwhile` + `researchQuery` (fail-safe: worthwhile only if the flag is set AND a non-empty query is given). The prompt defaults **false** and fires only for the narrow class (visa, flight delay, gov/legal/tax/medical notice, shipping delay, admission, conference).
- **Same search seam.** Auto-research calls `makeSearchProvider` (the gated web-search provider the conversation uses) — no parallel search path, no re-plumbed citations.
- **Cached + capped.** Result cached in `web_research` (PK `message_id`) → a re-sync never re-pays. Per-batch research cap **3** (tighter than the 10-chat cap) with bounded concurrency; skipped count logged. A paid search only fires for a research-worthy email when `gmail_auto_research` is on.
- **Delivered as a turn, silently.** The research answer + sources are appended to the email's chat as another assistant-only turn (so cross-questions use it via context). It does **not** speak a second TTS line, and — because `mostRecentConversation()` excludes email chats — the append can't hijack the launcher/main-window view.
- **Toggle chain made visible.** Auto-research requires **key + AI summaries + Store email context** (the decision rides on the stored summary). The Settings checkbox is disabled until those are on, with an inline explanation — no silent dead-end.

### 6.4 Phase 5 implementation notes (hardening)

- **Startup catch-up (no burst).** The FIRST automatic sync of a session runs as *catch-up*: it stores mail accrued while the app was closed and advances the `historyId` checkpoint, but **suppresses the delivery burst** (no chat/notify/TTS) — mirroring the reminder scheduler's "don't fire missed-while-closed alarms." All subsequent syncs deliver normally. `Sync now` is always a deliberate delivery (never catch-up). Kicked on `start()` and on `powerMonitor` resume (interval-gated).
- **403 rate-limit retry.** The provider now retries a `403` whose *machine* reason is `rateLimitExceeded`/`userRateLimitExceeded`/`RESOURCE_EXHAUSTED` (in addition to `429`/`5xx`), with the same capped backoff+jitter. A `403` for scope/permission (e.g. "Metadata scope does not permit format FULL") is **terminal** — never retried — so a misconfiguration fails fast instead of looping.
- **Error-status resilience.** A sync error sets `status='error'` and the scheduler retries next interval; `reconnect_needed` halts syncing until the user reconnects (which clears it). One un-fetchable message is skipped, never wedging the checkpoint (Phase 2).
- **Coverage.** Migration tests now assert every M006–M008 table + the M008 ALTER columns; scheduler tests lock the catch-up semantics; provider tests lock the retry policy (retry rate-limit, don't retry permission, give up at the cap).

## 7. Security posture (checklist)

- ✅ No LifeOS server; emails never uploaded anywhere; all storage local SQLite.
- ✅ OAuth tokens + client secret **encrypted at rest** (safeStorage/DPAPI); **never logged, never across IPC**.
- ✅ Client secret never displayed after save; Client ID is non-secret.
- ✅ Minimal, incremental scopes (`readonly`+`metadata` first).
- ✅ Disconnect = **server-side revoke** + local wipe + sync stop.
- ✅ AI processing and web research are **separately opt-in**; nothing leaves the device without an enabled, consented feature.
- ✅ "Delete Local Email Cache" wipes all synced email rows on demand.

---

## 8. Future extensibility

The `MailProvider` interface (list/get/history/watch/threads/attachments) is provider-agnostic. Adding **Outlook / Microsoft 365 / Exchange / Yahoo / IMAP** = a new adapter implementing that interface + its own OAuth/credential module; the sync engine, schema, repository, notifications, AI context, and Yogi capabilities are unchanged. Slack/Teams/Discord would be a *different* seam but can reuse the same "connected source → local store → Yogi context" spine.

---

## 9. Known limitations (Phase 1)

- **Push notifications are not implemented** — polling is the shipping strategy; push is a deferred advanced mode (§2.4).
- The **consent handshake and desktop notifications cannot be automatically tested** in CI (no live Google credentials, no display). They are verified by construction + covered by the **manual testing guide (§10)**. Green unit tests are **not** proof that end-to-end OAuth works.
- Feature toggles and sync-mode controls in the UI are **persisted** in Phase 1 but only become behaviorally live in Phase 2+ (they are clearly gated in the UI, not faked).
- Requires the user to create their **own** Google Cloud OAuth *Desktop* client (Client ID + Secret) — the privacy-first, no-shared-backend tradeoff. The manual guide walks through it.
- While the app is not running, no sync/notification occurs; the next launch catches up via incremental history sync.
- **Backlog isn't delivered as chats.** By design (§6.4), mail that arrived while the app was closed is *stored* on the next launch but not turned into chats/notifications — it's visible in the app but you won't get a per-email chat for it. New mail while the app is running is delivered normally.
- **Delete-cache leaves email chat sessions behind.** `chat_sessions` has no FK to `gmail_messages`, so deleting the local email cache removes the messages/context but the auto-created email *chats* linger (their content is in the turn, so they still read fine; their `email_message_id` just dangles). Deleting them would destroy the user's conversation — intentionally kept.
- **Summaries require Store email context:** AI email summaries are generated only for a *stored* message (`email_ai_context` FKs to `gmail_messages`). So with "Store email context" OFF, emails deliver with the snippet only, even if "AI email summaries" is ON. Correct by construction, but an implicit coupling worth knowing.
- **Stale thread counts:** `deleteMessage` does not recompute `gmail_threads.message_count`, so a thread's stored count can drift after deletes. Harmless now (no thread views), but Phase 3 must recompute rather than trust it.
- **Offline "Test Connection" wording:** if the device is offline, Test Connection reports "Not connected (…)" even though the account is still connected (tokens are preserved — we only clear on `invalid_grant`). No crash, state preserved; the message is just imprecise. A polish pass can distinguish "connected but offline" from "not connected".

---

## 10. Manual testing guide (Phase 1 — do this on a real machine)

**A. Create Google credentials (one-time).**
1. Go to <https://console.cloud.google.com/> → create/select a project.
2. **APIs & Services → Library →** enable **Gmail API**.
3. **APIs & Services → OAuth consent screen →** User type **External** → fill app name/email → add your own Google account under **Test users** (keeps you in "Testing" mode, no verification needed) → add the scope `.../auth/gmail.readonly` **only** (do NOT add `gmail.metadata` — it 403s full-message reads).
4. **APIs & Services → Credentials → Create credentials → OAuth client ID → Application type: *Desktop app*.**
5. Copy the **Client ID** and **Client Secret**.

**B. Connect in LifeOS.**
6. Open LifeOS → **Settings → Integrations → Google Gmail**.
7. Paste **Client ID** and **Client Secret** (toggle show/hide to verify), click **Save credentials**.
   - *Expected:* status shows credentials saved; **Connect Gmail** becomes enabled.
8. Click **Connect Gmail**. Your system browser opens Google's consent screen.
   - *Expected:* after you approve, the browser shows a "you can close this and return to LifeOS" page; LifeOS flips to **● Connected** and shows your account email. (First connection: you granted consent, so a refresh token was issued.)
9. Click **Test Connection**.
   - *Expected:* success with your address + mailbox reachable.

**C. Disconnect & revoke.**
10. Click **Disconnect**.
    - *Expected:* status returns to **○ Not Connected**; the account email clears. Verify at <https://myaccount.google.com/permissions> that **LifeOS is no longer listed** (server-side revoke worked). Tokens are gone from the device.

**D. Reconnect.**
11. Click **Connect Gmail** again → approve.
    - *Expected:* reconnects cleanly and (because we always send `prompt=consent`) a **new refresh token** is issued, so auto-refresh keeps working.

**E. Offline & error behavior.**
12. Turn off networking, click **Test Connection**.
    - *Expected:* an honest "couldn't reach Gmail" message, no crash, connection state preserved.
13. Enter a wrong Client Secret and try to connect.
    - *Expected:* a clear "check your Client ID/Secret" error, no crash.

**F. Cache delete.**
14. Click **Delete Local Email Cache**.
    - *Expected:* confirmation, then all synced email rows removed (no-op in Phase 1 if nothing synced yet; the button and its wiring exist and are safe).

**G. Phase 2 — sync & notifications (after connecting).**
15. On Connect, an initial sync runs in the background. Wait a few seconds, reopen Settings → Gmail → **Status**: "Last sync" shows a time and "Storage used" is non-zero (with "Store email context" on).
16. Send yourself a new email from another account. Within your sync interval (or click **Sync now**), a **desktop notification** appears — "New email · <sender>" / subject. Clicking it opens LifeOS.
    - *Expected:* exactly one notification per new inbox message; no notification for mail you send; no storm for old mail.
17. Mark the email read in Gmail, then **Sync now**. *Expected:* no new notification (it's not a fresh arrival); the stored copy's read state updates on the next incremental sync.
18. Set **Sync mode → Manual**. *Expected:* no automatic syncing; only **Sync now** pulls changes.
19. Toggle **Store email context** off, **Sync now**. *Expected:* "Storage used" drops toward zero over time / no new rows stored, but notifications for genuinely new mail still fire.
20. **Delete local email cache** → confirm. *Expected:* stored count returns to zero; you stay connected; the next sync re-downloads.

**H. Phase 3 — conversational email (with AI summaries + a key).**
21. Ensure **AI email summaries** is on and an OpenAI key is set. Send yourself a new email.
22. On arrival: a **desktop notification** appears AND Yogi **speaks** a one-line heads-up ("You've got a new email from …"). A **new chat** for that email appears in the Chat sidebar. *(TTS is skipped if you're mid voice-conversation — the toast still fires.)*
23. **Click the notification** → LifeOS opens the Chat screen with that email's chat selected, showing the summary (sender, subject, 1–2 sentences, any action items / dates).
24. Ask Yogi in that chat: **"Summarize this."** / **"Who sent it?"** / **"What action is required?"** → answers are grounded in the delivered email. *(Deep body questions like an exact tracking number are a known limitation — the body isn't in context yet.)*
25. Confirm your **normal** conversations are untouched: press `Shift+Alt+Space` (or reopen the app) → Yogi continues your most-recent **non-email** chat, NOT the new email chat.

**I. Phase 4 — web research.**
26. **Manual (verify this first — it's the shakiest):** with the web-search chain on (AI-assist + key + consent + web search enabled), open an email's chat and type **"research this"**. *Expected:* Yogi *should* show "🔎 Searching the web…" and reply with sources. If it instead answers without searching, the model under-classified the bare phrase — retry with **"research this email about the flight delay"** (naming the topic). This path is engine-provided but **unverified end-to-end**; if it still won't search, it's a prompt/classification tweak, not a Phase-4 rebuild.
27. **Automatic:** turn on **Automatic web research** (it stays disabled until AI summaries + Store email context + a key are on). Send yourself an email in the research-worthy class (e.g. a flight-delay or visa-status style message).
    - *Expected:* after the summary lands, a second **🔎 "I looked into this for you"** turn appears in that email's chat with an answer + sources. A newsletter/promo email should get **no** research turn.
28. Ask a follow-up in that chat ("what should I do about the delay?") → Yogi's answer uses the research it just did (it's in context).

*(Phase 5 adds hardening; semantic search over the whole mailbox is a later, separate phase.)*

**Phase 2 caveat:** desktop notifications and the real history-sync loop can only be verified on a machine with live Gmail credentials — they are covered here by construction + mocked-provider tests, not an end-to-end run.

**Troubleshooting — "Gmail API 403 on /messages/…" / 0 stored / no notifications.** Cause: the token was granted `gmail.metadata` (alongside `gmail.readonly`), which restricts `messages.get` to `format=metadata` and 403s `format=full`. Fix in-app: **Disconnect** (revokes the poisoned grant), then remove `gmail.metadata` from the Cloud OAuth consent screen (leave only `gmail.readonly`), then **Connect** again for a clean readonly-only token. A plain Reconnect is not enough if Google still has the metadata scope on the existing grant — Disconnect first so the grant is revoked. (First discovered on the live 2026-07-15 run; the requested scopes are now readonly-only by default.)
