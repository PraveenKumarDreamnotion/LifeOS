/**
 * EmailDeliveryCoordinator (Phase 3) — turns "new mail detected" into the conversational experience
 * the user asked for: each new email becomes ITS OWN chat, Yogi speaks a one-line heads-up, and the
 * user can talk to Yogi about it. Mirrors the reminder fan-out (notify + speak + deliver-into-chat).
 *
 * Load-bearing constraints (see the advisor review folded into this design):
 *  - QUIET chat creation: creating an email chat must NOT move the shared active-session pointer or
 *    force any window to switch view (that would hijack the launcher's "continue my conversation").
 *    Email chats are excluded from the voice-continuity fallback; only a notification/sidebar click
 *    opens them.
 *  - ONE utterance + ONE notification per batch (never N overlapping), and TTS is skipped while audio
 *    is already playing (a live conversation/reminder) — the toast still fires.
 *  - Dedup by email id (a re-processed id must not spawn a second chat).
 *  - Bounded: cap chats-per-batch; summaries run with bounded concurrency; degrade to snippet when
 *    summaries are unavailable.
 */
import { CH } from '../../core/types/channels';
import { formatDeliveryText, formatResearchText, formatSpokenLine, senderLabel, type SummarizableEmail } from '../../core/gmail/summary';
import type { EmailAiContext } from '../../core/gmail/types';
import { mapLimit } from './sync-engine';
import type { NewMessage } from './sync-engine';
import type { EmailContextService } from './email-context-service';
import type { EmailResearchService } from './email-research-service';
import type { ChatRepository } from '../database/chat-repository';
import type { GmailRepository } from '../database/gmail-repository';
import type { GmailNotifier } from './gmail-notifier';

/** At most this many new emails become chats in one batch (a flood shows one summary toast instead). */
const CHATS_PER_BATCH = 10;
const SUMMARY_CONCURRENCY = 3;
/** Auto-research is a PAID search per email — capped tighter than the chat batch, and only for the
 *  emails the summary judged research-worthy. */
const RESEARCH_PER_BATCH = 3;
const RESEARCH_CONCURRENCY = 2;

export interface EmailDeliveryDeps {
  chat: ChatRepository;
  gmailRepo: GmailRepository;
  context: EmailContextService;
  /** Phase 4: opt-in web research on an email (fire-and-forget after delivery). */
  research: EmailResearchService;
  /** The "Automatic web research" toggle. */
  autoResearch: () => boolean;
  notifier: GmailNotifier;
  /** Broadcast to every window (chat turn appended + sessions changed). */
  fanout: (channel: string, payload: unknown) => void;
  /** Speak a line through the audio window (already gated on the TTS provider). */
  speak: (text: string) => void;
  ttsEnabled: () => boolean;
  /** True while audio is already playing (a live conversation/reminder) — skip email TTS then. */
  isAudioBusy: () => boolean;
  /** Open a chat in the main window (focus + navigate + select) — the notification click target. */
  openChat: (sessionId: string) => void;
  log?: (level: 'info' | 'warn' | 'error', message: string) => void;
}

interface Delivered {
  sessionId: string;
  messageId: string;
  email: SummarizableEmail;
  ctx: EmailAiContext | null;
}

export class EmailDeliveryCoordinator {
  constructor(private readonly deps: EmailDeliveryDeps) {}

  private log(level: 'info' | 'warn' | 'error', message: string): void {
    this.deps.log?.(level, message);
  }

  async deliver(newMessages: NewMessage[]): Promise<void> {
    if (!newMessages.length) return;
    const batch = newMessages.slice(0, CHATS_PER_BATCH);
    const overflow = newMessages.length - batch.length;

    const results = await mapLimit(batch, SUMMARY_CONCURRENCY, async (nm): Promise<Delivered | null> => {
      try {
        // Dedup: an email that already has a chat is not delivered again.
        if (this.deps.chat.findSessionByEmail(nm.id)) return null;

        // Prefer the fuller stored row (better summary source); fall back to the NewMessage fields.
        const stored = this.deps.gmailRepo.getMessage(nm.id);
        const email: SummarizableEmail = stored ?? {
          fromName: nm.fromName,
          fromAddress: nm.fromAddress,
          subject: nm.subject,
          snippet: nm.snippet,
        };
        const ctx = stored ? await this.deps.context.ensure(stored) : null;

        // Quiet chat: createEmailSession links the email and does NOT touch the active pointer.
        const title = truncate(`📧 ${email.subject || senderLabel(email)}`, 60);
        const session = this.deps.chat.createEmailSession(title, nm.id);
        const turn = this.deps.chat.recordEmailDelivery(session.id, formatDeliveryText(email, ctx));
        this.deps.fanout(CH.CHAT_TURN_APPENDED, { sessionId: session.id, turn });
        return { sessionId: session.id, messageId: nm.id, email, ctx };
      } catch (e) {
        this.log('warn', `gmail: email delivery failed for ${nm.id} (${(e as Error).message})`);
        return null;
      }
    });

    const delivered = results.filter((r): r is Delivered => r !== null);
    if (!delivered.length) return; // all were duplicates / failed

    // Sidebar refresh so the new chat(s) appear live.
    this.deps.fanout(CH.CHAT_SESSIONS_CHANGED, {});

    // ONE notification for the batch; click opens the first new email's chat.
    const primary = delivered[0]!;
    this.deps.notifier.show({
      title: delivered.length === 1 ? `New email · ${senderLabel(primary.email)}` : `${delivered.length} new emails`,
      body:
        delivered.length === 1
          ? primary.email.subject || '(no subject)'
          : delivered.slice(0, 3).map((d) => `${senderLabel(d.email)}: ${d.email.subject || '(no subject)'}`).join('\n'),
      onClick: () => this.deps.openChat(primary.sessionId),
    });

    // ONE spoken line — only if TTS is on and audio isn't already busy (no overlap).
    if (this.deps.ttsEnabled() && !this.deps.isAudioBusy()) {
      const line = formatSpokenLine(
        delivered.length,
        delivered.length === 1 ? primary.email : null,
        delivered.length === 1 ? primary.ctx : null,
      );
      if (line) this.deps.speak(line);
    }

    if (overflow > 0) this.log('info', `gmail: ${overflow} more new emails not delivered as chats (batch cap ${CHATS_PER_BATCH})`);

    // Phase 4: opt-in web research — fire-and-forget so it never delays the toast/TTS. Appends a
    // research turn to the email's chat when done (no second spoken line).
    void this.researchDelivered(delivered).catch((e) => this.log('warn', `gmail: research pass failed (${(e as Error).message})`));
  }

  private async researchDelivered(delivered: Delivered[]): Promise<void> {
    if (!this.deps.autoResearch()) return;
    const worthy = delivered.filter((d) => d.ctx?.researchWorthwhile && d.ctx.researchQuery.trim());
    const batch = worthy.slice(0, RESEARCH_PER_BATCH);
    const skipped = worthy.length - batch.length;

    await mapLimit(batch, RESEARCH_CONCURRENCY, async (d) => {
      const result = await this.deps.research.research(d.messageId, d.ctx!.researchQuery);
      if (!result) return;
      const turn = this.deps.chat.recordEmailDelivery(d.sessionId, formatResearchText(result));
      this.deps.fanout(CH.CHAT_TURN_APPENDED, { sessionId: d.sessionId, turn });
      this.deps.fanout(CH.CHAT_SESSIONS_CHANGED, {});
    });

    if (skipped > 0) this.log('info', `gmail: ${skipped} research-worthy emails skipped (research cap ${RESEARCH_PER_BATCH})`);
  }
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}
