// Parsed to data and rendered as Svelte elements, so no message can inject markup.
// No [text](url): with guests in the room, a link must show where it goes.

export type Inline =
  | { type: 'text'; text: string }
  | { type: 'break' }
  | { type: 'code'; text: string }
  | { type: 'link'; href: string }
  | { type: 'strong' | 'em' | 'strike'; children: Inline[] };

export type Block = { type: 'paragraph'; children: Inline[] } | { type: 'codeblock'; text: string };

const fence = '```';

export function parseMessage(source: string): Block[] {
  const blocks: Block[] = [];
  let rest = source;
  for (;;) {
    const open = rest.indexOf(fence);
    const close = open < 0 ? -1 : rest.indexOf(fence, open + fence.length);
    if (close < 0) break;
    pushParagraph(blocks, rest.slice(0, open));
    blocks.push({ type: 'codeblock', text: fencedBody(rest.slice(open + fence.length, close)) });
    rest = rest.slice(close + fence.length);
  }
  pushParagraph(blocks, rest);
  return blocks;
}

function pushParagraph(blocks: Block[], text: string): void {
  const trimmed = text.replace(/^[ \t]*\n/, '').replace(/\n[ \t]*$/, '');
  if (trimmed.trim()) blocks.push({ type: 'paragraph', children: parseInline(trimmed) });
}

/** Drops the info string (```sh) and the newlines that frame a multi-line block. */
function fencedBody(body: string): string {
  const firstBreak = body.indexOf('\n');
  if (firstBreak >= 0 && /^[\w+-]*[ \t]*$/.test(body.slice(0, firstBreak))) {
    body = body.slice(firstBreak + 1);
  }
  return body.replace(/\n$/, '');
}

const isWordChar = (char: string | undefined) => !!char && /[\p{L}\p{N}_]/u.test(char);
const isSpace = (char: string | undefined) => !char || /\s/.test(char);

function parseInline(source: string): Inline[] {
  const nodes: Inline[] = [];
  let text = '';
  const flush = () => {
    if (text) nodes.push({ type: 'text', text });
    text = '';
  };

  let i = 0;
  while (i < source.length) {
    const char = source[i];

    if (char === '\n') {
      flush();
      nodes.push({ type: 'break' });
      i += 1;
      continue;
    }

    if (char === '`') {
      const close = source.indexOf('`', i + 1);
      if (close > i + 1) {
        flush();
        nodes.push({ type: 'code', text: source.slice(i + 1, close) });
        i = close + 1;
        continue;
      }
    }

    const emphasis = matchEmphasis(source, i);
    if (emphasis) {
      flush();
      nodes.push({ type: emphasis.type, children: parseInline(emphasis.inner) });
      i = emphasis.end;
      continue;
    }

    const link = matchLink(source, i);
    if (link) {
      flush();
      nodes.push({ type: 'link', href: link });
      i += link.length;
      continue;
    }

    text += char;
    i += 1;
  }
  flush();
  return nodes;
}

const delimiters = [
  { marker: '**', type: 'strong' },
  { marker: '~~', type: 'strike' },
  { marker: '*', type: 'em' },
  { marker: '_', type: 'em' }
] as const;

function matchEmphasis(
  source: string,
  start: number
): { type: 'strong' | 'em' | 'strike'; inner: string; end: number } | undefined {
  for (const { marker, type } of delimiters) {
    if (!source.startsWith(marker, start)) continue;
    const single = marker.length === 1;
    // `**` is never an empty `*` pair, and snake_case stays literal.
    if (single && (source[start + 1] === marker || source[start - 1] === marker)) return undefined;
    if (marker === '_' && isWordChar(source[start - 1])) return undefined;
    const from = start + marker.length;
    if (isSpace(source[from])) return undefined;

    const close = findClose(source, marker, from);
    if (close < 0) return undefined;
    return { type, inner: source.slice(from, close), end: close + marker.length };
  }
  return undefined;
}

/** The marker's closing position, skipping code spans so `*` inside them stays literal. */
function findClose(source: string, marker: string, from: number): number {
  const single = marker.length === 1;
  for (let i = from; i < source.length; i++) {
    const char = source[i];
    if (char === '\n' && source[i + 1] === '\n') return -1;
    if (char === '`') {
      const close = source.indexOf('`', i + 1);
      if (close > i + 1) {
        i = close;
        continue;
      }
    }
    if (!source.startsWith(marker, i) || i === from) continue;
    if (isSpace(source[i - 1])) continue;
    if (single && (source[i + 1] === marker || source[i - 1] === marker)) continue;
    if (marker === '_' && isWordChar(source[i + 1])) continue;
    return i;
  }
  return -1;
}

const urlPattern = /^https?:\/\/[^\s<>"'`]+/i;

/** A bare http(s) URL at `start`, without the punctuation that ends a sentence. */
function matchLink(source: string, start: number): string | undefined {
  if (source[start] !== 'h' && source[start] !== 'H') return undefined;
  if (isWordChar(source[start - 1])) return undefined;
  // The URL half of a masked link stays literal along with its text.
  if (source.slice(start - 2, start) === '](') return undefined;
  let url = urlPattern.exec(source.slice(start))?.[0];
  if (!url) return undefined;

  for (;;) {
    const last = url.at(-1);
    if (last && '.,!?;:*_~'.includes(last)) url = url.slice(0, -1);
    else if (last === ')' && count(url, '(') < count(url, ')')) url = url.slice(0, -1);
    else break;
  }

  try {
    const parsed = new URL(url);
    if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || !parsed.hostname) {
      return undefined;
    }
  } catch {
    return undefined;
  }
  return url;
}

function count(text: string, char: string): number {
  return text.split(char).length - 1;
}
