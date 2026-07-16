import { Fragment, useMemo, type ReactNode } from 'react';

/**
 * A tiny, dependency-free Markdown renderer for AI replies (Issue: literal `**` shown in the UI).
 *
 * Design constraints that shape it:
 *  • It runs inside the sandboxed, CSP-locked renderer on UNTRUSTED model output, so it builds React
 *    elements only — NEVER `dangerouslySetInnerHTML`. React escapes every text node, so this cannot
 *    inject markup no matter what the model returns.
 *  • It must be TOLERANT of partial/malformed Markdown: an unclosed `**`, a half-typed `[link`, a
 *    stray `` ` `` — each degrades to literal text and never throws or swallows the rest of a reply.
 *  • Scope is the formatting the assistant actually produces: `#`–`######` headings, `-`/`*`/`+` and
 *    `1.` lists (list items may be separated by blank lines, as the model emits them), `**bold**`,
 *    `*italic*`, `` `code` ``, and `[text](url)` links. Links render their TEXT only (the URL is
 *    dropped) — an `<a href>` would navigate the whole Electron window and a `javascript:` href would
 *    be an injection vector, so text-only is the safe choice (see docs/AI_INTEGRATIONS.md).
 *
 * `_`/`__` are intentionally NOT treated as emphasis: technical replies are full of `snake_case`
 * and file_names, and matching `_` there would corrupt them. The model uses `*`/`**` for emphasis.
 */

type Block =
  | { type: 'heading'; level: number; text: string }
  | { type: 'ul'; items: string[] }
  | { type: 'ol'; start: number; items: string[] }
  | { type: 'p'; lines: string[] };

const HEADING_RE = /^(#{1,6})\s+(.*)$/;
const UL_RE = /^[-*+]\s+(.*)$/;
const OL_RE = /^(\d+)[.)]\s+(.*)$/;

/**
 * Split a reply into block-level chunks with a small line state machine. The one subtlety: a blank
 * line does NOT end an open list — the model routinely puts a blank line between numbered items — so
 * a list stays open across blanks and closes only when a heading, a plain line, or the end arrives.
 * That keeps `1.`, `2.`, `3.` in a single `<ol>` (correct numbering) instead of three that restart.
 */
function parseBlocks(src: string): Block[] {
  const lines = src.replace(/\r\n/g, '\n').split('\n');
  const blocks: Block[] = [];
  let para: string[] = [];
  let list: { type: 'ul' | 'ol'; start: number; items: string[] } | null = null;

  const flushPara = () => {
    if (para.length) {
      blocks.push({ type: 'p', lines: para });
      para = [];
    }
  };
  const flushList = () => {
    if (list) {
      blocks.push(list.type === 'ol' ? { type: 'ol', start: list.start, items: list.items } : { type: 'ul', items: list.items });
      list = null;
    }
  };

  for (const raw of lines) {
    const trimmed = raw.trim();
    if (trimmed === '') {
      flushPara(); // a blank line ends a paragraph, but leaves an open list open (items can be spaced)
      continue;
    }
    const heading = HEADING_RE.exec(trimmed);
    if (heading) {
      flushPara();
      flushList();
      blocks.push({ type: 'heading', level: heading[1]!.length, text: heading[2]! });
      continue;
    }
    const ul = UL_RE.exec(trimmed);
    if (ul) {
      flushPara();
      if (list && list.type !== 'ul') flushList();
      if (!list) list = { type: 'ul', start: 1, items: [] };
      list.items.push(ul[1]!);
      continue;
    }
    const ol = OL_RE.exec(trimmed);
    if (ol) {
      flushPara();
      if (list && list.type !== 'ol') flushList();
      if (!list) list = { type: 'ol', start: parseInt(ol[1]!, 10) || 1, items: [] };
      list.items.push(ol[2]!);
      continue;
    }
    // A plain text line closes any open list, then joins the current paragraph.
    flushList();
    para.push(trimmed);
  }
  flushPara();
  flushList();
  return blocks;
}

