# 09 — Optional OpenAI AI Assist Architecture

> **Status:** Tier 2. Off by default. Cuttable on Day 6 (the *interface* and the disabled toggle must still ship).
>
> **The one rule that governs this entire document:**
> *The LLM is a **suggestion engine**, not an actuator. It proposes a JSON object. A human presses a button. Nothing else creates a reminder.*

---

## 1. When it runs

AI Assist is invoked **only** at one place in the pipeline (`08` §1, step 7):

```text
local confidence < 0.55
  AND settings.ai_assist_enabled === 'true'
  AND settings.ai_only_when_uncertain === 'true'  (or the user disabled that guard)
  AND an API key is present
  AND the user is online
      ↓
  sendToLLM(transcript)  ←  TEXT ONLY. Never audio. Never the database.
      ↓
  validate(response)     ←  four independent gates, §5
      ↓
  ConfirmationCard       ←  the SAME card the local parser produces
      ↓
  user presses Confirm   ←  the SAME gate
      ↓
  repository.create()
```

Everything downstream of `validate()` is identical whether the parse came from `local` or `llm`. There is exactly **one** path to persistence, and it runs through a button.

The motivating example from the brief:

> *"Can you make sure I do not forget to call Rahul around sunset tomorrow?"*

The local parser scores this low: `make sure I do not forget` matches a REMIND pattern, but chrono cannot resolve `around sunset`. Confidence lands near 0.4. With AI Assist on, the LLM proposes 7:00 PM and — critically — sets `needsClarification: true`, so Yogi still asks.

## 2. What is sent, and what never is

| Sent | Never sent |
| --- | --- |
| The single command's **text transcript** | Audio, ever |
| The current **ISO datetime + IANA timezone** (so the model can resolve "tomorrow") | Reminders, past or future |
| A static system prompt | Reminder history |
| | Memories |
| | Conversation history |
| | Settings |
| | Any identifier, device ID, or telemetry |

`MVP DECISION` — The request body is constructed from **exactly two runtime values**: `transcript` and `nowIso`. There is no code path that reads the database and puts it in an HTTP request. This is enforced by a unit test that snapshots the outbound payload shape.

`MVP DECISION` — The disclosure text, shown in Settings and in the consent modal, is verbatim:

> *AI Assist may send your command text to your selected AI provider when local understanding is uncertain. Your reminders and local data remain stored on your device.*

## 3. Consent

`MVP DECISION` — The toggle **does not flip** until the user reads and accepts the consent modal (`12` §8.2). Enabling is a deliberate act.

```ts
settings:
  ai_assist_enabled          = 'false'   // default
  ai_provider                = 'openai'
  ai_only_when_uncertain     = 'true'    // default; recommended
  ai_consent_accepted_at     = null      // ISO timestamp, set by the modal
  ai_last_used_at            = null      // shown in Settings for transparency
  ai_key_ciphertext          = null      // base64, see §7
```

`MVP DECISION` — If `ai_consent_accepted_at` is null, the network call is refused **in the main process**, not merely hidden in the UI. Consent is a server-side check in a client-side app: the renderer cannot be trusted to have enforced it.

`MVP DECISION` — Settings shows `Last used: <timestamp>` or `Never`. A privacy-first app that quietly phones home once a week is worse than one that never claimed to be private.

## 4. The request

`MVP DECISION` — Use OpenAI's **Structured Outputs** (`response_format: { type: 'json_schema', strict: true }`), not prompt-begging for JSON. `RISK (low)` — this constrains the model at the decoding level, which eliminates the "model returned prose around the JSON" failure mode. It does **not** eliminate the need for our own validation (§5): a schema-valid object can still contain a date in the past or an intent we do not support.

```ts
const SYSTEM_PROMPT = `
You convert a single natural-language reminder request into structured JSON.

