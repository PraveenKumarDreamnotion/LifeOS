# Live Demo Guide

> **Home:** [docs/README.md](./README.md) · **Related:** [DEVELOPMENT_GUIDE](./DEVELOPMENT_GUIDE.md) · [TROUBLESHOOTING](./TROUBLESHOOTING.md)

How to run LifeOS and show it off. Windows is the target platform.

## 1. Prerequisites

- **Windows 10/11**, Node.js (LTS; the project targets Node 24 features via Electron), npm.
- A microphone (for voice) and speakers (for TTS).
- *Optional* for cloud features: an **OpenAI API key** ([platform.openai.com/api-keys](https://platform.openai.com/api-keys)).
- *Optional* for Gmail: a **Google Cloud "Desktop app" OAuth client** (client id + secret).

## 2. Install & fetch the STT model

```bash
npm install
npm run fetch:model   # downloads the ~68 MB offline STT model into resources/models/stt/
```

`fetch:model` pulls the `sherpa-onnx-streaming-zipformer-en` int8 model (Apache-2.0) and flattens it. It is required for offline voice; without it, STT will fail to load (typing still works).

## 3. Run (development)

```bash
npm run dev     # electron-vite dev: HMR renderer + Electron main
```

> **Important dev caveat:** `npm run dev` hot-reloads the **renderer** but does **not** restart the **main process**. Changes to `electron/` (the engine, scheduler, router, IPC) require a full quit-and-relaunch (or `npm run build && npm run start`). This has bitten before — the UI updated while the old backend logic kept running.

To run the built app:

```bash
npm run build
npm start        # electron-vite preview
```

## 4. Configure

### Fully offline (no configuration)

Just run it. The rail chip shows **`🔒 Offline · on-device`**. Reminders, time, schedules, greetings, and local commands work with **zero network**.

### Enable cloud intelligence (opt-in)

Settings → **OpenAI**:
1. Toggle **AI Assist** (a consent modal explains what leaves the device).
2. Paste your **API key** → Save → (optional) Validate. The key is DPAPI-encrypted and never returned.
3. Optionally set **STT provider** to OpenAI (consent-gated) for higher-accuracy transcription.

Settings → **Voice**: choose a voice provider (Windows or OpenAI), a personality (6 voices), speed; **Preview** to hear it.

The rail chip flips to **`☁ OpenAI connected`** once a key is present.

### Enable Gmail (opt-in)

Settings → **Integrations · Gmail**:
1. In Google Cloud Console, create a **Desktop app** OAuth client; add scope `gmail.readonly`.
2. Paste Client ID + Client Secret → Save.
3. **Connect** → complete the Google consent in your browser → **Test**.
4. Toggle sync, notifications, AI summaries, auto-research as desired.

> If you previously connected with a `gmail.metadata` scope and see 403s, **Disconnect → remove the metadata scope in Cloud Console → Connect** (a plain Reconnect keeps the poisoned scope). See [TROUBLESHOOTING](./TROUBLESHOOTING.md).

## 5. Demo script (what to show)

### Voice conversation
- Press **`Alt+Shift+Space`** → say *"Hello Yogi, tell me a joke."* → hear a spoken reply in the floating launcher.

### Natural-language reminder
- Say/type: *"Remind me in one minute to drink water."*
- Expect: a confirmation card (title "Drink water", ~1 minute from now). Confirm by clicking or saying **"yes"**.
- Wait ~1 minute → a Windows toast + a spoken line + the always-on-top popup. Say **"mark it done"** in the popup.

### Recurring reminder
- *"Remind me every Monday at 7 AM to exercise."* → confirm → appears under **Schedules** with "Every Monday 7:00 AM".

### Web search (needs a key + web search on)
- *"What's the contact number of NIT Hamirpur?"*
- Expect: "🔎 Searching the web…" then an answer with a **Sources** list.

### AI-task reminder (needs a key)
- *"Remind me in two minutes to tell me today's weather in Delhi."*
- Expect: at fire time Yogi speaks the *weather*, not the title.

### Offline demo (remove the key first)
- Rail chip shows `🔒 Offline · on-device`.
- *"What time is it?"* → instant local answer.
- *"Remind me in 5 minutes to stretch."* → a card → confirm → it schedules and fires — all with no network.
- *"Explain quantum computing."* → an honest "needs an online provider" notice.

### Gmail (if connected)
- Send yourself an email → within the sync interval, hear a spoken heads-up + see a new email chat → click it → ask *"What's the action item?"*

## 6. Expected results & known limitations

| You do | You get |
| --- | --- |
| Set a reminder offline | Confirmable card → toast + spoken line + popup on time |
| Ask a live-fact question online | Answer + sources, or an honest failure |
| Remove the API key | App is provably offline (chip + banner); cloud features disabled |
| Reset local data (type `RESET`) | Everything wiped, relaunch to onboarding |

**Known limitations for a demo:**
- **Dev/unpackaged shows "electron"** in Task Manager (the process is `electron.exe`); a packaged build (`npm run build:win`) shows "LifeOS".
- **Offline STT can mis-hear** command words; a normalizer catches the reminder cue, but expect occasional transcription noise.
- **Gmail phases 3–5** (email chats, auto-research) are verified by construction; a real inbound email is the live check.
- The launcher/popup GUI behaviours were verified by unit tests + code trace; a physical Windows drive is the standing manual gap.

## 7. Package a branded build

```bash
npm run build:win    # NSIS installer + portable exe under release/
```

Produces `LifeOS.exe` (per-user NSIS install, no UAC) and a portable exe. See [DEVELOPMENT_GUIDE §packaging](./DEVELOPMENT_GUIDE.md).
