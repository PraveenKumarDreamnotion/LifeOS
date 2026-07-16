# 16 — API and IPC Contracts

> The IPC boundary is LifeOS's only security perimeter. Everything on the renderer side is untrusted, including code we wrote.

---

## 1. The exposed surface

The brief asks for `window.lifeos.*`. Here it is, complete. Fourteen functions and five event subscriptions. Nothing else exists.

```ts
// src/types/window.d.ts
declare global {
  interface Window {
    readonly lifeos: {
      reminders: {
        create(input: CreateReminderInput): Promise<Result<Reminder>>;
        list(): Promise<Result<Reminder[]>>;
        update(id: string, patch: UpdateReminderPatch): Promise<Result<Reminder>>;
        delete(id: string): Promise<Result<void>>;
        pause(id: string, paused: boolean): Promise<Result<Reminder>>;
        complete(id: string): Promise<Result<void>>;
        dismiss(id: string): Promise<Result<void>>;
        snooze(id: string, minutes: number): Promise<Result<Reminder>>;
        history(filter: HistoryFilter): Promise<Result<ReminderHistoryEntry[]>>;
      };
      speech: {
        start(): Promise<Result<{ sessionId: string; supportsPartials: boolean }>>;
        stop(): Promise<Result<{ text: string }>>;
        pushAudio(pcm16: ArrayBuffer): void;              // fire-and-forget, `send` not `invoke`
        onPartial(cb: (text: string) => void): Unsubscribe;
        onFinal(cb: (text: string) => void): Unsubscribe;
        onError(cb: (e: IpcError) => void): Unsubscribe;
      };
      settings: {
        get(): Promise<Result<SettingsDto>>;              // NEVER returns the API key
        update(patch: SettingsPatch): Promise<Result<SettingsDto>>;
        setApiKey(key: string): Promise<Result<void>>;    // one-way. No getter exists.
        clearApiKey(): Promise<Result<void>>;
        resetLocalData(): Promise<Result<void>>;          // ◄── NO ARGUMENTS. Ever.
        openLogsFolder(): Promise<Result<void>>;
        openDataFolder(): Promise<Result<void>>;
      };
      parse(text: string): Promise<Result<ParseResult>>;
      app: {
        version(): Promise<Result<{ version: string; electron: string }>>;
        onRemindersChanged(cb: () => void): Unsubscribe;
        onReminderTrigger(cb: (r: Reminder) => void): Unsubscribe;
        onOverdueOnStartup(cb: (r: Reminder[]) => void): Unsubscribe;
      };
    };
  }
}

type Unsubscribe = () => void;
```

`MVP DECISION` — What is **absent** is the contract:

| Absent | Why |
| --- | --- |
| `window.lifeos.ipcRenderer` | Hands the renderer every channel, including internal ones. |
| `window.lifeos.invoke(channel, ...args)` | The same thing with an extra step. |
| `settings.getApiKey()` | The key must not be nameable from the renderer. |
| `resetLocalData(path)` | A path argument is a filesystem-delete primitive. |
| `window.lifeos.db` / `.fs` / `.shell` | No. |
| `openExternal(url)` | Only a hardcoded allowlist, invoked from main (`11` §4). |

## 2. The `Result<T>` envelope

`MVP DECISION` — IPC handlers **never reject**. They return a discriminated union. A rejected `invoke` in the renderer means a bug in the bridge, not an expected error, and it deserves to be loud.

```ts
// core/types/ipc.ts
export type Result<T> =
  | { ok: true;  data: T }
  | { ok: false; error: IpcError };

export interface IpcError {
  code: string;        // machine-readable; maps to a sentence in 17 §2
  message: string;     // already user-facing; safe to render verbatim
}
```

Why not throw across IPC? Because Electron serialises a rejected promise's `Error` into a string with the stack attached, and the stack leaks the filesystem layout of the developer's machine into the renderer. Returning a sanitised envelope makes leaking a *deliberate act* rather than a default.

