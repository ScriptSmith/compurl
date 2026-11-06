import { describe, expect, it } from "vite-plus/test";
import { EXAMPLES } from "./examples.ts";
import { formatCommand, isMultiline } from "./format.ts";

const example = (id: string, i = 0) => EXAMPLES.find((e) => e.id === id)!.urls[i]!;

describe("formatCommand", () => {
  it("puts each option on its own line and back", () => {
    const curl = example("curl");
    const flat = formatCommand(curl, false)!;
    expect(flat).not.toContain("\n");
    expect(flat).toMatch(
      /^curl 'https:\/\/api\.example\.com\/v2\/orders\?status=open&limit=50' -H/,
    );
    expect(formatCommand(flat, true)).toBe(curl);
  });

  it("keeps the program and its leading words together, and everything after --", () => {
    expect(formatCommand("kubectl exec -it pod -n prod -- sh -c 'echo hi' | tee out", true)).toBe(
      "kubectl exec \\\n  -it \\\n  pod \\\n  -n prod \\\n  -- sh -c 'echo hi' | tee out",
    );
    expect(formatCommand("FOO=1 node app.js --port=3000", true)).toBe(
      "FOO=1 \\\n  node app.js \\\n  --port=3000",
    );
  });

  it("keeps Windows line continuations", () => {
    expect(formatCommand('curl "https://a.test" ^\n  -H "A: 1" ^\n  -k', false)).toBe(
      'curl "https://a.test" -H "A: 1" -k',
    );
    expect(formatCommand('curl "https://a.test" ^\n  -H "A: 1" -k', true)).toBe(
      'curl "https://a.test" ^\n  -H "A: 1" ^\n  -k',
    );
  });

  it("ignores text that isn't a command", () => {
    expect(formatCommand("https://a.test/?a=1&b=2", true)).toBeNull();
  });
});

describe("isMultiline", () => {
  it("looks only at the space between arguments", () => {
    expect(isMultiline(example("curl"))).toBe(true);
    expect(isMultiline(`curl https://a.test -d '{\n  "a": 1\n}'`)).toBe(false);
  });
});
