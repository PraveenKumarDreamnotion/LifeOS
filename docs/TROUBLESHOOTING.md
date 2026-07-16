# Troubleshooting

> **Home:** [docs/README.md](./README.md) · **Related:** [DEVELOPMENT_GUIDE](./DEVELOPMENT_GUIDE.md) · [LIVE_DEMO](./LIVE_DEMO.md)

Known issues and their fixes, drawn from the engineering changelog. Most are documented root causes, not guesses.

## Development

### "My change to the engine/scheduler/router isn't taking effect"
**`npm run dev` hot-reloads the renderer but NOT the main process.** Anything under `electron/` needs a full quit-and-relaunch (or `npm run build && npm start`). Symptom: the UI updated but backend logic is stale. This caused a real multi-session detour — always relaunch after editing `electron/`.

### "A second instance won't open / the app seems frozen"
There's a **single-instance lock** (two schedulers on one WAL would double-fire). A second launch focuses the existing window and exits. If a stale `electron.exe` holds the lock, close it (careful — killing `electron.exe` in dev can affect other Electron apps).

### "Task Manager shows 'electron', not 'LifeOS'"
Expected in **dev/unpackaged** — the process is literally `electron.exe`. A packaged build (`npm run build:win`) produces `LifeOS.exe` and shows "LifeOS" everywhere (verified on disk: `release/win-unpacked/LifeOS.exe`, `ProductName=LifeOS`).

### "Voice/STT fails to load"
Run `npm run fetch:model` — the ~68 MB sherpa STT model must exist in `resources/models/stt/`. Without it, STT can't load (typing still works). In a packaged build it ships as `extraResources` and loads from `resourcesPath`.

## Voice

### "Yogi mis-hears my reminders" (e.g. "remind" → "remained")
Offline sherpa mis-transcribes the reminder cue. A **normalizer** (`core/parsing/normalize-reminder.ts`, bounded edit-distance) canonicalizes a mis-heard verb *followed by "me"* back to "remind me", so most offline reminders still parse. It is a safety net, not a cure — the real fix (future) is hotword/keyword boosting toward command vocabulary. If a reminder isn't recognized, rephrase clearly ("remind me in 2 minutes to …").

### "I can't hear Yogi speak"
Check Settings → Voice → **Preview** (does the sample play?). If Preview works but the launcher doesn't, it's a launcher-specific audibility issue (flagged as unverified in the changelog). Ensure `tts_enabled` is on. Cloud TTS falls back to the Windows voice on failure; if `tts_degraded` is set, a prior cloud attempt failed. The audio window reports `audio:playing`/`audio:playbackError` — check the main-process log.

### "TTS overlaps or clips"
When the reminder popup is enabled, it is the **sole speaker** (the trigger sink's TTS stands down). If you see a double, confirm `reminder_popup_enabled` and that only one speaker path is active. A reminder firing mid-conversation pauses the conversation first.

### "The Stop-speaking button doesn't appear"
It's driven by `tts:speaking`, which the audio window emits via `audio:playing`. If TTS ran but no button showed, the audio window's playback events (`playing`/`ended`/`pause`/`error`) may not have fired — check the audio-host log.

## Conversation / AI

### "Yogi says it can't browse the internet"
The system prompt forbids this; if it happens, web search is off or not consented. Enable Settings → OpenAI (AI Assist + key) and `web_search_enabled`. A live-fact question should show "🔎 Searching the web…".

### "A web-search question just replies 'Let me look that up…' and stops"
This was a real routing bug (fixed): `research`-intent turns skipped the search branch. If you still see it, confirm you're on a build after that fix and that a search provider is configured. The engine now forces a search for `research` and backstops the flag with a reply-text heuristic.

### "Yogi claimed it set a reminder but nothing was created"
A **reliability guard** now rewrites a fabricated success into an honest failure. If a specific phrasing isn't recognized by the parser, it will say "I couldn't set that reminder just now — please try again, e.g. 'remind me in 2 minutes to …'". Rephrase with a clear cue.

### "Offline, everything says 'Connect OpenAI…'"
With no key, reminders, time/date, greetings, help, and "open settings"/"show schedules" work locally; only genuine reasoning gets the honest notice. If a reminder gets the notice, it's likely an STT mis-hear (see above) or a phrasing the local parser doesn't recognize.

## Reminders

### "A reminder didn't fire while the PC was asleep/closed"
- While the PC is fully **off**, nothing fires — the **startup catch-up** reports one-time reminders missed while closed (OverdueModal) and rolls recurring ones forward.
- On sleep/lock, `powerMonitor` resume/unlock triggers a reconcile.
- Consider enabling **Start at login** (Settings → Window & tray) so the scheduler runs more of the time.

### "A reminder is stuck / won't fire on time"
The scheduler reconciles every 30 s and immediately on a mutation. Check it isn't **paused** (tray/banner). Check `next_fire_at` in the DB.

## Gmail

### "Every email fetch returns 403 / 0 emails stored"
The classic bug: a **`gmail.metadata` scope poisons the token** — `messages.get` with `format=full` (used when "Download attachments" is on) 403s even with `readonly` also granted. **Fix: Disconnect → remove the metadata scope in Google Cloud Console → Connect.** A plain Reconnect keeps the revoked-but-still-granted metadata scope. The app now requests **`gmail.readonly` only**.

### "Connected but no new-email notifications"
- Check `gmail_enabled`, `gmail_notifications`, and the sync mode (5min/15min/manual).
- Initial sync **never notifies** (avoids a whole-inbox storm); only genuinely new INBOX+UNREAD mail after the first sync triggers delivery.
- Startup catch-up stores the backlog but suppresses the delivery burst — use **Sync now** for a deliberate delivery.

### "Auto-research didn't fire on an important email"
It's gated (key + AI summaries + Store email context + Auto research on) and only fires for a narrow class (visa/flight/gov-legal/shipping/admission/conference). The manual "research this email" path is model-dependent (gpt-4o-mini must classify it `research`) — phrase it "research this email about X" if the bare phrase under-triggers.

## Data & reset

### "How do I wipe everything?"
Settings → Danger zone → **Reset Local Data** → type `RESET`. It revokes the Google grant (if connected), deletes `lifeos.db` (+ sidecars — which holds *all* data, settings, and encrypted secrets), and relaunches to onboarding. Irreversible.

### "Where's my data?"
`%APPDATA%\LifeOS\lifeos.db` (packaged) or `%APPDATA%\lifeos\lifeos.db` (dev), WAL mode.

## Packaging / install

### "Windows SmartScreen warns about the installer"
The installer is **unsigned** — an availability issue, not a security one. Documented; checksums accompany releases.
