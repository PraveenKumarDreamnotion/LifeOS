import { randomUUID } from 'node:crypto';
import type { SqliteDriver } from './driver';
import type { ChatSession, ChatTurn, PersistedProposalStatus } from '../../core/types/chat';

/**
 * ChatRepository — the persistent, resumable conversation store (migration 003). Unlike the
 * best-effort `conversations` telemetry table, `chat_turns` is the FAITHFUL render source:
 * `assistantText` is exactly what the user saw, and a proposal turn carries its settled outcome
 * so a reopened chat renders a real settled card. It is the single source of truth for both the
 * renderer (message list) and the engine (last-K LLM context = a lossy (role,text) projection).
 */

export type ProposalStatus = PersistedProposalStatus;

interface SessionRow {
  id: string;
  title: string;
  created_at: number;
  updated_at: number;
  email_message_id: string | null;
}
interface TurnRow {
  id: string;
  session_id: string;
  kind: 'chat' | 'reminder' | 'email';
  user_text: string;
  assistant_text: string;
  intent: string | null;
  proposal_summary: string | null;
  proposal_status: ProposalStatus | null;
  reminder_id: string | null;
  created_at: number;
}

/** One record for a completed turn — the SHOWN reply plus any proposal it displayed. */
export interface RecordTurnInput {
  id: string; // the engine turnId
  sessionId: string;
  userText: string;
  assistantText: string;
  intent?: string | null;
  proposalSummary?: string | null;
  proposalStatus?: ProposalStatus | null;
  reminderId?: string | null;
}

export class ChatRepository {
  constructor(private readonly db: SqliteDriver, private readonly now: () => number = () => Date.now()) {}

  // ── Sessions ──────────────────────────────────────────────────────────────

  createSession(title = 'New chat'): ChatSession {
    const id = randomUUID();
    const ts = this.now();
    this.db.run('INSERT INTO chat_sessions (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)', [id, title, ts, ts]);
    return { id, title, createdAt: ts, updatedAt: ts };
  }

  listSessions(): ChatSession[] {
    return this.db
      .all<SessionRow>('SELECT * FROM chat_sessions ORDER BY updated_at DESC')
      .map(toSession);
  }

  /** Most-recent NON-email chat — the voice-continuity cold-start fallback (Phase 3). Email chats
   *  are excluded so a delivered email never hijacks "continue my last conversation". */
  mostRecentConversation(): ChatSession | undefined {
    const row = this.db.get<SessionRow>(
      'SELECT * FROM chat_sessions WHERE email_message_id IS NULL ORDER BY updated_at DESC LIMIT 1',
    );
    return row ? toSession(row) : undefined;
  }

  /**
   * The "most relevant" conversation to open when the launcher is launched manually (Issue 3).
   * Recency-primary across ALL chats (email, reminder-bearing, or normal) with email winning an
   * exact tie — because a new email or a fired reminder is delivered as a turn that bumps
   * `updated_at`, the latest notification naturally surfaces first, matching the requested priority
   * (notification → reminder → normal chat). Distinct from `mostRecentConversation()`, which
   * deliberately EXCLUDES email chats (that method backs a different, continuity-only path).
   */
  mostRelevantConversation(): ChatSession | undefined {
    const row = this.db.get<SessionRow>(
      `SELECT * FROM chat_sessions
       ORDER BY updated_at DESC, CASE WHEN email_message_id IS NOT NULL THEN 0 ELSE 1 END
       LIMIT 1`,
    );
    return row ? toSession(row) : undefined;
  }

  /** The chat auto-created for a given email, if one exists (dedup guard for delivery). */
  findSessionByEmail(emailMessageId: string): ChatSession | undefined {
    const row = this.db.get<SessionRow>(
      'SELECT * FROM chat_sessions WHERE email_message_id = ? LIMIT 1',
      [emailMessageId],
    );
    return row ? toSession(row) : undefined;
  }

  /** Create a chat linked to a delivered email (Phase 3). Distinct from createSession so the
   *  email link is set atomically at creation. */
  createEmailSession(title: string, emailMessageId: string): ChatSession {
    const id = randomUUID();
    const ts = this.now();
    this.db.run(
      'INSERT INTO chat_sessions (id, title, created_at, updated_at, email_message_id) VALUES (?, ?, ?, ?, ?)',
      [id, title, ts, ts, emailMessageId],
    );
    return { id, title, createdAt: ts, updatedAt: ts, emailMessageId };
  }

  getSession(id: string): ChatSession | undefined {
    const row = this.db.get<SessionRow>('SELECT * FROM chat_sessions WHERE id = ?', [id]);
    return row ? toSession(row) : undefined;
  }

  rename(id: string, title: string): void {
    this.db.run('UPDATE chat_sessions SET title = ?, updated_at = ? WHERE id = ?', [title, this.now(), id]);
  }

  /** Bump last-activity so the chat list re-sorts to the top. */
  touch(id: string): void {
    this.db.run('UPDATE chat_sessions SET updated_at = ? WHERE id = ?', [this.now(), id]);
  }

