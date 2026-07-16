import { describe, it, expect } from 'vitest';
import { AssistantTurnSchema, ASSISTANT_TURN_JSON_SCHEMA } from '../../core/conversation/turn-schema';
import { CONVERSATION_INTENTS } from '../../core/conversation/intent';

// Gate 1 (09 §5): the AssistantTurn SHAPE gate. It only validates structure — per-intent action
// schemas + semantics/safety are EP-6. An unknown key is a rejection (.strict()).
const VALID = {
  intent: 'question',
  reply: 'The capital of France is Paris.',
  action: null,
  confidence: 0.9,
  needsClarification: false,
  needsWebSearch: false,
  searchQuery: null,
};

describe('AssistantTurnSchema (Gate 1)', () => {
  it('accepts a well-formed reply-only turn', () => {
    const r = AssistantTurnSchema.safeParse(VALID);
    expect(r.success).toBe(true);
  });

  it('accepts every intent in the closed taxonomy', () => {
    for (const intent of CONVERSATION_INTENTS) {
      expect(AssistantTurnSchema.safeParse({ ...VALID, intent }).success).toBe(true);
    }
  });

  it('rejects an unknown intent', () => {
    expect(AssistantTurnSchema.safeParse({ ...VALID, intent: 'launch_missiles' }).success).toBe(false);
  });

  it('rejects an unknown extra key (strict)', () => {
    expect(AssistantTurnSchema.safeParse({ ...VALID, action_args: { foo: 1 } }).success).toBe(false);
  });

  it('rejects an empty reply', () => {
    expect(AssistantTurnSchema.safeParse({ ...VALID, reply: '   ' }).success).toBe(false);
  });

  it('rejects confidence outside 0..1', () => {
    expect(AssistantTurnSchema.safeParse({ ...VALID, confidence: 1.5 }).success).toBe(false);
    expect(AssistantTurnSchema.safeParse({ ...VALID, confidence: -0.1 }).success).toBe(false);
  });

  it('keeps action nullable in the OpenAI schema (strict-mode nullable union, not bare null)', () => {
    // Strict Structured Outputs rejects a bare {type:'null'} with a 400 — "nullable" must be a
    // ["type","null"] union. EP-5 sends null (the model is told to); EP-6 widens this to actions.
    expect(ASSISTANT_TURN_JSON_SCHEMA.properties.action).toEqual({ type: ['string', 'null'] });
  });

  it('the OpenAI json_schema is strict and lists all fields required', () => {
    expect(ASSISTANT_TURN_JSON_SCHEMA.additionalProperties).toBe(false);
    expect([...ASSISTANT_TURN_JSON_SCHEMA.required].sort()).toEqual(
      ['action', 'confidence', 'intent', 'needsClarification', 'needsWebSearch', 'reply', 'searchQuery'],
    );
  });
});
