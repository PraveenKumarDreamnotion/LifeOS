import { app, BrowserWindow, powerMonitor, safeStorage, ipcMain, nativeTheme, shell } from 'electron';
import { join } from 'node:path';
import { installSessionSecurity, installNavigationLocks, APP_ORIGIN } from './session';
import { ApiKeyStore } from '../services/api-key-store';
import { makeSpeechProvider, makeTtsProvider, makeLlmProvider, makeSearchProvider, makeTranscriptCleaner, type ProviderConfig } from '../providers/registry';
import { speakThroughAudioWindow } from './tts/speak';
import { CH } from '../../core/types/channels';
import { ChatRepository } from '../database/chat-repository';
import { ChatTurnService } from './chat/chat-turn-service';
import { makeLocalCommandRouter } from './chat/local-command-router';
import { ContextBuilder } from '../conversation/context-builder';
import { ConversationEngine, type EngineTurn } from '../conversation/conversation-engine';
import { registerChatHandlers } from './ipc/chat';
import { GmailRepository } from '../database/gmail-repository';
import { GmailTokenStore } from '../services/gmail-token-store';
import { GmailAuthService } from '../gmail/gmail-auth';
import { GmailProvider } from '../gmail/gmail-provider';
import { GmailSyncEngine } from '../gmail/sync-engine';
import { GmailSyncScheduler, type GmailSyncMode } from '../gmail/gmail-sync-scheduler';
import { createGmailNotifier } from '../gmail/gmail-notifier';
import { EmailContextService } from '../gmail/email-context-service';
import { EmailResearchService } from '../gmail/email-research-service';
import { EmailDeliveryCoordinator } from '../gmail/email-delivery';
import { registerGmailHandlers } from './ipc/gmail';
import { ConfirmationStore } from '../actions/confirmation-store';
import { ActionDispatcher } from '../actions/dispatcher';
import { executeAction } from '../actions/execute';
import { matchVoiceConfirm } from '../actions/voice-confirm-matcher';
import { registerActionHandlers } from './ipc/actions';
import { registerLauncherHandlers } from './ipc/launcher';
import { CreateReminderInput } from '../../core/types/ipc';
import { validateBusinessRules } from './ipc';
import {
  createMainWindow,
  createAudioWindow,
  createReminderPopupWindow,
  createLauncherWindow,
  positionLauncherBottomRight,
  positionPopupBottomRight,
  mainWindow,
  audioWindow,
  popupWindow,
  launcherWindow,
} from './windows';
import { createReminderPopup, PopupActionInput, PopupMessageInput } from './reminder-popup';
import { createTray, destroyTray, refreshTray } from '../tray/tray';
import { showTrayNoticeOnce } from './lifecycle';
import { openDatabase } from '../database/open';
import { ReminderRepository } from '../database/reminder-repository';
import { HistoryRepository } from '../database/history-repository';
import { SettingsRepository } from '../database/settings-repository';
import { Logger } from '../services/logger';
import { setAppOrigin, guard, isSenderOurWindow } from './ipc/guard';
import {
  registerIpcHandlers,
  broadcastRemindersChanged,
  broadcastSettingsChanged,
  type OverdueItem,
} from './ipc';
import { registerSpeechHandlers, disposeSpeech } from './ipc/speech';
import { DatabaseFromNewerVersionError } from '../database/migrate';
import { createScheduler } from '../scheduler/scheduler';
import { createTriggerSink } from '../scheduler/trigger-sink';
import { ReminderExecutor } from '../reminders/reminder-executor';
import type { Reminder } from '../../core/types/reminder';
import { createNotifier } from '../notifications/notifier';
import type { SqliteDriver } from '../database/driver';

/** Map the gmail_max_stored setting ('1000'|'5000'|'unlimited') to a prune cap (0 = unlimited). */
function gmailMaxStoredToNumber(value: string): number {
  if (value === 'unlimited') return 0;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 1000;
}

const TICK_MS = 30_000;

/**
 * Send a broadcast to EVERY window (55 §3). The conversation/action broadcasts used to target only
 * the main window; the reminder popup is now also a chat client, so a turn it initiates must reach
 * it. Safe to fan out because every consumer self-filters (chatSend by turnId; action:resolved /
 * action:expired by turnId; chat:turn:appended by sessionId) — a window ignores what it didn't start.
 */
function fanout(channel: string, payload?: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload);
  }
}

/** Fan out to every window EXCEPT the one that originated the turn — that window already shows the
 *  turn through its own optimistic UI, so mirroring it back would double-render (real-time sync). */
function fanoutExcept(exceptWebContentsId: number | undefined, channel: string, payload?: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue;
    if (exceptWebContentsId !== undefined && win.webContents.id === exceptWebContentsId) continue;
    win.webContents.send(channel, payload);
  }
}

// ── Startup sequence (13 §9). Three steps must precede any window. ────────────

// 0. App identity — set BEFORE getPath('userData') so the app name is "LifeOS" everywhere the OS
//    surfaces it (window app-model, notifications, the userData folder). Windows is case-insensitive
//    so this keeps the existing %APPDATA%\lifeos data. NB: Task Manager's process/Details name comes
//    from the .exe itself — that reads "electron" when UNPACKAGED (dev) and "LifeOS" only in a
//    packaged build (electron-builder renames the exe to productName/executableName). This can't be
//    changed for the dev harness without packaging.
app.setName('LifeOS');

// 0b. Isolate the DEV harness's profile from an installed build. Both otherwise resolve to the same
//     case-insensitive %APPDATA%\LifeOS, so a developer's local API key / Gmail tokens / chat would
//     appear inside an INSTALLED app on that same machine (they are NOT in the installer — they live
//     in this shared userData folder). Dev now uses %APPDATA%\LifeOS-dev; packaged keeps the canonical
//     %APPDATA%\LifeOS that real users get. A fresh install is therefore truly clean on any machine.
if (!app.isPackaged) {
  app.setPath('userData', join(app.getPath('appData'), 'LifeOS-dev'));
}