Rules:
- You may ONLY use intent "create_reminder" or "create_sing_reminder".
- If the request is not about setting a reminder, return intent "unknown".
- Resolve all relative times against the provided current time and timezone.
- Return scheduledAt as an ISO 8601 string WITH offset.
- recurrenceRule may only be null, "FREQ=DAILY;BYHOUR=<h>;BYMINUTE=<m>",
  or "FREQ=WEEKLY;BYDAY=<MO|TU|WE|TH|FR|SA|SU>;BYHOUR=<h>;BYMINUTE=<m>".
- If ANY of {date, time, AM/PM} is genuinely uncertain, set needsClarification=true
  and ask ONE short question. Prefer asking over guessing.
- Never invent a time the user did not imply. "Around sunset" may become 7:00 PM,
  but you MUST set needsClarification=true.
- Output ONLY the JSON object.
`.trim();

const body = {
  model: 'gpt-4o-mini',
  temperature: 0,
  max_tokens: 400,
  messages: [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user',   content: JSON.stringify({ transcript, now: nowIso, timezone: tz }) },
  ],
  response_format: { type: 'json_schema', strict: true, json_schema: REMINDER_JSON_SCHEMA },
};
```

`MVP DECISION` — `temperature: 0`. Reminder parsing is not a creative task.

`MVP DECISION` — Model `gpt-4o-mini`. It is more than adequate for slot-filling and it is the cheapest sensible option (§8). The model name lives in `settings` so a user can change it without a release.

### 4.1 Expected response (the brief's example, unchanged)

```json
{
  "intent": "create_reminder",
  "title": "Call Rahul",
  "description": "Call Rahul around sunset tomorrow",
  "scheduledAt": "2026-07-11T19:00:00+05:30",
  "timezone": "Asia/Kolkata",
  "recurrenceRule": null,
  "confidence": 0.82,
  "needsClarification": true,
  "clarificationQuestion": "Would you like me to set this reminder for 7:00 PM tomorrow?",
  "assistantResponse": "I can remind you tomorrow evening to call Rahul. Would 7:00 PM work?"
}
```

## 5. Validation — four independent gates

The brief lists the required checks. Here they are as executable gates, in order. **Each is sufficient to reject.** The response is a hostile input until it has passed all four.

### Gate 1 — Shape (Zod)

```ts
const LlmReminderSchema = z.object({
  intent: z.enum(['create_reminder', 'create_sing_reminder', 'unknown']),   // closed set
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(1000).nullable(),
  scheduledAt: z.string().datetime({ offset: true }),
  timezone: z.string().refine(isValidIanaZone, 'unknown timezone'),
  recurrenceRule: z.string().regex(SUPPORTED_RRULE_RE).nullable(),
  confidence: z.number().min(0).max(1),
  needsClarification: z.boolean(),
  clarificationQuestion: z.string().max(300).nullable(),
  assistantResponse: z.string().max(500),
}).strict();   // ← unknown keys are a REJECTION, not something to ignore

const SUPPORTED_RRULE_RE =
  /^FREQ=(DAILY;BYHOUR=\d{1,2};BYMINUTE=\d{1,2}|WEEKLY;BYDAY=(MO|TU|WE|TH|FR|SA|SU);BYHOUR=\d{1,2};BYMINUTE=\d{1,2})$/;
```

`MVP DECISION` — `.strict()` matters. An LLM that returns an extra `"action": "run_script"` key must fail loudly, not have it silently dropped.

### Gate 2 — Semantics

```ts
function validateSemantics(r: LlmReminder, now: number): Result {
  if (r.intent === 'unknown')                    return reject('unsupported_intent');
  if (!r.title.trim())                           return reject('empty_title');

  const at = DateTime.fromISO(r.scheduledAt, { setZone: true });
  if (!at.isValid)                               return reject('invalid_date');
  if (at.toMillis() <= now)                      return reject('date_in_past');
  if (at.toMillis() > now + 2 * YEAR_MS)         return reject('date_too_far');

  if (r.recurrenceRule && !parsesAsSupportedRule(r.recurrenceRule))
                                                 return reject('unsupported_recurrence');
  if (r.needsClarification && !r.clarificationQuestion)
                                                 return reject('clarification_without_question');
  return ok(r);
}
```

