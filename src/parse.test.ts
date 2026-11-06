import { describe, expect, it } from "vite-plus/test";
import { EXAMPLE } from "./example.ts";
import { defaultOptions, parseUrl, SELF, type Node, type Obj, type Options } from "./parse.ts";
import { parseRison } from "./rison.ts";

const opts = defaultOptions();
const without = (...ids: (keyof Options)[]): Options => ({
  ...opts,
  ...Object.fromEntries(ids.map((id) => [id, false])),
});

/** Converts a parsed tree into plain JSON for readable assertions. */
function plain(n: Node): unknown {
  if (n.t === "leaf") return n.v;
  if (n.t === "arr") return n.items.map(plain);
  return Object.fromEntries([...n.entries].map(([k, v]) => [k, plain(v)]));
}

const tree = (url: string, o = opts) => plain(parseUrl(url, o).tree) as Record<string, unknown>;
const viaOf = (o: Obj, ...path: string[]) => {
  let n: Node | undefined = o;
  for (const p of path) n = n?.t === "obj" ? n.entries.get(p) : undefined;
  return n && n.t !== "leaf" ? n.via : undefined;
};

describe("parseUrl", () => {
  it("splits the address into parts", () => {
    expect(tree("HTTPS://user:pw@Example.COM:8080/a/b?x=1#top")).toEqual({
      scheme: "https",
      user: "user",
      password: "pw",
      host: "example.com",
      port: "8080",
      path: "/a/b",
      query: { x: "1" },
      fragment: "top",
    });
  });

  it("nests dotted and bracket keys", () => {
    expect(
      tree("https://a.test/?o.apps=x,y&o.every=5&f[size][]=9&f[size][]=10&f[brand]=acme").query,
    ).toEqual({
      o: { apps: ["x", "y"], every: "5" },
      f: { size: ["9", "10"], brand: "acme" },
    });
  });

  it("keeps keys flat when key rules are off", () => {
    expect(tree("https://a.test/?o.apps=x&f[a]=1", without("dotted", "brackets")).query).toEqual({
      "o.apps": "x",
      "f[a]": "1",
    });
  });

  it("collects repeated keys into a list", () => {
    expect(tree("magnet:?xt=urn:btih:abc&tr=udp://a&tr=udp://b").query).toEqual({
      xt: "urn:btih:abc",
      tr: [
        { scheme: "udp", host: "a" },
        { scheme: "udp", host: "b" },
      ],
    });
  });

  it("keeps both a value and nested keys under the same name", () => {
    expect(tree("https://a.test/?a=1&a.b=2").query).toEqual({ a: { [SELF]: "1", b: "2" } });
  });

  it("decodes nested URLs, including encoded ones", () => {
    const t = tree(
      "https://a.test/play/?peer=wss://sig.example.dev/%3Fkey%3Dabc123&return=%2Fcart%3Fstep%3D2",
    );
    expect(t.query).toEqual({
      peer: { scheme: "wss", host: "sig.example.dev", path: "/", query: { key: "abc123" } },
      return: { path: "/cart", query: { step: "2" } },
    });
  });

  it("decodes JSON, base64 JSON, JWT and Rison values", () => {
    const parsed = parseUrl(EXAMPLE[0]!, opts);
    const q = plain(parsed.tree.entries.get("query")!) as Record<string, unknown>;
    expect(q.ctx).toEqual({ user: 42, experiments: ["new-nav"] });
    expect(q.token).toEqual({
      header: { alg: "HS256", typ: "JWT" },
      payload: { sub: "42", scope: "read", exp: 1793000000 },
      signature: "c2lnbmF0dXJlLWE",
    });
    expect(q._g).toEqual({ time: { from: "now-7d", to: "now" } });
    expect(viaOf(parsed.tree, "query", "ctx")).toBe("base64 JSON");
    expect(viaOf(parsed.tree, "query", "token")).toBe("JWT");
    expect(tree('https://a.test/?f={"size":[9,10]}').query).toEqual({ f: { size: [9, 10] } });
  });

  it("leaves random base64-looking tokens alone", () => {
    expect(
      tree("https://a.test/?ak=L5igkK0G-Sd1VEQXC2jpuQ&pv=hZkZjtLWzM1MglxIeHeT2Q==").query,
    ).toEqual({
      ak: "L5igkK0G-Sd1VEQXC2jpuQ",
      pv: "hZkZjtLWzM1MglxIeHeT2Q==",
    });
  });

  it("parses matrix params and hash routes", () => {
    const t = tree(EXAMPLE[0]!);
    expect(t.path).toBe("/catalog/shoes");
    expect(t.matrix).toEqual({ catalog: { view: "grid" } });
    expect(t.fragment).toEqual({ route: "/reviews", query: { page: "1" } });
  });

  it("parses hash params", () => {
    expect(tree("https://a.test/#access_token=x&state=y").fragment).toEqual({
      access_token: "x",
      state: "y",
    });
  });

  it("accepts a bare query string", () => {
    expect(tree("a=1&b=2")).toEqual({ query: { a: "1", b: "2" } });
  });

  it("decodes plus signs and percent escapes in values", () => {
    expect(tree("https://a.test/?q=red+shoes%21&bad=%E0%A4%A").query).toEqual({
      q: "red shoes!",
      bad: "%E0%A4%A",
    });
  });

  it("records spans that point at the raw text", () => {
    const raw = "  https://a.test/x?o.apps=a,b&k=v";
    const { spans } = parseUrl(raw, opts);
    const text = spans.map((s) => [raw.slice(s.start, s.end), s.path.join(".")]);
    expect(text).toEqual([
      ["https", "scheme"],
      ["a.test", "host"],
      ["/x", "path"],
      ["o.apps=a,b", "query.o.apps"],
      ["k=v", "query.k"],
    ]);
  });
});

describe("parseRison", () => {
  it("parses objects, lists, literals and quoted strings", () => {
    expect(parseRison("(a:!(1,2.5,-3),b:!t,c:!n,d:'it!'s',e:())")).toEqual({
      a: [1, 2.5, -3],
      b: true,
      c: null,
      d: "it's",
      e: {},
    });
  });

  it("rejects malformed input", () => {
    expect(() => parseRison("(a:1")).toThrow();
    expect(() => parseRison("(a:1)x")).toThrow();
  });
});
