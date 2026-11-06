const ID_CHAR = /[^\s'!:(),*@$]/;
const NUMBER = /^-?\d+(?:\.\d+)?(?:e[+-]?\d+)?$/i;

export function parseRison(s: string): unknown {
  let i = 0;
  const fail = (): never => {
    throw new SyntaxError(`Invalid Rison at ${i}`);
  };

  const str = (): string => {
    i++;
    let out = "";
    for (;;) {
      const c = s[i++];
      if (c === undefined) fail();
      if (c === "'") return out;
      if (c === "!") {
        const e = s[i++];
        if (e !== "!" && e !== "'") fail();
        out += e;
      } else out += c;
    }
  };

  const token = (asKey: boolean): string | number => {
    const start = i;
    while (i < s.length && ID_CHAR.test(s[i]!)) i++;
    if (i === start) fail();
    const tok = s.slice(start, i);
    return !asKey && NUMBER.test(tok) ? Number(tok) : tok;
  };

  const list = <T>(item: () => T): T[] => {
    const out: T[] = [];
    if (s[i] === ")") {
      i++;
      return out;
    }
    for (;;) {
      out.push(item());
      const d = s[i++];
      if (d === ")") return out;
      if (d !== ",") fail();
    }
  };

  const value = (): unknown => {
    const c = s[i];
    if (c === "(") {
      i++;
      return Object.fromEntries(
        list(() => {
          const k = s[i] === "'" ? str() : String(token(true));
          if (s[i++] !== ":") fail();
          return [k, value()] as const;
        }),
      );
    }
    if (c === "!") {
      const n = s[i + 1];
      i += 2;
      if (n === "(") return list(value);
      if (n === "t") return true;
      if (n === "f") return false;
      if (n === "n") return null;
      return fail();
    }
    if (c === "'") return str();
    return token(false);
  };

  const v = value();
  if (i !== s.length) fail();
  return v;
}