### Gate 3 — Safety scan

The brief requires: *"No unsafe action is requested. No shell command exists. No system command exists."*

```ts
const UNSAFE_PATTERNS = [
  /\b(?:powershell|cmd\.exe|bash|sh|wscript|cscript|rundll32|regsvr32|mshta)\b/i,
  /\b(?:reg\s+add|reg\s+delete|schtasks|net\s+user|takeown|icacls)\b/i,
  /\b(?:rm\s+-rf|del\s+\/[sf]|format\s+[a-z]:|rmdir\s+\/s)\b/i,
  /\b(?:Invoke-Expression|iex|Start-Process|Add-Type|DownloadString)\b/i,
  /\b(?:eval|exec|child_process|require\s*\()\b/i,
  /(?:^|\s)(?:https?|file|ftp):\/\//i,
  /[;&|`$]{1,}\s*\w/,                 // shell metacharacters followed by a word
  /<script|javascript:|data:text\/html/i,
];

function scanForUnsafeContent(r: LlmReminder): Result {
  const surfaces = [r.title, r.description ?? '', r.assistantResponse, r.clarificationQuestion ?? ''];
  for (const s of surfaces)
    for (const p of UNSAFE_PATTERNS)
      if (p.test(s)) return reject('unsafe_content');
  return ok(r);
}
```

`MVP DECISION` — This gate is **defence in depth, not the defence.** The actual defence is that **nothing in LifeOS ever executes a string.** There is no `eval`, no `new Function`, no `child_process` call that takes a dynamic argument (`11` §7). A reminder title reading `rm -rf /` is stored as a title and rendered as text — inert. The scan exists so that a compromised or prompt-injected model produces an *error the user sees* rather than a plausible-looking reminder titled `Invoke-Expression (New-Object Net.WebClient).DownloadString(...)`.

`RISK (low, accepted)` — A legitimate reminder like *"remind me to run the format C: test in the lab"* would be rejected. The user can edit and re-submit through the local path. False positives here are cheap; false negatives are not.

### Gate 4 — The confirmation gate

```ts
// There is no function called createReminderFromLlm(). It does not exist.
// The only writer is:
ipcMain.handle('reminders:create', async (_e, payload) => {
  const input = CreateReminderInput.parse(payload);      // from the RENDERER, after Confirm
  return repo.create(input);
});
```

`MVP DECISION` — The LLM response never reaches `repo.create()`. It reaches `ConfirmationCard`. The card's Confirm button constructs a `CreateReminderInput` from **what is displayed on screen**, which the user has read and may have edited. The provenance is recorded as `source: 'llm'` so history can show it.

`MVP DECISION` — If `needsClarification` is true, the card is a **Clarification card**, which has **no Confirm button at all**. The model cannot escape the clarification by claiming high confidence.

## 6. Failure handling

`MVP DECISION` — **Every AI Assist failure degrades to the local clarification question.** The feature can never make the app worse than not having it.

| Failure | Behaviour |
| --- | --- |
| No network | Skip the call. Local clarification. Toast: *"AI Assist needs a connection."* |
| 401 / invalid key | Local clarification. Settings banner: *"Your API key was rejected."* Disable further calls this session. |
| 429 rate limit | One retry with 2 s backoff, then local clarification. |
| 5xx | One retry, then local clarification. |
| Timeout (> 8 s) | Abort. Local clarification. |
| Any validation gate fails | Local clarification. Log the rejection reason to `app_logs`. **Never surface the raw LLM output.** |
| Response is unparseable JSON | Same as above. |

```ts
const AI_TIMEOUT_MS = 8_000;
// A user waiting 8 seconds for a reminder has already lost. Fail fast, ask locally.
```

`MVP DECISION` — Rejections are logged with the reason code and a **hash** of the transcript, never the transcript itself. Logs are local, but they are still logs.

## 7. API key storage

The brief asks for the key to be *"Stored locally and encrypted if possible."* It is possible.

`MVP DECISION` — Use Electron's **`safeStorage`**, which is backed by DPAPI on Windows and ties the ciphertext to the current Windows user account.

```ts
import { safeStorage } from 'electron';

