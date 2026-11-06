import { describe, expect, it } from "vite-plus/test";
import { actionsFor, adderFor, keyFor } from "./edit.ts";
import { EXAMPLES } from "./examples.ts";
import { defaultOptions, parseUrl, type Node, type Seg } from "./parse.ts";

const opts = defaultOptions();
const example = (id: string, i = 0) => EXAMPLES.find((e) => e.id === id)!.urls[i]!;
const set = (raw: string, path: Seg[], value: string) => actionsFor(raw, opts, path).apply!(value);
const remove = (raw: string, path: Seg[]) => actionsFor(raw, opts, path).remove!();

function valueAt(raw: string, path: Seg[]): unknown {
  let n: Node | undefined = parseUrl(raw, opts).tree;
  for (const p of path) {
    if (!n || n.t === "leaf") return undefined;
    n = n.t === "obj" ? n.entries.get(String(p)) : n.items[Number(p)];
  }
  return n?.t === "leaf" ? n.v : n;
}

const url = "https://a.test/x/y?q=red+shoes&o.apps=a,b&tr=1&tr=2#top";

describe("editing URLs", () => {
  it("replaces query values, keeping the original's encoding style", () => {
    expect(set(url, ["query", "q"], "blue suede & co")).toBe(
      "https://a.test/x/y?q=blue+suede+%26+co&o.apps=a,b&tr=1&tr=2#top",
    );
    expect(set(url, ["query", "o", "apps"], "a,b,c")).toContain("o.apps=a,b,c&");
  });

  it("edits repeated keys one value per line", () => {
    const a = actionsFor(url, opts, ["query", "tr"]);
    expect(a.current).toBe("1\n2");
    expect(a.multiline).toBe(true);
    expect(a.apply!("1\n3\n4")).toContain("&tr=1&tr=3&tr=4#");
    expect(a.apply!("9")).toBe("https://a.test/x/y?q=red+shoes&o.apps=a,b&tr=9#top");
  });

  it("edits the address, path segments and fragment", () => {
    expect(set(url, ["host"], "b.test")).toBe(url.replace("a.test", "b.test"));
    expect(set(url, ["path"], "/z")).toContain("a.test/z?");
    expect(set(url, ["path", 1], "w w")).toContain("/x/w%20w?");
    expect(set(url, ["fragment"], "bottom")).toMatch(/#bottom$/);
  });

  it("removes parameters and their separators", () => {
    expect(remove(url, ["query", "q"])).toBe("https://a.test/x/y?o.apps=a,b&tr=1&tr=2#top");
    expect(remove(url, ["query", "tr"])).toBe("https://a.test/x/y?q=red+shoes&o.apps=a,b#top");
    expect(remove(url, ["query", "o"])).toBe("https://a.test/x/y?q=red+shoes&tr=1&tr=2#top");
    expect(remove("https://a.test/?only=1#f", ["query", "only"])).toBe("https://a.test/#f");
  });

  it("adds query parameters", () => {
    expect(adderFor(url, opts, "query")!("new key", "a&b")).toContain("&tr=2&new+key=a%26b#top");
    expect(adderFor("https://a.test/p#f", opts, "query")!("k", "v")).toBe("https://a.test/p?k=v#f");
    expect(adderFor("https://a.test/p", opts, "header")).toBeNull();
  });

  it("re-encodes values inside base64 JSON, JWT, Rison and nested URLs", () => {
    const shop = example("shop");
    expect(valueAt(set(shop, ["query", "ctx", "user"], "43"), ["query", "ctx", "user"])).toBe(43);
    const jwt = set(shop, ["query", "token", "payload", "scope"], "admin");
    expect(valueAt(jwt, ["query", "token", "payload", "scope"])).toBe("admin");
    expect(jwt).toContain(".c2lnbmF0dXJlLWE&");
    expect(set(shop, ["query", "_g", "time", "from"], "now-1h")).toContain(
      "_g=(time:(from:now-1h,to:now))",
    );
    expect(set(shop, ["query", "return", "query", "step"], "5")).toContain(
      "return=https%3A%2F%2Fshop.example.com%2Fcart%3Fstep%3D5%26coupon%3DFALL",
    );
    expect(set(shop, ["matrix", "catalog", "view"], "table")).toContain(
      "/catalog;view=table/shoes?",
    );
    expect(set(shop, ["fragment", "query", "page"], "9")).toMatch(/#\/reviews\?page=9$/);
  });

  it("keeps values that were encoded twice encoded twice", () => {
    const oauth = example("oauth");
    const edited = set(oauth, ["query", "continue", "query", "tab"], "usage");
    expect(edited).toContain(
      "continue=https%253A%252F%252Fapp.example.com%252Fhome%253Ftab%253Dusage",
    );
    expect(
      valueAt(set(oauth, ["query", "state", "returnTo"], "/x"), ["query", "state", "returnTo"]),
    ).toBe("/x");
  });

  it("removes keys inside JSON", () => {
    const shop = example("shop");
    const edited = remove(shop, ["query", "ctx", "experiments"]);
    expect(valueAt(edited, ["query", "ctx", "experiments"])).toBeUndefined();
    expect(valueAt(edited, ["query", "ctx", "user"])).toBe(42);
  });

  it("finds the raw key behind a nested row so it can be added elsewhere", () => {
    expect(keyFor(example("shop", 1), opts, ["query", "filter", "color"])).toEqual({
      kind: "query",
      key: "filter[color]",
    });
    expect(keyFor(example("shop"), opts, ["query", "filter", "color"])).toBeNull();
  });
});

describe("editing curl commands", () => {
  const curl = example("curl", 1);
  const first = (s: string) => s.split("\n")[0];

  it("changes the method and URL parts", () => {
    expect(first(set(curl, ["method"], "PUT"))).toBe(
      "curl -X PUT 'https://api.example.com/v2/orders' \\",
    );
    expect(first(set(curl, ["host"], "api2.example.com"))).toBe(
      "curl -X POST https://api2.example.com/v2/orders \\",
    );
    expect(first(set(example("curl"), ["method"], "DELETE"))).toMatch(/^curl -X DELETE 'https/);
  });

  it("edits headers, cookies, tokens and JSON bodies in place", () => {
    expect(valueAt(set(curl, ["body", "qty"], "5"), ["body", "qty"])).toBe(5);
    expect(set(curl, ["headers", "cookie", "theme"], "blue")).toContain(
      "-H 'Cookie: session=abc123; theme=blue'",
    );
    const scope = ["headers", "authorization", "credentials", "payload", "scope"];
    expect(actionsFor(curl, opts, scope).current).toBe("orders:write");
    expect(valueAt(set(curl, scope, "orders:admin"), scope)).toBe("orders:admin");
  });

  it("removes headers and single flags from a cluster", () => {
    const noType = remove(curl, ["headers", "content-type"]);
    expect(noType).not.toContain("Content-Type");
    expect(noType).toContain("'https://api.example.com/v2/orders' \\\n  -H 'Authorization:");
    expect(remove(curl, ["options", "silent"]).split("\n").pop()).toBe("  --compressed -S");
  });

  it("adds headers and query parameters", () => {
    expect(adderFor(curl, opts, "header")!("X-Trace", "abc")).toContain(
      "-H 'Cookie: session=abc123; theme=light' \\\n  -H 'X-Trace: abc' \\",
    );
    expect(first(adderFor(curl, opts, "query")!("page", "2"))).toBe(
      "curl -X POST 'https://api.example.com/v2/orders?page=2' \\",
    );
  });
});
