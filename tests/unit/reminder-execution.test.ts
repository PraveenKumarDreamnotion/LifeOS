import { describe, it, expect } from 'vitest';
import {
  ReminderExecutionSpecSchema,
  isAiTask,
  requiresFireTimeConfirmation,
  parseExecutionSpec,
  serializeExecutionSpec,
  type ReminderExecutionSpec,
} from '../../core/types/reminder-execution';

const aiSpec = (over: Partial<ReminderExecutionSpec> = {}): ReminderExecutionSpec =>
  ReminderExecutionSpecSchema.parse({
    version: 1,
    type: 'ai_task',
    instruction: 'Find the contact details of NIT Hamirpur.',
    capabilities: ['web_search'],
    outputFormat: 'spoken_answer',
    delivery: { notify: true, voice: true },
    ...over,
  });

describe('ReminderExecutionSpec', () => {
  it('isAiTask distinguishes ai_task from simple/null', () => {
    expect(isAiTask(aiSpec())).toBe(true);
    expect(isAiTask(null)).toBe(false);
    expect(isAiTask(ReminderExecutionSpecSchema.parse({ version: 1, type: 'simple' }))).toBe(false);
  });

  it('read-only capabilities auto-execute; a write capability forces confirmation', () => {
    expect(requiresFireTimeConfirmation(aiSpec({ capabilities: ['web_search'] }))).toBe(false);
    expect(requiresFireTimeConfirmation(aiSpec({ capabilities: [] }))).toBe(false);
    expect(requiresFireTimeConfirmation(aiSpec({ capabilities: ['weather', 'news'] }))).toBe(false);
    expect(requiresFireTimeConfirmation(aiSpec({ capabilities: ['web_search', 'email_send'] }))).toBe(true);
    expect(requiresFireTimeConfirmation(aiSpec({ capabilities: ['calendar_write'] }))).toBe(true);
  });

  it('serialize stores nothing for simple/null (byte-identical to a plain reminder)', () => {
    expect(serializeExecutionSpec(null)).toBeNull();
    expect(serializeExecutionSpec(ReminderExecutionSpecSchema.parse({ version: 1, type: 'simple' }))).toBeNull();
  });

  it('round-trips an ai_task spec through serialize → parse', () => {
    const spec = aiSpec();
    const json = serializeExecutionSpec(spec);
    expect(json).toBeTypeOf('string');
    const back = parseExecutionSpec(json);
    expect(back).toEqual(spec);
  });

  it('parse fails safe to null on corrupt / legacy / unknown-version JSON', () => {
    expect(parseExecutionSpec(null)).toBeNull();
    expect(parseExecutionSpec('')).toBeNull();
    expect(parseExecutionSpec('not json')).toBeNull();
    expect(parseExecutionSpec('{"version":2,"type":"ai_task"}')).toBeNull(); // future version
    expect(parseExecutionSpec('{"type":"ai_task"}')).toBeNull(); // missing version
    expect(parseExecutionSpec('{"version":1,"type":"bogus"}')).toBeNull(); // bad enum
  });
});