```ts
// Renderer usage — errors are values, so they cannot be forgotten
const r = await window.lifeos.reminders.create(input);
if (!r.ok) return showError(r.error);       // TypeScript will not let you skip this
navigate(`/schedules?highlight=${r.data.id}`);
```

## 3. Channel inventory

`MVP DECISION` — Channel names are `namespace:verb`, defined once in `core/types/ipc.ts`, imported by both preload and main. A typo becomes a compile error rather than a silent no-op.

### 3.1 `invoke` channels (renderer → main → renderer)

| Channel | Payload | Returns | Validation |
| --- | --- | --- | --- |
| `reminders:create` | `unknown` | `Reminder` | `CreateReminderInput.strict()` + business rules |
| `reminders:list` | — | `Reminder[]` | — |
| `reminders:update` | `id, unknown` | `Reminder` | `uuid` + `UpdateReminderInput.strict()` |
| `reminders:delete` | `id` | `void` | `z.string().uuid()` |
| `reminders:pause` | `id, boolean` | `Reminder` | `uuid` + `z.boolean()` |
| `reminders:complete` | `id` | `void` | `uuid` |
| `reminders:dismiss` | `id` | `void` | `uuid` |
| `reminders:snooze` | `id, minutes` | `Reminder` | `SnoozeInput.strict()` (1–1440) |
| `reminders:history` | `unknown` | `Entry[]` | `HistoryFilter.strict()` |
| `speech:start` | — | `{sessionId, supportsPartials}` | — |
| `speech:stop` | — | `{text}` | — |
| `settings:get` | — | `SettingsDto` | — (**strips the key**) |
| `settings:update` | `unknown` | `SettingsDto` | `SettingsPatch.strict()` |
| `settings:setApiKey` | `string` | `void` | `z.string().min(20).max(200)` |
| `settings:clearApiKey` | — | `void` | — |
| `settings:resetLocalData` | **none** | `void` | handler signature takes no args |
| `settings:openLogsFolder` | — | `void` | path from `app.getPath`, not IPC |
| `settings:openDataFolder` | — | `void` | ditto |
| `parse:reminder` | `string` | `ParseResult` | `z.string().min(1).max(1000)` |
| `app:version` | — | `{version, electron}` | — |

### 3.2 `send` channels (renderer → main, fire-and-forget)

| Channel | Payload | Why not `invoke` |
| --- | --- | --- |
| `speech:audio` | `ArrayBuffer` (PCM16) | ~5 frames/second. A promise per frame would be pure overhead. |

`RISK (medium)` — `speech:audio` is the only unacknowledged channel and the only high-frequency one. `MVP DECISION` — guard it:

```ts
ipcMain.on('speech:audio', (event, pcm) => {
  assertSenderIsOurWindow(event.senderFrame);
  if (!(pcm instanceof ArrayBuffer))        return;   // silently drop; no error path exists
  if (pcm.byteLength > 64 * 1024)           return;   // 200ms @16kHz PCM16 = 6.4KB. 64KB is 10×.
  if (!speechCoordinator.hasActiveSession()) return;  // no session → no buffer growth
  speechCoordinator.pushAudio(pcm);
});
```

Three guards, because an unacknowledged channel that allocates is a memory-exhaustion primitive. A compromised renderer sending 64 KB buffers in a tight loop must hit a wall, and the wall is "there is no active session."

### 3.3 Broadcast channels (main → renderer)

| Channel | Payload | When |
| --- | --- | --- |
| `speech:partial` | `string` | Interim transcript updated |
| `speech:final` | `string` | Utterance complete |
| `speech:error` | `IpcError` | Mic or model failure |
| `reminders:changed` | — | After **any** mutation. Renderer refetches. |
| `reminder:trigger` | `Reminder` | A reminder fired; show the modal |
| `overdue:startup` | `Reminder[]` | Reminders were due while the app was closed |

`MVP DECISION` — `reminders:changed` carries **no payload**. The renderer refetches the list. Sending a diff creates a second source of truth and an ordering bug the first time two mutations race. Refetching tens of rows over IPC costs microseconds.

## 4. The preload implementation

