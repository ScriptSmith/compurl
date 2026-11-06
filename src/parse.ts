import { parseBang, parseViewport } from "./decoders/bang.ts";
import { base64Bytes, base64Text, inflateText, lzText } from "./decoders/compress.ts";
import { parseCurl, tokenize, type Curl, type Token } from "./decoders/curl.ts";
import { parseJsurl } from "./decoders/jsurl.ts";
import { protobufFromBytes } from "./decoders/protobuf.ts";
import { parseRison } from "./decoders/rison.ts";
import { parseSearch } from "./decoders/search.ts";
import { annotateSigned } from "./decoders/signed.ts";
import { timeNote } from "./decoders/time.ts";
import { itsdangerous, jwt, paseto, rails } from "./decoders/tokens.ts";
import { parseXml } from "./decoders/xml.ts";
import {
  encodeLike,
  encodeRaw,
  FRAGMENT,
  INTENT,
  MATRIX,
  QUERY,
  QUERY_VALUE,
  SEGMENT,
  USERINFO,
} from "./encode.ts";
import type { Options } from "./options.ts";
import {
  arr,
  fromJson,
  insert,
  leaf,
  obj,
  PUSH,
  walkLeaves,
  withVia,
  type Node,
  type Obj,
  type Scalar,
  type Seg,
  type Span,
} from "./tree.ts";

export * from "./options.ts";
export * from "./tree.ts";

export interface Parsed {
  tree: Obj;
  spans: Span[];
  kind: "url" | "curl";
  /** The URL a curl command requests. */
  url?: string;
}

