import { SELF, type Arr, type Node, type Obj, type Seg } from "./parse.ts";

export type Status = "same" | "diff" | "partial";

export interface Row {
  path: Seg[];
  key: string;
  depth: number;
  /** One entry per compared URL; undefined where that URL lacks this part. */
  cells: (Node | undefined)[];
  children: Row[];
  status: Status;
  /** True when every container cell is a flat list of values, shown inline. */
  compact: boolean;
}

export interface Comparison {
  rows: Row[];
  index: Map<string, Row>;
  counts: Record<Status, number>;
}

export const pathKey = (path: Seg[]): string => JSON.stringify(path);

export function label(seg: Seg): string {
  if (typeof seg === "number") return `[${seg}]`;
  if (seg === SELF) return "(own value)";
  return seg === "" ? '""' : seg;
}

const isFlatList = (n: Node): n is Arr => n.t === "arr" && n.items.every((i) => i.t === "leaf");

function childOf(n: Node | undefined, seg: Seg): Node | undefined {
  if (!n || n.t === "leaf") return undefined;
  if (n.t === "obj") return typeof seg === "string" ? n.entries.get(seg) : undefined;
  return typeof seg === "number" ? n.items[seg] : undefined;
}

/** Ordered union of child keys, keeping each URL's own ordering where possible. */
function childSegs(cells: (Node | undefined)[]): Seg[] {
  const out: Seg[] = [];
  for (const c of cells) {
    if (!c || c.t === "leaf") continue;
    const segs: Seg[] = c.t === "obj" ? [...c.entries.keys()] : c.items.map((_, i) => i);
    let pos: number | null = null;
    for (const s of segs) {
      const found = out.indexOf(s);
      if (found >= 0) {
        pos = found;
        continue;
      }
      const at: number = pos === null ? out.length : pos + 1;
      out.splice(at, 0, s);
      pos = at;
    }
  }
  return out;
}

export function equalNode(a: Node, b: Node): boolean {
  if (a.t === "leaf" || b.t === "leaf") return a.t === "leaf" && b.t === "leaf" && a.v === b.v;
  if (a.t === "arr" || b.t === "arr") {
    return (
      a.t === "arr" &&
      b.t === "arr" &&
      a.items.length === b.items.length &&
      a.items.every((x, i) => equalNode(x, b.items[i]!))
    );
  }
  if (a.entries.size !== b.entries.size) return false;
  for (const [k, x] of a.entries) {
    const y = b.entries.get(k);
    if (!y || !equalNode(x, y)) return false;
  }
  return true;
}

function statusOf(row: Row): Status {
  const { cells } = row;
  if (cells.some((c) => !c)) return "partial";
  const first = cells[0]!;
  if (row.children.length) {
    const sameKind = cells.every((c) => c!.t === first.t);
    return sameKind && row.children.every((c) => c.status === "same") ? "same" : "diff";
  }
  return cells.every((c) => equalNode(c!, first)) ? "same" : "diff";
}

function build(cells: (Node | undefined)[], path: Seg[], depth: number, out: Comparison): Row {
  const containers = cells.filter((c): c is Obj | Arr => !!c && c.t !== "leaf");
  const compact = containers.length > 0 && containers.every(isFlatList);
  const row: Row = {
    path,
    key: pathKey(path),
    depth,
    cells,
    children: [],
    status: "same",
    compact,
  };
  if (containers.length && !compact) {
    row.children = childSegs(cells).map((seg) =>
      build(
        cells.map((c) => childOf(c, seg)),
        [...path, seg],
        depth + 1,
        out,
      ),
    );
  }
  row.status = statusOf(row);
  if (!row.children.length) out.counts[row.status]++;
  out.index.set(row.key, row);
  return row;
}

/** Aligns the parsed trees of several URLs into rows keyed by path. */
export function compare(trees: Obj[]): Comparison {
  const out: Comparison = { rows: [], index: new Map(), counts: { same: 0, diff: 0, partial: 0 } };
  out.rows = childSegs(trees).map((seg) =>
    build(
      trees.map((t) => childOf(t, seg)),
      [seg],
      0,
      out,
    ),
  );
  return out;
}

export type Range = [start: number, end: number];

function toRanges(indices: number[]): Range[] {
  indices.sort((x, y) => x - y);
  const out: Range[] = [];
  for (const i of indices) {
    const last = out[out.length - 1];
    if (last && last[1] === i) last[1] = i + 1;
    else out.push([i, i + 1]);
  }
  return out;
}

/**
 * Myers diff over characters. Returns the ranges of `a` that were removed and of `b` that were
 * added, or null when the strings are too long or too unlike each other for the result to help.
 */
export function charDiff(a: string, b: string): { a: Range[]; b: Range[] } | null {
  const n = a.length;
  const m = b.length;
  if (n + m > 6000) return null;
  const maxD = Math.min(n + m, 300);
  const off = maxD + 1;
  const v = new Int32Array(2 * maxD + 3);
  const trace: Int32Array[] = [];
  for (let d = 0; d <= maxD; d++) {
    for (let k = -d; k <= d; k += 2) {
      let x =
        k === -d || (k !== d && v[off + k - 1]! < v[off + k + 1]!)
          ? v[off + k + 1]!
          : v[off + k - 1]! + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v[off + k] = x;
      if (x === n && y === m) return backtrack(trace, d, n, m);
    }
    trace.push(v.slice(off - d, off + d + 1));
  }
  return null;
}

function backtrack(trace: Int32Array[], D: number, n: number, m: number) {
  const common = (n + m - D) / 2;
  if (common < 0.5 * Math.max(n, m)) return null;
  const del: number[] = [];
  const ins: number[] = [];
  let x = n;
  let y = m;
  for (let d = D; d > 0; d--) {
    const prev = trace[d - 1]!;
    const get = (k: number) => prev[k + d - 1]!;
    const k = x - y;
    const down = k === -d || (k !== d && get(k - 1) < get(k + 1));
    const prevK = down ? k + 1 : k - 1;
    const prevX = get(prevK);
    const prevY = prevX - prevK;
    if (down) ins.push(prevY);
    else del.push(prevX);
    x = prevX;
    y = prevY;
  }
  return { a: toRanges(del), b: toRanges(ins) };
}