`VERIFIED FACT` — A sandboxed preload cannot `require` across files; it must be a single bundled file. electron-vite handles this.

```ts
// electron/preload/index.ts
import { contextBridge, ipcRenderer } from 'electron';
import { CH } from '../../core/types/ipc';    // inlined by the bundler

/** Strips the IpcRendererEvent, which carries `sender` — a privilege-escalation handle. */
function subscribe(channel: string, cb: (...args: any[]) => void) {
  const wrapped = (_e: unknown, ...args: any[]) => cb(...args);
  ipcRenderer.on(channel, wrapped);
  return () => { ipcRenderer.removeListener(channel, wrapped); };
}

const api = {
  reminders: {
    create:   (i: unknown)             => ipcRenderer.invoke(CH.REMINDERS_CREATE, i),
    list:     ()                       => ipcRenderer.invoke(CH.REMINDERS_LIST),
    update:   (id: string, p: unknown) => ipcRenderer.invoke(CH.REMINDERS_UPDATE, id, p),
    delete:   (id: string)             => ipcRenderer.invoke(CH.REMINDERS_DELETE, id),
    pause:    (id: string, p: boolean) => ipcRenderer.invoke(CH.REMINDERS_PAUSE, id, p),
    complete: (id: string)             => ipcRenderer.invoke(CH.REMINDERS_COMPLETE, id),
    dismiss:  (id: string)             => ipcRenderer.invoke(CH.REMINDERS_DISMISS, id),
    snooze:   (id: string, m: number)  => ipcRenderer.invoke(CH.REMINDERS_SNOOZE, id, m),
    history:  (f: unknown)             => ipcRenderer.invoke(CH.REMINDERS_HISTORY, f),
  },
  speech: {
    start:     ()                  => ipcRenderer.invoke(CH.SPEECH_START),
    stop:      ()                  => ipcRenderer.invoke(CH.SPEECH_STOP),
    pushAudio: (pcm: ArrayBuffer)  => ipcRenderer.send(CH.SPEECH_AUDIO, pcm),
    onPartial: (cb: (t: string) => void)  => subscribe(CH.SPEECH_PARTIAL, cb),
    onFinal:   (cb: (t: string) => void)  => subscribe(CH.SPEECH_FINAL, cb),
    onError:   (cb: (e: unknown) => void) => subscribe(CH.SPEECH_ERROR, cb),
  },
  settings: {
    get:            ()            => ipcRenderer.invoke(CH.SETTINGS_GET),
    update:         (p: unknown)  => ipcRenderer.invoke(CH.SETTINGS_UPDATE, p),
    setApiKey:      (k: string)   => ipcRenderer.invoke(CH.SETTINGS_SET_KEY, k),
    clearApiKey:    ()            => ipcRenderer.invoke(CH.SETTINGS_CLEAR_KEY),
    resetLocalData: ()            => ipcRenderer.invoke(CH.SETTINGS_RESET),   // no args
    openLogsFolder: ()            => ipcRenderer.invoke(CH.SETTINGS_OPEN_LOGS),
    openDataFolder: ()            => ipcRenderer.invoke(CH.SETTINGS_OPEN_DATA),
  },
  parse: (text: string) => ipcRenderer.invoke(CH.PARSE_REMINDER, text),
  app: {
    version:             ()  => ipcRenderer.invoke(CH.APP_VERSION),
    onRemindersChanged:  (cb: () => void)             => subscribe(CH.REMINDERS_CHANGED, cb),
    onReminderTrigger:   (cb: (r: unknown) => void)   => subscribe(CH.REMINDER_TRIGGER, cb),
    onOverdueOnStartup:  (cb: (r: unknown[]) => void) => subscribe(CH.OVERDUE_STARTUP, cb),
  },
};

contextBridge.exposeInMainWorld('lifeos', Object.freeze(api));
```

`MVP DECISION` — `Object.freeze` prevents a compromised script from monkey-patching `window.lifeos.reminders.delete` and having *other* scripts on the page call the patched version. It is cheap and it closes a real hole.