const MAX_DEPTH = 8;
const ABS_URL = /^[a-z][a-z0-9+.-]*:\/\/\S+$/i;
const REL_URL = /^\/[^\s?#]*\?\S*=\S*$/;
const SCHEME = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;
const CURL = /^curl(?:\.exe)?\s/i;
const URL_RE =
  /^(?:([a-zA-Z][a-zA-Z0-9+.-]*):)?(?:\/\/([^/?#]*))?([^?#]*)(?:\?([^#]*))?(?:#(.*))?$/ds;
const DEFAULT_PORTS: Record<string, string> = {
  http: "80",
  https: "443",
  ws: "80",
  wss: "443",
  ftp: "21",
};

type Add = (start: number, end: number, path: Seg[], more?: Partial<Span>) => void;

export function decodePct(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

const decodeForm = (s: string) => decodePct(s.replace(/\+/g, " "));

function attempt<T>(fn: () => T): T | undefined {
  try {
    return fn();
  } catch {
    return undefined;
  }
}

const tryJson = (t: string): unknown => attempt(() => JSON.parse(t) as unknown);

/** Splits `text` on `&` (and `;` when enabled), keeping each piece's offset. */
function pairs(text: string, semicolons: boolean): [string, number][] {
  const out: [string, number][] = [];
  let start = 0;
  for (let i = 0; i <= text.length; i++) {
    if (i === text.length || text[i] === "&" || (semicolons && text[i] === ";")) {
      out.push([text.slice(start, i), start]);
      start = i + 1;
    }
  }
  return out;
}

function looksLikeQuery(t: string, opts: Options): boolean {
  if (!t.includes("=") || /\s/.test(t)) return false;
  let anyValue = false;
  for (const [pair] of pairs(t, opts.semicolons)) {
    const eq = pair.indexOf("=");
    if (eq <= 0 || !/^[\w.\-[\]%~$!*]+$/.test(pair.slice(0, eq))) return false;
    const v = pair.slice(eq + 1);
    if (v.includes("=")) return false;
    if (v) anyValue = true;
  }
  return anyValue;
}

/** Turns decoded text (from base64, compression and so on) into structure if it has any. */
function structured(text: string, via: string, opts: Options, depth: number): Node | null {
  const t = text.trim();
  if (/^[[{]/.test(t)) {
    const j = tryJson(t);
    if (j !== undefined) return fromJson(j, `${via} JSON`);
  }
  if (t.startsWith("<")) {
    const x = parseXml(t);
    if (x) return fromJson(x, `${via} XML`);
  }
  if (ABS_URL.test(t)) return buildUrl(t, 0, null, opts, depth, `${via} URL`);
  if (looksLikeQuery(t, opts))
    return parseQuery(t, 0, [], null, opts, depth, `${via} query string`);
  return null;
}

const printable = (t: string) => t.length >= 8 && /\s/.test(t);

function decompress(t: string, opts: Options, depth: number): Node | null {
  const m = /^([a-z][\w-]{0,15})[:/]([A-Za-z0-9+/_$=-]{16,})$/i.exec(t);
  const tries: [string, string][] = m
    ? [
        [`${m[1]}: `, m[2]!],
        ["", t],
      ]
    : [["", t]];
  for (const [prefix, body] of tries) {
    const node = decompressBody(prefix, body, opts, depth);
    if (node) return node;
  }
  return null;
}

function decompressBody(prefix: string, body: string, opts: Options, depth: number): Node | null {
  const bytes = base64Bytes(body, 12);
  const inflated = bytes && inflateText(bytes);
  if (inflated) {
    const via = `${prefix}base64 ${inflated.kind}`;
    let text = inflated.text;
    if (inflated.kind === "deflate" && /%[0-9A-F]{2}/i.test(text)) text = decodePct(text);
    const s = structured(text, via, opts, depth + 1);
    if (s) return s;
    if (inflated.kind !== "deflate" || printable(text)) return leaf(text, via);
  }
  const lz = lzText(body);
  if (lz !== null) {
    const s = structured(lz, `${prefix}lz-string`, opts, depth + 1);
    if (s) return s;
    if (printable(lz)) return leaf(lz, `${prefix}lz-string`);
  }
  return null;
}

function protobufValue(t: string): Record<string, unknown> | null {
  for (const candidate of /^\d/.test(t) ? [t, t.slice(1)] : [t]) {
    const bytes = base64Bytes(candidate, 8);
    const msg = bytes && protobufFromBytes(bytes);
    if (msg) return msg;
  }
  return null;
}

const listOf = (t: string, sep: string | RegExp, via: string) =>
  arr(
    t.split(sep).map((x) => leaf(x)),
    via,
  );

function decodeOnce(s: string, opts: Options, depth: number, key?: string): Node {
  const t = s.trim();
  if (depth > MAX_DEPTH || t === "") return leaf(s);
  if (opts.jwt) {
    const d = jwt(t);
    if (d) return fromJson(d.value, d.via);
  }
  if (opts.tokens) {
    const d = itsdangerous(t) ?? rails(t) ?? paseto(t);
    if (d) return fromJson(d.value, d.via);
  }
  if (opts.json && /^[[{]/.test(t)) {
    const j = tryJson(t);
    if (j !== undefined) return fromJson(j, "JSON");
  }
  if (opts.rison && /^!?\(/.test(t)) {
    const r = attempt(() => parseRison(t));
    if (r !== undefined) return fromJson(r, "Rison");
  }
  if (opts.jsurl && /^~[('\-\dtfn]/.test(t)) {
    const r = attempt(() => parseJsurl(t));
    if (r !== undefined) return fromJson(r, "JSURL");
  }
  if (opts.maps && /^!\d+[a-z]/.test(t)) {
    const b = parseBang(t);
    if (b) return fromJson(b, "Maps data");
  }
  if (opts.urls) {
    if (ABS_URL.test(t)) return buildUrl(t, 0, null, opts, depth + 1, "URL");
    if (REL_URL.test(t)) return buildUrl(t, 0, null, opts, depth + 1, "relative URL");
  }
  if (opts.compressed) {
    const c = decompress(t, opts, depth);
    if (c) return c;
  }
  if (opts.base64) {
    const text = base64Text(t);
    const s = text && structured(text, "base64", opts, depth + 1);
    if (s) return s;
  }
  if (opts.protobuf) {
    const p = protobufValue(t);
    if (p) return fromJson(p, "base64 protobuf");
  }
  if (opts.queries && looksLikeQuery(t, opts)) {
    return parseQuery(t, 0, [], null, opts, depth + 1, "query string");
  }
  if (opts.search) {
    const q = parseSearch(t, key);
    if (q) return fromJson(q, "search query");
  }
  if (opts.lists && t.includes(",")) return listOf(t, ",", "comma list");
  if (opts.pipes && t.includes("|")) return listOf(t, "|", "pipe list");
  if (opts.spaces && /\S\s+\S/.test(t)) return listOf(t, /\s+/, "space list");
  return leaf(s);
}

/** Turns one decoded value into structure, using the enabled decoders. */
export function decodeValue(s: string, opts: Options, depth = 0, key?: string): Node {
  const node = decodeOnce(s, opts, depth, key);
  if (node.t !== "leaf" || !opts.encoding || depth > MAX_DEPTH) return node;
  let t = s;
  let times = 1;
  while (times < 4 && /%[0-9a-f]{2}/i.test(t)) {
    const d = decodePct(t);
    if (d === t) break;
    t = d;
    times++;
  }
  if (times === 1) return node;
  const label = times === 2 ? "encoded twice" : `encoded ${times} times`;
  const again = decodeOnce(t, opts, depth + 1, key);
  if (again.t !== "leaf") return withVia(again, `${label},`);
  return leaf(again.v, again.note ? `${label}, ${again.note}` : label);
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
  for (const [part, at] of pairs(text, opts.semicolons)) {
    if (!part) continue;
    const start = offset + at;
    const eq = part.indexOf("=");
    const key = decodeForm(eq < 0 ? part : part.slice(0, eq));
    const segs = splitKey(key, opts);
    const value =
      eq < 0
        ? leaf("", "no value")
        : decodeValue(decodeForm(part.slice(eq + 1)), opts, depth, segs[segs.length - 1]);
    const path = insert(q, segs, value);
    if (!spans) continue;
    const end = start + part.length;
    const rawValue = eq < 0 ? "" : part.slice(eq + 1);
    const style = opts.semicolons
      ? { ...QUERY_VALUE, reserved: `${QUERY_VALUE.reserved};` }
      : QUERY_VALUE;
    const remove: [number, number] =
      at > 0
        ? [start - 1, end]
        : at + part.length < text.length
          ? [start, end + 1]
          : [offset > 0 ? start - 1 : start, end];
    spans.push({
      start,
      end,
      valueStart: eq < 0 ? undefined : start + eq + 1,
      path: [...base, ...path],
      item: value.t === "leaf" ? value.v : undefined,
      edit: {
        range: [eq < 0 ? end : start + eq + 1, end],
        text: eq < 0 ? "" : decodeForm(rawValue),
        encode: (v) =>
          eq < 0
            ? v === ""
              ? ""
              : `=${encodeLike(v, "", style)}`
            : encodeLike(v, rawValue, style),
        node: value,
        remove,
        prefix: part.slice(0, eq < 0 ? part.length : eq + 1),
      },
    });
  }
  if (opts.signed) annotateSigned(q);
  return q;
}

function parseAuthority(
  a: string,
  off: number,
  root: Obj,
  add: Add,
  opts: Options,
  scheme?: string,
) {
  let hostStart = 0;
  const at = a.lastIndexOf("@");
  if (at >= 0) {
    const info = a.slice(0, at);
    const colon = info.indexOf(":");
    const user = colon < 0 ? info : info.slice(0, colon);
    root.entries.set("user", leaf(decodePct(user)));
    add(off, off + user.length, ["user"], {
      edit: {
        range: [off, off + user.length],
        text: decodePct(user),
        encode: (v) => encodeLike(v, user, USERINFO),
      },
    });
    if (colon >= 0) {
      const password = info.slice(colon + 1);
      root.entries.set("password", leaf(decodePct(password)));
      add(off + colon + 1, off + at, ["password"], {
        edit: {
          range: [off + colon + 1, off + at],
          text: decodePct(password),
          encode: (v) => encodeLike(v, password, USERINFO),
          remove: [off + colon, off + at],
        },
      });
    }
    hostStart = at + 1;
  }
  const hp = a.slice(hostStart);
  const m = /^(\[[^\]]*\]|[^:]*)(?::(\d*))?$/.exec(hp);
  const host = m ? m[1]! : hp;
  const port = m?.[2];
  let hostValue = decodePct(host).toLowerCase();
  if (opts.loose) hostValue = hostValue.replace(/^www\./, "");
  root.entries.set("host", leaf(hostValue));
  const hostRange: [number, number] = [off + hostStart, off + hostStart + host.length];
  add(...hostRange, ["host"], {
    edit: { range: hostRange, text: host, encode: (v) => encodeRaw(v, "/?#@") },
  });
  if (port && !(opts.loose && scheme && DEFAULT_PORTS[scheme] === port)) {
    root.entries.set("port", leaf(port));
    const portRange: [number, number] = [hostRange[1] + 1, off + hostStart + hp.length];
    add(...portRange, ["port"], {
      edit: {
        range: portRange,
        text: port,
        encode: (v) => v.replace(/\D/g, ""),
        remove: [hostRange[1], portRange[1]],
      },
    });
  }
}

const SEGMENT_DECODERS = (opts: Options): Options => ({
  ...opts,
  lists: false,
  pipes: false,
  spaces: false,
  search: false,
  queries: false,
  urls: false,
  json: false,
  rison: false,
  jsurl: false,
  maps: false,
  encoding: false,
});

function parsePath(path: string, off: number, root: Obj, add: Add, opts: Options, depth: number) {
  const matrix = obj("matrix params");
  const maps = obj("Google Maps");
  const names: string[] = [];
  const kept: Node[] = [];
  const segOpts = SEGMENT_DECODERS(opts);
  let pos = off;
  add(off, off + path.length, ["path"], {
    hidden: true,
    edit: { range: [off, off + path.length], text: path, encode: (v) => encodeRaw(v, "?#") },
  });
  const segs = path.split("/");
  segs.forEach((seg, i) => {
    let name = seg;
    if (opts.matrix && seg.includes(";")) {
      const [head = "", ...params] = seg.split(";");
      name = head;
      let key = decodePct(head) || `segment ${i}`;
      while (matrix.entries.has(key)) key += "'";
      const p = obj();
      matrix.entries.set(key, p);
      let ppos = pos + head.length + 1;
      for (const kv of params) {
        if (kv) {
          const eq = kv.indexOf("=");
          const k = decodePct(eq < 0 ? kv : kv.slice(0, eq));
          const v =
            eq < 0
              ? leaf("", "no value")
              : decodeValue(decodePct(kv.slice(eq + 1)), opts, depth, k);
          const sub = insert(p, [k], v);
          const rawValue = eq < 0 ? "" : kv.slice(eq + 1);
          add(ppos, ppos + kv.length, ["matrix", key, ...sub], {
            valueStart: eq < 0 ? undefined : ppos + eq + 1,
            edit: {
              range: [eq < 0 ? ppos + kv.length : ppos + eq + 1, ppos + kv.length],
              text: decodePct(rawValue),
              encode: (x) =>
                eq < 0 ? `=${encodeLike(x, "", MATRIX)}` : encodeLike(x, rawValue, MATRIX),
              node: v,
              remove: [ppos - 1, ppos + kv.length],
            },
          });
        }
        ppos += kv.length + 1;
      }
    }
    names.push(name);
    const decoded = decodePct(name);
    let handled = false;
    if (opts.maps) {
      const viewport = parseViewport(decoded);
      const data = /^data=(!\d+[a-z].*)$/s.exec(decoded);
      const bang = data && parseBang(data[1]!);
      if (viewport) maps.entries.set("viewport", fromJson(viewport));
      if (bang) maps.entries.set("data", fromJson(bang));
      if (viewport || bang) {
        const skip = viewport ? 0 : 5;
        const raw = name.slice(skip);
        add(pos, pos + name.length, ["maps", viewport ? "viewport" : "data"], {
          edit: {
            range: [pos + skip, pos + name.length],
            text: decodePct(raw),
            encode: (v) => encodeLike(v, raw, SEGMENT),
            remove: [pos - 1, pos + name.length],
          },
        });
        handled = true;
      }
    }
    if (!handled && !(i === 0 && name === "")) {
      add(pos, pos + name.length, ["path"], { item: opts.segments ? decoded : undefined });
      if (opts.segments) {
        const node = decoded.length >= 16 ? decodeValue(decoded, segOpts, depth) : leaf(decoded);
        add(pos, pos + name.length, ["path", kept.length], {
          hidden: true,
          edit: {
            range: [pos, pos + name.length],
            text: decoded,
            encode: (v) => encodeLike(v, name, SEGMENT),
            node,
            remove: [pos - 1, pos + name.length],
          },
        });
        kept.push(node);
      }
    }
    pos += seg.length + 1;
  });

  if (opts.segments) {
    if (opts.loose && kept.length > 1) {
      const last = kept[kept.length - 1]!;
      if (last.t === "leaf" && last.v === "") kept.pop();
    }
    const onlyRoot =
      kept.length === 1 && kept[0]!.t === "leaf" && kept[0]!.v === "" && path.startsWith("/");
    if (onlyRoot) root.entries.set("path", leaf("/"));
    else if (kept.length) root.entries.set("path", arr(kept));
  } else {
    let p = decodePct(names.join("/"));
    if (opts.loose && p.length > 1) p = p.replace(/\/+$/, "");
    root.entries.set("path", leaf(p));
  }
  if (matrix.entries.size) root.entries.set("matrix", matrix);
  if (maps.entries.size) root.entries.set("maps", maps);
}

const INTENT_TYPES: Record<string, string> = {
  B: "boolean",
  b: "byte",
  c: "char",
  d: "double",
  f: "float",
  i: "int",
  l: "long",
  s: "short",
};

function parseIntent(frag: string, off: number, root: Obj, add: Add, opts: Options, depth: number) {
  const node = obj("Android intent");
  const extras = obj("extras");
  let pos = 0;
  for (const item of frag.split(";")) {
    const at = off + pos;
    pos += item.length + 1;
    if (!item || item === "Intent" || item === "end") continue;
    const eq = item.indexOf("=");
    const k = eq < 0 ? item : item.slice(0, eq);
    const v = decodePct(eq < 0 ? "" : item.slice(eq + 1));
    const valueStart = eq < 0 ? undefined : at + eq + 1;
    const rawValue = eq < 0 ? "" : item.slice(eq + 1);
    const edit = (node: Node) => ({
      range: [eq < 0 ? at + item.length : at + eq + 1, at + item.length] as [number, number],
      text: v,
      encode: (x: string) => (eq < 0 ? "=" : "") + encodeLike(x, rawValue, INTENT),
      node,
      remove: [at - 1, at + item.length] as [number, number],
    });
    const extra = /^([SBbcdfils])\.(.+)$/.exec(k);
    if (extra) {
      const [, type, name] = extra;
      const value =
        type === "S"
          ? decodeValue(v, opts, depth, name)
          : type === "B"
            ? leaf(v === "true", "boolean")
            : type === "c"
              ? leaf(v, "char")
              : leaf(Number.isFinite(Number(v)) ? Number(v) : v, INTENT_TYPES[type!]);
      extras.entries.set(name!, value);
      add(at, at + item.length, ["fragment", "extras", name!], { valueStart, edit: edit(value) });
    } else {
      const value = decodeValue(v, { ...opts, lists: false, spaces: false }, depth, k);
      node.entries.set(k, value);
      add(at, at + item.length, ["fragment", k], { valueStart, edit: edit(value) });
    }
  }
  if (extras.entries.size) node.entries.set("extras", extras);
  root.entries.set("fragment", node);
}

function textDirective(raw: string): Node {
  const parts = raw.split(",");
  const o = obj();
  if (parts.length > 1 && parts[0]!.endsWith("-"))
    o.entries.set("prefix", leaf(decodePct(parts.shift()!.slice(0, -1))));
  const suffix =
    parts.length > 1 && parts[parts.length - 1]!.startsWith("-") ? parts.pop()!.slice(1) : null;
  o.entries.set("start", leaf(decodePct(parts[0] ?? "")));
  if (parts[1] !== undefined) o.entries.set("end", leaf(decodePct(parts[1])));
  if (suffix !== null) o.entries.set("suffix", leaf(decodePct(suffix)));
  return o;
}

function parseTextFragment(frag: string, off: number, root: Obj, add: Add) {
  const node = obj("text fragment");
  const i = frag.indexOf(":~:");
  if (i > 0) {
    const anchor = frag.slice(0, i);
    node.entries.set("anchor", leaf(decodePct(anchor)));
    add(off, off + i, ["fragment", "anchor"], {
      edit: {
        range: [off, off + i],
        text: decodePct(anchor),
        encode: (v) => encodeLike(v, anchor, FRAGMENT),
      },
    });
  }
  let pos = i + 3;
  const directives = frag.slice(i + 3).split("&");
  directives.forEach((d, n) => {
    const at = off + pos;
    pos += d.length + 1;
    if (!d) return;
    const eq = d.indexOf("=");
    const name = eq < 0 ? d : d.slice(0, eq);
    const raw = eq < 0 ? "" : d.slice(eq + 1);
    const path = insert(node, [name], name === "text" ? textDirective(raw) : leaf(decodePct(raw)));
    const end = at + d.length;
    add(at, end, ["fragment", ...path], {
      valueStart: eq < 0 ? undefined : at + eq + 1,
      edit: {
        range: [eq < 0 ? end : at + eq + 1, end],
        text: raw,
        encode: (v) => (eq < 0 ? "=" : "") + encodeRaw(v, "#&"),
        remove: n > 0 ? [at - 1, end] : directives.length > 1 ? [at, end + 1] : [off + i, end],
      },
    });
  });
  root.entries.set("fragment", node);
}

const FRAGMENT_FORMATS = (opts: Options): Options => ({
  ...SEGMENT_DECODERS(opts),
  json: opts.json,
  rison: opts.rison,
  jsurl: opts.jsurl,
});

function parseFragment(
  frag: string,
  off: number,
  root: Obj,
  spans: Span[] | null,
  add: Add,
  opts: Options,
  depth: number,
) {
  const special =
    (opts.intent && frag.startsWith("Intent;")) ||
    (opts.textfrag && frag.includes(":~:")) ||
    /^!?\//.test(frag);
  if (special) {
    add(off, off + frag.length, ["fragment"], {
      hidden: true,
      edit: {
        range: [off, off + frag.length],
        text: frag,
        encode: (v) => encodeRaw(v, "#"),
        remove: [off - 1, off + frag.length],
      },
    });
  }
  if (opts.intent && frag.startsWith("Intent;"))
    return parseIntent(frag, off, root, add, opts, depth);
  if (opts.textfrag && frag.includes(":~:")) return parseTextFragment(frag, off, root, add);
  if (/^!?\//.test(frag)) {
    const node = obj("hash route");
    const q = frag.indexOf("?");
    const route = q < 0 ? frag : frag.slice(0, q);
    node.entries.set("route", leaf(decodePct(route)));
    add(off, off + route.length, ["fragment", "route"], {
      edit: {
        range: [off, off + route.length],
        text: decodePct(route),
        encode: (v) => encodeLike(v, route, { ...FRAGMENT, reserved: "#%?" }),
      },
    });
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
    return;
  }
  const decoded = decodePct(frag);
  const format = decodeValue(decoded, FRAGMENT_FORMATS(opts), depth);
  const whole = (node: Node, hidden: boolean) =>
    add(off, off + frag.length, ["fragment"], {
      hidden,
      edit: {
        range: [off, off + frag.length],
        text: decoded,
        encode: (v) => encodeLike(v, frag, FRAGMENT),
        node,
        remove: [off - 1, off + frag.length],
      },
    });
  if (format.t !== "leaf" || format.note) {
    root.entries.set("fragment", format);
    whole(format, false);
  } else if (/^[^=&]+=/.test(frag)) {
    root.entries.set(
      "fragment",
      parseQuery(frag, off, ["fragment"], spans, opts, depth, "hash params"),
    );
    add(off, off + frag.length, ["fragment"], {
      hidden: true,
      edit: {
        range: [off, off + frag.length],
        text: frag,
        encode: (v) => encodeRaw(v, "#"),
        remove: [off - 1, off + frag.length],
      },
    });
  } else {
    const node = decodeValue(decoded, opts, depth, "fragment");
    root.entries.set("fragment", node);
    whole(node, false);
  }
}

function buildUrl(
  s: string,
  offset: number,
  spans: Span[] | null,
  opts: Options,
  depth: number,
  via?: string,
  root: Obj = obj(via),
): Obj {
  const add: Add = (start, end, path, more = {}) => {
    if (spans && (end > start || more.hidden)) spans.push({ start, end, path, ...more });
  };

  const keyOf = (k: string) => encodeLike(k, "[].", QUERY);
  const valueOf = (v: string) => encodeLike(v, ",:/@", QUERY_VALUE);

  if (!SCHEME.test(s) && !/^[/?#]/.test(s) && /^[^/?#=&]+=/.test(s)) {
    const q = parseQuery(s, offset, ["query"], spans, opts, depth, "query");
    if (q.entries.size) root.entries.set("query", q);
    add(offset + s.length, offset + s.length, ["query"], {
      hidden: true,
      insert: { at: offset + s.length, build: (k, v) => `&${keyOf(k)}=${valueOf(v)}` },
    });
    return root;
  }

  const m = URL_RE.exec(s)!;
  const idx = m.indices!;
  const [, scheme, authority, path, query, fragment] = m;
  const lowerScheme = scheme?.toLowerCase();
  if (lowerScheme !== undefined) {
    root.entries.set("scheme", leaf(lowerScheme));
    const range: [number, number] = [offset + idx[1]![0], offset + idx[1]![1]];
    add(...range, ["scheme"], {
      edit: { range, text: scheme!, encode: (v) => v.replace(/[^\w+.-]/g, "") },
    });
  }
  if (authority !== undefined)
    parseAuthority(authority, offset + idx[2]![0], root, add, opts, lowerScheme);
  if (path) parsePath(path, offset + idx[3]![0], root, add, opts, depth);
  if (query !== undefined) {
    const q = parseQuery(query, offset + idx[4]![0], ["query"], spans, opts, depth, "query");
    if (q.entries.size) root.entries.set("query", q);
  }
  const queryEnd =
    query !== undefined
      ? offset + idx[4]![1]
      : fragment !== undefined
        ? offset + idx[5]![0] - 1
        : offset + s.length;
  add(queryEnd, queryEnd, ["query"], {
    hidden: true,
    insert: {
      at: queryEnd,
      build: (k, v) =>
        `${query === undefined ? "?" : query === "" ? "" : "&"}${keyOf(k)}=${valueOf(v)}`,
    },
    edit:
      query === undefined
        ? undefined
        : {
            range: [offset + idx[4]![0], queryEnd],
            text: query,
            encode: (v) => encodeRaw(v, "#"),
            remove: [offset + idx[4]![0] - 1, queryEnd],
          },
  });
  if (fragment) parseFragment(fragment, offset + idx[5]![0], root, spans, add, opts, depth);
  return root;
}

const LIST_HEADERS =
  /^(?:accept(?:-encoding|-language|-charset)?|cache-control|vary|allow|te|connection|access-control-[\w-]+|sec-ch-ua(?:-[\w-]+)?|if-(?:none-)?match)$/;

function parseCookies(text: string, opts: Options, depth: number): Obj {
  const o = obj("cookies");
  for (const part of text.split(/;\s*/)) {
    if (!part.trim()) continue;
    const eq = part.indexOf("=");
    const name = (eq < 0 ? part : part.slice(0, eq)).trim();
    const value =
      eq < 0
        ? ""
        : part
            .slice(eq + 1)
            .trim()
            .replace(/^"(.*)"$/, "$1");
    insert(o, [name], decodeValue(decodePct(value), opts, depth, name));
  }
  return o;
}

export function headerValue(name: string, value: string, opts: Options, depth = 1): Node {
  const hopts: Options = {
    ...opts,
    spaces: false,
    pipes: false,
    search: false,
    lists: LIST_HEADERS.test(name),
  };
  if (name === "cookie") return parseCookies(value, opts, depth);
  if (name === "authorization" || name === "proxy-authorization") {
    const m = /^(\S+)\s+(.+)$/s.exec(value.trim());
    if (m) {
      const auth = obj(`${m[1]} auth`);
      auth.entries.set("scheme", leaf(m[1]!));
      const basic = m[1]!.toLowerCase() === "basic" ? base64Text(m[2]!, 2) : null;
      if (basic !== null) {
        const colon = basic.indexOf(":");
        auth.entries.set("user", leaf(colon < 0 ? basic : basic.slice(0, colon)));
        if (colon >= 0) auth.entries.set("password", leaf(basic.slice(colon + 1)));
      } else auth.entries.set("credentials", decodeValue(m[2]!, hopts, depth));
      return auth;
    }
  }
  return decodeValue(value, hopts, depth, name);
}

function contentType(c: Curl): string {
  for (const h of c.headers) {
    const m = /^content-type\s*:\s*(.*)$/i.exec(h.value);
    if (m) return m[1]!.toLowerCase();
  }
  return c.data.some((d) => d.kind === "json") ? "application/json" : "";
}

/** Body text as curl would send it, and the token it came from when there is exactly one. */
function bodyText(c: Curl): { text: string; token?: Token } {
  const parts = c.data.map(({ kind, token }) => {
    if (kind !== "data-urlencode") return token.value;
    const v = token.value;
    const eq = v.indexOf("=");
    if (eq < 0) return encodeURIComponent(v);
    return eq === 0
      ? encodeURIComponent(v.slice(1))
      : `${v.slice(0, eq)}=${encodeURIComponent(v.slice(eq + 1))}`;
  });
  const single =
    c.data.length === 1 && c.data[0]!.kind !== "data-urlencode" ? c.data[0]!.token : undefined;
  return { text: parts.join("&"), token: single };
}

function curlTree(
  s: string,
  lead: number,
  spans: Span[],
  opts: Options,
): { root: Obj; url?: string } {
  const tokens = tokenize(s);
  const c = parseCurl(tokens)!;
  const root = obj("curl");
  let effective: string | undefined;
  const add = (start: number, end: number, path: Seg[], valueStart?: number, item?: Scalar) => {
    if (end > start)
      spans.push({
        start: lead + start,
        end: lead + end,
        path,
        valueStart: valueStart === undefined ? undefined : lead + valueStart,
        item,
      });
  };
  const at = (t: Token) => (t.exact === undefined ? null : t.exact);

  const has = (n: string) => c.options.some((o) => o.name === n);
  const get = has("get");
  const { text: body, token: bodyToken } = bodyText(c);
  const inferred = has("head")
    ? "HEAD"
    : (c.data.length || c.form.length || has("upload-file")) && !get
      ? "POST"
      : "GET";
  root.entries.set(
    "method",
    c.method ? leaf(c.method.value.toUpperCase()) : leaf(inferred, "inferred"),
  );
  if (c.method) add(c.method.start, c.method.end, ["method"]);

  if (c.url) {
    let url = c.url.value;
    const extra = [...c.urlQuery.map((t) => t.value), ...(get && body ? [body] : [])];
    if (extra.length) url += (url.includes("?") ? "&" : "?") + extra.join("&");
    const off = at(c.url);
    const urlSpans: Span[] = [];
    buildUrl(url, off ?? 0, off === null ? null : urlSpans, opts, 0, undefined, root);
    for (const sp of urlSpans) {
      if (!sp.hidden && sp.start < (off ?? 0) + c.url.value.length)
        add(sp.start, sp.end, sp.path, sp.valueStart, sp.item);
    }
    effective = url;
  }
  if (c.extraUrls.length)
    root.entries.set("other URLs", arr(c.extraUrls.map((t) => decodeValue(t.value, opts, 1))));

  const headers = obj("headers");
  const header = (name: string, value: string, token?: Token, valueAt?: number) => {
    const path = insert(headers, [name], headerValue(name, value, opts, 1));
    if (token) {
      const start = at(token);
      if (start !== null && valueAt !== undefined)
        add(start, start + token.value.length, ["headers", ...path], start + valueAt);
      else add(token.start, token.end, ["headers", ...path]);
    }
  };
  for (const h of c.headers) {
    const m = /^([^:;]+)([:;])\s*(.*)$/s.exec(h.value);
    if (!m) continue;
    const name = m[1]!.trim().toLowerCase();
    const removed = m[2] === ":" && m[3] === "";
    if (removed) insert(headers, [name], leaf("", "removed"));
    else header(name, m[3]!, h, h.value.length - m[3]!.length);
  }
  for (const o of c.options) {
    if (!o.value) continue;
    if (o.name === "user-agent") header("user-agent", o.value.value, o.value);
    if (o.name === "referer") header("referer", o.value.value, o.value);
    if (o.name === "oauth2-bearer") header("authorization", `Bearer ${o.value.value}`, o.value);
  }
  if (c.data.some((d) => d.kind === "json")) {
    if (!headers.entries.has("content-type"))
      insert(headers, ["content-type"], leaf("application/json", "from --json"));
    if (!headers.entries.has("accept"))
      insert(headers, ["accept"], leaf("application/json", "from --json"));
  }
  if (headers.entries.size) root.entries.set("headers", headers);

  if (c.cookies.length) {
    const cookies = obj("cookies");
    for (const t of c.cookies) {
      if (!t.value.includes("=")) insert(cookies, ["(file)"], leaf(t.value, "cookie file"));
      else for (const [k, v] of parseCookies(t.value, opts, 1).entries) insert(cookies, [k], v);
      add(t.start, t.end, ["cookies"]);
    }
    root.entries.set("cookies", cookies);
  }

  if (c.user) {
    const colon = c.user.value.indexOf(":");
    const auth = obj("--user");
    auth.entries.set("user", leaf(colon < 0 ? c.user.value : c.user.value.slice(0, colon)));
    if (colon >= 0) auth.entries.set("password", leaf(c.user.value.slice(colon + 1)));
    root.entries.set("auth", auth);
    add(c.user.start, c.user.end, ["auth"]);
  }

  if (body && !get) {
    const type = contentType(c);
    const start = bodyToken ? at(bodyToken) : null;
    let node: Node;
    if (body.startsWith("@")) node = leaf(body.slice(1), "read from file");
    else if (/json/.test(type) || (opts.json && /^\s*[[{]/.test(body)))
      node = decodeValue(body, opts, 1);
    else if (/x-www-form-urlencoded/.test(type) || (type === "" && looksLikeQuery(body, opts))) {
      const bodySpans: Span[] = [];
      node = parseQuery(
        body,
        start ?? 0,
        ["body"],
        start === null ? null : bodySpans,
        opts,
        1,
        "form body",
      );
      for (const sp of bodySpans)
        if (!sp.hidden) add(sp.start, sp.end, sp.path, sp.valueStart, sp.item);
    } else node = decodeValue(body, opts, 1);
    root.entries.set("body", node);
    if (!(node.t === "obj" && node.via === "form body" && start !== null)) {
      for (const d of c.data) add(d.token.start, d.token.end, ["body"]);
    }
  }

  if (c.form.length) {
    const form = obj("multipart form");
    for (const t of c.form) {
      const eq = t.value.indexOf("=");
      const name = eq < 0 ? t.value : t.value.slice(0, eq);
      const v = eq < 0 ? "" : t.value.slice(eq + 1);
      const value =
        v.startsWith("@") || v.startsWith("<")
          ? leaf(v.slice(1), v[0] === "@" ? "file upload" : "file contents")
          : decodeValue(v, opts, 1, name);
      const path = insert(form, [name], value);
      add(t.start, t.end, ["form", ...path]);
    }
    root.entries.set("form", form);
  }

  const options = obj("options");
  for (const o of c.options) {
    if (["user-agent", "referer", "oauth2-bearer"].includes(o.name)) continue;
    insert(options, [o.name], o.value ? leaf(o.value.value) : leaf(true));
    add(o.token.start, (o.value && o.value.end > o.token.end ? o.value : o.token).end, [
      "options",
      o.name,
    ]);
  }
  if (options.entries.size) root.entries.set("options", options);
  return { root, url: effective };
}

function annotate(tree: Node) {
  walkLeaves(tree, (l) => {
    const n = timeNote(l.v);
    if (n && !l.note?.includes(n.replace(/^.*?: /, ""))) l.note = l.note ? `${l.note}, ${n}` : n;
  });
}

/** Parses a URL, a bare query string or a curl command into a tree plus source ranges. */
export function parseUrl(raw: string, opts: Options): Parsed {
  const spans: Span[] = [];
  const lead = raw.length - raw.trimStart().length;
  const s = raw.trim();
  const curl = CURL.test(s);
  const { root: tree, url } = curl
    ? curlTree(s, lead, spans, opts)
    : { root: buildUrl(s, lead, spans, opts, 0), url: s };
  if (opts.timestamps) annotate(tree);
  spans.sort((a, b) => a.start - b.start);
  return { tree, spans, kind: curl ? "curl" : "url", url };
}
