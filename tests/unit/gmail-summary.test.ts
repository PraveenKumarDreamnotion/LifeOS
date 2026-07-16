import { describe, it, expect } from 'vitest';
import { parseEmailContext, formatDeliveryText, formatResearchText, formatSpokenLine, senderLabel } from '../../core/gmail/summary';

const M = { fromName: 'Amazon', fromAddress: 'ship@amazon.com', subject: 'Your package shipped', snippet: 'Arrives tomorrow.' };
const NO_RESEARCH = { researchWorthwhile: false, researchQuery: '' };

describe('email summary (pure)', () => {
  it('parseEmailContext coerces + defaults, never throws', () => {
    expect(parseEmailContext({ summary: 'S', senderIntent: 'I', actionItems: ['do x'], keyDates: ['Fri'], priority: 'high' })).toEqual({
      summary: 'S', senderIntent: 'I', actionItems: ['do x'], keyDates: ['Fri'], priority: 'high', ...NO_RESEARCH,
    });
    // Garbage / missing → safe defaults.
    expect(parseEmailContext({})).toEqual({ summary: '', senderIntent: '', actionItems: [], keyDates: [], priority: 'normal', ...NO_RESEARCH });
    expect(parseEmailContext(null).priority).toBe('normal');
    expect(parseEmailContext({ priority: 'bogus', actionItems: 'nope' })).toMatchObject({ priority: 'normal', actionItems: [] });
  });

  it('research decision requires BOTH the flag and a non-empty query (fail-safe)', () => {
    expect(parseEmailContext({ researchWorthwhile: true, researchQuery: 'visa wait time Delhi' })).toMatchObject({
      researchWorthwhile: true, researchQuery: 'visa wait time Delhi',
    });
    expect(parseEmailContext({ researchWorthwhile: true, researchQuery: '' }).researchWorthwhile).toBe(false); // no query → skip
    expect(parseEmailContext({ researchWorthwhile: false, researchQuery: 'q' }).researchWorthwhile).toBe(false);
  });

  it('formatResearchText renders the answer + sources, assistant-only style', () => {
    const text = formatResearchText({ query: 'q', answer: 'The flight is delayed 2h.', citations: [{ title: 'Airline', url: 'https://a.co' }] });
    expect(text).toContain('🔎 I looked into this for you:');
    expect(text).toContain('The flight is delayed 2h.');
    expect(text).toContain('• Airline — https://a.co');
  });

  it('senderLabel prefers name, then address, then a fallback', () => {
    expect(senderLabel(M)).toBe('Amazon');
    expect(senderLabel({ ...M, fromName: null })).toBe('ship@amazon.com');
    expect(senderLabel({ ...M, fromName: null, fromAddress: null })).toBe('Unknown sender');
  });

  it('formatDeliveryText includes the summary + action items when context exists', () => {
    const text = formatDeliveryText(M, { summary: 'A parcel is on the way.', senderIntent: 'notify', actionItems: ['Track it'], keyDates: ['tomorrow'], priority: 'normal', ...NO_RESEARCH });
    expect(text).toContain('📧 New email from Amazon');
    expect(text).toContain('Your package shipped');
    expect(text).toContain('A parcel is on the way.');
    expect(text).toContain('• Track it');
    expect(text).toContain('Key dates: tomorrow');
  });

  it('formatDeliveryText degrades to the snippet when there is no AI context', () => {
    const text = formatDeliveryText(M, null);
    expect(text).toContain('Arrives tomorrow.');
    expect(text).not.toContain('What you may need to do');
  });

  it('formatSpokenLine is one utterance: sender+gist for one, count for many', () => {
    expect(formatSpokenLine(1, M, { summary: 'A parcel is on the way. Extra.', senderIntent: '', actionItems: [], keyDates: [], priority: 'normal', ...NO_RESEARCH }))
      .toBe("You've got a new email from Amazon. A parcel is on the way.");
    expect(formatSpokenLine(1, M, null)).toBe("You've got a new email from Amazon.");
    expect(formatSpokenLine(3, M, null)).toBe("You've got 3 new emails.");
    expect(formatSpokenLine(0, null, null)).toBe('');
  });
});
