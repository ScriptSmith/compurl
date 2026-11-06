import { compressToBase64, compressToEncodedURIComponent } from "lz-string";
import { describe, expect, it } from "vite-plus/test";
import { lzText } from "./decoders/compress.ts";
import { parseCurl, tokenize } from "./decoders/curl.ts";
import { parseJsurl } from "./decoders/jsurl.ts";
import { parseRison } from "./decoders/rison.ts";
import { parseXml } from "./decoders/xml.ts";
import { EXAMPLES } from "./examples.ts";
import { defaultOptions, parseUrl, SELF, type Node, type Obj, type Options } from "./parse.ts";

const opts = defaultOptions();
const using = (changes: Partial<Options>): Options => ({ ...opts, ...changes });
const example = (id: string, i = 0) => EXAMPLES.find((e) => e.id === id)!.urls[i]!;

/** Converts a parsed tree into plain JSON for readable assertions. */
function plain(n: Node): unknown {
  if (n.t === "leaf") return n.v;
  if (n.t === "arr") return n.items.map(plain);
  return Object.fromEntries([...n.entries].map(([k, v]) => [k, plain(v)]));
}

function at(o: Node, ...path: (string | number)[]): Node | undefined {
  let n: Node | undefined = o;
  for (const p of path) {
    if (!n || n.t === "leaf") return undefined;
    n = n.t === "obj" ? n.entries.get(String(p)) : n.items[Number(p)];
  }
  return n;
}

const tree = (url: string, o = opts) => plain(parseUrl(url, o).tree) as Record<string, unknown>;
const root = (url: string, o = opts): Obj => parseUrl(url, o).tree;
const viaOf = (n: Node | undefined) => (n && n.t !== "leaf" ? n.via : undefined);
const noteOf = (n: Node | undefined) => (n?.t === "leaf" ? n.note : undefined);

describe("URL structure", () => {
  it("splits the address into parts", () => {
    expect(tree("HTTPS://user:pw@Example.COM:8080/a/b?x=1#top")).toEqual({
      scheme: "https",
      user: "user",
      password: "pw",
      host: "example.com",
      port: "8080",
      path: ["a", "b"],
      query: { x: "1" },
      fragment: "top",
    });
  });

  it("keeps the path whole when segments are off", () => {
    expect(tree("https://a.test/a/b/", using({ segments: false })).path).toBe("/a/b/");
    expect(tree("https://a.test/").path).toBe("/");
  });

  it("ignores default ports, www. and trailing slashes as URL variations", () => {
    const loose = using({ loose: true });
    expect(tree("https://www.a.test:443/x/", loose)).toEqual({
      scheme: "https",
      host: "a.test",
      path: ["x"],
    });
    expect(tree("https://a.test:8443/x/", loose).port).toBe("8443");
  });

  it("accepts a bare query string", () => {
    expect(tree("a=1&b=2")).toEqual({ query: { a: "1", b: "2" } });
  });

  it("records spans that point at the raw text", () => {
    const raw = "  https://a.test/x/y?o.apps=a,b&k=v";
    const { spans } = parseUrl(raw, opts);
    const visible = spans.filter((s) => !s.hidden);
    expect(visible.map((s) => [raw.slice(s.start, s.end), s.path.join(".")])).toEqual([
      ["https", "scheme"],
      ["a.test", "host"],
      ["x", "path"],
      ["y", "path"],
      ["o.apps=a,b", "query.o.apps"],
      ["k=v", "query.k"],
    ]);
  });
});

