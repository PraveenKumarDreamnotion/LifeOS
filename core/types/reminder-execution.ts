/**
 * ReminderExecutionSpec — the structured "what to DO when this reminder fires" record.
 *
 * The problem it solves: historically a reminder stored only a title string, so a fired reminder
 * could only "notify + speak the title." A request like "remind me tomorrow to tell me the contact
 * details of NIT Hamirpur" therefore replayed as passive chat context and the model asked "what
 * would you like to know?" instead of executing. Storing a structured intent — captured and
 * confirmed at creation time — lets the fire-time ReminderExecutor run the task deterministically
 * (web research → answer → speak) rather than re-parsing an ambiguous utterance.
 *
 * `null` on a reminder means "no spec" — the classic notify/sing behaviour, unchanged. This type is
 * additive; every pre-existing reminder keeps behaving exactly as before.
 *
 * Kept as a zod schema so the JSON we persist in `reminders.execution_json` is validated on the way
 * back out (a corrupt/legacy blob fails safe to null → simple notify). Pure: no electron/DOM.
 */
import { z } from 'zod';

/**
 * Capabilities a scheduled task may need. The list is intentionally broader than what executes
 * today (only web_search is wired) so the taxonomy ACCOMMODATES weather/news/email/calendar without
 * a schema change — but we implement executors incrementally, we don't build eight at once.
 */
export const REMINDER_CAPABILITIES = [
  'web_search', // read-only: live web lookup (implemented)
  'weather', // read-only (future)
  'news', // read-only (future)
  'email_read', // read-only (future)
  'calendar_read', // read-only (future)
  'documents_read', // read-only (future)
  'email_send', // WRITE — requires fire-time confirmation
  'calendar_write', // WRITE — requires fire-time confirmation
] as const;
export type ReminderCapability = (typeof REMINDER_CAPABILITIES)[number];

/**
 * Capabilities that only READ external state. A task whose capabilities are ALL read-only may
 * auto-execute at fire time (mirrors 57 §4 "read tools execute directly"). Any capability outside
 * this set is a WRITE and forces a fire-time confirmation card — the "LLM never actuates without a
 * human yes" invariant is preserved even for scheduled tasks.
 */
export const READ_ONLY_CAPABILITIES: readonly ReminderCapability[] = [
  'web_search',
  'weather',
  'news',
  'email_read',
  'calendar_read',
  'documents_read',
];

/** How the produced result should be shaped/delivered. `spoken_answer` = a concise voice-first
 *  reply; `summary` = a few sentences; `text` = written result (no strong voice framing). */
export const REMINDER_OUTPUT_FORMATS = ['spoken_answer', 'summary', 'text'] as const;

export const ReminderExecutionSpecSchema = z
  .object({
    /** Bump when the shape changes incompatibly; an unknown version fails safe to null. */
    version: z.literal(1),
    /** 'simple' = notify + speak the title (today's behaviour, no AI). 'ai_task' = run the
     *  instruction and deliver the produced answer. */
    type: z.enum(['simple', 'ai_task']),
    /**
     * The imperative task to perform at fire time — a RESOLVED instruction, NOT the raw user
     * utterance. e.g. "Find and report the contact details of NIT Hamirpur." Empty for 'simple'.
     */
    instruction: z.string().trim().max(2000).default(''),
    /** Capabilities the task needs; drives consent gating and the read-only/write policy. */
    capabilities: z.array(z.enum(REMINDER_CAPABILITIES)).default([]),
    outputFormat: z.enum(REMINDER_OUTPUT_FORMATS).default('spoken_answer'),
    delivery: z
      .object({
        notify: z.boolean().default(true), // OS notification (unconditional in practice)
        voice: z.boolean().default(true), // speak the result aloud
      })
      .default({ notify: true, voice: true }),
  })
  .strict();

export type ReminderExecutionSpec = z.infer<typeof ReminderExecutionSpecSchema>;

/** True when the spec is a real AI task to execute (not simple/null). */
export function isAiTask(spec: ReminderExecutionSpec | null | undefined): spec is ReminderExecutionSpec {
  return !!spec && spec.type === 'ai_task';
}

/** True when ANY capability writes external state → the fired reminder must confirm before acting.
 *  A task with no capabilities, or only read-only ones, may auto-execute. */
export function requiresFireTimeConfirmation(spec: ReminderExecutionSpec): boolean {
  const readOnly = new Set<ReminderCapability>(READ_ONLY_CAPABILITIES);
  return spec.capabilities.some((c) => !readOnly.has(c));
}

/** Parse the stored JSON blob defensively. Anything invalid/legacy → null (→ simple notify). */
export function parseExecutionSpec(json: string | null | undefined): ReminderExecutionSpec | null {
  if (!json) return null;
  try {
    const parsed = ReminderExecutionSpecSchema.safeParse(JSON.parse(json));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Serialize for storage. A 'simple'/null spec stores NOTHING (null column) so existing rows and
 *  plain reminders are byte-identical to before — the AI path is strictly additive. */
export function serializeExecutionSpec(spec: ReminderExecutionSpec | null | undefined): string | null {
  if (!spec || spec.type === 'simple') return null;
  return JSON.stringify(spec);
}
