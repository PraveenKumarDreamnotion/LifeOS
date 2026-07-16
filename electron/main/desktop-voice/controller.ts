import { BrowserWindow, globalShortcut } from 'electron';
import { CH } from '../../../core/types/channels';
import { DESKTOP_VOICE_IDLE_STATE, type DesktopVoiceState } from '../../../core/types/desktop-voice';
import type { ChatRepository } from '../../database/chat-repository';
import type { SettingsRepository } from '../../database/settings-repository';

export interface LauncherWindowApi {
  ensure(): BrowserWindow;
  current(): BrowserWindow | null;
  show(): void;
  /** Position the launcher bottom-right of the active display — called on every show. */
  positionOnShow(): void;
  setInteractive(interactive: boolean): void;
  setHovered(hovered: boolean): void;
}

export interface DesktopVoiceControllerDeps {
  chat: ChatRepository;
  /** Start a turn AND mirror "turn started" to the main window (real-time sync). Pass the launcher's
   *  own webContents id as originId so the launcher isn't mirrored its own message. Returns turnId. */
  startTurn: (text: string, sessionId: string, originId?: number) => string;
  settings: SettingsRepository;
  window: LauncherWindowApi;
  broadcast: (channel: string, payload?: unknown) => void;
  stopSpeaking: () => void;
  /** Speak text through the shared audio path (gated by the Voice toggle in main). Used to re-read
   *  an interrupted reply when resuming a conversation after a reminder. */
  speak: (text: string) => void;
  getActiveProposalSessionId?: () => string | null;
  /** The shared active-conversation pointer (single source of truth, owned by main). */
  getActiveSessionId: () => string | null;
  setActiveSessionId: (sessionId: string) => void;
  /** True when the effective STT provider is cloud OpenAI (selected + keyed + consented). Surfaced in
   *  every state snapshot so the launcher can submit an OpenAI transcript hands-free. Optional so
   *  existing callers/tests default to the offline (review) behaviour. */
  getSttAutoSubmit?: () => boolean;
}

export class DesktopVoiceController {
  private state: DesktopVoiceState = { ...DESKTOP_VOICE_IDLE_STATE };
  private lastShortcutTime = 0;
  /** Conversation-interruption state: a reminder fired mid-conversation, so the launcher was paused
   *  and must be resumed on the same session once the reminder is handled. */
  private interruptedForReminder = false;
  private resumeSession: string | null = null;
  /** True if Yogi was mid-reply (speaking) when interrupted — so the resume re-reads that reply. */
  private resumeWasSpeaking = false;
  /** After re-reading the interrupted reply on resume, start listening when that speech ends. */
  private pendingResumeListen = false;

  constructor(private readonly deps: DesktopVoiceControllerDeps) {}

  /** True when the launcher is engaged in a conversation (any non-resting phase) — i.e. a firing
   *  reminder should pause it rather than compete for audio. */
  isConversationActive(): boolean {
    const p = this.state.phase;
    return p === 'listening' || p === 'processing' || p === 'review' || p === 'sending' || p === 'speaking' || p === 'complete';
  }

  /**
   * A reminder is firing during an active conversation — PAUSE it so the reminder owns the audio:
   * stop the conversation's TTS, suspend STT (hiding the launcher unmounts the renderer, which tears
   * down mic capture), and remember the session to resume. No-op if no conversation is active, so a
   * reminder that fires with the launcher idle behaves exactly as before.
   */
  pauseForReminder(): void {
    if (this.interruptedForReminder || !this.isConversationActive()) return;
    this.interruptedForReminder = true;
    this.resumeSession = this.state.sessionId;
    this.resumeWasSpeaking = this.state.phase === 'speaking'; // was Yogi mid-reply? → re-read on resume
    this.deps.stopSpeaking(); // stop the conversation reply so it never overlaps the reminder
    this.deps.window.setInteractive(false);
    const win = this.deps.window.current();
    if (win && !win.isDestroyed()) win.hide(); // renderer unmounts → useSpeech teardown stops the mic
    this.update({ phase: 'idle', sessionId: null, activeTurnId: null, startedAt: null, searching: false, error: null });
  }

