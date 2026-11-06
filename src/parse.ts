import { parseRison } from "./rison.ts";

export type Scalar = string | number | boolean | null;
export type Seg = string | number;

export interface Leaf {
  t: "leaf";
  v: Scalar;
  note?: string;
}
export interface Obj {
  t: "obj";
  via?: string;
  entries: Map<string, Node>;
}
export interface Arr {
  t: "arr";
  via?: string;
  items: Node[];
}
export type Node = Leaf | Obj | Arr;

/** A range of the raw input that produced the value at `path`. */
export interface Span {
  start: number;
  end: number;
  valueStart?: number;
  path: Seg[];
  /** The decoded value when this span holds one plain value, such as one of several repeated keys. */
  item?: Scalar;
}

export interface Parsed {
  tree: Obj;
  spans: Span[];
}

export type DecoderId =
  | "dotted"
  | "brackets"
  | "lists"
  | "urls"
  | "queries"
  | "json"
  | "base64"
  | "jwt"
  | "rison"
  | "matrix";

export type Options = Record<DecoderId, boolean>;

export const DECODERS: readonly { id: DecoderId; label: string; example: string }[] = [
  { id: "dotted", label: "Dotted keys", example: "ui.theme=dark becomes ui › theme" },
  {
    id: "brackets",
    label: "Bracket keys",
    example: "filter[size][]=9 becomes filter › size, a list",
  },
  { id: "lists", label: "Comma lists", example: "sort=price,-rating becomes a two-item list" },
  {
    id: "urls",
    label: "Nested URLs",
    example: "return=https%3A%2F%2Fa.example%2F%3Fx%3D1 is split into its own parts",
  },
  {
    id: "queries",
    label: "Nested query strings",
    example: "state=a%3D1%26b%3D2 becomes a and b",
  },
  { id: "json", label: "JSON", example: 'f={"size":9} becomes f › size' },
  { id: "base64", label: "Base64 JSON", example: "ctx=eyJzaXplIjo5fQ becomes ctx › size" },
  { id: "jwt", label: "JWT", example: "token=eyJhbGci… becomes header, payload, signature" },
  { id: "rison", label: "Rison", example: "_g=(time:(from:now-7d)) becomes _g › time › from" },
  {
    id: "matrix",
    label: "Matrix params",
    example: "/catalog;view=grid/ becomes matrix › catalog › view",
  },
];

export const defaultOptions = (): Options =>
  Object.fromEntries(DECODERS.map((d) => [d.id, true])) as Options;