describe("keys and lists", () => {
  it("nests dotted and bracket keys", () => {
    expect(
      tree("https://a.test/?o.apps=x,y&o.every=5&f[size][]=9&f[size][]=10&f[brand]=acme").query,
    ).toEqual({
      o: { apps: ["x", "y"], every: "5" },
      f: { size: ["9", "10"], brand: "acme" },
    });
  });

  it("keeps keys flat when key rules are off", () => {
    expect(
      tree("https://a.test/?o.apps=x&f[a]=1", using({ dotted: false, brackets: false })).query,
    ).toEqual({
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

  it("splits on semicolons only when asked", () => {
    expect(tree("https://a.test/?a=1;b=2").query).toEqual({ a: "1;b=2" });
    expect(tree("https://a.test/?a=1;b=2", using({ semicolons: true })).query).toEqual({
      a: "1",
      b: "2",
    });
  });

  it("splits space and pipe lists", () => {
    expect(tree("https://a.test/?scope=openid%20profile+email&family=Inter|Roboto").query).toEqual({
      scope: ["openid", "profile", "email"],
      family: ["Inter", "Roboto"],
    });
    expect(tree("https://a.test/?q=red+shoes", using({ spaces: false })).query).toEqual({
      q: "red shoes",
    });
  });

  it("parses search qualifiers", () => {
    const q = root("https://a.test/?q=is%3Aopen+is%3Apr+label%3A%22bug+fix%22+crash+report");
    expect(plain(at(q, "query", "q")!)).toEqual({
      is: ["open", "pr"],
      label: "bug fix",
      terms: "crash report",
    });
    expect(viaOf(at(q, "query", "q"))).toBe("search query");
    expect(tree("https://a.test/?q=repo%3Avite").query).toEqual({ q: { repo: "vite" } });
    expect(tree("https://a.test/?xt=urn:btih:abc").query).toEqual({ xt: "urn:btih:abc" });
  });

  it("decodes plus signs and percent escapes in values", () => {
    expect(tree("https://a.test/?q=red%21&bad=%E0%A4%A").query).toEqual({
      q: "red!",
      bad: "%E0%A4%A",
    });
  });
});

describe("nested values", () => {
  it("decodes nested URLs, including encoded ones", () => {
    expect(
      tree(
        "https://a.test/play/?peer=wss://sig.example.dev/%3Fkey%3Dabc123&return=%2Fcart%3Fstep%3D2",
      ).query,
    ).toEqual({
      peer: { scheme: "wss", host: "sig.example.dev", path: "/", query: { key: "abc123" } },
      return: { path: ["cart"], query: { step: "2" } },
    });
  });

  it("decodes values that were encoded more than once", () => {
    const t = root(example("oauth"));
    const cont = at(t, "query", "continue");
    expect(viaOf(cont)).toBe("encoded twice, URL");
    expect(plain(at(cont!, "query")!)).toEqual({ tab: "billing" });
    expect(plain(at(t, "query", "scope")!)).toEqual(["openid", "profile", "email"]);
    expect(plain(at(t, "query", "state")!)).toEqual({
      returnTo: "/dashboard",
      nonce: "n-0S6_WzA2Mj",
    });
  });

  it("leaves random tokens alone", () => {
    expect(
      tree("https://a.test/?ak=L5igkK0G-Sd1VEQXC2jpuQ&pv=hZkZjtLWzM1MglxIeHeT2Q==&room=dngvavan7g")
        .query,
    ).toEqual({
      ak: "L5igkK0G-Sd1VEQXC2jpuQ",
      pv: "hZkZjtLWzM1MglxIeHeT2Q==",
      room: "dngvavan7g",
    });
  });
});

describe("formats", () => {
  it("decodes JSON, base64 JSON, JWT and Rison values", () => {
    const t = root(example("shop"));
    expect(plain(at(t, "query", "ctx")!)).toEqual({ user: 42, experiments: ["new-nav"] });
    expect(viaOf(at(t, "query", "ctx"))).toBe("base64 JSON");
    expect(plain(at(t, "query", "token")!)).toEqual({
      header: { alg: "HS256", typ: "JWT" },
      payload: { sub: "42", scope: "read", exp: 1793000000 },
      signature: "c2lnbmF0dXJlLWE",
    });
    expect(noteOf(at(t, "query", "token", "payload", "exp"))).toBe("2026-10-26 07:33:20 UTC");
    expect(plain(at(t, "query", "_g")!)).toEqual({ time: { from: "now-7d", to: "now" } });
    expect(tree('https://a.test/?f={"size":[9,10]}').query).toEqual({ f: { size: [9, 10] } });
  });

  it("decompresses SAML requests into XML", () => {
    const t = root(example("saml"));
    const req = at(t, "query", "SAMLRequest");
    expect(viaOf(req)).toBe("base64 deflate XML");
    const authn = at(req!, "samlp:AuthnRequest");
    expect(plain(at(authn!, "@AssertionConsumerServiceURL")!)).toBe(
      "https://app.example.com/saml/acs",
    );
    expect(plain(at(authn!, "saml:Issuer")!)).toBe("https://app.example.com/saml/metadata");
    expect(at(t, "query", "Signature")?.t).toBe("leaf");
  });

  it("decompresses Mermaid pako: and TypeScript playground lz-string fragments", () => {
    const mermaid = at(root(example("mermaid")), "fragment");
    expect(viaOf(mermaid)).toBe("pako: base64 zlib JSON");
    expect(plain(at(mermaid!, "code")!)).toContain("A[Client] --> B[API]");
    const ts = at(root(example("ts")), "fragment");
    expect(noteOf(ts)).toBe("code: lz-string");
    expect(plain(ts!)).toContain("const greet");
  });

  it("decodes itsdangerous, Rails and PASETO tokens", () => {
    const t = root(example("tokens"));
    expect(viaOf(at(t, "query", "session"))).toBe("itsdangerous");
    expect(plain(at(t, "query", "session", "payload")!)).toEqual({ user_id: 42, role: "viewer" });
    expect(noteOf(at(t, "query", "session", "timestamp"))).toBe("2026-10-26 07:33:20 UTC");
    expect(viaOf(at(t, "query", "remember"))).toBe("Rails signed message");
    expect(plain(at(t, "query", "remember", "data")!)).toEqual({
      message: { user_id: 42, device: "laptop" },
      expires: null,
      purpose: "cookie.remember",
    });
    expect(plain(at(t, "query", "ticket", "claims")!)).toEqual({
      sub: "42",
      scope: "read",
      exp: "2026-12-01T00:00:00+00:00",
    });
  });

  it("decodes JSURL", () => {
    expect(parseJsurl("~(cols~(~'name~'age)~limit~20~on~true~q~'a*20b!)")).toEqual({
      cols: ["name", "age"],
      limit: 20,
      on: true,
      q: "a b$",
    });
    expect(parseJsurl("~(~)")).toEqual([]);
    expect(parseJsurl("~()")).toEqual({});
    expect(() => parseJsurl("~(a~")).toThrow();
  });

  it("decodes base64 protobuf only when enabled", () => {
    const url = example("tokens");
    expect(at(root(url), "query", "ved")?.t).toBe("leaf");
    expect(plain(at(root(url, using({ protobuf: true })), "query", "ved")!)).toEqual({
      "#1": 42,
      "#2": "abc",
      "#3": { "#1": 7 },
    });
  });
});

describe("paths and fragments", () => {
  it("parses matrix params and hash routes", () => {
    const t = tree(example("shop"));
    expect(t.path).toEqual(["catalog", "shoes"]);
    expect(t.matrix).toEqual({ catalog: { view: "grid" } });
    expect(t.fragment).toEqual({ route: "/reviews", query: { page: "1" } });
  });

  it("parses hash params", () => {
    expect(tree("https://a.test/#access_token=x&state=y").fragment).toEqual({
      access_token: "x",
      state: "y",
    });
  });

  it("parses text fragments", () => {
    expect(tree("https://a.test/#intro:~:text=quick-,brown,fox,-jumps&text=lazy").fragment).toEqual(
      {
        anchor: "intro",
        text: [{ prefix: "quick", start: "brown", end: "fox", suffix: "jumps" }, { start: "lazy" }],
      },
    );
  });

  it("parses Android intents with typed extras", () => {
    const t = root(example("intent", 1));
    expect(plain(at(t, "fragment")!)).toMatchObject({
      scheme: "zxing",
      package: "com.google.zxing.client.android.beta",
      extras: { version: 4, debug: true, since: 1793000000000 },
    });
    expect(plain(at(t, "fragment", "extras", "browser_fallback_url", "query")!)).toEqual({
      ref: "email",
    });
  });

  it("parses Google Maps viewports and data", () => {
    const t = tree(example("maps"));
    expect(t.path).toEqual(["maps", "place", "Sydney+Opera+House"]);
    expect(t.maps).toMatchObject({
      viewport: { lat: -33.8567844, lng: 151.2152967, zoom: 17 },
      data: {
        "#3": { "#4": true },
        "#4": { "#3": { "#8": { "#3": -33.8567844, "#4": 151.2152967 } } },
      },
    });
  });
});

describe("annotations", () => {
  it("adds times to timestamps and time-ordered IDs", () => {
    const t = root(example("tokens"));
    expect(noteOf(at(t, "query", "ts"))).toBe("2026-10-26 07:33:20 UTC");
    expect(noteOf(at(t, "query", "request"))).toBe("UUIDv7 time: 2026-10-26 07:33:20 UTC");
    expect(noteOf(at(t, "query", "order"))).toBe("ULID time: 2026-10-26 07:33:20 UTC");
    expect(noteOf(at(t, "query", "post"))).toContain("2026-10-26 07:33:20 UTC if X");
  });

  it("explains signed URL parameters", () => {
    const t = root(example("aws", 1));
    expect(plain(at(t, "query", "X-Amz-Credential")!)).toEqual({
      "access key": "AKIAIOSFODNN7EXAMPLE",
      date: "20261106",
      region: "ap-southeast-2",
      service: "s3",
      "request type": "aws4_request",
    });
    expect(plain(at(t, "query", "X-Amz-SignedHeaders")!)).toEqual(["host", "x-amz-content-sha256"]);
    expect(noteOf(at(t, "query", "X-Amz-Expires"))).toBe("expires 2026-11-13 10:15:00 UTC");
    expect(
      noteOf(
        at(
          root("https://a.blob.core.windows.net/c/f?sv=2022-11-02&sp=rl&sr=b&sig=x"),
          "query",
          "sp",
        ),
      ),
    ).toBe("read, list");
  });
});

describe("curl", () => {
  it("tokenizes shell quoting", () => {
    const toks = tokenize(`curl 'a b' "c\\"d" $'e\\nf' g\\ h \\\n  -H 'X: 1'`);
    expect(toks.map((t) => t.value)).toEqual(["curl", "a b", 'c"d', "e\nf", "g h", "-H", "X: 1"]);
    expect(toks[1]!.exact).toBe(6);
    expect(toks[2]!.exact).toBeUndefined();
  });

  it("reads options, combined flags and attached values", () => {
    const c = parseCurl(
      tokenize(
        "curl -sSL -XPOST https://a.test --data-raw x=1 -H'A: b' --unknown val --compressed",
      ),
    )!;
    expect(c.method?.value).toBe("POST");
    expect(c.url?.value).toBe("https://a.test");
    expect(c.headers.map((h) => h.value)).toEqual(["A: b"]);
    expect(c.options.map((o) => [o.name, o.value?.value ?? null])).toEqual([
      ["silent", null],
      ["show-error", null],
      ["location", null],
      ["unknown", "val"],
      ["compressed", null],
    ]);
  });

  it("turns a curl command into method, URL parts, headers, cookies and body", () => {
    const raw = example("curl", 1);
    const t = root(raw);
    expect(plain(t)).toMatchObject({
      method: "POST",
      scheme: "https",
      host: "api.example.com",
      path: ["v2", "orders"],
      headers: {
        authorization: { scheme: "Bearer", credentials: { payload: { scope: "orders:write" } } },
        "content-type": "application/json",
        cookie: { session: "abc123", theme: "light" },
      },
      body: { sku: "TR-9", qty: 2, gift: false },
      options: { compressed: true, silent: true, "show-error": true },
    });
    const { spans } = parseUrl(raw, opts);
    const host = spans.find((s) => s.path.join() === "host")!;
    expect(raw.slice(host.start, host.end)).toBe("api.example.com");
    const ct = spans.find((s) => s.path.join() === "headers,content-type")!;
    expect(raw.slice(ct.valueStart, ct.end)).toBe("application/json");
  });

  it("infers GET and moves data into the query with -G", () => {
    expect(tree("curl -G https://a.test/s -d q=1 -d page=2")).toMatchObject({
      method: "GET",
      query: { q: "1", page: "2" },
    });
    expect(plain(at(root("curl https://a.test -d 'a=1&b=2'"), "body")!)).toEqual({
      a: "1",
      b: "2",
    });
    expect(noteOf(at(root("curl https://a.test"), "method"))).toBe("inferred");
  });
});

describe("decoders", () => {
  it("matches lz-string's own compressor", () => {
    const samples = [
      "const x = 1;\nconsole.log(x);",
      '{"a":[1,2,3],"b":"text with spaces"}',
      "hello world ".repeat(40),
    ];
    for (const s of samples) {
      expect(lzText(compressToEncodedURIComponent(s))).toBe(s);
      expect(lzText(compressToBase64(s))).toBe(s);
    }
  });

  it("parses XML with attributes, repeated children and entities", () => {
    expect(parseXml('<?xml version="1.0"?><a x="1"><b>one &amp; two</b><b>3</b><c/></a>')).toEqual({
      a: { "@x": "1", b: ["one & two", "3"], c: "" },
    });
    expect(parseXml("<a><b></a>")).toBeUndefined();
  });

  it("parses Rison", () => {
    expect(parseRison("(a:!(1,2.5,-3),b:!t,c:!n,d:'it!'s',e:())")).toEqual({
      a: [1, 2.5, -3],
      b: true,
      c: null,
      d: "it's",
      e: {},
    });
    expect(() => parseRison("(a:1")).toThrow();
  });
});
