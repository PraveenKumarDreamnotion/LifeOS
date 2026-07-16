# Technology Stack

> **Home:** [docs/README.md](./README.md) · **Rationale sources:** `docs/lifeos-planning/04-technology-research.md`, `05-framework-decision.md`, `06-speech-to-text-research.md`, `07-text-to-speech-research.md`

Versions are from `package.json`. "Why chosen" and "alternative considered" draw from the decision records in `lifeos-planning/`, not inference.

## Core stack

| Technology | Version | Purpose | Why chosen | Alternative considered |
| --- | --- | --- | --- | --- |
| **Electron** | 43.1.0 | Desktop shell (Chromium 150 + Node 24) | The developer already knows JS/TS; the hard parts (scheduler, STT binding, NL parser, tray, toasts) are all Node-shaped. Main process is a plain Node loop, **never throttled** — ideal for a scheduler. | **Tauri 2** (forces Rust for scheduler/STT/persistence; no `chrono-node` equiv; inconsistent WebView2 `speechSynthesis`); **Flutter** (new language; least-mature desktop embedding) — see `05-framework-decision.md` |
| **React** | 19 | Renderer UI | Component model, huge ecosystem, ports to a future Tauri renderer unchanged | Svelte, vanilla — React chosen for familiarity + tooling |
| **TypeScript** | 5.7 | Language everywhere | One language across main/renderer/core; strict typing at the IPC + LLM boundaries | Plain JS |
| **Vite / electron-vite** | Vite 6 / electron-vite 5 | Build tooling | Bundles main/preload/renderer with correct defaults; **bundles each preload to a single file** (a hard requirement of `sandbox:true`); HMR for renderer | Raw Vite + hand-rolled config; electron-forge (more friction for NSIS + portable) |
| **electron-builder** | 26 | Packaging | NSIS installer + portable exe; per-user install (no UAC); GitHub publish from env var | electron-forge |

## Data & logic

| Technology | Version | Purpose | Why chosen | Alternative considered |
| --- | --- | --- | --- | --- |
| **`node:sqlite`** | built into Electron 43 | Local database (WAL) | **No native module, no rebuild, no `asarUnpack`** — sidesteps the ABI/rebuild pain of native SQLite. Behind a swappable `SqliteDriver` interface. | **`better-sqlite3`** (kept as the fallback driver seam; would need prebuilt binaries + unpack) |
| **chrono-node** | 2.9.1 | Natural-language date parsing | Maintained, TS types, exactly the NL date parsing the reminder parser needs. `forwardDate` mode is mandatory. | Rust `chrono` is a date library not an NL parser; no Dart equiv — a decisive point against Tauri/Flutter |
| **Luxon** | 3.7.2 | Date math / recurrence | DST-correct next-occurrence math; timezone-aware; RRULE strings computed by hand on top of it | `date-fns`, `moment` (deprecated) |
| **Zod** | 4.4.3 | Validation | `.strict()` at every IPC handler and on the LLM turn schema — an unknown key is a rejection, not silently ignored | io-ts, manual validation |

## Voice (speech-to-text / text-to-speech)

| Technology | Version | Purpose | Why chosen | Alternative considered |
| --- | --- | --- | --- | --- |
| **`sherpa-onnx-node`** | 1.13.4 | **Local** STT (default) | Native N-API, prebuilt Windows DLLs, streaming Zipformer (~68 MB int8). On-device, no consent needed, zero network. The default STT. | whisper.cpp (kept as an optional offline seam); cloud-only STT (rejected as the default) |
| **OpenAI `gpt-4o-transcribe`** | API | **Cloud** STT (opt-in) | Higher accuracy when the user opts in; batch WAV POST with **transparent fallback to sherpa** on any failure | Deepgram (wired as an optional streaming-cloud seam) |
| **Web `speechSynthesis`** | Chromium/OS | **Local** TTS (default) | Offline OS voices, zero network, in the hidden audio window | — |
| **OpenAI `gpt-4o-mini-tts`** | API | **Cloud** TTS (opt-in) | Natural voices; **streamed** to the audio window via Media Source Extensions for low latency (blob fallback) | ElevenLabs, Azure (cost/lock-in) |

> Note: the seeded default STT model key is `gpt-4o-transcribe` (`settings-repository.ts:32`); the provider config falls back to `gpt-4o-mini-transcribe` only when the value is empty.

## Intelligence (LLM / search)

| Technology | Version | Purpose | Why chosen | Alternative considered |
| --- | --- | --- | --- | --- |
| **OpenAI `gpt-4o-mini`** | API | Conversation LLM (opt-in) | Cheap, fast, supports strict **Structured Outputs** (the app forces a single validated JSON turn). Non-streaming by design (streaming channel reserved). | Larger GPT-4 models (cost); Ollama/local (a **planned** future seam) |
| **OpenAI `gpt-4o-mini-search-preview`** | API | Web search (opt-in) | A search-capable model that returns `url_citation` annotations the app parses into sources. A **separate seam** from the LLM. | Brave/Tavily search APIs (drop-in later) |

## Security & platform

| Technology | Purpose | Notes |
| --- | --- | --- |
| **Electron `safeStorage` (Windows DPAPI)** | Encrypt the OpenAI API key + Gmail OAuth tokens + client secret at rest | Ciphertext lives in a `settings` row; plaintext is produced only in main and **never crosses IPC** |
| **Content-Security-Policy** | Response-header CSP (`electron/main/session.ts`) | `script-src 'self'`, no `unsafe-inline`/`unsafe-eval` in production; `connect-src` opens `api.openai.com` only when a cloud feature is enabled |
| **Google OAuth (loopback + PKCE)** | Gmail connect | `http://127.0.0.1:<ephemeral-port>` loopback + PKCE S256; scope `gmail.readonly` only |

## Tooling

| Technology | Version | Purpose | Notes |
| --- | --- | --- | --- |
| **Vitest** | 2.1 | Unit + integration + renderer tests | 523 tests / 55 files; jsdom only for `tests/renderer/**` |
| **@testing-library/react** | 16 | Renderer hook tests | Used by `tests/renderer/useConversation.test.tsx` |
| **ESLint** | 9 (flat config) | Linting | Enforces `core/` purity; bans `child_process`/`eval`; only `reset-service.ts` may import `fs` |
| **typescript-eslint** | 8 | TS lint rules | `no-explicit-any` is a warning |
| **Prettier** | — | **Not configured** | No Prettier config in the repo; formatting conventions are conveyed via ESLint only |
| **npm** | — | Package manager | `package-lock.json`; no pnpm/yarn |

## Runtime dependencies (the whole list)

Only **four** runtime deps ship — a deliberate small surface:

```json
"chrono-node": "^2.9.1",   // NL date parsing
"luxon": "^3.7.2",         // date math / recurrence
"sherpa-onnx-node": "^1.13.4", // local STT
"zod": "^4.4.3"            // validation
```

Everything else (React, Electron, Vite, Vitest, TypeScript, electron-builder) is a **devDependency** — bundled at build time, not shipped as a node_modules tree (except native modules `sherpa-onnx-node`, which is `asarUnpack`ed).

## Why the stack, in one sentence

**Electron + TypeScript keeps every hard component (scheduler, streaming STT, NL parser, tray, toasts) in the one language the developer knows, while the pure `core/` layer keeps the whole decision reversible** — a Tauri or mobile port would replace only `electron/` and rewire IPC. See `docs/lifeos-planning/05-framework-decision.md` (ADR-001).