`MVP DECISION` — The preload does **no validation**. It is a dumb pipe. Validation belongs in main, because a compromised renderer can call `ipcRenderer.invoke` directly — the preload's own `ipcRenderer` import is reachable from the isolated world only in theory, but designing as if it were is the correct posture. **Never trust a check that runs on the wrong side of the boundary.**

## 5. The handler template

Every `ipcMain.handle` in LifeOS has exactly this shape. No exceptions, including handlers that "obviously" cannot fail.

```ts
// electron/main/ipc/reminders.ts
import { CH } from '../../../core/types/ipc';

ipcMain.handle(CH.REMINDERS_CREATE, async (event, raw: unknown) => {
  return guard(event, async () => {
    // 1. VALIDATE — Zod, .strict(), never a cast
    const input = CreateReminderInput.parse(raw);

    // 2. AUTHORIZE — business rules the schema cannot express
    validateBusinessRules(input, Date.now());

    // 3. ACT
    const reminder = reminderRepo.create(input);

    // 4. NOTIFY — everyone refetches
    broadcast(CH.REMINDERS_CHANGED);
    scheduler.reconcile('mutation');      // idempotent; picks up the new next_fire_at

    return reminder;                       // plain object; no Date, no Buffer, no class
  });
});

/** Wraps every handler: origin check, error sanitisation, Result envelope. */
async function guard<T>(event: IpcMainInvokeEvent, fn: () => Promise<T>): Promise<Result<T>> {
  try {
    assertSenderIsOurWindow(event.senderFrame);
    return { ok: true, data: await fn() };
  } catch (e) {
    return { ok: false, error: toIpcError(e) };
  }
}

function assertSenderIsOurWindow(frame: WebFrameMain | null): void {
  if (!frame) throw new SecurityError('no_frame');
  if (new URL(frame.url).origin !== APP_ORIGIN) throw new SecurityError('bad_origin');
}
```

`MVP DECISION` — `raw` is typed **`unknown`**, always. Writing `(event, input: CreateReminderInput)` is a lie: TypeScript types do not survive `structuredClone`, and the compiler will happily let you trust an attacker.

`MVP DECISION` — Return values must be **structured-cloneable plain objects**. No `Date`, no `Buffer`, no class instance, no `undefined` in an array. The domain model was designed with `number` timestamps precisely so this is never a problem (`15` §1).

## 6. The settings handler — the key never leaves

```ts
ipcMain.handle(CH.SETTINGS_GET, async (event) => guard(event, async () => {
  const all = settingsRepo.getAll();
  const { ai_key_ciphertext, ...safe } = all;      // ◄── destructured out, structurally
  return { ...toDto(safe), hasApiKey: Boolean(ai_key_ciphertext) };
}));

ipcMain.handle(CH.SETTINGS_SET_KEY, async (event, raw) => guard(event, async () => {
  const key = z.string().trim().min(20).max(200).parse(raw);
  if (!safeStorage.isEncryptionAvailable()) throw new EncryptionUnavailableError();
  settingsRepo.set('ai_key_ciphertext', safeStorage.encryptString(key).toString('base64'));
  // Nothing is returned. There is no getter. The key is write-only from the renderer's view.
}));
```

And the test that keeps it true:

```ts
// tests/integration/ipc-contracts.test.ts
it('settings:get never returns the API key under any name', async () => {
  await ipc('settings:setApiKey', 'sk-test-000000000000000000000000');
  const r = await ipc('settings:get');
  const json = JSON.stringify(r);
  expect(json).not.toContain('sk-test');
  expect(json).not.toContain('ciphertext');
  expect(r.data.hasApiKey).toBe(true);
});
```

`MVP DECISION` — The destructure (`const { ai_key_ciphertext, ...safe }`) is deliberate over a `delete` or an allowlist map. If someone renames the column, the destructure breaks at compile time.

## 7. Audio-window channels

The hidden audio window (`13` §4) has its own tiny preload and a **one-way** contract.

