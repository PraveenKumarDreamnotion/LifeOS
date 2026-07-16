import type { Result } from '../../core/types/channels';
import type { ReminderDto, HistoryDto, SettingsDto, GmailStatusDto, GmailSyncResultDto } from '../../core/types/ipc';
import type { ParseResult } from '../../core/parsing/types';
import type { ChatDonePayload } from '../../core/types/chat';
import type { DispatchResult } from '../../core/actions/action';
import type { ChatSession, ChatTurn } from '../../core/types/chat';
import type { ReminderPopupData, ReminderPopupAction } from '../../core/types/popup';
import type { DesktopVoiceState } from '../../core/types/desktop-voice';

type Unsubscribe = () => void;

/** A conversation as shown in the launcher's compact chat switcher (Issue 4). */
export interface LauncherSession {
  id: string;
  title: string;
  updatedAt: number;
  kind: 'email' | 'chat';
}

declare global {
  interface Window {
    readonly lifeos: {
      reminders: {
        create(input: unknown): Promise<Result<ReminderDto>>;
        list(): Promise<Result<ReminderDto[]>>;
        get(id: string): Promise<Result<ReminderDto | null>>;
        update(id: string, patch: unknown): Promise<Result<ReminderDto>>;
        delete(id: string): Promise<Result<{ deleted: boolean }>>;
        pause(id: string, paused: boolean): Promise<Result<ReminderDto>>;
        complete(id: string): Promise<Result<{ ok: boolean }>>;
        dismiss(id: string): Promise<Result<{ ok: boolean }>>;
        snooze(id: string, minutes: number): Promise<Result<ReminderDto>>;
        history(filter: unknown): Promise<Result<HistoryDto[]>>;
      };
      settings: {
        get(): Promise<Result<SettingsDto>>;
        update(patch: unknown): Promise<Result<{ ok: boolean }>>;
        resetLocalData(): Promise<Result<{ ok: boolean }>>;
        openDataFolder(): Promise<Result<{ ok: boolean }>>;
        setApiKey(key: string): Promise<Result<{ ok: boolean }>>;
        clearApiKey(): Promise<Result<{ ok: boolean }>>;
        validateApiKey(): Promise<Result<{ valid: boolean; reason?: string }>>;
      };
      overdue: {
        take(): Promise<Result<Array<{ id: string; title: string; recurring: boolean }>>>;
      };
      speech: {
        start(sampleRate: number): Promise<Result<{ started: boolean; supportsPartials: boolean }>>;
        stop(): Promise<Result<{ text: string }>>;
        pushAudio(pcm: ArrayBuffer): void;
        onPartial(cb: (t: string) => void): Unsubscribe;
        onError(cb: (e: unknown) => void): Unsubscribe;
      };
      parse(text: string): Promise<Result<ParseResult>>;
      chat: {
        send(text: string, sessionId: string): Promise<Result<{ turnId: string }>>;
        cancel(turnId: string): Promise<Result<{ cancelled: boolean }>>;
        onDelta(cb: (t: string) => void): Unsubscribe;
        onDone(cb: (payload: ChatDonePayload) => void): Unsubscribe;
        onSearching(cb: (p: { turnId: string; sessionId: string | null }) => void): Unsubscribe;
        listSessions(): Promise<Result<ChatSession[]>>;
        createSession(): Promise<Result<ChatSession>>;
        turns(sessionId: string): Promise<Result<ChatTurn[]>>;
        rename(id: string, title: string): Promise<Result<{ ok: boolean }>>;
        deleteSession(id: string): Promise<Result<{ ok: boolean }>>;
        setActiveSession(id: string): Promise<Result<{ ok: boolean }>>;
        onTurnStarted(cb: (payload: { sessionId: string; turnId: string; userText: string }) => void): Unsubscribe;
        onTurnAppended(cb: (payload: { sessionId: string; turn: ChatTurn }) => void): Unsubscribe;
      };
      action: {
        confirm(turnId: string): Promise<Result<DispatchResult>>;
        cancel(turnId: string): Promise<Result<{ cancelled: boolean }>>;
        onExpired(cb: (payload: { turnId: string }) => void): Unsubscribe;
        onResolved(cb: (payload: { turnId: string; status: 'executed' | 'cancelled'; summary?: string }) => void): Unsubscribe;
      };
      tts: {
        preview(): Promise<Result<{ ok: boolean }>>;
        stop(): Promise<Result<{ ok: boolean }>>;
        onSpeaking(cb: (p: { active: boolean }) => void): Unsubscribe;
      };
      gmail: {
        setCredentials(clientId: string, clientSecret: string): Promise<Result<{ ok: boolean }>>;
        connect(): Promise<Result<{ emailAddress: string }>>;
        disconnect(): Promise<Result<{ ok: boolean }>>;
        test(): Promise<Result<{ ok: boolean; emailAddress?: string; reason?: string }>>;
        deleteCache(): Promise<Result<{ ok: boolean; deleted: number }>>;
        syncNow(): Promise<Result<GmailSyncResultDto>>;
        status(): Promise<Result<GmailStatusDto>>;
        onStatusChanged(cb: (s: GmailStatusDto) => void): Unsubscribe;
        onOpenChat(cb: (p: { sessionId: string }) => void): Unsubscribe;
      };
      app: {
        version(): Promise<Result<{ version: string; electron: string }>>;
        onRemindersChanged(cb: () => void): Unsubscribe;
        onSettingsChanged(cb: () => void): Unsubscribe;
        onSessionsChanged(cb: () => void): Unsubscribe;
        onReminderTrigger(cb: (r: unknown) => void): Unsubscribe;
        onLauncherSessionActivated(cb: (p: { sessionId: string }) => void): Unsubscribe;
        onNavigate(cb: (screen: string) => void): Unsubscribe;
      };
    };
    /** The reminder popup window's bridge (55) — a SEPARATE renderer from the main window. */
    readonly lifeosPopup: {
      onShow(cb: (data: ReminderPopupData) => void): Unsubscribe;
      action(payload: ReminderPopupAction): Promise<Result<{ ok: boolean }>>;
      message(payload: { reminderId: string; text: string }): Promise<
        Result<{ reply?: string; action?: 'completed' | 'dismissed' | 'snoozed' | 'deleted'; chat?: boolean }>
      >;
      chat: {
        send(text: string, sessionId: string): Promise<Result<{ turnId: string }>>;
        onDone(cb: (payload: ChatDonePayload) => void): Unsubscribe;
        createSession(): Promise<Result<ChatSession>>;
      };
      speech: {
        start(sampleRate: number): Promise<Result<{ started: boolean; supportsPartials: boolean }>>;
        stop(): Promise<Result<{ text: string }>>;
        pushAudio(pcm: ArrayBuffer): void;
        onPartial(cb: (t: string) => void): Unsubscribe;
        onError(cb: (e: unknown) => void): Unsubscribe;
      };
      tts: {
        stop(): Promise<Result<{ ok: boolean }>>;
        onSpeaking(cb: (p: { active: boolean }) => void): Unsubscribe;
      };
      onSearching(cb: (p: { turnId: string }) => void): Unsubscribe;
    };
    readonly lifeosLauncher: {
      getState(): Promise<Result<DesktopVoiceState>>;
      onStateChanged(cb: (p: DesktopVoiceState) => void): Unsubscribe;
      onBeginListening(cb: (p: { sessionId: string }) => void): Unsubscribe;
      onStopListening(cb: () => void): Unsubscribe;
      sendTranscript(payload: { sessionId: string; text: string }): Promise<Result<{ turnId: string }>>;
      discardTranscript(payload: { sessionId: string }): Promise<Result<{ ok: boolean }>>;
      reviewReady(payload: { sessionId: string }): Promise<Result<{ ok: boolean }>>;
      hoverChanged(active: boolean): Promise<Result<{ ok: boolean }>>;
      setInteractive(interactive: boolean): Promise<Result<{ ok: boolean }>>;
      setError(message: string): Promise<Result<{ ok: boolean }>>;
      listSessions(): Promise<Result<LauncherSession[]>>;
      openConversation(sessionId: string): Promise<Result<{ ok: boolean }>>;
      speech: {
        start(sampleRate: number): Promise<Result<{ started: boolean; supportsPartials: boolean }>>;
        stop(): Promise<Result<{ text: string }>>;
        pushAudio(pcm: ArrayBuffer): void;
        onPartial(cb: (t: string) => void): Unsubscribe;
        onError(cb: (e: unknown) => void): Unsubscribe;
      };
      tts: {
        stop(): Promise<Result<{ ok: boolean }>>;
        onSpeaking(cb: (p: { active: boolean }) => void): Unsubscribe;
      };
      chat: {
        turns(sessionId: string): Promise<Result<ChatTurn[]>>;
        onDone(cb: (payload: ChatDonePayload) => void): Unsubscribe;
        onSearching(cb: (p: { turnId: string; sessionId: string | null }) => void): Unsubscribe;
        onTurnStarted(cb: (p: { sessionId: string; turnId: string; userText: string }) => void): Unsubscribe;
        onTurnAppended(cb: (p: { sessionId: string; turn: ChatTurn }) => void): Unsubscribe;
      };
    };
  }
}

export {};