/** Key used when a path holds both its own value and nested keys, as in `a=1&a.b=2`. */
export const SELF = "\u0000self";
const PUSH = "\u0000push";
const MAX_DEPTH = 8;
const ABS_URL = /^[a-z][a-z0-9+.-]*:\/\/\S/i;
const REL_URL = /^\/[^\s?#]*\?\S*=/;
const SCHEME = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;
const URL_RE =
  /^(?:([a-zA-Z][a-zA-Z0-9+.-]*):)?(?:\/\/([^/?#]*))?([^?#]*)(?:\?([^#]*))?(?:#(.*))?$/ds;

const leaf = (v: Scalar, note?: string): Leaf =>
  note === undefined ? { t: "leaf", v } : { t: "leaf", v, note };
const obj = (via?: string): Obj => ({ t: "obj", via, entries: new Map() });

export function decodePct(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

const decodeForm = (s: string) => decodePct(s.replace(/\+/g, " "));

function tryJson(t: string): unknown {
  try {
    return JSON.parse(t);
  } catch {
    return undefined;
  }
}

function fromJson(v: unknown, via?: string): Node {
  if (Array.isArray(v)) return { t: "arr", via, items: v.map((x) => fromJson(x)) };
  if (v !== null && typeof v === "object") {
    const o = obj(via);
    for (const [k, x] of Object.entries(v)) o.entries.set(k, fromJson(x));
    return o;
  }
  return leaf(v as Scalar);
}

function hasControlChars(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c < 9 || (c > 13 && c < 32) || c === 127) return true;
  }
  return false;
}

/** Decodes standard or URL-safe base64 into UTF-8 text, or null if it isn't clean text. */
export function base64Text(t: string, min = 8): string | null {
  let b = t.replace(/ /g, "+");
  if (b.length < min || !/^[A-Za-z0-9+/_-]+={0,2}$/.test(b)) return null;
  b = b.replace(/-/g, "+").replace(/_/g, "/").replace(/=+$/, "");
  if (b.length % 4 === 1) return null;
  while (b.length % 4) b += "=";
  try {
    const bytes = Uint8Array.from(atob(b), (c) => c.charCodeAt(0));
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return hasControlChars(text) ? null : text;
  } catch {
    return null;
  }
}

const TIME_CLAIMS = new Set(["exp", "iat", "nbf", "auth_time"]);

function jwt(t: string): Obj | null {
  const m = /^([\w-]+)\.([\w-]+)\.([\w-]*)$/.exec(t);
  if (!m) return null;
  const header = tryJson(base64Text(m[1]!, 4) ?? "");
  const payload = tryJson(base64Text(m[2]!, 2) ?? "");
  if (header === null || typeof header !== "object" || !("alg" in header)) return null;
  if (payload === undefined) return null;
  const p = fromJson(payload);
  if (p.t === "obj") {
    for (const [k, v] of p.entries) {
      if (TIME_CLAIMS.has(k) && v.t === "leaf" && typeof v.v === "number") {
        v.note = new Date(v.v * 1000)
          .toISOString()
          .replace("T", " ")
          .replace(/\.\d+Z$/, " UTC");
      }
    }
  }
  const o = obj("JWT");
  o.entries.set("header", fromJson(header));
  o.entries.set("payload", p);
  o.entries.set("signature", leaf(m[3]!));
  return o;
}

function looksLikeQuery(t: string): boolean {
  if (!t.includes("=") || /\s/.test(t)) return false;
  let anyValue = false;
  for (const pair of t.split("&")) {
    const eq = pair.indexOf("=");
    if (eq <= 0) return false;
    const v = pair.slice(eq + 1);
    if (v.includes("=")) return false;
    if (v) anyValue = true;
  }
  return anyValue;
}

/** Turns one decoded parameter value into structure, using the enabled decoders. */
export function decodeValue(s: string, opts: Options, depth = 0): Node {
  const t = s.trim();
  if (depth > MAX_DEPTH || t === "") return leaf(s);
  if (opts.jwt) {
    const j = jwt(t);
    if (j) return j;
  }
  if (opts.json && /^[[{]/.test(t)) {
    const j = tryJson(t);
    if (j !== undefined) return fromJson(j, "JSON");
  }
  if (opts.rison && /^!?\(/.test(t)) {
    try {
      return fromJson(parseRison(t), "Rison");
    } catch {
      // not Rison
    }
  }
  if (opts.urls) {
    if (ABS_URL.test(t)) return buildUrl(t, 0, null, opts, depth + 1, "URL");
    if (REL_URL.test(t)) return buildUrl(t, 0, null, opts, depth + 1, "relative URL");
  }
  if (opts.base64) {
    const text = base64Text(t)?.trim();
    if (text && /^[[{]/.test(text)) {
      const j = tryJson(text);
      if (j !== undefined) return fromJson(j, "base64 JSON");
    }
    if (text && ABS_URL.test(text)) return buildUrl(text, 0, null, opts, depth + 1, "base64 URL");
  }
  if (opts.queries && looksLikeQuery(t)) {
    return parseQuery(t, 0, [], null, opts, depth + 1, "query string");
  }
  if (opts.lists && t.includes(",")) {
    return { t: "arr", via: "comma list", items: t.split(",").map((x) => leaf(x)) };
  }
  return leaf(s);
}

/** Splits `a.b[c][]` into ["a", "b", "c", PUSH] according to the enabled key rules. */
export function splitKey(key: string, opts: Options): string[] {
  let base = key;
  let rest: string[] = [];
  if (opts.brackets) {
    const m = /^([^[\]]+)((?:\[[^[\]]*\])+)$/.exec(key);
    if (m) {
      base = m[1]!;
      rest = [...m[2]!.matchAll(/\[([^[\]]*)\]/g)].map((x) => (x[1] === "" ? PUSH : x[1]!));
    }
  }
  const head = opts.dotted && /^[^.]+(?:\.[^.]+)+$/.test(base) ? base.split(".") : [base];
  return [...head, ...rest];
}

const REPEATED = "repeated key";

/** Places `value` at `segs` inside `root` and returns the path of the row it belongs to. */
function insert(root: Obj, segs: string[], value: Node): string[] {
  let cur = root;
  const path: string[] = [];
  for (let i = 0; i < segs.length; i++) {
    const last = i === segs.length - 1;
    const seg = segs[i] === PUSH ? "[]" : segs[i]!;
    const nextIsPush = segs[i + 1] === PUSH && i + 1 === segs.length - 1;
    const existing = cur.entries.get(seg);
    path.push(seg);
    if (nextIsPush) {
      if (existing?.t === "arr" && existing.via === "[] keys") existing.items.push(value);
      else if (!existing) cur.entries.set(seg, { t: "arr", via: "[] keys", items: [value] });
      else cur.entries.set(seg, combine(existing, value));
      return path;
    }
    if (last) {
      if (!existing) cur.entries.set(seg, value);
      else if (existing.t === "obj" && existing.via === undefined && value.t !== "obj") {
        existing.entries.set(SELF, value);
      } else cur.entries.set(seg, combine(existing, value));
      return path;
    }
    if (existing?.t === "obj") cur = existing;
    else {
      const o = obj();
      if (existing) o.entries.set(SELF, existing);
      cur.entries.set(seg, o);
      cur = o;
    }
  }
  return path;
}

function combine(existing: Node, value: Node): Arr {
  if (existing.t === "arr" && existing.via === REPEATED) {
    existing.items.push(value);
    return existing;
  }
  return { t: "arr", via: REPEATED, items: [existing, value] };
}

function parseQuery(
  text: string,
  offset: number,
  base: Seg[],
  spans: Span[] | null,
  opts: Options,
  depth: number,
  via: string,
): Obj {
  const q = obj(via);
  let pos = 0;
  for (const part of text.split("&")) {
    const start = offset + pos;
    pos += part.length + 1;
    if (!part) continue;
    const eq = part.indexOf("=");
    const key = decodeForm(eq < 0 ? part : part.slice(0, eq));
    const value =
      eq < 0 ? leaf("", "no value") : decodeValue(decodeForm(part.slice(eq + 1)), opts, depth);
    const path = insert(q, splitKey(key, opts), value);
    spans?.push({
      start,
      end: start + part.length,
      valueStart: eq < 0 ? undefined : start + eq + 1,
      path: [...base, ...path],
      item: value.t === "leaf" ? value.v : undefined,
    });
  }
  return q;
}

type Add = (start: number, end: number, path: Seg[], valueStart?: number) => void;

function parseAuthority(a: string, off: number, root: Obj, add: Add) {
  let hostStart = 0;
  const at = a.lastIndexOf("@");
  if (at >= 0) {
    const info = a.slice(0, at);
    const colon = info.indexOf(":");
    const user = colon < 0 ? info : info.slice(0, colon);
    root.entries.set("user", leaf(decodePct(user)));
    add(off, off + user.length, ["user"]);
    if (colon >= 0) {
      root.entries.set("password", leaf(decodePct(info.slice(colon + 1))));
      add(off + colon + 1, off + at, ["password"]);
    }
    hostStart = at + 1;
  }
  const hp = a.slice(hostStart);
  const m = /^(\[[^\]]*\]|[^:]*)(?::(\d*))?$/.exec(hp);
  const host = m ? m[1]! : hp;
  const port = m?.[2];
  root.entries.set("host", leaf(decodePct(host).toLowerCase()));
  add(off + hostStart, off + hostStart + host.length, ["host"]);
  if (port) {
    root.entries.set("port", leaf(port));
    add(off + hostStart + host.length + 1, off + hostStart + hp.length, ["port"]);
  }
}

function parsePath(path: string, off: number, root: Obj, add: Add, opts: Options, depth: number) {
  if (!opts.matrix || !path.includes(";")) {
    root.entries.set("path", leaf(decodePct(path)));
    add(off, off + path.length, ["path"]);
    return;
  }
  const matrix = obj("matrix params");
  const names: string[] = [];
  let pos = off;
  path.split("/").forEach((seg, i) => {
    const [name = "", ...params] = seg.split(";");
    names.push(name);
    add(pos, pos + name.length, ["path"]);
    if (params.length) {
      let key = decodePct(name) || `segment ${i}`;
      while (matrix.entries.has(key)) key += "'";
      const p = obj();
      matrix.entries.set(key, p);
      let ppos = pos + name.length + 1;
      for (const kv of params) {
        if (kv) {
          const eq = kv.indexOf("=");
          const k = decodePct(eq < 0 ? kv : kv.slice(0, eq));
          const v =
            eq < 0 ? leaf("", "no value") : decodeValue(decodePct(kv.slice(eq + 1)), opts, depth);
          const sub = insert(p, [k], v);
          add(ppos, ppos + kv.length, ["matrix", key, ...sub], eq < 0 ? undefined : ppos + eq + 1);
        }
        ppos += kv.length + 1;
      }
    }
    pos += seg.length + 1;
  });
  root.entries.set("path", leaf(decodePct(names.join("/"))));
  root.entries.set("matrix", matrix);
}

function parseFragment(
  frag: string,
  off: number,
  root: Obj,
  spans: Span[] | null,
  add: Add,
  opts: Options,
  depth: number,
) {
  if (/^!?\//.test(frag)) {
    const node = obj("hash route");
    const q = frag.indexOf("?");
    const route = q < 0 ? frag : frag.slice(0, q);
    node.entries.set("route", leaf(decodePct(route)));
    add(off, off + route.length, ["fragment", "route"]);
    if (q >= 0) {
      const query = parseQuery(
        frag.slice(q + 1),
        off + q + 1,
        ["fragment", "query"],
        spans,
        opts,
        depth,
        "query",
      );
      if (query.entries.size) node.entries.set("query", query);
    }
    root.entries.set("fragment", node);
  } else if (/^[^=&]+=/.test(frag)) {
    root.entries.set(
      "fragment",
      parseQuery(frag, off, ["fragment"], spans, opts, depth, "hash params"),
    );
  } else {
    root.entries.set("fragment", leaf(decodePct(frag)));
    add(off, off + frag.length, ["fragment"]);
  }
}

function buildUrl(
  s: string,
  offset: number,
  spans: Span[] | null,
  opts: Options,
  depth: number,
  via?: string,
): Obj {
  const root = obj(via);
  const add: Add = (start, end, path, valueStart) => {
    if (spans && end > start) spans.push({ start, end, path, valueStart });
  };

  if (!SCHEME.test(s) && !/^[/?#]/.test(s) && /^[^/?#=&]+=/.test(s)) {
    const q = parseQuery(s, offset, ["query"], spans, opts, depth, "query");
    if (q.entries.size) root.entries.set("query", q);
    return root;
  }

  const m = URL_RE.exec(s)!;
  const idx = m.indices!;
  const [, scheme, authority, path, query, fragment] = m;
  if (scheme !== undefined) {
    root.entries.set("scheme", leaf(scheme.toLowerCase()));
    add(offset + idx[1]![0], offset + idx[1]![1], ["scheme"]);
  }
  if (authority !== undefined) parseAuthority(authority, offset + idx[2]![0], root, add);
  if (path) parsePath(path, offset + idx[3]![0], root, add, opts, depth);
  if (query !== undefined) {
    const q = parseQuery(query, offset + idx[4]![0], ["query"], spans, opts, depth, "query");
    if (q.entries.size) root.entries.set("query", q);
  }
  if (fragment) parseFragment(fragment, offset + idx[5]![0], root, spans, add, opts, depth);
  return root;
}

/** Parses a URL (or a bare query string) into a tree of parts plus source ranges for each part. */
export function parseUrl(raw: string, opts: Options): Parsed {
  const spans: Span[] = [];
  const lead = raw.length - raw.trimStart().length;
  const tree = buildUrl(raw.trim(), lead, spans, opts, 0);
  return { tree, spans };
}
