import { tokenize, type Token } from "./curl.ts";

export type Arg =
  | {
      kind: "option";
      name: string;
      flag: Token;
      /** The option's value, or null when it is a switch. */
      value: Token | null;
      /** Text before a value written inside the flag itself, such as `--name=` or `-D`. */
      attached?: string;
    }
  | { kind: "positional"; token: Token };

export interface Command {
  /** The tokens of this command, up to any control operator. */
  tokens: Token[];
  /** `NAME=value` assignments before the program. */
  env: Token[];
  program: Token;
  args: Arg[];
  /** A control operator such as `|` or `&&`, and every token after it. */
  rest: Token[];
}

const OPERATOR = /^(?:\|\|?|\|&|&&?|;)$/;
const ASSIGNMENT = /^[A-Za-z_]\w*=/;
const PROGRAM = /^[\p{L}\p{N}_.~/\\+@%:-]+$/u;
const NUMBER = /^-?\d+(?:\.\d+)?$/;
const VALUE_LIKE = /^-?\d|[=\s]/;

/** Long options that are almost always switches, so the argument after them is never their value. */
const SWITCHES = new Set([
  "all",
  "amend",
  "build",
  "debug",
  "detach",
  "dry-run",
  "follow",
  "force",
  "force-recreate",
  "global",
  "help",
  "init",
  "insecure",
  "interactive",
  "privileged",
  "prune",
  "pull",
  "quiet",
  "read-only",
  "rebase",
  "recursive",
  "remove-orphans",
  "rm",
  "silent",
  "stdin",
  "tty",
  "verbose",
  "version",
  "wait",
  "watch",
  "yes",
]);

/** Single-dash options of a few letters that take a value even when it looks like a plain word. */
const SHORT_WITH_VALUE = new Set(["-cp", "-jar"]);

/** Splits tokens at the first unquoted control operator such as `|`, `&&` or `;`. */
export function splitAtOperator(tokens: Token[]): { tokens: Token[]; rest: Token[] } {
  const i = tokens.findIndex((t) => t.exact === t.start && OPERATOR.test(t.value));
  return i < 0 ? { tokens, rest: [] } : { tokens: tokens.slice(0, i), rest: tokens.slice(i) };
}

/** Guesses whether `name` takes `next` as its value, since the program's own options are unknown. */
function takesValue(name: string, next: Token): boolean {
  const n = next.value;
  if (n === "--" || (n.startsWith("-") && n !== "-" && !NUMBER.test(n))) return false;
  if (name.startsWith("--")) return !name.startsWith("--no-") && !SWITCHES.has(name.slice(2));
  if (SHORT_WITH_VALUE.has(name)) return true;
  if (/\d/.test(name)) return false;
  if (/^-[A-Za-z]{2,3}$/.test(name)) return VALUE_LIKE.test(n);
  return true;
}

/** Reads a shell command whose options aren't known. Returns null when `s` doesn't look like one. */
export function parseCommand(s: string): Command | null {
  const { tokens, rest } = splitAtOperator(tokenize(s));
  let i = 0;
  const env: Token[] = [];
  while (i < tokens.length && ASSIGNMENT.test(s.slice(tokens[i]!.start, tokens[i]!.end))) {
    env.push(tokens[i++]!);
  }
  const program = tokens[i++];
  if (!program || tokens.length + rest.length < 2) return null;
  if (!PROGRAM.test(program.value) || program.value.includes("://")) return null;

  const args: Arg[] = [];
  let ended = false;
  for (; i < tokens.length; i++) {
    const t = tokens[i]!;
    const v = t.value;
    if (ended || v === "-" || !v.startsWith("-")) {
      args.push({ kind: "positional", token: t });
      continue;
    }
    if (v === "--") {
      ended = true;
      args.push({ kind: "positional", token: t });
      continue;
    }
    const eq = v.indexOf("=");
    const define = /^-D[^-=]/.test(v);
    if (define || eq > (v.startsWith("--") ? 2 : 1)) {
      const attached = define ? "-D" : v.slice(0, eq + 1);
      const name = define ? "-D" : v.slice(0, eq);
      const value = { value: v.slice(attached.length), start: t.start, end: t.end };
      args.push({ kind: "option", name, flag: t, value, attached });
      continue;
    }
    const next = tokens[i + 1];
    const value = next && takesValue(v, next) ? next : null;
    args.push({ kind: "option", name: v, flag: t, value });
    if (value) i++;
  }
  return { tokens, env, program, args, rest };
}
