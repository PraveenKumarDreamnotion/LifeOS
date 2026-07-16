import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import { Markdown } from '../../src/components/Markdown';

afterEach(() => cleanup());

/** The rendered `.md` container for a given source string. */
function md(text: string): HTMLElement {
  const { container } = render(<Markdown text={text} />);
  return container.querySelector('.md') as HTMLElement;
}

describe('Markdown — inline formatting', () => {
  it('renders **bold** as <strong> and shows NO literal asterisks', () => {
    const root = md('**Features**');
    const strong = root.querySelector('strong');
    expect(strong?.textContent).toBe('Features');
    expect(root.textContent).toBe('Features');
    expect(root.textContent).not.toContain('*');
  });

  it('renders *italic* as <em>', () => {
    const root = md('an *important* note');
    expect(root.querySelector('em')?.textContent).toBe('important');
    expect(root.textContent).toBe('an important note');
  });

  it('renders `code` as <code> with contents verbatim', () => {
    const root = md('run `npm test` now');
    const code = root.querySelector('code');
    expect(code?.textContent).toBe('npm test');
    expect(code?.className).toContain('md-code');
  });

  it('renders a [text](url) link as its text only, dropping the URL', () => {
    const root = md('see [collegedunia.com](https://collegedunia.com/x?utm_source=openai)');
    expect(root.textContent).toBe('see collegedunia.com');
    expect(root.textContent).not.toContain('http');
    expect(root.querySelector('.md-link')?.textContent).toBe('collegedunia.com');
  });

  it('leaves snake_case identifiers untouched (no `_` emphasis)', () => {
    const root = md('the utm_source and stt_provider keys');
    expect(root.textContent).toBe('the utm_source and stt_provider keys');
    expect(root.querySelector('em')).toBeNull();
  });
});

describe('Markdown — tolerance of partial / malformed input (streaming)', () => {
  it('an UNCLOSED bold marker renders literally, never throws', () => {
    const root = md('**Fea');
    expect(root.textContent).toBe('**Fea');
    expect(root.querySelector('strong')).toBeNull();
  });

  it('a half-typed link renders literally', () => {
    const root = md('see [collegedunia');
    expect(root.textContent).toBe('see [collegedunia');
  });

  it('a lone backtick survives as text', () => {
    const root = md('a ` b');
    expect(root.textContent).toBe('a ` b');
    expect(root.querySelector('code')).toBeNull();
  });

  it('empty text renders an empty container without crashing', () => {
    const root = md('');
    expect(root.textContent).toBe('');
  });
});

describe('Markdown — block structure', () => {
  it('renders # / ## / ### as heading elements', () => {
    const root = md('# Big\n\n## Medium\n\n### Small');
    expect(root.querySelector('h1')?.textContent).toBe('Big');
    expect(root.querySelector('h2')?.textContent).toBe('Medium');
    expect(root.querySelector('h3')?.textContent).toBe('Small');
  });

  it('caps deep headings (####) at <h3>', () => {
    const root = md('#### Deep');
    expect(root.querySelector('h3')?.textContent).toBe('Deep');
  });

  it('groups `-` lines into a single <ul>', () => {
    const root = md('- one\n- two\n- three');
    const uls = root.querySelectorAll('ul');
    expect(uls.length).toBe(1);
    expect(within(uls[0] as HTMLElement).getAllByRole('listitem')).toHaveLength(3);
  });

  it('keeps a numbered list — items separated by BLANK LINES — in ONE <ol> with correct start', () => {
    // This is exactly how the model emits it (screenshot): 1., blank, 2., blank, 3.
    const root = md('1. **IIT Mandi**: Ranked 26th.\n\n2. **NIT Hamirpur**: Ranked 97th.\n\n3. **IIIT Una**: A central IIIT.');
    const ols = root.querySelectorAll('ol');
    expect(ols.length).toBe(1); // a single list, not three that restart at 1
    const items = within(ols[0] as HTMLElement).getAllByRole('listitem');
    expect(items).toHaveLength(3);
    // Inline formatting runs INSIDE list items (the bold lead-in), no literal asterisks.
    expect(items[0]!.querySelector('strong')?.textContent).toBe('IIT Mandi');
    expect(items[0]!.textContent).toBe('IIT Mandi: Ranked 26th.');
  });

  it('respects a list that starts at a number other than 1', () => {
    const root = md('3. third\n4. fourth');
    expect(root.querySelector('ol')?.getAttribute('start')).toBe('3');
  });

  it('separates paragraphs on blank lines and preserves a soft line break within one', () => {
    const root = md('line one\nline two\n\nsecond para');
    const ps = root.querySelectorAll('p');
    expect(ps.length).toBe(2);
    expect(ps[0]?.querySelectorAll('br').length).toBe(1); // soft break kept
    expect(ps[1]?.textContent).toBe('second para');
  });

  it('renders a realistic mixed reply (heading + intro + numbered list) with no stray markdown', () => {
    const root = md(
      'As of July 2026, the top colleges include:\n\n1. **IIT Mandi**: Ranked 26th.\n\n2. **NIT Hamirpur**: Ranked 97th.',
    );
    expect(root.textContent).not.toContain('**');
    expect(screen.getByText('IIT Mandi')).toBeTruthy();
    expect(root.querySelectorAll('ol li')).toHaveLength(2);
  });
});
