# 21 — Release and GitHub Plan

---

## 1. Repository

```text
github.com/<user>/lifeos          public, MIT
```

| Item | Value |
| --- | --- |
| Description | Yogi — a privacy-first AI reminder companion for Windows. Everything stays on your device. |
| Topics | `electron` `react` `typescript` `sqlite` `privacy-first` `local-first` `speech-to-text` `reminders` `offline` |
| Default branch | `main` |
| License | MIT |
| Issues | On |
| Discussions | On |
| Wiki | Off (docs live in `/docs`) |
| Branch protection | Not for a solo MVP. Add when there are two contributors. |

`MVP DECISION` — The `docs/lifeos-planning/` folder ships **in the repository**. It is the strongest evidence that the architecture was reasoned about rather than assembled, and it is what lets someone else pick the project up.

## 2. Versioning

Semantic versioning from `0.1.0`. Pre-1.0 means: the schema may change between minors, and it will be migrated forward, never backward.

| Version | Meaning |
| --- | --- |
| `0.1.0` | This MVP |
| `0.1.x` | Bug fixes only. No schema changes. |
| `0.2.0` | Auto-update, opt-in autostart, JSON export |
| `1.0.0` | When the confirmation gate, the scheduler and the privacy claims have survived real users for a quarter |

## 3. Build and publish

`VERIFIED FACT` — If `GH_TOKEN` or `GITHUB_TOKEN` is present in the environment, electron-builder's publish config defaults to `[{provider:"github"}]` and creates a **draft** release for the tag. (https://www.electron.build/publish.html)

```bash
# Local, from a clean tree, on Windows
npm ci
npm run typecheck && npm run lint && npm run test:unit && npm run test:integration
npm run build

export GH_TOKEN=ghp_xxx        # scope: repo  (or fine-grained: Contents read+write)
npx electron-builder --win --publish always
```

Artifacts:

```text
release/
  LifeOS-Setup-0.1.0.exe          # NSIS installer, per-user, no admin
  LifeOS-0.1.0-portable.exe       # portable, no install
  latest.yml                      # for a future electron-updater
  SHA256SUMS.txt                  # generated separately; see §6
```

`VERIFIED FACT` — GitHub Releases limits: **2 GiB per asset**, up to **1000 assets per release**. An Electron installer with a 40 MB STT model lands around 150 MB, so this is not a constraint.

### The release workflow

```yaml
# .github/workflows/release.yml
name: release
on:
  push:
    tags: ['v*']

jobs:
  build:
    runs-on: windows-latest        # the only OS that matters here
    permissions:
      contents: write              # required to create the release
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 24, cache: npm }
      - run: npm ci
      - run: npm run typecheck
      - run: npm run lint
      - run: npm run test:unit
      - run: npm run test:integration
      - run: npx electron-builder --win --publish always
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
      - name: Checksums
        run: |
          Get-FileHash release/*.exe -Algorithm SHA256 |
            ForEach-Object { "$($_.Hash.ToLower())  $(Split-Path $_.Path -Leaf)" } |
            Out-File -Encoding utf8 release/SHA256SUMS.txt
      - uses: softprops/action-gh-release@v2
        with:
          draft: true
          files: release/SHA256SUMS.txt
```

`MVP DECISION` — The release is created as a **draft**. It is published by a human, after that human has downloaded the artifact from GitHub and installed it on a machine that has never seen the source. CI proves the build compiles. Only a human can prove it installs.

`RISK (medium)` — CI cannot run the manual checklist. The Day-7 gate is therefore manual and non-negotiable (`20` step 20).

## 4. Code signing — the honest position

`VERIFIED FACT` — An **unsigned** NSIS installer downloaded from GitHub carries the Mark-of-the-Web and triggers:

> **Windows protected your PC**
> Microsoft Defender SmartScreen prevented an unrecognized app from starting.
> Publisher: **Unknown**