export function storeApiKey(plaintext: string): void {
  if (!safeStorage.isEncryptionAvailable()) throw new EncryptionUnavailableError();
  const ciphertext = safeStorage.encryptString(plaintext);
  settings.set('ai_key_ciphertext', ciphertext.toString('base64'));
}

export function readApiKey(): string | null {
  const b64 = settings.get('ai_key_ciphertext');
  if (!b64) return null;
  return safeStorage.decryptString(Buffer.from(b64, 'base64'));
}
```

Invariants:

- `RISK (medium)` — `safeStorage.isEncryptionAvailable()` can return `false`. `MVP DECISION` — if it does, **refuse to store the key**, tell the user why, and offer to keep it in memory for the session only. Never silently write a plaintext key to disk.
- `MVP DECISION` — The key **never crosses IPC to the renderer.** `settings:get` returns `{ hasApiKey: true }`, never the value. The Settings UI renders `••••••••` from a boolean.
- `MVP DECISION` — The key is read in the main process, at call time, and passed straight to `fetch`. It is never logged, never included in an error message, never written to `app_logs`.
- `MVP DECISION` — "Reset LifeOS Local Data" deletes the ciphertext with everything else.
- `RISK (low, accepted)` — DPAPI ciphertext is decryptable by any process running as the same Windows user. This is the platform's security model, and it is what every Electron app does. It defends against a copied `%APPDATA%` folder, not against malware already running as the user. Stated plainly in `22-privacy-policy-and-disclosures.md`.

## 8. Cost

`VERIFIED FACT` — OpenAI pricing, July 2026, for the models relevant here:

| Model | Input | Output |
| --- | --- | --- |
| `gpt-4o-mini` | ~$0.15 / 1M tokens | ~$0.60 / 1M tokens |

A single AI Assist call is roughly **250 input + 150 output tokens** (system prompt + one sentence + one small JSON object).

```text
per call    ≈ 250 × $0.15/1M  +  150 × $0.60/1M
            ≈ $0.0000375 + $0.00009
            ≈ $0.00013                    ≈ ₹0.011
```

`ASSUMPTION` — AI Assist fires only when local confidence < 0.55. On the fixture corpus (`18` §3), that is ~8% of commands. A heavy user creating 10 reminders/day would trigger it under once a day.

```text
30 calls/month  ≈ $0.004/month  ≈ ₹0.33/month
```

`MVP DECISION` — **LifeOS's operating cost remains ₹0.** The user brings their own key and is billed by OpenAI directly. LifeOS never proxies a request, never holds a shared key, and never sees a bill. The consent modal states this:

> *Requests go to OpenAI under your own API key and are billed to your OpenAI account. Typical cost is well under ₹1 per month for normal use.*

`RISK (low)` — A user could set `ai_only_when_uncertain = false`, sending every command to OpenAI. That is ~₹4/month at 10/day. The setting is labelled *(recommended: on)* and defaults to on.

## 9. The provider interface

```ts
// core/ai/ai-assist-provider.ts — no Electron imports, no fetch import
export interface AiAssistProvider {
  readonly id: 'openai' | 'anthropic' | 'ollama';
  readonly isLocal: boolean;
  parse(input: AiParseInput, signal: AbortSignal): Promise<AiParseRaw>;
}

