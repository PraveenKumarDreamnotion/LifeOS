# LifeOS Privacy Statement

**Last updated:** 11 July 2026 · **Applies to:** LifeOS 0.1.0

## The short version

LifeOS has no server. It has no account. It has no telemetry. Your reminders live in a file on your computer, and nothing is sent anywhere.

## What LifeOS stores, and where

Everything lives in one folder:

```text
%APPDATA%\LifeOS\
  lifeos.db        your reminders, history, and settings (a standard SQLite file)
  logs/            local diagnostic logs
```

Inside `lifeos.db`:

| Table | What it holds |
| --- | --- |
| `reminders` | Title, description, when it fires, whether it repeats |
| `reminder_history` | When reminders fired, and what you did about them |
| `settings` | Your preferences |
| `app_logs` | Local diagnostics |
| `memories`, `conversations` | **Empty.** Created for a future version. LifeOS 0.1.0 writes nothing here. |

You can open this file with any SQLite browser and read every byte of it. Copy it to back it up. Delete it to start over. There is no lock-in because there is no server.

## What LifeOS sends over the network

**Nothing.** LifeOS 0.1.0 makes zero network requests. This is enforced in code by a network filter that blocks every outbound request that is not to the app's own origin. You can verify this yourself with Wireshark, and we encourage it.

> A future, optional "AI Assist" feature (not present in 0.1.0) would send only the *text* of a command to a provider you choose, under your own API key, and only when you explicitly enable it. It is not in this release.

## Speech

Your voice is transcribed **on your computer**, by a speech model that ships inside the app. Audio never leaves your machine and is never written to disk. It exists in memory while you speak and is discarded when you stop.

There is no wake word and no background listening. The microphone opens when you press the button and closes when you press it again, after two seconds of silence, or after thirty seconds — whichever comes first.

Windows asks for microphone permission the first time you press the mic button, not when you install.

Yogi speaks reminders aloud using the text-to-speech voices already installed in Windows — also offline.

## Telemetry, analytics, crash reports

None. There is no analytics SDK, no crash reporter, no "anonymous usage statistics", and no update ping. LifeOS does not know you exist. If it crashes and you want to help, **Settings → Open data folder** shows you exactly what a log contains, and you decide whether to attach it to a GitHub issue. Please read it first — your reminder titles are in there.

## Deleting your data

**Settings → Reset local data.** You will be asked to type `RESET`.

This deletes everything inside `%APPDATA%\LifeOS\` — reminders, history, settings, and logs. It touches nothing else on your computer, and it cannot: the folder is resolved by the operating system, and the code refuses to delete any path that is not that folder.

**Uninstalling LifeOS does not delete your data.** `%APPDATA%\LifeOS\` remains, so reinstalling keeps your reminders. Delete the folder by hand if you want it gone.

## What LifeOS will never do

LifeOS runs as your normal Windows user account and never asks for administrator access. It will never modify Windows system files or the registry (beyond its own uninstall entry), install drivers or services, create Windows Task Scheduler jobs, run shell commands built from anything you say or type, execute code returned by any AI model, read or delete files outside its own data folder, add itself to Windows startup without you asking, or upload your data anywhere.

## Contact

Open an issue at the project's GitHub repository.