The user must click *More info → Run anyway*. The second click is deliberately buried. (electron-builder#8764)

### Options

| Option | Cost/year | SmartScreen | Notes |
| --- | --- | --- | --- |
| **Unsigned** | **₹0** | Warning, every user, forever | `MVP DECISION` |
| Azure Trusted Signing | ~$120 | Reputation accrues | Cheapest legitimate route. `RISK` — eligibility has historically required an organisation ≥ 3 years old; issues short-lived certs. |
| OV certificate | ~$200–400 | Reputation accrues over downloads | Cloud/HSM delivered. |
| EV certificate | ~$400–900 | **Instant trust** | Business only; hardware token/HSM. |

`VERIFIED FACT` — SmartScreen reputation is per-signing-identity **and** per-file-hash, and accrues as clean installs accumulate. EV bypasses the wait entirely.

`VERIFIED FACT` — Since **2026-03-01**, maximum code-signing certificate validity dropped to **~460 days (~15 months)** industry-wide. Expect roughly annual renewals.

`MVP DECISION` — **Ship unsigned.** ₹0 is a hard constraint of the brief. Mitigate honestly:

1. A screenshot of the exact warning in the README, with the two clicks labelled.
2. Published **SHA-256 checksums** so users can verify integrity independently of Microsoft.
3. A one-line explanation of *why*: "LifeOS is unsigned because a code-signing certificate costs money this free project doesn't have."
4. Never tell a user to disable SmartScreen. Ever.

`FUTURE OPTION` — Azure Trusted Signing at v0.2, if the project attracts users.

## 5. The README

Structure, in order. The order matters: a stranger decides in fifteen seconds.

```markdown
# LifeOS — meet Yogi
> A privacy-first AI reminder companion for Windows. Everything stays on your device.

![demo](docs/demo.gif)          ← 60–90s. Speak → confirm → get reminded.

## What it does
Speak a reminder. See exactly how Yogi understood it. Confirm. Get reminded — with
a Windows notification and a spoken reminder — at the right time. Offline.

## Privacy in one paragraph
LifeOS has no server, no account, and no sync. Your reminders live in a SQLite file
at %APPDATA%\LifeOS\. Speech is transcribed on your computer. Nothing is uploaded
unless you explicitly enable AI Assist, which is off by default. There is no telemetry.
[Full privacy statement →](PRIVACY.md)

## Install
1. Download `LifeOS-Setup-0.1.0.exe` from [Releases](…).
2. Windows will show "Windows protected your PC". This is because LifeOS is not
   code-signed — a certificate costs money this free project doesn't have.
   Click **More info** → **Run anyway**.        ![smartscreen](docs/smartscreen.png)
3. LifeOS installs for your user only. **It never asks for administrator access.**

Verify your download (optional):
    Get-FileHash LifeOS-Setup-0.1.0.exe -Algorithm SHA256
Compare against `SHA256SUMS.txt` in the release.

## ⚠️ Important: reminders need LifeOS running
Closing the window keeps Yogi in the system tray so reminders still fire.
**If you Quit from the tray menu, reminders will not fire until you reopen LifeOS.**
LifeOS does not add itself to Windows startup. That is deliberate.

## Supported commands
…the 14 examples, verbatim…

## What Yogi asks about instead of guessing
| You say | Yogi asks |
| "remind me at 6" | Six in the morning, or six in the evening? |
…

## Known limitations
→ [docs/lifeos-planning/23-known-limitations.md]

## Screenshots
## How it works (architecture)
## Building from source
## Roadmap
## License — MIT
## Credits — chrono-node, sherpa-onnx, Electron, and the Yogi song (CC0, see assets/audio/LICENSE.md)
```

`MVP DECISION` — The "reminders need LifeOS running" warning appears **above the fold**, in the README, in onboarding pane 3, in Settings, and in the tray dialog. It is the product's central limitation. Burying it would be the single most dishonest thing this project could do.

## 6. Checksums

```powershell
Get-FileHash release\*.exe -Algorithm SHA256 |
  ForEach-Object { "$($_.Hash.ToLower())  $(Split-Path $_.Path -Leaf)" } |
  Out-File -Encoding utf8 release\SHA256SUMS.txt
```

Attach `SHA256SUMS.txt` to the release. For an unsigned binary this is the *only* integrity guarantee a user has, and it costs one command.

## 7. Release notes template

```markdown
## LifeOS 0.1.0 — first release

Yogi can now hear a reminder, show you exactly how it was understood, and remind you
at the right time. Entirely on your device.

### What works
- Speak or type a reminder in natural language
- Relative ("in 5 minutes"), absolute ("tomorrow at 9 AM"), weekly ("every Monday at 7 AM")
- Yogi **asks instead of guessing** when a command is ambiguous
- A confirmation card showing the exact date and time before anything is saved
- Windows notifications + spoken reminders, while minimised to the tray
- "Please sing after 2 minutes" plays the Yogi song
- Everything stored locally in SQLite. No account, no server, no telemetry.

### Known limitations
- **Reminders only fire while LifeOS is running** (window closed to tray is fine; Quit is not)
- Weekly and daily recurrence only — no monthly
- English only
- Unsigned: Windows will show a SmartScreen warning. See the README.
- No auto-update yet

### Verify your download
`SHA256SUMS.txt` is attached.

### Files
- `LifeOS-Setup-0.1.0.exe` — installer (recommended), per-user, no admin required
- `LifeOS-0.1.0-portable.exe` — portable, keeps its data next to the exe
```

`MVP DECISION` — **Known limitations go in the release notes, not just the README.** A user who reads only the release page must still learn that quitting stops the reminders.

## 8. Screenshots and demo

Five screenshots, light theme, 1080×760, no personal data in them:

1. The **confirmation card** — the product's central idea, in one image.
2. A **clarification card** ("Six in the morning, or six in the evening?") — the honesty.
3. Active Schedules with a live countdown.
4. A Windows toast firing with the app in the tray.
5. Settings, showing AI Assist **off** and the privacy panel.

The 60–90 second demo GIF/video:

```text
0:00  Open LifeOS. The "Local · Offline" chip is visible.
0:05  Press the mic. Say "remind me in 2 minutes to drink water."
0:10  Words appear as you speak.
0:14  The confirmation card shows: Drink water · Today, 4:20 PM · in 2 minutes.
0:18  Press Confirm. Yogi speaks: "Okay. I will remind you in 2 minutes to drink water."
0:22  Close the window. The tray dialog appears.
0:25  [cut] Two minutes later: a Windows toast. Yogi's voice.
0:35  Say "please sing after 1 minute." The Yogi song plays from the tray.
0:50  Open DevTools, kill the renderer process. A pending reminder STILL fires a toast.
1:05  Show Wireshark: zero packets, the entire session.
```

`MVP DECISION` — The last two shots do more for credibility than any feature. `0:50` proves the scheduler lives in the main process. `1:05` proves the privacy claim is a measurement, not a promise.

## 9. Issue templates

`.github/ISSUE_TEMPLATE/bug.yml` must ask for:

- LifeOS version, Windows version and build
- Was LifeOS running (tray) or quit when the reminder should have fired?
- The exact command text typed or spoken
- The relevant lines from `Settings → Open logs folder`

`MVP DECISION` — Add a prominent note: **"Please redact anything personal from your log before attaching it."** Logs contain reminder titles. Reminder titles contain medical facts.

## 10. Post-release

| When | Action |
| --- | --- |
| Immediately | Download from GitHub on a **different machine** and install. If that fails, delete the release. |
| Day 1 | Watch the SmartScreen click-through complaints. Expect them. |
| Week 1 | Triage bugs. Fix only crashes and missed reminders in `0.1.x`. |
| Week 2 | Decide whether auto-update (`electron-updater` + `latest.yml`, already generated) is worth `0.2.0`. |

`MVP DECISION` — Do not accept feature requests into `0.1.x`. The cut list in `03` §2 was decided when nobody was watching; it should not be reopened because somebody is.

## 11. Release checklist

```text
□ Version bumped in package.json. CHANGELOG written.
□ Clean tree. `npm ci` from scratch.
□ typecheck + lint + unit + integration all green.
□ `npx electron-builder --win` produces BOTH artifacts.
□ Installed on a FRESH Windows VM as a standard user. No UAC.
□ Full manual checklist passed (18 §10) against the INSTALLED app.
□ Procmon: no writes outside %APPDATA%\LifeOS\ and %LOCALAPPDATA%\Programs\LifeOS\.
□ Procmon: no registry writes outside HKCU\…\Uninstall\LifeOS.
□ No Task Scheduler entry. No service. No driver. No startup entry.
□ Wireshark, AI Assist off, 30 min incl. a fired reminder: ZERO packets.
□ Portable exe tested separately (toasts need an explicit AUMID — no Start Menu shortcut).
□ SHA256SUMS.txt generated and attached.
□ README: SmartScreen steps + screenshot, the "must be running" warning, demo GIF.
□ PRIVACY.md and LICENSE present.
□ Release notes include Known Limitations.
□ Draft published.
□ Downloaded FROM GITHUB on a different machine and installed.   ← the last gate
□ Tag v0.1.0 pushed.
```