  /**
   * The reminder was dismissed/completed — RESUME the conversation on the SAME session. If Yogi was
   * mid-reply when interrupted, re-open the launcher and RE-READ that reply from the start (recovering
   * the lost context), then automatically resume listening once the re-read finishes. If it was just
   * listening, resume listening directly. When auto-resume is off, re-open ready and wait for the user.
   * No-op if we didn't pause a conversation.
   */
  resumeAfterReminder(): void {
    if (!this.interruptedForReminder) return;
    this.interruptedForReminder = false;
    const session = this.resumeSession;
    const wasSpeaking = this.resumeWasSpeaking;
    this.resumeSession = null;
    this.resumeWasSpeaking = false;
    if (!session) return;
    this.deps.setActiveSessionId(session); // so a resumed listen resolves the SAME chat

    const autoResume = this.deps.settings.get('conversation_auto_resume') !== 'false';
    const reply = wasSpeaking ? this.lastAssistantReply(session) : null;

    if (autoResume && reply) {
      // Re-open the launcher and re-read the interrupted reply; when that speech ends, start
      // listening (sequenced via pendingResumeListen so the re-read never overlaps the mic).
      const win = this.deps.window.ensure();
      this.deps.window.positionOnShow();
      this.deps.window.setInteractive(false);
      this.deps.window.show();
      this.update({ phase: 'speaking', sessionId: session, activeTurnId: null, startedAt: Date.now(), searching: false, error: null });
      this.deps.broadcast(CH.LAUNCHER_SESSION_ACTIVATED, { sessionId: session });
      win.webContents.send(CH.LAUNCHER_BEGIN_LISTENING, { sessionId: session }); // hydrate the transcript view
      this.pendingResumeListen = true;
      this.deps.speak(`Okay, picking up where we left off. ${reply}`);
      return;
    }
    if (autoResume) {
      this.startListening(); // was just listening — resume listening directly on the same session
      return;
    }
    // Auto-resume off: re-open the launcher ready and let the user continue when they choose.
    this.startListening();
  }

  /** The most recent assistant reply text in a session (skips fired-reminder turns), or null. */
  private lastAssistantReply(sessionId: string): string | null {
    try {
      const turns = this.deps.chat.loadTurns(sessionId) as Array<{ kind?: string; assistantText?: string }>;
      for (let i = turns.length - 1; i >= 0; i--) {
        const t = turns[i]!;
        if (t.kind !== 'reminder' && t.assistantText) return t.assistantText;
      }
    } catch {
      /* best-effort */
    }
    return null;
  }

  snapshot(): DesktopVoiceState {
    // sttAutoSubmit is derived live so switching the STT provider takes effect on the next launch
    // without a restart (mirrors the speech handler's per-session provider rebind).
    return { ...this.state, sttAutoSubmit: this.deps.getSttAutoSubmit?.() ?? false };
  }

  registeredAccelerator(): string | null {
    return this.state.registeredAccelerator;
  }

  registerShortcut(): void {
    if (this.deps.settings.get('desktop_voice_shortcut_enabled') !== 'true') return;
    const accelerator = 'Alt+Shift+Space';
    try {
      if (globalShortcut.register(accelerator, () => this.toggleListening())) {
        this.update({ registeredAccelerator: accelerator });
        return;
      }
    } catch {
      /* invalid/taken accelerator */
    }
    this.update({ registeredAccelerator: null });
  }

  unregisterShortcut(): void {
    if (this.state.registeredAccelerator) globalShortcut.unregister(this.state.registeredAccelerator);
    this.update({ registeredAccelerator: null });
  }

  toggleListening(): void {
    const now = Date.now();
    if (now - this.lastShortcutTime < 400) {
      // Ignore key-repeat/rapid presses
      return;
    }
    this.lastShortcutTime = now;

    if (this.state.phase === 'listening') {
      this.stopListening();
    } else if (this.state.phase === 'processing' || this.state.phase === 'sending') {
      // Ignore shortcut presses during processing or sending
      return;
    } else {
      this.startListening();
    }
  }

  startListening(): void {
    this.deps.stopSpeaking();

    // Conversation continuity: CONTINUE the active conversation instead of minting a new chat each
    // launch. Resolve the shared active-session pointer → most-recent chat (cold-start fallback) →
    // create a first chat only when none exists. A new conversation is created solely by the user's
    // explicit "+ New chat" (which moves the pointer) or when there are no chats at all.
    const sessionId = this.resolveActiveSession();
    this.deps.setActiveSessionId(sessionId);

    const win = this.deps.window.ensure();
    this.deps.window.positionOnShow();
    this.deps.window.setInteractive(false);
    this.deps.window.show();
    this.update({
      phase: 'listening',
      sessionId,
      activeTurnId: null,
      startedAt: Date.now(),
      searching: false,
      error: null,
    });
    this.deps.broadcast(CH.LAUNCHER_SESSION_ACTIVATED, { sessionId });
    win.webContents.send(CH.LAUNCHER_BEGIN_LISTENING, { sessionId });
  }