  /** Delete a chat + its turns. Reminders OUTLIVE chats (55 §Delivery) — their session link is
   *  nulled, never cascade-deleted. Transactional so a partial delete can't happen. */
  deleteSession(id: string): void {
    this.db.transaction(() => {
      this.db.run('DELETE FROM chat_turns WHERE session_id = ?', [id]);
      this.db.run('UPDATE reminders SET session_id = NULL WHERE session_id = ?', [id]);
      this.db.run('DELETE FROM chat_sessions WHERE id = ?', [id]);
    });
  }

  // ── Turns ─────────────────────────────────────────────────────────────────

  /** Persist a completed turn (best-effort: a write failure must never break the live turn). */
  recordTurn(input: RecordTurnInput): void {
    this.db.run(
      `INSERT INTO chat_turns
         (id, session_id, kind, user_text, assistant_text, intent, proposal_summary, proposal_status, reminder_id, created_at)
       VALUES (?, ?, 'chat', ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.id,
        input.sessionId,
        input.userText,
        input.assistantText,
        input.intent ?? null,
        input.proposalSummary ?? null,
        input.proposalStatus ?? null,
        input.reminderId ?? null,
        this.now(),
      ],
    );
    this.touch(input.sessionId);
  }

  /**
   * Deliver a fired reminder INTO its chat (DELIVERY): a `kind='reminder'` turn with no user text.
   * Bumps the session so it rises in the sidebar. Returns the new turn for a live broadcast.
   */
  recordReminderDelivery(sessionId: string, reminderId: string, text: string): ChatTurn {
    const id = randomUUID();
    const ts = this.now();
    this.db.run(
      `INSERT INTO chat_turns
         (id, session_id, kind, user_text, assistant_text, intent, reminder_id, created_at)
       VALUES (?, ?, 'reminder', '', ?, 'reminder_fired', ?, ?)`,
      [id, sessionId, text, reminderId, ts],
    );
    this.touch(sessionId);
    return {
      id, sessionId, kind: 'reminder', userText: '', assistantText: text,
      intent: 'reminder_fired', proposalSummary: null, proposalStatus: null, reminderId, createdAt: ts,
    };
  }

  /** Deliver a new email INTO its chat (Phase 3): a `kind='email'` assistant-only turn (no user
   *  text). The text doubles as LLM context — because recentTurns feeds the engine, Yogi can answer
   *  about the email from chat history with no engine change. Returns the turn for a live broadcast. */
  recordEmailDelivery(sessionId: string, text: string): ChatTurn {
    const id = randomUUID();
    const ts = this.now();
    this.db.run(
      `INSERT INTO chat_turns
         (id, session_id, kind, user_text, assistant_text, intent, created_at)
       VALUES (?, ?, 'email', '', ?, 'email_received', ?)`,
      [id, sessionId, text, ts],
    );
    this.touch(sessionId);
    return {
      id, sessionId, kind: 'email', userText: '', assistantText: text,
      intent: 'email_received', proposalSummary: null, proposalStatus: null, reminderId: null, createdAt: ts,
    };
  }

  /** Settle a proposal turn's outcome (called when confirm/cancel/expiry resolves it). */
  resolveProposal(turnId: string, status: ProposalStatus, reminderId: string | null): void {
    this.db.run('UPDATE chat_turns SET proposal_status = ?, reminder_id = ? WHERE id = ?', [status, reminderId, turnId]);
  }

  /** A single persisted turn by id — used to mirror a just-completed launcher turn into the open chat. */
  getTurn(id: string): ChatTurn | undefined {
    const row = this.db.get<TurnRow>('SELECT * FROM chat_turns WHERE id = ?', [id]);
    return row ? toTurn(row) : undefined;
  }

  /** All turns for a session, oldest first — the renderer rebuilds the message list from these. */
  loadTurns(sessionId: string): ChatTurn[] {
    return this.db
      .all<TurnRow>('SELECT * FROM chat_turns WHERE session_id = ? ORDER BY created_at ASC', [sessionId])
      .map(toTurn);
  }

  /** The last K turns for a session — the engine's bounded LLM context window. */
  recentTurns(sessionId: string, limit: number): ChatTurn[] {
    return this.db
      .all<TurnRow>('SELECT * FROM chat_turns WHERE session_id = ? ORDER BY created_at DESC LIMIT ?', [sessionId, limit])
      .map(toTurn)
      .reverse(); // back to chronological order
  }
}

function toSession(r: SessionRow): ChatSession {
  return { id: r.id, title: r.title, createdAt: r.created_at, updatedAt: r.updated_at, emailMessageId: r.email_message_id ?? null };
}
function toTurn(r: TurnRow): ChatTurn {
  return {
    id: r.id,
    sessionId: r.session_id,
    kind: r.kind ?? 'chat',
    userText: r.user_text,
    assistantText: r.assistant_text,
    intent: r.intent,
    proposalSummary: r.proposal_summary,
    proposalStatus: r.proposal_status,
    reminderId: r.reminder_id,
    createdAt: r.created_at,
  };
}
