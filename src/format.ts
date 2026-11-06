import { parseCommand, splitAtOperator } from "./decoders/command.ts";
import { parseCurl, tokenize, type Token } from "./decoders/curl.ts";

/**
 * Splits a command into the pieces that each get their own line: the program with any words
 * before the first option, then each option with its value, then each other argument.
 */
function pieces(s: string): { pieces: Token[][]; rest: Token[] } | null {
  const { tokens, rest } = splitAtOperator(tokenize(s));
  const curl = parseCurl(tokens);
  if (curl) {
    const out: Token[][] = [[tokens[0]!]];
    let head = true;
    for (const t of tokens.slice(1)) {
      if (curl.flags.has(t)) out[out.length - 1]!.push(t);
      else if (head && !t.value.startsWith("-")) out[0]!.push(t);
      else {
        head = false;
        out.push([t]);
      }
    }
    return { pieces: out, rest };
  }
  const c = parseCommand(s);
  if (!c) return null;
  const out = [...c.env.map((t) => [t]), [c.program]];
  let head = true;
  let ended = false;
  for (const a of c.args) {
    const last = out[out.length - 1]!;
    if (a.kind === "positional") {
      if (head || ended) last.push(a.token);
      else out.push([a.token]);
      ended ||= a.token.value === "--";
      continue;
    }
    head = false;
    out.push(a.value && a.attached === undefined ? [a.flag, a.value] : [a.flag]);
  }
  return { pieces: out, rest: c.rest };
}

/** Whether a command's arguments are spread over more than one line. */
export function isMultiline(raw: string): boolean {
  const tokens = tokenize(raw);
  return tokens.some((t, i) => i > 0 && raw.slice(tokens[i - 1]!.end, t.start).includes("\n"));
}

/**
 * Rewrites a command with each option and argument on its own line, or with everything on one
 * line. Quoting is kept as written. Returns null when `raw` isn't a command.
 */
export function formatCommand(raw: string, multiline: boolean): string | null {
  const s = raw.trim();
  const p = pieces(s);
  if (!p) return null;
  const text = (ts: Token[]) => ts.map((t) => s.slice(t.start, t.end)).join(" ");
  const caret = /\^\r?\n/.test(s) && !/\\\r?\n/.test(s);
  const sep = multiline ? (caret ? " ^\n  " : " \\\n  ") : " ";
  const body = p.pieces.map(text).join(sep);
  return p.rest.length ? `${body} ${text(p.rest)}` : body;
}
