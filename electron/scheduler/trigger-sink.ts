/**
 * The trigger fan-out (13 §3.2, 17 §1).
 *
 * Read the ordering as the reliability argument: the notification and the history record
 * are UNCONDITIONAL and come first, outside any try that could skip them. Speech, audio and
 * the in-app modal are best-effort and individually wrapped — a throw in any of them cannot
 * prevent the toast. A silent reminder is still a reminder; a missed reminder is a bug.
 */
import { BrowserWindow } from 'electron';
import type { TriggerSink } from './scheduler';
import type { Notifier } from '../notifications/notifier';
import type { HistoryRepository } from '../database/history-repository';
import type { Reminder } from '../../core/types/reminder';
import { isAiTask } from '../../core/types/reminder-execution';
import { spokenReminder } from '../../core/tts/reminder-speech';
import type { TextToSpeechProvider } from '../../core/tts/tts-provider';
import { speakThroughAudioWindow } from '../main/tts/speak';

export interface TriggerSinkDeps {
  notifier: Notifier;
  history: HistoryRepository;
  audioWindow: () => BrowserWindow | null;
  mainWindow: () => BrowserWindow | null;
  ttsEnabled: () => boolean;
  // EP-4: the active TTS provider + the chosen friendly voice/rate, resolved per fire (live rebind).
  ttsProvider: () => TextToSpeechProvider;
  ttsVoice: () => string;
  ttsRate: () => number;
  setTtsDegraded: (v: boolean) => void;
  // DELIVERY: deliver a fired reminder into the chat that created it. Called ONLY for reminders
  // with a sessionId; a null-session (manual/pre-existing) reminder never reaches here.
  deliverToChat?: (r: Reminder) => void;
  // 55: show the fired reminder to the user — the always-on-top popup, or (flag off) the legacy
  // TriggerModal. Best-effort; the unconditional notification already fired.
  showReminder: (r: Reminder) => void;
  // When the always-on-top popup is enabled it speaks the reminder itself (natural line), so the
  // sink must NOT also speak — otherwise the two overlap and the user hears a clipped double. When
  // the popup is off (legacy modal), the sink speaks the reminder instead.
  popupEnabled: () => boolean;
  // Conversation interruption: if a voice conversation is active, pause it BEFORE the reminder
  // speaks so their audio never overlaps. Paired with the popup's onQueueDrained → resume. No-op
  // when no conversation is active. Only used on the popup path (which owns the resume signal).
  pauseConversation?: () => void;
  // reminder-execution: run an ai_task reminder's intent (research → answer) and speak/deliver the
  // ANSWER. Best-effort and asynchronous. When present and the reminder is an ai_task, it REPLACES
  // the default speak-the-title + deliver-the-title behaviour (the answer, not the title, is what
  // the user hears and sees). Absent / non-ai_task reminders behave exactly as before.
  executeReminder?: (r: Reminder) => void;
  /** Optional debug logging of the fan-out steps (reported reliability ask) — best-effort. */
  log?: (level: 'info' | 'warn' | 'error', message: string) => void;
}

function safely(module: string, fn: () => unknown): void {
  try {
    Promise.resolve(fn()).catch((e) => console.warn(`[${module}] degraded: ${e}`));
  } catch (e) {
    console.warn(`[${module}] degraded: ${e}`);
  }
}

export function createTriggerSink(deps: TriggerSinkDeps): TriggerSink {
  const log = (level: 'info' | 'warn' | 'error', msg: string) => deps.log?.(level, msg);
  return {
    fire(r: Reminder): void {
      log('info', `fired ${r.id} "${r.title}" · session=${r.sessionId ?? 'none'} · ${r.recurrenceRule ? 'recurring' : 'one-time'}`);
      // UNCONDITIONAL — must not be inside any try that could skip them.
      deps.notifier.show(r);
      deps.history.record(r.id, r.title, Date.now(), 'triggered');
      log('info', `notified + history recorded for ${r.id}`);

      // An ai_task reminder with an executor wired does its OWN speaking + chat delivery (the
      // researched answer), so we suppress the default title-speak and title-delivery below to
      // avoid speaking/showing the title AND then the answer. The unconditional notify above and
      // the popup/sing below are unaffected — the heads-up still fires immediately.
      const aiExecuted = isAiTask(r.execution) && !!deps.executeReminder;

      // INTERRUPTION (first best-effort step): if a voice conversation is active, pause it before the
      // reminder speaks so audio never overlaps. Only on the popup path — the popup drain resumes it.
      safely('pause-conversation', () => {
        if (deps.popupEnabled()) deps.pauseConversation?.();
      });

      // BEST EFFORT — each isolated.
      safely('tts', () => {
        if (aiExecuted) return; // the executor speaks the answer instead of the title
        if (deps.popupEnabled()) return; // the popup speaks the natural line — don't double up
        if (!deps.ttsEnabled()) return;
        const aw = deps.audioWindow();
        if (!aw || aw.isDestroyed()) return;
        // Branches on provider.kind: Windows in-window, or OpenAI audio-bytes → audio:playBytes,
        // with a Windows fallback baked into the coordinator (33 §3.2). Notification already fired.
        // Speak the natural line (greeting + "it's time to …"), not the raw title.
        return speakThroughAudioWindow({
          aw,
          provider: deps.ttsProvider(),
          text: spokenReminder(r.title),
          voiceKey: deps.ttsVoice(),
          rate: deps.ttsRate(),
          onDegrade: () => deps.setTtsDegraded(true),
        });
      });

      safely('audio', () => {
        if (r.actionType !== 'sing') return;
        const aw = deps.audioWindow();
        if (!aw || aw.isDestroyed()) return;
        aw.webContents.send('audio:play', { file: 'yogi-song' });
      });

      safely('ui', () => deps.showReminder(r));

      // DELIVERY (best-effort, after the unconditional notify + history): drop the reminder INTO
      // its chat so the conversation can continue from it. Only for chat-created reminders — a
      // null-session reminder behaves exactly as before (notification + modal, no chat write).
      safely('chat-delivery', () => {
        if (aiExecuted) return; // the executor delivers the answer instead of the title
        if (r.sessionId) {
          deps.deliverToChat?.(r);
          log('info', `delivered ${r.id} into chat ${r.sessionId}`);
        }
      });

      // reminder-execution (best-effort, after the unconditional notify + history): run an ai_task
      // reminder's intent and speak/deliver the ANSWER. Async — the notification already fired; the
      // answer arrives seconds later. A throw here can never cost the reminder.
      safely('reminder-exec', () => {
        if (aiExecuted) deps.executeReminder!(r);
      });
    },
  };
}
