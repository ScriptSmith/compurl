import { base64Text } from "./decoders/compress.ts";
import { parseCurl, SHORT_FLAGS, tokenize, type Curl, type Token } from "./decoders/curl.ts";
import { parseJsurl, stringifyJsurl } from "./decoders/jsurl.ts";
import { parseRison, stringifyRison } from "./decoders/rison.ts";
import { shellQuote } from "./encode.ts";
import {
  decodePct,
  headerValue,
  parseUrl,
  type Node,
  type Options,
  type Seg,
  type Span,
} from "./parse.ts";

/** What can be done to one value in one input. Each function returns the whole new input text. */
export interface Actions {
  /** The value as it should appear in an editor, when it can be edited. */
  current?: string;
  multiline?: boolean;
  apply?: (value: string) => string;
  remove?: () => string;
}

interface Editor {
  current: string;
  multiline?: boolean;
  apply: (value: string) => string;
  remove?: () => string;
}

type Splice = [start: number, end: number, text: string];

const key = (path: Seg[]) => JSON.stringify(path);
const isPrefix = (prefix: Seg[], path: Seg[]) => prefix.every((s, i) => path[i] === s);

/** Applies non-overlapping replacements, merging touching removals so separators aren't eaten twice. */
function splice(raw: string, edits: Splice[]): string {
  const sorted = [...edits].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const merged: Splice[] = [];
  for (const e of sorted) {
    const last = merged[merged.length - 1];
    if (last && e[0] < last[1]) {
      last[1] = Math.max(last[1], e[1]);
      last[2] += e[2];
    } else merged.push([...e]);
  }
  let out = raw;
  for (const [s, e, t] of merged.reverse()) out = out.slice(0, s) + t + out.slice(e);
  return out;
}

function mapEditor(ed: Editor, wrap: (inner: string) => string): Editor {
  return {
    current: ed.current,
    multiline: ed.multiline,
    apply: (v) => wrap(ed.apply(v)),
    remove: ed.remove && (() => wrap(ed.remove!())),
  };
}

