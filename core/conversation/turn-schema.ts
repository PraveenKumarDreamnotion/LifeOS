/**
 * The AssistantTurn contract (31 §3) — the single object the LLM returns, used verbatim as the
 * OpenAI Structured-Outputs json_schema AND as the Zod validator on the way back in. EP-5 runs
 * only the shape gate (Gate 1); per-intent action schemas + semantics/safety gates are EP-6.
 * `action` is `null` in EP-5 (no actions are executed yet) — EP-6 widens it.
 */
import { z } from 'zod';
import { CONVERSATION_INTENTS } from './intent';

export const AssistantTurnSchema = z
  .object({
    intent: z.enum([
      'chat',
      'question',
      'research',
      'reminder_create',
      'reminder_update',
      'reminder_delete',
      'memory_save',
      'memory_query',
      'settings',
      'unknown',
    ]),
    reply: z.string().trim().min(1).max(2000),
    action: z.unknown().nullable(),
    confidence: z.number().min(0).max(1),
    needsClarification: z.boolean(),
    // 57 (tool layer): the model decides whether this needs LIVE web info it can't answer from
    // training (a phone number, today's weather, news). If so it supplies the search query; the
    // app runs web_search and answers. false for general knowledge (explain Docker) — no tool.
    needsWebSearch: z.boolean(),
    searchQuery: z.string().nullable(),
  })
  .strict(); // an unknown key is a REJECTION (09 §5 Gate 1)

export type AssistantTurn = z.infer<typeof AssistantTurnSchema>;

/**
 * The JSON schema handed to OpenAI Structured Outputs (`strict:true`). `action` is nullable and
 * the model is instructed to always send `null` in EP-5 (no executable action yet — EP-6 expands
 * this to the per-intent action union). NB: strict mode expresses "nullable" as a `["type","null"]`
 * union, NOT a bare `{type:'null'}` — a bare null type is rejected with a 400 (the supported types
 * are string/number/boolean/integer/object/array/enum/anyOf; null only appears inside a union).
 */
export const ASSISTANT_TURN_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    intent: { type: 'string', enum: CONVERSATION_INTENTS },
    reply: { type: 'string' },
    action: { type: ['string', 'null'] },
    confidence: { type: 'number' },
    needsClarification: { type: 'boolean' },
    needsWebSearch: { type: 'boolean' },
    searchQuery: { type: ['string', 'null'] },
  },
  required: ['intent', 'reply', 'action', 'confidence', 'needsClarification', 'needsWebSearch', 'searchQuery'],
} as const;
