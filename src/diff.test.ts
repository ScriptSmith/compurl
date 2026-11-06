import { describe, expect, it } from "vite-plus/test";
import { charDiff, compare, type Row } from "./diff.ts";
import { EXAMPLE } from "./example.ts";
import { defaultOptions, parseUrl } from "./parse.ts";

const opts = defaultOptions();
const run = (...urls: string[]) => compare(urls.map((u) => parseUrl(u, opts).tree));
const statusOf = (c: ReturnType<typeof run>, ...path: (string | number)[]) =>
  c.index.get(JSON.stringify(path))?.status;

function flatten(rows: Row[]): string[] {
  return rows.flatMap((r) => [r.path.join("."), ...flatten(r.children)]);
}

describe("compare", () => {
  const a =
    "https://h.test/play/?app=menu&o.apps=beachball,gaze&o.every=5&setup=solo&room=r1&peer=wss://s.test/%3Fkey%3Dk1";
  const b =
    "https://h.test/play/?app=gaze&variant=eye&o.iris=changes&setup=solo&room=r1&peer=wss://s.test/%3Fkey%3Dk1";

  it("marks identical, different and missing parts", () => {
    const c = run(a, b);
    expect(statusOf(c, "host")).toBe("same");
    expect(statusOf(c, "query", "app")).toBe("diff");
    expect(statusOf(c, "query", "variant")).toBe("partial");
    expect(statusOf(c, "query", "o", "apps")).toBe("partial");
    expect(statusOf(c, "query", "o")).toBe("diff");
    expect(statusOf(c, "query", "peer")).toBe("same");
    expect(statusOf(c, "query")).toBe("diff");
  });

  it("orders keys by the first URL, slotting new keys after their neighbours", () => {
    const keys = flatten(run(a, b).rows).filter((k) => /^query\.[^.]+$/.test(k));
    expect(keys).toEqual([
      "query.app",
      "query.variant",
      "query.o",
      "query.setup",
      "query.room",
      "query.peer",
    ]);
  });

  it("counts only leaf rows", () => {
    const c = run(EXAMPLE[0]!, EXAMPLE[1]!);
    const leaves = [...c.index.values()].filter((r) => !r.children.length).length;
    expect(c.counts.same + c.counts.diff + c.counts.partial).toBe(leaves);
    expect(c.counts.partial).toBeGreaterThan(0);
    expect(c.counts.diff).toBeGreaterThan(0);
  });

  it("shows flat lists inline and compares them as a whole", () => {
    const c = run("https://a.test/?s=1,2,3", "https://a.test/?s=1,3");
    const row = c.index.get(JSON.stringify(["query", "s"]))!;
    expect(row.compact).toBe(true);
    expect(row.children).toEqual([]);
    expect(row.status).toBe("diff");
  });

  it("treats a single URL as all-same", () => {
    const c = run(a);
    expect(c.counts.diff + c.counts.partial).toBe(0);
  });
});

describe("charDiff", () => {
  it("finds inserted and removed characters", () => {
    expect(charDiff("trail runner", "trail runners")).toEqual({ a: [], b: [[12, 13]] });
    expect(charDiff("now-7d", "now-30d")).toEqual({ a: [[4, 5]], b: [[4, 6]] });
  });

  it("gives up on unrelated strings", () => {
    expect(charDiff("L5igkK0G-Sd1VEQXC2jpuQ", "hZkZjtLWzM1MglxIeHeT2Q")).toBeNull();
  });

  it("handles empty strings", () => {
    expect(charDiff("", "")).toEqual({ a: [], b: [] });
  });
});
