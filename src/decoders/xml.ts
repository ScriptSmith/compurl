import { put } from "../tree.ts";

const TOKEN =
  /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>|<!\[CDATA\[([\s\S]*?)\]\]>|<\/([^\s>]+)\s*>|<([^\s/>!?]+)((?:\s+[^\s=/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/y;
const ATTR = /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
const ENTITY = /&(?:#x([0-9a-f]+)|#(\d+)|(lt|gt|amp|quot|apos));/gi;
const NAMED: Record<string, string> = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };

const unescape = (s: string) =>
  s.replace(ENTITY, (_, hex: string, dec: string, name: string) =>
    hex
      ? String.fromCodePoint(parseInt(hex, 16))
      : dec
        ? String.fromCodePoint(Number(dec))
        : NAMED[name.toLowerCase()]!,
  );

interface Element {
  name: string;
  fields: Record<string, unknown>;
  text: string;
}

function finish(el: Element): unknown {
  const text = el.text.trim();
  if (!Object.keys(el.fields).length) return text;
  if (text) el.fields["#text"] = text;
  return el.fields;
}

/**
 * Converts a small XML document into plain objects: attributes become `@name` keys, repeated
 * child elements become lists and text becomes `#text`. Returns undefined if it isn't well formed.
 */
export function parseXml(s: string): Record<string, unknown> | undefined {
  const stack: Element[] = [];
  let root: Record<string, unknown> | undefined;
  TOKEN.lastIndex = 0;
  while (TOKEN.lastIndex < s.length) {
    const m = TOKEN.exec(s);
    if (!m) return undefined;
    const [, cdata, close, open, attrs, selfClose, text] = m;
    const top = stack[stack.length - 1];
    if (cdata !== undefined || text !== undefined) {
      const t = cdata ?? unescape(text!);
      if (top) top.text += t;
      else if (t.trim()) return undefined;
    } else if (open !== undefined) {
      if (root) return undefined;
      const el: Element = { name: open, fields: {}, text: "" };
      for (const a of attrs!.matchAll(ATTR)) el.fields[`@${a[1]}`] = unescape(a[2] ?? a[3]!);
      if (selfClose) {
        if (top) put(top.fields, open, finish(el));
        else root = { [open]: finish(el) };
      } else stack.push(el);
    } else if (close !== undefined) {
      const el = stack.pop();
      if (!el || el.name !== close) return undefined;
      const parent = stack[stack.length - 1];
      if (parent) put(parent.fields, el.name, finish(el));
      else root = { [el.name]: finish(el) };
    }
  }
  return stack.length ? undefined : root;
}
