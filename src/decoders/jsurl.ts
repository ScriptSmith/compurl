const KEYWORDS: Record<string, unknown> = { true: true, false: false, null: null };

/** Parses JSURL (github.com/Sage/jsurl), as in `~(cols~(~'name~'age)~limit~20)`. */
export function parseJsurl(s: string): unknown {
  let i = 0;
  const fail = (): never => {
    throw new SyntaxError(`Invalid JSURL at ${i}`);
  };
  const eat = (c: string) => {
    if (s[i] !== c) fail();
    i++;
  };

  const decode = (): string => {
    let out = "";
    let beg = i;
    while (i < s.length && s[i] !== "~" && s[i] !== ")") {
      const c = s[i];
      if (c === "*" || c === "!") {
        out += s.slice(beg, i);
        if (c === "!") {
          out += "$";
          i++;
        } else {
          const wide = s[i + 1] === "*";
          const hex = s.slice(i + (wide ? 2 : 1), i + (wide ? 6 : 3));
          if (!/^[0-9a-f]+$/i.test(hex) || hex.length !== (wide ? 4 : 2)) fail();
          out += String.fromCharCode(parseInt(hex, 16));
          i += wide ? 6 : 3;
        }
        beg = i;
      } else i++;
    }
    return out + s.slice(beg, i);
  };

  const value = (): unknown => {
    eat("~");
    const c = s[i];
    if (c === "(") {
      i++;
      if (s[i] === "~") {
        const list: unknown[] = [];
        if (s[i + 1] === ")") i++;
        else
          do list.push(value());
          while (s[i] === "~");
        eat(")");
        return list;
      }
      const o: Record<string, unknown> = {};
      if (s[i] !== ")") {
        do {
          const key = decode();
          o[key] = value();
        } while (s[i] === "~" && ++i);
      }
      eat(")");
      return o;
    }
    if (c === "'") {
      i++;
      return decode();
    }
    const beg = i;
    while (i < s.length && s[i] !== ")" && s[i] !== "~") i++;
    const tok = s.slice(beg, i);
    if (/^-?\d/.test(tok)) {
      const n = Number(tok);
      return Number.isFinite(n) ? n : fail();
    }
    return tok in KEYWORDS ? KEYWORDS[tok] : fail();
  };

  const v = value();
  if (i !== s.length) fail();
  return v;
}

const encode = (s: string) =>
  s.replace(/[^\w.-]/g, (c) => {
    if (c === "$") return "!";
    const code = c.charCodeAt(0);
    return code < 0x100
      ? `*${code.toString(16).padStart(2, "0")}`
      : `**${code.toString(16).padStart(4, "0")}`;
  });

export function stringifyJsurl(v: unknown): string {
  if (v === null || v === undefined) return "~null";
  if (typeof v === "boolean") return `~${v}`;
  if (typeof v === "number")
    return Number.isFinite(v) ? `~${String(v).replace(/\+/g, "")}` : "~null";
  if (typeof v === "string") return `~'${encode(v)}`;
  if (Array.isArray(v)) return `~(${v.map(stringifyJsurl).join("") || "~"})`;
  return `~(${Object.entries(v as Record<string, unknown>)
    .map(([k, x]) => encode(k) + stringifyJsurl(x))
    .join("~")})`;
}