type InlineKind = 'code' | 'bold' | 'italic' | 'link';
const INLINE_RULES: Array<{ kind: InlineKind; re: RegExp }> = [
  { kind: 'code', re: /`([^`]+)`/ }, // code first: its contents are literal (no nested formatting)
  { kind: 'bold', re: /\*\*([\s\S]+?)\*\*/ },
  { kind: 'link', re: /\[([^\]]+)\]\(([^)]*)\)/ },
  { kind: 'italic', re: /\*([^*\n]+?)\*/ },
];

/**
 * Render inline spans by repeatedly taking the EARLIEST match among the rules. Everything before a
 * match is literal text; bold/italic recurse so `**a *b* c**` nests correctly; code does not recurse.
 * An unterminated marker simply never matches, so it survives as literal text — the tolerance the
 * streaming/partial case relies on.
 */
function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = [];
  let rest = text;
  let k = 0;
  while (rest.length > 0) {
    let best: { index: number; length: number; kind: InlineKind; groups: RegExpExecArray } | null = null;
    for (const rule of INLINE_RULES) {
      const m = rule.re.exec(rest);
      if (m && (best === null || m.index < best.index)) {
        best = { index: m.index, length: m[0].length, kind: rule.kind, groups: m };
      }
    }
    if (!best) {
      out.push(rest);
      break;
    }
    if (best.index > 0) out.push(rest.slice(0, best.index));
    const key = `${keyPrefix}-${k++}`;
    if (best.kind === 'code') {
      out.push(
        <code key={key} className="md-code">
          {best.groups[1]}
        </code>,
      );
    } else if (best.kind === 'bold') {
      out.push(<strong key={key}>{renderInline(best.groups[1]!, key)}</strong>);
    } else if (best.kind === 'italic') {
      out.push(<em key={key}>{renderInline(best.groups[1]!, key)}</em>);
    } else {
      // link — render the anchor TEXT only (URL dropped by design); recurse for inline formatting in it
      out.push(
        <span key={key} className="md-link">
          {renderInline(best.groups[1]!, key)}
        </span>,
      );
    }
    rest = rest.slice(best.index + best.length);
  }
  return out;
}

function BlockView({ block }: { block: Block }): ReactNode {
  if (block.type === 'heading') {
    const level = Math.min(block.level, 3); // cap at h3 so a lone `#` doesn't dominate a chat bubble
    const Tag = level === 1 ? 'h1' : level === 2 ? 'h2' : 'h3';
    return <Tag className={`md-h md-h${level}`}>{renderInline(block.text, 'h')}</Tag>;
  }
  if (block.type === 'ul') {
    return (
      <ul className="md-ul">
        {block.items.map((it, i) => (
          <li key={i}>{renderInline(it, `uli${i}`)}</li>
        ))}
      </ul>
    );
  }
  if (block.type === 'ol') {
    return (
      <ol className="md-ol" start={block.start}>
        {block.items.map((it, i) => (
          <li key={i}>{renderInline(it, `oli${i}`)}</li>
        ))}
      </ol>
    );
  }
  return (
    <p className="md-p">
      {block.lines.map((line, i) => (
        <Fragment key={i}>
          {i > 0 && <br />}
          {renderInline(line, `p${i}`)}
        </Fragment>
      ))}
    </p>
  );
}

/**
 * Render `text` as Markdown. Used for the assistant's NORMAL replies in the main chat and the voice
 * launcher; plain-text surfaces (user bubbles, delivered emails/reminders) keep their pre-wrap
 * rendering so nothing that isn't a model reply is reinterpreted.
 */
export function Markdown({ text, className }: { text: string; className?: string }): ReactNode {
  const blocks = useMemo(() => parseBlocks(text), [text]);
  return (
    <div className={className ? `md ${className}` : 'md'}>
      {blocks.map((b, i) => (
        <BlockView key={i} block={b} />
      ))}
    </div>
  );
}