```ts
// electron/preload/audio.ts
contextBridge.exposeInMainWorld('lifeosAudio', Object.freeze({
  onSpeak: (cb: (p: { text: string; voiceId?: string; rate?: number }) => void) => subscribe('tts:speak', cb),
  onCancel:(cb: () => void)                                                    => subscribe('tts:cancel', cb),
  onPlay:  (cb: (p: { file: string }) => void)                                 => subscribe('audio:play', cb),
  onStop:  (cb: () => void)                                                    => subscribe('audio:stop', cb),
  ready:   ()                     => ipcRenderer.send('audio:ready'),
  report:  (e: { code: string })  => ipcRenderer.send('audio:error', e),
}));
```

`MVP DECISION` — The audio window can send exactly two things: `audio:ready` and `audio:error`. It cannot read reminders, cannot write settings, cannot request a parse. It is an output device with a status light.

`MVP DECISION` — `audio:play` carries a **filename**, not a path: `{ file: 'yogi-song' }`. Main resolves it against a hardcoded map. A path from IPC, even from our own window, is a file-read primitive.

```ts
const SOUNDS = { 'yogi-song': () => resourcePath('audio', 'yogi-song.mp3') } as const;
```

## 8. Renderer wrapper

```ts
// src/lib/ipc.ts — the only place the renderer touches window.lifeos
export async function createReminder(input: CreateReminderInput): Promise<Reminder> {
  const r = await window.lifeos.reminders.create(input);
  if (!r.ok) throw new AppError(r.error.code, r.error.message);   // become an exception HERE, at the edge
  return r.data;
}
```

`MVP DECISION` — Convert `Result` to an exception at the renderer's edge, then use normal `try/catch` and React error boundaries inside the app. `Result` is the right shape for a *boundary*; exceptions are the right shape for React. Translating once, in one file, gets both.

## 9. Contract tests

```ts
// tests/integration/ipc-contracts.test.ts — runs against a real Electron main process
describe('IPC contracts', () => {
  it('rejects an unknown key on reminders:create', async () => {
    const r = await ipc('reminders:create', { ...valid, action: 'exec' });
    expect(r).toEqual({ ok: false, error: { code: 'invalid_input', message: expect.any(String) } });
  });

  it('rejects a past date', async () => {
    const r = await ipc('reminders:create', { ...valid, scheduledAtUtcMs: Date.now() - 60_000 });
    expect(r.error.code).toBe('date_in_past');
  });

  it('stores a SQL-injection title as literal text', async () => {
    const evil = `'); DROP TABLE reminders;--`;
    const r = await ipc('reminders:create', { ...valid, title: evil });
    expect((await ipc('reminders:list')).data[0].title).toBe(evil);
    expect(tableExists('reminders')).toBe(true);
  });

  it('never leaks a stack trace', async () => {
    const r = await ipc('reminders:delete', 'not-a-uuid');
    expect(JSON.stringify(r)).not.toMatch(/[A-Z]:\\|\/home\/|at Object\./);
  });

  it('drops an oversized audio frame without allocating', async () => {
    send('speech:audio', new ArrayBuffer(1024 * 1024));
    expect(speechCoordinator.bufferedBytes()).toBe(0);
  });

  it('resetLocalData accepts no arguments', () => {
    const handler = getHandler('settings:resetLocalData');
    expect(handler.length).toBeLessThanOrEqual(1);   // (event) only
  });

  it('every registered channel appears in CH', () => {
    for (const ch of listRegisteredChannels()) expect(Object.values(CH)).toContain(ch);
  });
});
```

`MVP DECISION` — That last test is the anti-drift guard. A handler registered with a string literal that is not in `CH` is a channel nobody documented and nobody validated. It fails the build.

## 10. Versioning

`MVP DECISION` — The preload and main ship in the same binary, so the IPC contract cannot skew. No version negotiation, no capability handshake. If a channel changes, both sides change in the same commit, and `CH` makes the compiler enforce it.

`FUTURE OPTION` — Should LifeOS ever gain a plugin surface or a companion process, this section becomes a real protocol document with a version field. It does not need one now, and adding one now would be architecture for its own sake.
