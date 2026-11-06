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

/** How to change the value behind a span by rewriting the raw text. */
export interface Edit {
  /** Raw range that the encoded value replaces. */
  range: [number, number];
  /** The value as the user sees and edits it. */
  text: string;
  /** Turns edited text back into raw text for `range`. */
  encode: (text: string) => string;
  /** The decoded form of `text`, for edits further down the tree. */
  node?: Node;
  /** Raw range to delete to remove this entry, separator included. */
  remove?: [number, number];
  /** The raw text before the value, such as `key=`, for adding siblings of a repeated key. */
  prefix?: string;
}

/** A place in the raw text where new entries can be added. */
export interface Insert {
  at: number;
  build: (key: string, value: string) => string;
}

/** A range of the raw input that produced the value at `path`. */
export interface Span {
  start: number;
  end: number;
  valueStart?: number;
  path: Seg[];
  /** The decoded value when this span holds one plain value, such as one of several repeated keys. */
  item?: Scalar;
  edit?: Edit;
  insert?: Insert;
  /** Used for editing only, not highlighted. */
  hidden?: boolean;
}

/** Key used when a path holds both its own value and nested keys, as in `a=1&a.b=2`. */
export const SELF = "\u0000self";
export const PUSH = "\u0000push";
export const REPEATED = "repeated key";

export const leaf = (v: Scalar, note?: string): Leaf =>
  note === undefined ? { t: "leaf", v } : { t: "leaf", v, note };
export const obj = (via?: string): Obj => ({ t: "obj", via, entries: new Map() });
export const arr = (items: Node[], via?: string): Arr => ({ t: "arr", via, items });

export function fromJson(v: unknown, via?: string): Node {
  if (Array.isArray(v))
    return arr(
      v.map((x) => fromJson(x)),
      via,
    );
  if (v !== null && typeof v === "object") {
    const o = obj(via);
    for (const [k, x] of Object.entries(v)) o.entries.set(k, fromJson(x));
    return o;
  }
  if (typeof v === "bigint") return leaf(v.toString());
  return leaf(v as Scalar);
}

export function withVia<T extends Node>(n: T, via: string): T {
  if (n.t !== "leaf") n.via = n.via ? `${via} ${n.via}` : via;
  return n;
}

function combine(existing: Node, value: Node): Arr {
  if (existing.t === "arr" && existing.via === REPEATED) {
    existing.items.push(value);
    return existing;
  }
  return arr([existing, value], REPEATED);
}

/** Places `value` at `segs` inside `root` and returns the path of the row it belongs to. */
export function insert(root: Obj, segs: string[], value: Node): string[] {
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
      else if (!existing) cur.entries.set(seg, arr([value], "[] keys"));
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

/** Adds `value` under `key`, turning repeated keys into a list. */
export function put(o: Record<string, unknown>, key: string, value: unknown) {
  if (!(key in o)) o[key] = value;
  else if (Array.isArray(o[key]) && REPEATS.has(o[key] as unknown[]))
    (o[key] as unknown[]).push(value);
  else {
    const list = [o[key], value];
    REPEATS.add(list);
    o[key] = list;
  }
}
const REPEATS = new WeakSet<unknown[]>();

/** Converts a tree into plain JSON values. */
export function toPlain(n: Node): unknown {
  if (n.t === "leaf") return n.v;
  if (n.t === "arr") return n.items.map(toPlain);
  return Object.fromEntries(
    [...n.entries].map(([k, v]) => [k === SELF ? "(own value)" : k, toPlain(v)]),
  );
}

export function walkLeaves(n: Node, fn: (leaf: Leaf, key: Seg | undefined) => void, key?: Seg) {
  if (n.t === "leaf") fn(n, key);
  else if (n.t === "obj") for (const [k, v] of n.entries) walkLeaves(v, fn, k);
  else n.items.forEach((v) => walkLeaves(v, fn, key));
}