// 1. Autoplay policy — before any window; the hidden audio window has no user gesture.
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

// 2. AppUserModelID — drives the notification title + taskbar grouping. Use the packaged appId when
//    installed (matches the Start-Menu shortcut Windows registers); unpackaged has no shortcut, so
//    fall back to the exe path (the Electron default) to keep dev toasts working.
if (process.platform === 'win32') {
  app.setAppUserModelId(app.isPackaged ? 'com.dreamnotion.lifeos' : process.execPath);
}

// 3. Single instance — two schedulers on one WAL would double-fire.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  let isQuitting = false;
  let db: SqliteDriver | null = null;
  let reminderMutationReconcile: (() => void) | null = null;
  // Stop all background timers/pollers that touch the DB. Assigned once the timers exist; called
  // by closeDb so a Reset (which app.exit()s WITHOUT firing before-quit) can't leave a timer
  // ticking against a closed database — that throws uncaught and shows the main-process crash dialog.
  let stopBackgroundTimers: () => void = () => {};
  // Stashed at startup reconcile (before the window exists); the renderer pulls it on mount.
  let pendingOverdue: OverdueItem[] = [];

  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    console.log(`\nLifeOS ${app.getVersion()} — electron ${process.versions.electron} · packaged ${app.isPackaged}`);

    // 5. Origin + navigation locks first. Session security (CSP/allowlist) is installed just
    //    below, AFTER settings exist, because its network predicate reads them live (D1).
    setAppOrigin(APP_ORIGIN);
    installNavigationLocks();

    // 6. Database: open, migrate, seed defaults.
    const dbPath = join(app.getPath('userData'), 'lifeos.db');
    try {
      db = openDatabase(dbPath);
    } catch (e) {
      if (e instanceof DatabaseFromNewerVersionError) {
        // Refuse to open; never migrate backwards. (A real dialog lands on Day 6.)
        console.error('[db]', e.message);
        app.exit(1);
        return;
      }
      throw e;
    }

    const log = new Logger(db, app.isPackaged);
    const reminders = new ReminderRepository(db);
    const history = new HistoryRepository(db);
    const settings = new SettingsRepository(db);
    settings.seedDefaults();
    log.info('startup', `database ready at ${dbPath}`);

    // Theme: drive Chromium's native theme from the user's choice so EVERY window — the main window
    // AND the frameless reminder popup (which has no settings access of its own) — honours a forced
    // Light/Dark. 'system' follows the OS. themeSource is exactly 'system'|'light'|'dark', matching
    // our theme setting, and stays consistent with the main window's `data-theme` (both key the same
    // dark tokens). Called at startup and on every settings change.
    const syncNativeTheme = () => {
      const t = settings.get('theme');
      nativeTheme.themeSource = t === 'light' || t === 'dark' ? t : 'system';
    };
    syncNativeTheme();

    // Conversation: the local-parser fallback (pure) + the persistent, resumable chat store (CONV).
    // chatRepo is the single faithful source of truth for both the renderer and the engine's context.
    const chat = new ChatTurnService();
    const chatRepo = new ChatRepository(db);

    // API key store — the ONLY place the key is encrypted/decrypted (30 §13.6). Ciphertext
    // lives in the `ai_key_ciphertext` setting; the plaintext never crosses IPC.
    const apiKeyStore = new ApiKeyStore(
      safeStorage,
      () => settings.get('ai_key_ciphertext'),
      (b64) => settings.set('ai_key_ciphertext', b64),
    );

    // Gmail integration (docs/lifeos-planning/gmail-integration.md). Token bundle + OAuth client
    // secret are safeStorage ciphertext held in settings, decrypted only here in main, never across
    // IPC — same guarantee as the API key. Main-process fetch to Google is not gated by the session
    // allowlist (like the OpenAI provider), so privacy is enforced by only calling when connected.
    const gmailRepo = new GmailRepository(db);
    const gmailTokenStore = new GmailTokenStore(
      safeStorage,
      {
        read: () => settings.get('gmail_token_ciphertext'),
        write: (b64) => settings.set('gmail_token_ciphertext', b64),
      },
      {
        read: () => settings.get('gmail_client_secret_ciphertext'),
        write: (b64) => settings.set('gmail_client_secret_ciphertext', b64),
      },
    );
    const gmailAuth = new GmailAuthService({
      tokenStore: gmailTokenStore,
      repo: gmailRepo,
      getClientId: () => settings.get('gmail_client_id'),
      openExternal: (url) => shell.openExternal(url),
      log: (level, message) => log[level]('gmail', message),
    });

    // D1 fix (30): the live network predicate, bound to real settings — replaces the dead
    // `() => false` probe. session.ts re-reads it on every response (CSP) and request
    // (allowlist), so toggling AI Assist takes effect without a restart. Default is fail-safe.
    // Any cloud feature that is enabled + keyed (+ consented) opens the api.openai.com allowlist
    // for the renderer/CSP. EP-3 adds cloud STT to the predicate. Default is fail-safe: false.
    const cloudEnabled = () =>
      apiKeyStore.has() &&
      (settings.get('ai_assist_enabled') === 'true' ||
        (settings.get('stt_provider') === 'openai' && settings.get('stt_consented_at') !== '') ||
        (settings.get('tts_provider') === 'openai' && settings.get('tts_consented_at') !== ''));
    installSessionSecurity(cloudEnabled);

    // Snapshot of the settings the provider factory keys on (33 §5). EP-3/EP-4 read the STT/TTS
    // provider, consent, and model.
    const providerConfig = (): ProviderConfig => ({
      sttProvider: settings.get('stt_provider'),
      ttsProvider: settings.get('tts_provider'),
      aiProvider: settings.get('ai_provider'),
      aiEnabled: settings.get('ai_assist_enabled') === 'true',
      hasApiKey: apiKeyStore.has(),
      sttConsented: settings.get('stt_consented_at') !== '',
      ttsConsented: settings.get('tts_consented_at') !== '',
      sttModel: settings.get('stt_model') || 'gpt-4o-mini-transcribe',
      aiConsented: settings.get('ai_consent_accepted_at') !== '',
      aiModel: settings.get('ai_model') || 'gpt-4o-mini',
      webSearchEnabled: settings.get('web_search_enabled') === 'true',
      searchModel: settings.get('search_model') || 'gpt-4o-mini-search-preview',
      sttCleanupEnabled: settings.get('stt_cleanup_enabled') === 'true',
    });

    // EP-6: the Action Dispatcher. Reminder-create actions flow through it (validate → store a
    // pending proposal → confirm → execute). The Execution Layer calls the SAME writer the direct
    // path uses (repo.create + reconcile + broadcast), so the persisted row is byte-identical.
    const confirmationStore = new ConfirmationStore((expiredTurnId) => {
      chatRepo.resolveProposal(expiredTurnId, 'cancelled', null); // settle the stored turn (expiry = cancel)
      fanout(CH.ACTION_EXPIRED, { turnId: expiredTurnId });
    });
    const persistReminder = (raw: CreateReminderInput, sessionId: string | null): string => {
      const input = CreateReminderInput.parse(raw); // same normalisation/defaults as the direct path
      validateBusinessRules(input.scheduledAtUtcMs, input.recurrenceRule, input.actionType);
      const created = reminders.create(input, sessionId); // session_id = the chat that made it
      // VERIFY the reminder was actually STORED and SCHEDULED before anyone can claim success. If the
      // read-back is missing or has no next_fire_at, throw — dispatcher.confirm catches it and returns
      // a failure, so Yogi says "couldn't create that reminder" instead of a false success (reported bug).
      const stored = reminders.get(created.id);
      if (!stored || !stored.nextFireAt) {
        log.error('reminder', `create VERIFY FAILED for ${created.id} — stored=${!!stored} nextFireAt=${stored?.nextFireAt}`);
        throw new Error('reminder_persist_failed');
      }
      log.info(
        'reminder',
        `created ${created.id} "${input.title}" · fires ${new Date(stored.nextFireAt).toISOString()} · ${input.recurrenceRule ? 'recurring' : 'one-time'} · session=${sessionId ?? 'none'}`,
      );
      broadcastRemindersChanged();
      reminderMutationReconcile?.(); // nudge the scheduler so it's picked up promptly, not up to a tick late
      refreshTray();
      return created.id;
    };
    const actionDispatcher = new ActionDispatcher({
      store: confirmationStore,
      validate: (input) => validateBusinessRules(input.scheduledAtUtcMs, input.recurrenceRule, input.actionType),
      execute: (action, source, sessionId) => executeAction(action, source, { createReminder: persistReminder }, sessionId),
    });

    // Speak arbitrary text through the SAME path reminders/preview use, gated by the Voice toggle.
    // Best-effort — a TTS failure never affects the on-screen text (EP-4/EP-5).
    const speakText = (text: string) => {
      if (settings.get('tts_enabled') !== 'true') return;
      const aw = audioWindow;
      if (!aw || aw.isDestroyed()) return;
      void speakThroughAudioWindow({
        aw,
        provider: makeTtsProvider(providerConfig(), { getKey: () => apiKeyStore.get() }),
        text,
        voiceKey: settings.get('tts_voice'),
        rate: Number(settings.get('tts_rate')) || 1.0,
        onDegrade: () => settings.set('tts_degraded', 'true'),
      }).catch((e) => log.warn('chat', `speak failed: ${String(e)}`));
    };
    const voiceConfirmEnabled = () => settings.get('voice_confirm_enabled') === 'true';

    // EP-5/EP-6: the conversation brain. The provider factory is re-run per turn (live rebind) so
    // toggling AI Assist / consent takes effect without a restart. Reply-only intents get the
    // model's reply; reminder-create actions propose through the dispatcher (when enabled). The
    // result is pushed to the main window on chat:done.
    let desktopLauncher: ReturnType<typeof registerLauncherHandlers> | null = null;
    // The single active-conversation pointer shared by the main window and the voice launcher.
    // Moves only on deliberate navigation (main-window select / + New chat, or a launcher turn), so
    // the launcher continues the SAME conversation across presses. Deliberately NOT persisted across
    // restarts — cold start falls back to the most-recent chat, matching the main window.
    let activeSessionId: string | null = null;
    // Per-turn origin/session, set when a turn STARTS (startChatTurn) and read when it searches /
    // completes — lets the engine callbacks mirror the turn to the OTHER windows (real-time sync).
    const turnMeta = new Map<string, { sessionId: string; originId?: number }>();
    const conversationEngine = new ConversationEngine({
      provider: () => makeLlmProvider(providerConfig(), { getKey: () => apiKeyStore.get() }),
      fallback: chat,
      context: new ContextBuilder(reminders, () => Date.now()),
      chat: chatRepo,
      dispatcher: actionDispatcher,
      dispatcherEnabled: () => settings.get('dispatcher_enabled') === 'true',
      // 57: web_search backend (live rebind) — used when the model flags a turn as needing live info.
      searchProvider: () => makeSearchProvider(providerConfig(), { getKey: () => apiKeyStore.get() }),
      // Capability router (offline mode): answers local commands (time/settings/greeting/help) with
      // no LLM. "open settings" switches the main window's screen via the app:navigate broadcast.
      localRouter: makeLocalCommandRouter({
        now: () => Date.now(),
        timezone: () => Intl.DateTimeFormat().resolvedOptions().timeZone,
        navigate: (screen) => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.show();
            mainWindow.focus();
            mainWindow.webContents.send(CH.NAVIGATE, screen);
          } else {
            createMainWindow(); // no window yet — it opens on the default screen; the switch is best-effort
          }
        },
      }),
      broadcast: (turnId: string, turn: EngineTurn) => {
        // chat:done goes to ALL windows — the originating sender's chatSend/waitForLauncherReply
        // resolves on it (matched by turnId); other windows ignore it.
        fanout(CH.CHAT_DONE, { turnId, ...turn });
        desktopLauncher?.markTurnDone(turnId);
        // Mirror the completed turn (from the DB, the faithful record) to the OTHER windows so both
        // the main chat and the launcher render one live conversation. Excludes the sender, which
        // shows it via its own optimistic UI — so there is no double-append and no dedup needed.
        const meta = turnMeta.get(turnId);
        turnMeta.delete(turnId);
        if (meta) {
          try {
            const t = chatRepo.getTurn(turnId);
            if (t) fanoutExcept(meta.originId, CH.CHAT_TURN_APPENDED, { sessionId: meta.sessionId, turn: t });
          } catch {
            /* best-effort mirror — the turn persists and shows on reopen regardless */
          }
        }
      },
      // Reason code only (never the user's text) — makes a 400 (schema rejected) distinguishable
      // from a genuine network failure in the dev log (46 §Failure).
      onDegrade: (reason) => log.warn('chat', `turn degraded: ${reason}`),
      onInfo: (msg) => log.info('chat', msg),
      onSearchStart: (turnId) => {
        // Session-scoped so a NON-originating window can show "Searching the web…" on the right turn.
        fanout(CH.CHAT_SEARCHING, { turnId, sessionId: turnMeta.get(turnId)?.sessionId ?? null });
        desktopLauncher?.markSearching(turnId);
      },
      onSpeak: (replyText: string) => speakText(replyText),
      // EP-7: when a proposal card appears and voice-confirm is on, speak the prompt so the user
      // knows they can answer by voice.
      onProposeSpeak: (summary: string) => {
        if (voiceConfirmEnabled()) speakText(`${summary}. Say yes to confirm, or no to cancel.`);
      },
    });

    /**
     * The single entry point for starting a chat turn — used by BOTH the main chat (chat:send) and
     * the voice launcher. It records the turn's origin, then mirrors "a turn started (reply pending)"
     * to every OTHER window so the user's message + a thinking indicator appear there instantly. The
     * originating window shows its own message through its own optimistic UI (excluded here).
     */
    const startChatTurn = (text: string, sessionId: string, originId?: number): string => {
      const turnId = conversationEngine.startTurn(text, sessionId);
      turnMeta.set(turnId, { sessionId, originId });
      fanoutExcept(originId, CH.CHAT_TURN_STARTED, { sessionId, turnId, userText: text });
      return turnId;
    };

    // EP-7: resolve a pending proposal BY VOICE. The matcher runs locally in main and drives the
    // SAME action:confirm/cancel a button press would (36 §4.3) — it never reaches the LLM. The
    // renderer can't see main confirm the card, so we broadcast action:resolved to settle it.
    const broadcastResolved = (turnId: string, status: 'executed' | 'cancelled', summary?: string) => {
      fanout(CH.ACTION_RESOLVED, { turnId, status, summary });
    };
    const handleVoiceTranscript = (text: string): boolean => {
      if (!voiceConfirmEnabled()) return false;
      const turnId = confirmationStore.currentOpen();
      if (!turnId) return false; // no pending proposal → normal dictation, don't intercept
      const m = matchVoiceConfirm(text);
      if (m === 'neither') return false; // ambiguous → leave the transcript for the composer
      if (m === 'repeat') {
        const action = confirmationStore.peek(turnId);
        if (action) speakText(`${action.summary}. Say yes to confirm, or no to cancel.`);
        return true;
      }
      if (m === 'affirm') {
        const res = actionDispatcher.confirm(turnId);
        chatRepo.resolveProposal(turnId, res.ok ? 'executed' : 'cancelled', res.ok ? res.reminderId ?? null : null);
        broadcastResolved(turnId, res.ok ? 'executed' : 'cancelled', res.ok ? res.summary : res.message);
        speakText(res.ok ? 'Done — saved.' : "Sorry, I couldn't save that.");
        log.info('action', `voice confirm ${res.ok ? 'confirmed' : 'rejected:' + res.code}`);
        return true;
      }
      // negate
      actionDispatcher.cancel(turnId);
      chatRepo.resolveProposal(turnId, 'cancelled', null);
      broadcastResolved(turnId, 'cancelled');
      speakText('Okay, cancelled.');
      log.info('action', 'voice cancel');
      return true;
    };

    // 7. Hidden audio window (kept from Day 1 — real infrastructure).
    createAudioWindow();

    // 55: the always-on-top reminder popup window — created hidden at startup (like the audio
    // window) so it inherits the secured session; shown INACTIVE bottom-right when a reminder fires.
    createReminderPopupWindow();
    if (settings.get('desktop_voice_launcher_enabled') === 'true') {
      createLauncherWindow();
    }

    const launcherApi = {
      ensure: () => {
        if (!launcherWindow || launcherWindow.isDestroyed()) createLauncherWindow();
        return launcherWindow!;
      },
      current: () => launcherWindow,
      show: () => {
        const lw = launcherWindow;
        if (!lw || lw.isDestroyed()) return;
        lw.setAlwaysOnTop(true, 'screen-saver');
        lw.showInactive(); // never steals focus, like the reminder popup
      },
      // Pin bottom-right of the active display on every show (mirrors the reminder popup).
      positionOnShow: () => {
        const lw = launcherWindow;
        if (lw && !lw.isDestroyed()) positionLauncherBottomRight(lw);
      },
      // Issue 1 — the Close (✕) button was unreachable during `listening`/`processing`: the window
      // was made click-THROUGH (setIgnoreMouseEvents(true, forward)) whenever it wasn't "interactive"
      // and only re-enabled clicks on a fragile hover-forward path. Fix: decouple mouse-clickability
      // from keyboard-focusability. Keyboard focus (needed only for the review textarea) tracks the
      // `interactive` flag, but the window ALWAYS accepts mouse clicks while visible — so the header
      // ✕ and the chat switcher work in every phase. A non-focusable window still delivers button
      // clicks, so this keeps the "never steal focus" posture (paired with showInactive()).
      setInteractive: (interactive: boolean) => {
        const lw = launcherWindow;
        if (!lw || lw.isDestroyed()) return;
        lw.setFocusable(interactive);
        lw.setIgnoreMouseEvents(false);
      },
      // Mouse events stay enabled in every visible phase (see setInteractive) — nothing to toggle on
      // hover. Kept to satisfy the LauncherWindowApi contract.
      setHovered: () => {},
    };
    const reminderPopup = createReminderPopup({
      window: () => popupWindow,
      position: (w) => positionPopupBottomRight(w as unknown as import('electron').BrowserWindow),
      reminders,
      history,
      onChanged: () => {
        broadcastRemindersChanged();
        reminderMutationReconcile?.();
        refreshTray();
      },
      speak: (text) => speakText(text),
      formatTime: (r) =>
        new Date(r.nextFireAt).toLocaleTimeString('en-US', { timeZone: r.timezone, hour: 'numeric', minute: '2-digit' }),
      // Conversation interruption: when the last reminder is handled, resume any paused conversation.
      onQueueDrained: () => desktopLauncher?.resumeAfterReminder(),
    });
    // popup:action — the popup's Complete/Dismiss/Snooze/✕ (guard()-wrapped; origin-checked).
    ipcMain.handle(CH.POPUP_ACTION, (event, raw) =>
      guard(event, () => reminderPopup.handleAction(PopupActionInput.parse(raw))),
    );
    // popup:message — a typed/spoken popup message → lifecycle action or a { chat: true } signal.
    ipcMain.handle(CH.POPUP_MESSAGE, (event, raw) =>
      guard(event, () => {
        const { reminderId, text } = PopupMessageInput.parse(raw);
        return reminderPopup.handleMessage(reminderId, text);
      }),
    );

    const openMain = () => {
      if (mainWindow) {
        mainWindow.show();
        mainWindow.focus();
      } else {
        createMainWindow();
      }
    };

    // Open a specific conversation on BOTH surfaces: the launcher (when enabled — the voice/chat
    // surface) directly into that chat in a typeable state, and the main window (focus + select) so
    // both stay on the same conversation. Shared by the email notification and the reminder toast.
    const openSessionEverywhere = (sessionId: string) => {
      if (settings.get('desktop_voice_launcher_enabled') === 'true') {
        desktopLauncher?.openConversation(sessionId);
      } else {
        openMain();
      }
      fanout(CH.GMAIL_OPEN_CHAT, { sessionId }); // main window selects it (generic session-open)
    };

    // 8. Scheduler — wall-clock authoritative (08 §10). Created before the tray, because
    //    the tray's Pause/Resume needs to trigger a reconcile when un-pausing.
    // Reminder toast click → open the launcher into the reminder's conversation (the chat that made
    // it), where the user can keep talking to Yogi; a reminder with no chat just focuses the main
    // window. This is the reminder analogue of the email-notification navigation.
    const notifier = createNotifier((r) => {
      log.info('reminder', `notification clicked: ${r.id} session=${r.sessionId ?? 'none'}`);
      if (r.sessionId) openSessionEverywhere(r.sessionId);
      else openMain();
    });

    // Gmail Phase 2/3: provider → sync engine → scheduler → delivery coordinator (each new email
    // becomes its own chat + a spoken heads-up + a clickable notification). Token acquisition goes
    // through the single getValidAccessToken seam. `gmail_store_context=false` ⇒ track the cursor +
    // notify but store nothing.
    const gmailProvider = new GmailProvider();
    const gmailNotifier = createGmailNotifier();
    // True while the audio window is playing (a live conversation/reminder) — email TTS is skipped
    // then so it never overlaps. Set by the audio:playing handler below.
    let audioBusy = false;
    // Email-notification click → open that email's chat where the user converses (Issue 2). Uses the
    // shared session-open helper (launcher when enabled, else main window; both stay in sync).
    const openGmailChat = (sessionId: string) => openSessionEverywhere(sessionId);
    const emailContextService = new EmailContextService({
      gmailRepo,
      llm: () => makeLlmProvider(providerConfig(), { getKey: () => apiKeyStore.get() }),
      summariesEnabled: () => settings.get('gmail_ai_summaries') === 'true',
      log: (level, message) => log[level]('gmail-ai', message),
    });
    const emailResearchService = new EmailResearchService({
      gmailRepo,
      searchProvider: () => makeSearchProvider(providerConfig(), { getKey: () => apiKeyStore.get() }),
      log: (level, message) => log[level]('gmail-research', message),
    });
    const emailDelivery = new EmailDeliveryCoordinator({
      chat: chatRepo,
      gmailRepo,
      context: emailContextService,
      research: emailResearchService,
      autoResearch: () => settings.get('gmail_auto_research') === 'true',
      notifier: gmailNotifier,
      fanout,
      speak: speakText,
      ttsEnabled: () => settings.get('tts_enabled') === 'true',
      isAudioBusy: () => audioBusy,
      openChat: openGmailChat,
      log: (level, message) => log[level]('gmail-email', message),
    });
    const gmailSyncEngine = new GmailSyncEngine({
      provider: gmailProvider,
      repo: gmailRepo,
      getAccessToken: () => gmailAuth.getValidAccessToken(),
      getConfig: () => ({
        storeContext: settings.get('gmail_store_context') === 'true',
        downloadAttachments: settings.get('gmail_download_attachments') === 'true',
        maxStored: gmailMaxStoredToNumber(settings.get('gmail_max_stored')),
        notificationsEnabled: settings.get('gmail_notifications') === 'true',
      }),
      // Each batch of genuinely-new INBOX mail → the conversational delivery experience. Swallow a
      // throw in the fan-out tail (notify/speak) so it can't become an unhandled rejection.
      onNewMessages: (msgs) => {
        emailDelivery.deliver(msgs).catch((e) => log.warn('gmail-email', `delivery failed: ${(e as Error).message}`));
      },
      log: (level, message) => log[level]('gmail-sync', message),
    });
    const gmailSyncScheduler = new GmailSyncScheduler({
      engine: gmailSyncEngine,
      repo: gmailRepo,
      getConfig: () => ({
        enabled: settings.get('gmail_enabled') === 'true',
        mode: settings.get('gmail_sync_mode') as GmailSyncMode,
      }),
      log: (level, message) => log[level]('gmail-sync', message),
    });
    gmailSyncScheduler.start();

    // reminder-execution: run an ai_task reminder's intent (web research → answer) at fire time.
    // Provider is live-rebound per fire so consent/web-search toggles take effect without restart.
    const reminderExecutor = new ReminderExecutor({
      searchProvider: () => makeSearchProvider(providerConfig(), { getKey: () => apiKeyStore.get() }),
      onInfo: (msg) => log.info('reminder-exec', msg),
    });
    /** Deliver arbitrary text into a reminder's originating chat as a 'reminder' turn (assistant-only
     *  bubble) and live-append it to any open window. No-op for a null-session reminder. Shared by
     *  the plain title delivery and the executed-answer delivery. */
    const deliverTextToChat = (r: Reminder, text: string) => {
      if (!r.sessionId) return;
      const turn = chatRepo.recordReminderDelivery(r.sessionId, r.id, text);
      fanout(CH.CHAT_TURN_APPENDED, { sessionId: r.sessionId, turn });
    };

    const sink = createTriggerSink({
      notifier,
      history,
      audioWindow: () => audioWindow,
      mainWindow: () => mainWindow,
      ttsEnabled: () => settings.get('tts_enabled') === 'true',
      // EP-4: resolve the active TTS provider + chosen voice/rate per fire (live rebind).
      ttsProvider: () => makeTtsProvider(providerConfig(), { getKey: () => apiKeyStore.get() }),
      ttsVoice: () => settings.get('tts_voice'),
      ttsRate: () => Number(settings.get('tts_rate')) || 1.0,
      setTtsDegraded: (v) => settings.set('tts_degraded', String(v)),
      // DELIVERY: record the fired reminder as a turn IN its chat and live-append it if that chat
      // is open. Best-effort — a failure here never affects the notification/history/speak above.
      // (ai_task reminders skip this — the executor delivers the ANSWER instead of the title.)
      deliverToChat: (r) => deliverTextToChat(r, `⏰ Reminder — ${r.title}`),
      // 55: the fired-reminder surface — the always-on-top popup, or (flag off) the legacy modal.
      showReminder: (r) => {
        if (settings.get('reminder_popup_enabled') === 'true') {
          reminderPopup.enqueue(r);
        } else {
          const mw = mainWindow;
          if (mw && !mw.isDestroyed()) mw.webContents.send(CH.REMINDER_TRIGGER, r);
        }
      },
      // The popup speaks the reminder when enabled — so the sink's own TTS stands down to avoid a
      // clipped double; when the popup is off, the sink speaks the natural line instead.
      popupEnabled: () => settings.get('reminder_popup_enabled') === 'true',
      // Conversation interruption: pause an active voice conversation before the reminder speaks.
      pauseConversation: () => desktopLauncher?.pauseForReminder(),
      // reminder-execution: execute the ai_task intent, then speak + deliver the ANSWER. Best-effort
      // and async — the unconditional notification already fired; the answer follows seconds later.
      executeReminder: (r) => {
        void reminderExecutor
          .execute(r)
          .then((outcome) => {
            if (outcome.kind === 'simple') return; // shouldn't happen (guarded in the sink), but safe
            deliverTextToChat(r, outcome.delivered);
            // Speak the answer unless the reminder opted out of voice (global Voice toggle still applies).
            if (r.execution?.delivery.voice !== false) speakText(outcome.spoken);
          })
          .catch((e) => log.warn('reminder-exec', `execute failed: ${String(e)}`));
      },
      log: (level, message) => log[level]('reminder', message),
    });
    const scheduler = createScheduler({
      now: () => Date.now(),
      repo: reminders,
      sink,
      tickMs: TICK_MS,
      isPaused: () => settings.get('reminders_paused') === 'true',
      onOverdue: (missed) => {
        log.info('scheduler', `${missed.length} reminder(s) were overdue at startup`);
        // Record a history row for one-time reminders that were truly missed (recurring ones
        // were rolled forward, not missed) so they appear on the History → Missed tab.
        for (const r of missed) {
          if (!r.recurrenceRule) history.record(r.id, r.title, Date.now(), 'missed');
        }
        // Stash for the renderer to pull on mount — a broadcast here would fire before the
        // main window exists and before the renderer subscribes (a guaranteed race).
        pendingOverdue = missed.map((r) => ({ id: r.id, title: r.title, recurring: !!r.recurrenceRule }));
      },
      onError: (e) => log.error('scheduler', String(e)),
    });

    const togglePause = () => {
      const nowPaused = settings.get('reminders_paused') !== 'true';
      settings.set('reminders_paused', String(nowPaused));
      refreshTray();
      broadcastSettingsChanged();
      if (!nowPaused) scheduler.reconcile('resume'); // catch anything that came due while paused
    };

    // Reflect the launch-at-login preference into the OS (idempotent). Windows only; the '--hidden'
    // arg lets a login-triggered start know to stay in the tray. Called at startup + on settings change.
    const syncLoginItem = () => {
      if (process.platform !== 'win32') return;
      app.setLoginItemSettings({ openAtLogin: settings.get('launch_at_login') === 'true', args: ['--hidden'] });
    };

    // 9. Tray — module-scope ref, full menu.
    createTray({
      onOpen: openMain,
      onViewSchedules: openMain,
      onTogglePause: togglePause,
      onQuit: () => {
        isQuitting = true;
        app.quit();
      },
      isPaused: () => settings.get('reminders_paused') === 'true',
      activeCount: () => reminders.listActive().length,
    });

    // 10. IPC handlers. A mutation broadcasts to renderers, nudges the scheduler, and
    //     refreshes the tray count.
    registerIpcHandlers({
      reminders,
      history,
      settings,
      apiKeyStore,
      snoozeDefaultMinutes: () => Number(settings.get('snooze_minutes')) || 10,
      takeOverdue: () => {
        const items = pendingOverdue;
        pendingOverdue = [];
        return items;
      },
      closeDb: () => {
        stopBackgroundTimers(); // silence DB-touching timers BEFORE the handle closes
        db?.close();
        db = null;
      },
      // Reset (Issue 5): revoke the Google OAuth grant server-side before the local wipe, so a reset
      // doesn't leave LifeOS authorized in the user's Google account. Only when actually connected;
      // disconnect() itself is best-effort (a failed revoke still clears local state).
      onBeforeReset: async () => {
        if (gmailRepo.getAccount()) await gmailAuth.disconnect();
      },
      onChanged: () => {
        broadcastRemindersChanged();
        reminderMutationReconcile?.();
        refreshTray();
      },
      onSettingsChanged: () => {
        refreshTray();
        broadcastSettingsChanged();
        syncNativeTheme();
        syncLoginItem(); // apply a changed 'Start at login' preference to the OS

        // Dynamically update launcher window and shortcut bindings
        if (settings.get('desktop_voice_launcher_enabled') === 'true') {
          launcherApi.ensure();
          if (desktopLauncher) {
            desktopLauncher.unregisterShortcut();
            if (settings.get('desktop_voice_shortcut_enabled') === 'true') {
              desktopLauncher.registerShortcut();
            }
          }
        } else {
          if (desktopLauncher) {
            desktopLauncher.unregisterShortcut();
          }
          const lw = launcherApi.current();
          if (lw && !lw.isDestroyed()) {
            lw.hide();
          }
        }
      },
    });

    // Gmail integration handlers (connect/disconnect/test/credentials/deleteCache/status).
    registerGmailHandlers({
      auth: gmailAuth,
      repo: gmailRepo,
      tokenStore: gmailTokenStore,
      settings,
      onSettingsChanged: () => {
        broadcastSettingsChanged();
        refreshTray();
      },
      syncNow: () => gmailSyncScheduler.syncNow(),
    });

    // Conversation handlers (chat:send/cancel + session list/create/turns/rename). Separate from
    // registerIpcHandlers because the turn result arrives asynchronously on chat:done.
    registerChatHandlers({
      engine: conversationEngine,
      chat: chatRepo,
      startTurn: startChatTurn,
      setActiveSession: (id) => {
        activeSessionId = id;
      },
    });

    // EP-6/EP-7: action:confirm/cancel — execute or discard the STORED pending proposal for a
    // turnId, then settle the persisted chat turn so a reopened chat shows the settled card.
    registerActionHandlers({
      dispatcher: actionDispatcher,
      settle: (turnId, status, reminderId) => chatRepo.resolveProposal(turnId, status, reminderId),
      onOutcome: (outcome) => log.info('action', `confirm ${outcome}`),
    });

    const stopSpeaking = () => {
      const aw = audioWindow;
      if (aw && !aw.isDestroyed()) {
        aw.webContents.send('tts:cancel'); // Windows speechSynthesis
        aw.webContents.send('audio:stop'); // <audio> element (bytes/blob)
        aw.webContents.send('audio:ttsAbort'); // streaming MediaSource
      }
      fanout(CH.TTS_SPEAKING, { active: false });
      desktopLauncher?.setSpeaking(false);
    };

    desktopLauncher = registerLauncherHandlers({
      chat: chatRepo,
      startTurn: startChatTurn,
      settings,
      window: launcherApi,
      broadcast: fanout,
      stopSpeaking,
      speak: (text) => speakText(text), // re-read an interrupted reply when resuming after a reminder
      getActiveProposalSessionId: () => {
        const turnId = confirmationStore.currentOpen();
        return turnId ? confirmationStore.peekSessionId(turnId) : null;
      },
      getActiveSessionId: () => activeSessionId,
      setActiveSessionId: (id) => {
        activeSessionId = id;
      },
      // Hands-free STT decision: only when OpenAI is the EFFECTIVE provider (selected + keyed +
      // consented) — the same condition under which the cloud batch provider actually transcribes,
      // so we never auto-submit a silent sherpa fallback. Offline/unconsented → Review as before.
      getSttAutoSubmit: () => {
        const cfg = providerConfig();
        return cfg.sttProvider === 'openai' && cfg.hasApiKey && cfg.sttConsented;
      },
    });
    desktopLauncher.registerShortcut();
    log.info('launcher', `shortcut ${desktopLauncher.registeredAccelerator() ?? 'not registered'}`);

    // Speech-to-text handlers. The active provider is resolved per session from current settings
    // (EP-3 live rebind): offline sherpa, or OpenAI-batch behind a sherpa fallback when
    // stt_provider='openai' + key + consent. The key is read in main at call time only.
    registerSpeechHandlers({
      resolve: (sherpa) => makeSpeechProvider(providerConfig(), { getKey: () => apiKeyStore.get(), sherpa }),
      // EP-7: while a proposal is pending, the matcher gets first refusal on the final transcript.
      onFinalTranscript: handleVoiceTranscript,
      // Track A: post-STT LLM cleanup for dictation. Provider resolved per call (live rebind); null
      // (AI off / not consented / kill switch) or any failure → the raw transcript is returned.
      cleanTranscript: async (raw) => {
        const cleaner = makeTranscriptCleaner(providerConfig(), { getKey: () => apiKeyStore.get() });
        if (!cleaner) return raw;
        try {
          return await cleaner.clean(raw);
        } catch (e) {
          log.warn('stt', `cleanup failed: ${String(e)}`);
          return raw;
        }
      },
    });

    // EP-4: audio-window playback failure → note it so the next utterance uses the Windows voice
    // (wires the previously-dead reverse channel, 30 D8, 33 §3.1).
    ipcMain.on('audio:playbackError', (event) => {
      if (!isSenderOurWindow(event.senderFrame)) return;
      settings.set('tts_degraded', 'true');
      log.warn('tts', 'audio playback failed; falling back to the Windows voice');
    });

    // Voice: the audio window reports play/stop → broadcast tts:speaking so every window can show a
    // Stop Speaking button while Yogi is talking.
    ipcMain.on('audio:playing', (event, active: unknown) => {
      if (!isSenderOurWindow(event.senderFrame)) return;
      audioBusy = active === true; // gates email TTS so it never overlaps a live conversation/reminder
      fanout(CH.TTS_SPEAKING, { active: active === true });
      desktopLauncher?.setSpeaking(active === true);
    });
    // tts:stop — a renderer asks to stop speech immediately (Stop button, or mic interrupting).
    ipcMain.handle(CH.TTS_STOP, (event) =>
      guard(event, () => {
        stopSpeaking();
        return { ok: true };
      }),
    );

    // EP-4: Voice preview — speak the sample through the active provider+voice+rate, the SAME path
    // reminders use, so the user hears exactly what a reminder will sound like (35 §4).
    ipcMain.handle(CH.TTS_PREVIEW, (event) =>
      guard(event, async () => {
        const aw = audioWindow;
        if (aw && !aw.isDestroyed()) {
          await speakThroughAudioWindow({
            aw,
            provider: makeTtsProvider(providerConfig(), { getKey: () => apiKeyStore.get() }),
            text: 'This is Yogi. Nice to meet you.',
            voiceKey: settings.get('tts_voice'),
            rate: Number(settings.get('tts_rate')) || 1.0,
            onDegrade: () => settings.set('tts_degraded', 'true'),
          });
        }
        return { ok: true };
      }),
    );

    log.info('scheduler', `started · tick=${TICK_MS}ms · ${reminders.listActive().length} active reminder(s)`);
    scheduler.reconcile('startup'); // catch-up for reminders due while the app was closed
    const tick = setInterval(() => scheduler.reconcile('tick'), TICK_MS);
    powerMonitor.on('resume', () => scheduler.reconcile('resume'));
    powerMonitor.on('unlock-screen', () => scheduler.reconcile('unlock'));
    // Gmail: after waking from sleep, check for mail that arrived while suspended (interval-gated).
    powerMonitor.on('resume', () => void gmailSyncScheduler.tick());

    reminderMutationReconcile = () => scheduler.reconcile('mutation');
    stopBackgroundTimers = () => {
      clearInterval(tick);
      gmailSyncScheduler.stop();
    };
    app.on('before-quit', () => {
      stopBackgroundTimers();
      desktopLauncher?.unregisterShortcut();
    });

    syncLoginItem(); // reconcile the OS login item with the stored preference at startup

    // 11. Main window last. A launch-at-login start stays in the tray (no window popping up every
    //     boot); the scheduler + tray still run so reminders fire. Close-to-tray shows a one-time notice.
    const openedAtLogin = app.getLoginItemSettings().wasOpenedAtLogin || process.argv.includes('--hidden');
    const win = createMainWindow(openedAtLogin);
    win.on('close', (e) => {
      if (isQuitting) return;
      // Respect the user's close preference (12 §8). Default: hide to tray.
      if (settings.get('close_action') === 'quit') {
        isQuitting = true;
        app.quit(); // window-all-closed is a no-op on win32, so quit explicitly
        return;
      }
      e.preventDefault();
      showTrayNoticeOnce(win, settings);
      win.hide();
    });
  });

  // We live in the tray. Hiding the last window must not quit on Windows.
  app.on('window-all-closed', () => {
    /* deliberately no quit on win32 */
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });

  app.on('before-quit', () => {
    isQuitting = true;
    destroyTray();
    disposeSpeech();
    db?.close(); // checkpoint the WAL
  });
}
