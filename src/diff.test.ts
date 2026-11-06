import { describe, expect, it } from "vite-plus/test";
import { charDiff, compare, type Row } from "./diff.ts";
import { EXAMPLES } from "./examples.ts";
import { defaultOptions, parseUrl, type Options } from "./parse.ts";

const EXAMPLE = EXAMPLES[0]!.urls;
const opts = defaultOptions();
const run = (...urls: string[]) => compare(urls.map((u) => parseUrl(u, opts).tree));
const runWith = (changes: Partial<Options>, ...urls: string[]) => {
  const o = { ...opts, ...changes };
  return compare(
    urls.map((u) => parseUrl(u, o).tree),
    o,
  );
};
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

describe("treat as equal", () => {
  it("compares lists in any order", () => {
    const a = "https://a.test/?scope=openid%20email&o=b,a";
    const b = "https://a.test/?scope=email%20openid&o=a,b";
    expect(statusOf(run(a, b), "query", "scope")).toBe("diff");
    expect(statusOf(runWith({ sets: true }, a, b), "query", "scope")).toBe("same");
    expect(statusOf(runWith({ sets: true }, a, b), "query", "o")).toBe("same");
  });

  it("ignores case and number formatting", () => {
    const a = "https://a.test/?theme=Dark&n=1.0&z=007";
    const b = "https://a.test/?theme=dark&n=1&z=7";
    expect(statusOf(run(a, b), "query")).toBe("diff");
    const c = runWith({ case: true, numbers: true }, a, b);
    expect([
      statusOf(c, "query", "theme"),
      statusOf(c, "query", "n"),
      statusOf(c, "query", "z"),
    ]).toEqual(["same", "same", "same"]);
  });

  it("ignores URL variations", () => {
    const a = "https://www.a.test:443/x/";
    const b = "https://a.test/x";
    expect(run(a, b).counts.same).toBe(1);
    expect(runWith({ loose: true }, a, b).counts).toEqual({ same: 3, diff: 0, partial: 0 });
  });

  it("lines up a curl command with a plain URL", () => {
    const c = run(
      "https://api.test/v1/items?id=3",
      "curl 'https://api.test/v1/items?id=4' -H 'Accept: */*'",
    );
    expect(statusOf(c, "host")).toBe("same");
    expect(statusOf(c, "query", "id")).toBe("diff");
    expect(statusOf(c, "method")).toBe("partial");
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