export interface AiParseInput { transcript: string; nowIso: string; timezone: string; }
export type AiParseRaw = unknown;   // ← deliberately `unknown`. It has not been validated yet.
```

`MVP DECISION` — `parse()` returns **`unknown`**, not a typed object. The type system should force the caller through Zod. A provider that returns `Promise<LlmReminder>` is a provider that has lied about having validated something.

```text
AiAssistProvider
├── OpenAiAssistProvider   ← MVP (Tier 2)
├── OllamaAssistProvider   ← future: fully local LLM, restores offline-first
└── AnthropicAssistProvider← future
```

`FUTURE OPTION` — **Ollama** is the interesting one. A local `llama3.2:3b` behind the same interface would give AI Assist's flexibility with **zero network, zero cost, and zero disclosure**, collapsing this document's entire consent apparatus. It is the right long-term answer for a privacy-first product and belongs in v0.4 (`24-future-roadmap.md`).

## 10. What AI Assist is explicitly forbidden from doing

Restating the brief's constraints as invariants a reviewer can check by grepping:

| Forbidden | Enforced by |
| --- | --- |
| Creating a reminder | No code path from `parse()` to `repo.create()`. Only `ipcMain.handle('reminders:create')` writes, and only the renderer's Confirm button calls it. |
| Editing or deleting a reminder | AI Assist is invoked only from the parse pipeline. `repo.update`/`repo.delete` have no LLM caller. |
| Triggering a reminder | The scheduler reads `next_fire_at` from SQLite. It has no LLM dependency and no network dependency. |
| Executing anything | No `eval`, no `new Function`, no `child_process` with a dynamic argument, anywhere in the codebase (`11` §7). |
| Reading user data | The request body is built from `transcript` and `nowIso`. Asserted by a payload-snapshot test. |
| Running when disabled | Consent checked in **main**, not the renderer. |
| Bypassing confirmation | `needsClarification: true` renders a card with no Confirm button. |

## 11. Testing

```ts
// tests/unit/ai-assist-validation.test.ts
describe('LLM response validation', () => {
  it('rejects an unknown intent',                () => expectReject({ intent: 'delete_all_reminders' }, 'unsupported_intent'));
  it('rejects an extra key',                     () => expectReject({ ...valid, action: 'run' },        'shape'));
  it('rejects a past date',                      () => expectReject({ ...valid, scheduledAt: yesterday }, 'date_in_past'));
  it('rejects an unsupported RRULE',             () => expectReject({ ...valid, recurrenceRule: 'FREQ=MONTHLY' }, 'unsupported_recurrence'));
  it('rejects a shell command in the title',     () => expectReject({ ...valid, title: 'Invoke-Expression $x' }, 'unsafe_content'));
  it('rejects a URL in assistantResponse',       () => expectReject({ ...valid, assistantResponse: 'see https://evil.tld' }, 'unsafe_content'));
  it('rejects clarification without a question', () => expectReject({ ...valid, needsClarification: true, clarificationQuestion: null }, 'clarification_without_question'));
  it('accepts the brief\'s example verbatim',    () => expectAccept(BRIEF_EXAMPLE));
});

// tests/unit/ai-assist-payload.test.ts
it('never includes database content in the request body', async () => {
  const captured = await captureOutboundRequest(() => provider.parse(input, signal));
  const body = JSON.stringify(captured.body);
  expect(body).not.toContain('reminders');
  expect(body).not.toContain(SEEDED_REMINDER_TITLE);
  expect(Object.keys(captured.body.messages[1])).toEqual(['role', 'content']);
});

// tests/unit/ai-assist-consent.test.ts
it('refuses to call the network when consent is absent, even if the renderer asks', async () => {
  settings.set('ai_consent_accepted_at', null);
  await expect(aiAssist.parse(input)).rejects.toThrow(ConsentRequiredError);
  expect(fetchSpy).not.toHaveBeenCalled();
});
```

`MVP DECISION` — The payload test and the consent test are **not optional even if AI Assist is cut on Day 6.** If the code exists in the repository, its safety properties must be pinned. If it is cut, cut the code, not the tests.