function base64Codec(t: string): { text: string; encode: (s: string) => string } | null {
  const s = t.replace(/ /g, "+");
  const text = base64Text(s, 1);
  if (text === null) return null;
  const urlSafe = /[-_]/.test(s) || (!/[+/]/.test(s) && !s.endsWith("="));
  const padded = s.endsWith("=");
  return {
    text,
    encode: (x) => {
      let bin = "";
      for (const b of new TextEncoder().encode(x)) bin += String.fromCharCode(b);
      let out = btoa(bin);
      if (urlSafe) out = out.replace(/\+/g, "-").replace(/\//g, "_");
      return padded ? out : out.replace(/=+$/, "");
    },
  };
}

function coerce(v: string, old: unknown): unknown {
  if (typeof old === "number") {
    const n = Number(v);
    return v.trim() !== "" && Number.isFinite(n) ? n : v;
  }
  if (typeof old === "boolean") return v === "true" ? true : v === "false" ? false : v;
  if (old === null) return v === "null" ? null : v;
  return v;
}

type Bag = Record<string | number, unknown>;

/** Edits one value inside JSON-like data (JSON, Rison, JSURL). */
function dataEditor(
  text: string,
  rest: Seg[],
  parse: (s: string) => unknown,
  stringify: (v: unknown) => string,
): Editor | null {
  let data: unknown;
  try {
    data = parse(text);
  } catch {
    return null;
  }
  const parentOf = (root: unknown) => {
    let cur = root;
    for (const seg of rest.slice(0, -1)) {
      if (cur === null || typeof cur !== "object") return null;
      cur = (cur as Bag)[seg];
    }
    return cur !== null && typeof cur === "object" ? (cur as Bag) : null;
  };
  const last = rest[rest.length - 1]!;
  const parent = parentOf(data);
  if (!parent || !(last in parent)) return null;
  const old = parent[last];
  const isLeaf = old === null || typeof old !== "object";
  const change = (fn: (p: Bag) => void) => {
    const copy = structuredClone(data);
    fn(parentOf(copy)!);
    return stringify(copy);
  };
  return {
    current: typeof old === "string" ? old : JSON.stringify(old, null, isLeaf ? undefined : 2),
    multiline: !isLeaf,
    apply: (v) =>
      change((p) => {
        p[last] = isLeaf ? coerce(v, old) : JSON.parse(v);
      }),
    remove: () =>
      change((p) => {
        if (Array.isArray(p)) p.splice(Number(last), 1);
        else delete p[last];
      }),
  };
}

const LISTS: Record<string, string> = { "comma list": ",", "pipe list": "|", "space list": " " };

/** Edits a value inside text that a decoder turned into `node`, by re-encoding that text. */
function valueEditor(text: string, node: Node, rest: Seg[], opts: Options): Editor | null {
  if (!rest.length) return { current: text, apply: (v) => v };
  if (node.t === "leaf" || !node.via) return null;
  const via = node.via;

  const enc = /^encoded (?:twice|(\d+) times), (.*)$/.exec(via);
  if (enc) {
    const times = enc[1] ? Number(enc[1]) : 2;
    let inner = text;
    for (let i = 1; i < times; i++) inner = decodePct(inner);
    const ed = valueEditor(inner, { ...node, via: enc[2] }, rest, opts);
    return (
      ed &&
      mapEditor(ed, (s) => {
        let out = s;
        for (let i = 1; i < times; i++) out = encodeURIComponent(out);
        return out;
      })
    );
  }
  if (via === "URL" || via === "relative URL") return urlEditor(text, opts, rest);
  if (via === "query string" || via === "form body")
    return urlEditor(text, opts, ["query", ...rest]);
  const b64 = /^base64 (JSON|URL|query string)$/.exec(via);
  if (b64) {
    const codec = base64Codec(text);
    const ed = codec && valueEditor(codec.text, { ...node, via: b64[1] }, rest, opts);
    return ed && mapEditor(ed, codec!.encode);
  }
  if (via === "JSON")
    return dataEditor(
      text,
      rest,
      (s) => JSON.parse(s),
      (v) => JSON.stringify(v),
    );
  if (via === "Rison") return dataEditor(text, rest, parseRison, stringifyRison);
  if (via === "JSURL") return dataEditor(text, rest, parseJsurl, stringifyJsurl);

  const sep = LISTS[via];
  if (sep) {
    const items = sep === " " ? text.trim().split(/\s+/) : text.split(sep);
    const i = rest[0];
    if (rest.length !== 1 || typeof i !== "number" || i >= items.length) return null;
    return {
      current: items[i]!,
      apply: (v) => items.map((x, j) => (j === i ? v : x)).join(sep),
      remove: () => items.filter((_, j) => j !== i).join(sep),
    };
  }

  if (via === "JWT") {
    const parts = text.split(".");
    const [part, ...more] = rest;
    if (parts.length !== 3) return null;
    if (part === "signature" && !more.length) {
      return { current: parts[2]!, apply: (v) => [parts[0], parts[1], v].join(".") };
    }
    const i = part === "header" ? 0 : part === "payload" ? 1 : -1;
    const codec = i >= 0 ? base64Codec(parts[i]!) : null;
    if (!codec) return null;
    const inner: Editor | null = more.length
      ? dataEditor(
          codec.text,
          more,
          (s) => JSON.parse(s),
          (v) => JSON.stringify(v),
        )
      : { current: codec.text, apply: (v) => v };
    return (
      inner &&
      mapEditor(inner, (s) => parts.map((p, j) => (j === i ? codec.encode(s) : p)).join("."))
    );
  }

  if (via.endsWith(" auth") && node.t === "obj") {
    const m = /^(\S+)(\s+)(.*)$/s.exec(text);
    if (!m) return null;
    const [, scheme, ws, cred] = m as unknown as [string, string, string, string];
    const [field, ...more] = rest;
    if (field === "scheme" && !more.length) return { current: scheme, apply: (v) => v + ws + cred };
    if (field === "credentials") {
      const credNode = node.entries.get("credentials");
      const ed = credNode ? valueEditor(cred, credNode, more, opts) : null;
      return ed && mapEditor(ed, (s) => scheme + ws + s);
    }
    const basic = base64Text(cred, 1);
    if ((field === "user" || field === "password") && !more.length && basic !== null) {
      const colon = basic.indexOf(":");
      const user = colon < 0 ? basic : basic.slice(0, colon);
      const pass = colon < 0 ? "" : basic.slice(colon + 1);
      return {
        current: field === "user" ? user : pass,
        apply: (v) => {
          const pair = field === "user" ? `${v}:${pass}` : `${user}:${v}`;
          return scheme + ws + base64Codec(cred)!.encode(pair);
        },
      };
    }
    return null;
  }

  if (via === "cookies" && node.t === "obj") {
    const parts = text.split(/(;\s*)/);
    const i = parts.findIndex((p, j) => j % 2 === 0 && p.split("=")[0]!.trim() === rest[0]);
    if (i < 0) return null;
    const eq = parts[i]!.indexOf("=");
    const name = eq < 0 ? parts[i]! : parts[i]!.slice(0, eq);
    const raw = eq < 0 ? "" : parts[i]!.slice(eq + 1);
    const join = (value: string) =>
      parts.map((p, j) => (j === i ? `${name}=${value}` : p)).join("");
    const reencode = (s: string) => (raw.includes("%") ? encodeURIComponent(s) : s);
    const remove = () => parts.filter((_, j) => j !== i && j !== (i > 0 ? i - 1 : i + 1)).join("");
    if (rest.length === 1)
      return { current: decodePct(raw), apply: (v) => join(reencode(v)), remove };
    const child = node.entries.get(String(rest[0]));
    const ed = child ? valueEditor(decodePct(raw), child, rest.slice(1), opts) : null;
    return ed && mapEditor(ed, (s) => join(reencode(s)));
  }
  return null;
}

function single(raw: string, s: Span): Editor {
  const e = s.edit!;
  return {
    current: e.text,
    apply: (v) => splice(raw, [[...e.range, e.encode(v)]]),
    remove: e.remove && (() => splice(raw, [[...e.remove!, ""]])),
  };
}

/** Several pairs with the same key, edited one per line. */
function repeated(raw: string, list: Span[]): Editor {
  const removable = list.filter((s) => s.edit!.remove);
  return {
    current: list.map((s) => s.edit!.text).join("\n"),
    multiline: true,
    apply: (v) => {
      const lines = v.split("\n");
      const edits: Splice[] = [];
      list.forEach((s, i) => {
        const e = s.edit!;
        if (i < lines.length) edits.push([...e.range, e.encode(lines[i]!)]);
        else if (e.remove) edits.push([...e.remove, ""]);
      });
      const last = list[list.length - 1]!.edit!;
      const extra = lines
        .slice(list.length)
        .map((l) => `&${last.prefix ?? ""}${last.encode(l)}`)
        .join("");
      if (extra) edits.push([last.range[1], last.range[1], extra]);
      return splice(raw, edits);
    },
    remove: removable.length
      ? () =>
          splice(
            raw,
            removable.map((s) => [...s.edit!.remove!, ""]),
          )
      : undefined,
  };
}

function targetsOf(spans: Span[]): Map<string, Span[]> {
  const map = new Map<string, Span[]>();
  for (const s of spans) {
    if (!s.edit) continue;
    const k = key(s.path);
    const list = map.get(k);
    if (list) list.push(s);
    else map.set(k, [s]);
  }
  return map;
}

function urlEditor(raw: string, opts: Options, path: Seg[]): Editor | null {
  const targets = targetsOf(parseUrl(raw, opts).spans);
  const exact = targets.get(key(path));
  if (exact) return exact.length === 1 ? single(raw, exact[0]!) : repeated(raw, exact);
  for (let i = path.length - 1; i >= 1; i--) {
    const list = targets.get(key(path.slice(0, i)));
    if (!list) continue;
    let span = list[0]!;
    let rest = path.slice(i);
    if (list.length > 1) {
      const idx = path[i];
      if (typeof idx !== "number" || !list[idx]) return null;
      span = list[idx]!;
      rest = path.slice(i + 1);
      if (!rest.length) return single(raw, span);
    }
    const e = span.edit!;
    const inner = e.node && valueEditor(e.text, e.node, rest, opts);
    return inner ? mapEditor(inner, (s) => splice(raw, [[...e.range, e.encode(s)]])) : null;
  }
  return null;
}

/** Removes every entry under `path`, for rows such as `o` that group `o.a=1&o.b=2`. */
function urlRemoveUnder(raw: string, opts: Options, path: Seg[]): (() => string) | undefined {
  const ranges = parseUrl(raw, opts)
    .spans.filter((s) => s.edit?.remove && s.path.length > path.length && isPrefix(path, s.path))
    .map((s) => s.edit!.remove!);
  if (!ranges.length) return undefined;
  return () =>
    splice(
      raw,
      ranges.map((r) => [...r, ""]),
    );
}

const URL_PARTS = new Set([
  "scheme",
  "user",
  "password",
  "host",
  "port",
  "path",
  "matrix",
  "maps",
  "query",
  "fragment",
]);

interface CurlCtx {
  raw: string;
  lead: number;
  c: Curl;
}

function curlCtx(raw: string): CurlCtx | null {
  const lead = raw.length - raw.trimStart().length;
  const c = parseCurl(tokenize(raw.trim()));
  return c && { raw, lead, c };
}

const tokenRange = (x: CurlCtx, t: Token): [number, number] => [x.lead + t.start, x.lead + t.end];
const replaceToken = (x: CurlCtx, t: Token, value: string) =>
  splice(x.raw, [[...tokenRange(x, t), shellQuote(value)]]);

/** Removes an option and its value, along with the whitespace before them. */
function removeArg(x: CurlCtx, value: Token, name?: string): string {
  const flag = x.c.flags.get(value) ?? value;
  const cluster = /^-[^-]{2,}$/.test(flag.value) && flag === value;
  if (cluster && name) {
    const letter = Object.keys(SHORT_FLAGS).find((k) => SHORT_FLAGS[k] === name);
    if (letter) return replaceToken(x, flag, flag.value.replace(letter, ""));
  }
  const i = x.c.tokens.indexOf(flag);
  const from = i > 0 ? x.c.tokens[i - 1]!.end : flag.start;
  return splice(x.raw, [[x.lead + from, x.lead + Math.max(value.end, flag.end), ""]]);
}

function curlEditor(raw: string, opts: Options, path: Seg[]): Actions {
  const x = curlCtx(raw);
  if (!x) return {};
  const { c } = x;
  const [head, ...rest] = path;

  if (head === "method" && !rest.length) {
    if (c.method) {
      const m = c.method;
      return {
        current: m.value,
        apply: (v) => replaceToken(x, m, v),
        remove: () => removeArg(x, m),
      };
    }
    const method = parseUrl(raw, opts).tree.entries.get("method");
    const at = x.lead + c.tokens[0]!.end;
    return {
      current: method?.t === "leaf" ? String(method.v) : "GET",
      apply: (v) => splice(raw, [[at, at, ` -X ${shellQuote(v)}`]]),
    };
  }

  if (typeof head === "string" && URL_PARTS.has(head)) {
    if (!c.url) return {};
    const url = c.url;
    const ed = urlEditor(url.value, opts, path);
    const remove = ed?.remove ?? urlRemoveUnder(url.value, opts, path);
    return {
      ...(ed && mapEditor(ed, (s) => replaceToken(x, url, s))),
      remove: remove && (() => replaceToken(x, url, remove())),
    };
  }

  if (head === "headers" && typeof rest[0] === "string") {
    const name = rest[0];
    const h = c.headers.find((t) => t.value.split(/[:;]/)[0]!.trim().toLowerCase() === name);
    if (h) {
      const m = /^([^:;]+)([:;]\s*)(.*)$/s.exec(h.value);
      if (!m) return {};
      const [, label, sep, value] = m as unknown as [string, string, string, string];
      const ed = valueEditor(value, headerValue(name, value, opts), rest.slice(1), opts);
      return {
        ...(ed && mapEditor(ed, (s) => replaceToken(x, h, label + sep + s))),
        remove:
          rest.length === 1
            ? () => removeArg(x, h)
            : ed?.remove && (() => replaceToken(x, h, label + sep + ed.remove!())),
      };
    }
    const o = c.options.find((t) => t.name === name && t.value);
    if (o && rest.length === 1) {
      const v = o.value!;
      return {
        current: v.value,
        apply: (s) => replaceToken(x, v, s),
        remove: () => removeArg(x, v),
      };
    }
    return {};
  }

  if (head === "body" && c.data.length === 1) {
    const d = c.data[0]!.token;
    const body = parseUrl(raw, opts).tree.entries.get("body");
    const ed = body ? valueEditor(d.value, body, rest, opts) : null;
    return {
      ...(ed && mapEditor(ed, (s) => replaceToken(x, d, s))),
      remove: rest.length
        ? ed?.remove && (() => replaceToken(x, d, ed.remove!()))
        : () => removeArg(x, d),
    };
  }

  if (head === "form" && typeof rest[0] === "string" && rest.length === 1) {
    const f = c.form.find((t) => t.value.split("=")[0] === rest[0]);
    if (!f) return {};
    const name = rest[0];
    return {
      current: f.value.slice(name.length + 1),
      apply: (v) => replaceToken(x, f, `${name}=${v}`),
      remove: () => removeArg(x, f),
    };
  }

  if (head === "auth" && c.user && rest.length === 1) {
    const u = c.user;
    const colon = u.value.indexOf(":");
    const user = colon < 0 ? u.value : u.value.slice(0, colon);
    const pass = colon < 0 ? "" : u.value.slice(colon + 1);
    if (rest[0] === "user")
      return { current: user, apply: (v) => replaceToken(x, u, `${v}:${pass}`) };
    if (rest[0] === "password")
      return { current: pass, apply: (v) => replaceToken(x, u, `${user}:${v}`) };
  }

  if (head === "options" && typeof rest[0] === "string" && rest.length === 1) {
    const o = c.options.find((t) => t.name === rest[0]);
    if (!o) return {};
    const v = o.value;
    return {
      ...(v && { current: v.value, apply: (s: string) => replaceToken(x, v, s) }),
      remove: () => removeArg(x, v ?? o.token, v ? undefined : o.name),
    };
  }
  return {};
}

/** Works out how the value at `path` in one input can be edited or removed. */
export function actionsFor(raw: string, opts: Options, path: Seg[]): Actions {
  if (/^\s*curl(?:\.exe)?\s/i.test(raw)) return curlEditor(raw, opts, path);
  const ed = urlEditor(raw, opts, path);
  return { ...ed, remove: ed?.remove ?? urlRemoveUnder(raw, opts, path) };
}

export type AddKind = "query" | "header";

/** Returns a function that adds a query parameter or header to an input, or null if it can't. */
export function adderFor(
  raw: string,
  opts: Options,
  kind: AddKind,
): ((k: string, v: string) => string) | null {
  const x = /^\s*curl(?:\.exe)?\s/i.test(raw) ? curlCtx(raw) : null;
  if (x) {
    if (kind === "query") {
      const url = x.c.url;
      const inner = url && adderFor(url.value, opts, "query");
      return inner ? (k, v) => replaceToken(x, url, inner(k, v)) : null;
    }
    const anchor =
      x.c.headers[x.c.headers.length - 1] ?? x.c.url ?? x.c.tokens[x.c.tokens.length - 1]!;
    const at = x.lead + anchor.end;
    const gap = raw.includes("\\\n") ? " \\\n  " : " ";
    return (k, v) => splice(raw, [[at, at, `${gap}-H ${shellQuote(`${k}: ${v}`)}`]]);
  }
  if (kind !== "query") return null;
  const span = parseUrl(raw, opts).spans.find(
    (s) => s.insert && s.path.length === 1 && s.path[0] === "query",
  );
  if (!span?.insert) return null;
  const { at, build } = span.insert;
  return (k, v) => splice(raw, [[at, at, build(k, v)]]);
}

/** The query key or header name that produced `path` in this input, for adding it elsewhere. */
export function keyFor(
  raw: string,
  opts: Options,
  path: Seg[],
): { kind: AddKind; key: string } | null {
  if (path.length === 2 && path[0] === "headers" && typeof path[1] === "string") {
    return { kind: "header", key: path[1] };
  }
  if (path[0] !== "query") return null;
  const x = /^\s*curl(?:\.exe)?\s/i.test(raw) ? curlCtx(raw) : null;
  const text = x ? x.c.url?.value : raw;
  if (!text) return null;
  const span = parseUrl(text, opts).spans.find((s) => s.edit?.prefix && key(s.path) === key(path));
  if (!span) return null;
  const prefix = span.edit!.prefix!;
  return { kind: "query", key: decodePct(prefix.replace(/=$/, "").replace(/\+/g, " ")) };
}