  /**
   * The conversation the launcher opens into on a MANUAL launch (Issue 3). It should be the MOST
   * RELEVANT conversation: the most recently active chat of any kind. A new email or a fired reminder
   * is delivered as a turn that bumps `updated_at`, so the latest notification surfaces first
   * (priority: notification → reminder → normal chat). The shared active pointer still wins when it
   * is at least as fresh as the top candidate — i.e. while you are actively using a conversation,
   * pressing the shortcut continues it rather than jumping to an older chat. The launcher's own chat
   * switcher lets the user move elsewhere in one click if the default isn't what they wanted.
   */
  private resolveActiveSession(): string {
    const pointer = this.pointerSession();
    let best: { id: string; updatedAt?: number } | undefined;
    try {
      best = this.deps.chat.mostRelevantConversation();
    } catch {
      /* fall through to pointer/create */
    }
    if (pointer && best && (pointer.updatedAt ?? 0) >= (best.updatedAt ?? 0)) return pointer.id;
    if (best) return best.id;
    if (pointer) return pointer.id;
    return this.deps.chat.createSession().id;
  }

  /** The shared active-pointer session if it still exists, else undefined. */
  private pointerSession(): { id: string; updatedAt?: number } | undefined {
    const active = this.deps.getActiveSessionId();
    if (!active) return undefined;
    try {
      return this.deps.chat.getSession(active) ?? undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Open the launcher DIRECTLY into a specific conversation (Issue 2 + Issue 4). Used by a
   * notification click (open the email's chat and continue chatting about it) and by the launcher's
   * chat switcher. Lands in a TYPEABLE state (Review) with the conversation hydrated, moves the
   * shared pointer, and never steals focus. If the launcher was recording, the mic is torn down
   * first so we don't switch conversations out from under a live recording.
   */
  openConversation(sessionId: string): void {
    if (!sessionId) return;
    // Stop any TTS from the previous conversation, and stop a live recording before switching.
    this.deps.stopSpeaking();
    if (this.state.phase === 'listening' || this.state.phase === 'processing') {
      const listeningWin = this.deps.window.current();
      if (listeningWin && !listeningWin.isDestroyed()) listeningWin.webContents.send(CH.LAUNCHER_STOP_LISTENING);
    }
    this.interruptedForReminder = false; // an explicit open cancels any pending reminder-resume
    this.deps.setActiveSessionId(sessionId);
    this.deps.window.ensure();
    this.deps.window.positionOnShow();
    this.deps.window.setInteractive(true); // typeable + clickable, so the user can reply immediately
    this.deps.window.show();
    // The state broadcast carries the new sessionId → the renderer's onStateChanged switches the
    // active session, and useLauncherMessages re-hydrates that chat's turns. No BEGIN_LISTENING here
    // (that would start the mic); the user lands able to read the thread and type a reply.
    this.update({ phase: 'review', sessionId, activeTurnId: null, startedAt: null, searching: false, error: null });
    this.deps.broadcast(CH.LAUNCHER_SESSION_ACTIVATED, { sessionId });
  }

  /** Conversations for the launcher's chat switcher (Issue 4) — safe DTOs, newest first. */
  listSessions(): Array<{ id: string; title: string; updatedAt: number; kind: 'email' | 'chat' }> {
    try {
      return this.deps.chat.listSessions().map((s) => ({
        id: s.id,
        title: s.title,
        updatedAt: s.updatedAt,
        kind: s.emailMessageId ? ('email' as const) : ('chat' as const),
      }));
    } catch {
      return [];
    }
  }

  stopListening(): void {
    if (this.state.phase !== 'listening') return;
    this.update({ phase: 'processing', error: null });
    const win = this.deps.window.current();
    if (win && !win.isDestroyed()) win.webContents.send(CH.LAUNCHER_STOP_LISTENING);
  }

  markReviewReady(sessionId: string): void {
    if (this.state.sessionId !== sessionId) return;
    this.deps.window.setInteractive(true);
    this.update({ phase: 'review', error: null });
  }

  markHover(active: boolean): void {
    if (this.state.phase !== 'idle' && this.state.phase !== 'hover') return;
    this.update({ phase: active ? 'hover' : 'idle' });
  }

  sendTranscript(sessionId: string, text: string): string {
    this.deps.setActiveSessionId(sessionId); // keep the shared pointer on the conversation we speak into
    const session = this.deps.chat.getSession(sessionId);
    if (session?.title === 'New chat') {
      this.deps.chat.rename(sessionId, text.length > 48 ? `${text.slice(0, 48)}...` : text);
    }
    // Start the turn through the SHARED entry point (same engine pipeline as the main chat). No
    // originId: the launcher renders its conversation as a PURE subscriber to the turn broadcasts
    // (no optimistic list), so it should receive its own turn's started/appended events too.
    const turnId = this.deps.startTurn(text, sessionId);

    // The launcher stays VISIBLE through the response arc (sending → searching → complete →
    // speaking) so the user sees Searching/Thinking and the reply, and can Stop speaking. It
    // returns to its hidden resting state only when the arc ends (setSpeaking(false) → idle).
    this.update({ phase: 'sending', sessionId, activeTurnId: turnId, searching: false, error: null });
    this.deps.broadcast(CH.LAUNCHER_SESSION_ACTIVATED, { sessionId });
    return turnId;
  }

  async discardTranscript(_sessionId: string): Promise<void> {
    // Dismiss/✕/Escape must also silence Yogi — the launcher can be dismissed WHILE TTS is speaking
    // (the window is visible through the response arc), and hiding it would otherwise leave speech
    // running with no visible Stop control.
    this.deps.stopSpeaking();
    // Dismiss only CLOSES the launcher — it does NOT delete the conversation. The session is the
    // shared active chat (it may hold prior turns, or be a fresh "New chat" the user still owns), so
    // deleting it here would be data loss. Continuity: the pointer stays put for the next launch.
    try {
      const win = this.deps.window.current();
      if (win && !win.isDestroyed()) win.hide();
    } catch {
      /* ignore */
    }

    this.deps.window.setInteractive(false);
    this.update({ phase: 'idle', sessionId: null, activeTurnId: null, startedAt: null, searching: false, error: null });
  }

  markSearching(turnId: string): void {
    if (this.state.activeTurnId !== turnId) return;
    this.update({ searching: true });
  }

  markTurnDone(turnId: string): void {
    if (this.state.activeTurnId !== turnId) return; // only the launcher's own turn
    this.deps.window.setInteractive(true);
    this.update({ phase: 'complete', searching: false });
    // NB: mirroring this turn to the main window is handled centrally by the engine broadcast
    // callback (fanoutExcept the launcher), so both surfaces sync through one mechanism.
  }

  setSpeaking(active: boolean): void {
    // While paused for a reminder, the reminder's OWN audio flows through the shared audio window and
    // reports audio:playing here. Ignore it — otherwise the reminder finishing (playing=false) would
    // hide/reset the launcher we intend to resume (the historical "reminder collapses the UI" bug).
    if (this.interruptedForReminder) return;
    if (active) {
      if (
        this.state.phase === 'sending' ||
        this.state.phase === 'complete' ||
        this.state.phase === 'review' ||
        this.state.phase === 'processing'
      ) {
        this.update({ phase: 'speaking' });
      }
      return;
    }
    if (this.state.phase === 'speaking') {
      // The re-read of an interrupted reply just finished → sequence into listening so the user can
      // continue, instead of hiding. (Set on resume; sequenced so the re-read never overlaps the mic.)
      if (this.pendingResumeListen) {
        this.pendingResumeListen = false;
        this.startListening();
        return;
      }
      // The response arc is over — return the launcher to its hidden resting (idle) state.
      this.deps.window.setInteractive(false);
      const win = this.deps.window.current();
      if (win && !win.isDestroyed()) win.hide();
      this.update({ phase: 'idle', sessionId: null, activeTurnId: null, startedAt: null, searching: false, error: null });
    }
  }

  setError(message: string): void {
    this.deps.window.setInteractive(true);
    this.update({ phase: 'error', error: message });
  }

  private update(patch: Partial<DesktopVoiceState>): void {
    this.state = { ...this.state, ...patch };
    this.deps.broadcast(CH.LAUNCHER_STATE_CHANGED, this.snapshot());
  }
}
