export interface Token {
  value: string;
  start: number;
  end: number;
  /** Where `value` starts in the raw text, when it appears there verbatim (no quotes or escapes inside). */
  exact?: number;
}

const ANSI: Record<string, string> = {
  n: "\n",
  t: "\t",
  r: "\r",
  a: "\x07",
  b: "\b",
  e: "\x1b",
  E: "\x1b",
  f: "\f",
  v: "\v",
  "\\": "\\",
  "'": "'",
  '"': '"',
  "?": "?",
};

/** Splits a shell command line the way bash would, for the quoting styles browsers emit. */
export function tokenize(s: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < s.length) {
    while (i < s.length) {
      if (/\s/.test(s[i]!)) i++;
      else if ((s[i] === "\\" || s[i] === "^") && /^\r?\n/.test(s.slice(i + 1, i + 3))) {
        i += s[i + 1] === "\r" ? 3 : 2;
      } else break;
    }
    if (i >= s.length) break;
    const start = i;
    let value = "";
    let pieces = 0;
    let verbatim = true;
    let contentStart = i;
    while (i < s.length && !/\s/.test(s[i]!)) {
      pieces++;
      const c = s[i]!;
      if (c === "'") {
        const close = s.indexOf("'", i + 1);
        const end = close < 0 ? s.length : close;
        contentStart = i + 1;
        value += s.slice(i + 1, end);
        i = end + 1;
      } else if (c === "$" && s[i + 1] === "'") {
        verbatim = false;
        i += 2;
        while (i < s.length && s[i] !== "'") {
          if (s[i] === "\\" && i + 1 < s.length) {
            const e = s[i + 1]!;
            const hex = /^x([0-9a-f]{1,2})|^u([0-9a-f]{4})|^U([0-9a-f]{8})|^([0-7]{1,3})/i.exec(
              s.slice(i + 1),
            );
            if (hex) {
              const code =
                hex[4] !== undefined
                  ? parseInt(hex[4], 8)
                  : parseInt(hex[1] ?? hex[2] ?? hex[3]!, 16);
              value += String.fromCodePoint(code);
              i += 1 + hex[0].length;
            } else {
              value += ANSI[e] ?? `\\${e}`;
              i += 2;
            }
          } else value += s[i++];
        }
        i++;
      } else if (c === '"') {
        contentStart = i + 1;
        i++;
        while (i < s.length && s[i] !== '"') {
          if (s[i] === "\\" && /["\\$`\n]/.test(s[i + 1] ?? "")) {
            verbatim = false;
            if (s[i + 1] !== "\n") value += s[i + 1];
            i += 2;
          } else value += s[i++];
        }
        i++;
      } else if (c === "\\" && i + 1 < s.length) {
        verbatim = false;
        value += s[i + 1];
        i += 2;
      } else {
        contentStart = i;
        while (i < s.length && !/[\s'"\\]/.test(s[i]!) && !(s[i] === "$" && s[i + 1] === "'")) {
          value += s[i++];
        }
      }
    }
    const token: Token = { value, start, end: Math.min(i, s.length) };
    if (pieces === 1 && verbatim) token.exact = contentStart;
    tokens.push(token);
  }
  return tokens;
}

const SHORT_WITH_ARG = new Set("XHdFubAeoxUmwTEcrzKyYDCPQt");
const SHORT_FLAGS: Record<string, string> = {
  s: "silent",
  S: "show-error",
  L: "location",
  k: "insecure",
  i: "include",
  I: "head",
  v: "verbose",
  f: "fail",
  G: "get",
  g: "globoff",
  N: "no-buffer",
  O: "remote-name",
  J: "remote-header-name",
  n: "netrc",
  j: "junk-session-cookies",
  l: "list-only",
  a: "append",
  B: "use-ascii",
  M: "manual",
  p: "proxytunnel",
  q: "disable",
  R: "remote-time",
  V: "version",
  Z: "parallel",
  "0": "http1.0",
  "1": "tlsv1",
  "2": "sslv2",
  "3": "sslv3",
  "4": "ipv4",
  "6": "ipv6",
  "#": "progress-bar",
};
const SHORT_NAMES: Record<string, string> = {
  X: "request",
  H: "header",
  d: "data",
  F: "form",
  u: "user",
  b: "cookie",
  A: "user-agent",
  e: "referer",
  o: "output",
  x: "proxy",
  U: "proxy-user",
  m: "max-time",
  w: "write-out",
  T: "upload-file",
  E: "cert",
  c: "cookie-jar",
  r: "range",
  z: "time-cond",
  K: "config",
  y: "speed-time",
  Y: "speed-limit",
  D: "dump-header",
  C: "continue-at",
  P: "ftp-port",
  Q: "quote",
  t: "telnet-option",
};
const LONG_WITH_ARG = new Set([
  ...Object.values(SHORT_NAMES),
  "url",
  "data-raw",
  "data-binary",
  "data-ascii",
  "data-urlencode",
  "json",
  "form-string",
  "connect-timeout",
  "retry",
  "retry-delay",
  "retry-max-time",
  "cacert",
  "capath",
  "key",
  "key-type",
  "cert-type",
  "resolve",
  "connect-to",
  "oauth2-bearer",
  "limit-rate",
  "interface",
  "local-port",
  "trace",
  "trace-ascii",
  "stderr",
  "max-redirs",
  "max-filesize",
  "aws-sigv4",
  "variable",
  "proxy-header",
  "request-target",
  "unix-socket",
  "abstract-unix-socket",
  "dns-servers",
  "doh-url",
  "ciphers",
  "pinnedpubkey",
  "preproxy",
  "socks5",
  "socks5-hostname",
  "noproxy",
  "user-agent",
  "url-query",
  "expect100-timeout",
  "keepalive-time",
  "happy-eyeballs-timeout-ms",
  "output-dir",
  "create-file-mode",
  "hsts",
  "alt-svc",
  "etag-save",
  "etag-compare",
]);

const KNOWN_FLAGS = new Set([
  ...Object.values(SHORT_FLAGS),
  "compressed",
  "compressed-ssh",
  "http1.1",
  "http2",
  "http2-prior-knowledge",
  "http3",
  "http3-only",
  "digest",
  "ntlm",
  "negotiate",
  "basic",
  "anyauth",
  "location-trusted",
  "tcp-nodelay",
  "path-as-is",
  "raw",
  "no-keepalive",
  "fail-with-body",
  "fail-early",
  "tlsv1.0",
  "tlsv1.1",
  "tlsv1.2",
  "tlsv1.3",
  "ssl",
  "ssl-reqd",
  "no-progress-meter",
  "styled-output",
  "no-alpn",
  "no-npn",
  "no-sessionid",
  "post301",
  "post302",
  "post303",
  "proxy-insecure",
  "xattr",
  "create-dirs",
  "ignore-content-length",
  "remote-name-all",
  "skip-existing",
  "suppress-connect-headers",
  "trace-time",
]);

export type DataKind =
  | "data"
  | "data-raw"
  | "data-binary"
  | "data-ascii"
  | "data-urlencode"
  | "json";

export interface Curl {
  url?: Token;
  extraUrls: Token[];
  method?: Token;
  headers: Token[];
  data: { kind: DataKind; token: Token }[];
  form: Token[];
  user?: Token;
  cookies: Token[];
  urlQuery: Token[];
  /** Other options, by long name, with their value token or null for plain flags. */
  options: { name: string; token: Token; value: Token | null }[];
}

const URLISH = /^(?:[a-z][a-z0-9+.-]*:\/\/|[\w.-]+\.[a-z]{2,}(?:[:/?#]|$)|localhost|\[)/i;

/** Reads curl's command-line arguments. Returns null if `tokens` isn't a curl command. */
export function parseCurl(tokens: Token[]): Curl | null {
  if (!tokens.length || !/(?:^|[/\\])curl(?:\.exe)?$/i.test(tokens[0]!.value)) return null;
  const out: Curl = {
    extraUrls: [],
    headers: [],
    data: [],
    form: [],
    cookies: [],
    urlQuery: [],
    options: [],
  };

  const apply = (name: string, flag: Token, value: Token | null) => {
    switch (name) {
      case "request":
        out.method = value!;
        break;
      case "header":
        out.headers.push(value!);
        break;
      case "data":
      case "data-raw":
      case "data-binary":
      case "data-ascii":
      case "data-urlencode":
      case "json":
        out.data.push({ kind: name, token: value! });
        break;
      case "form":
      case "form-string":
        out.form.push(value!);
        break;
      case "user":
        out.user = value!;
        break;
      case "cookie":
        out.cookies.push(value!);
        break;
      case "url-query":
        out.urlQuery.push(value!);
        break;
      case "url":
        if (out.url) out.extraUrls.push(value!);
        else out.url = value!;
        break;
      default:
        out.options.push({ name, token: flag, value });
    }
  };

  for (let i = 1; i < tokens.length; i++) {
    const tok = tokens[i]!;
    const v = tok.value;
    if (v.startsWith("--") && v.length > 2) {
      const eq = v.indexOf("=");
      const name = eq > 0 ? v.slice(2, eq) : v.slice(2);
      if (eq > 0) {
        apply(name, tok, { value: v.slice(eq + 1), start: tok.start, end: tok.end });
        continue;
      }
      const next = tokens[i + 1];
      const takesArg =
        LONG_WITH_ARG.has(name) ||
        (!KNOWN_FLAGS.has(name) &&
          next !== undefined &&
          !next.value.startsWith("-") &&
          !URLISH.test(next.value));
      if (takesArg && next) {
        apply(name, tok, next);
        i++;
      } else apply(name, tok, null);
    } else if (v.startsWith("-") && v.length > 1) {
      for (let j = 1; j < v.length; j++) {
        const c = v[j]!;
        if (SHORT_WITH_ARG.has(c)) {
          const rest = v.slice(j + 1);
          let value: Token | null;
          if (rest) {
            value = { value: rest, start: tok.start, end: tok.end };
            if (tok.exact !== undefined) value.exact = tok.exact + j + 1;
          } else value = tokens[++i] ?? null;
          if (value) apply(SHORT_NAMES[c]!, tok, value);
          break;
        }
        apply(SHORT_FLAGS[c] ?? c, tok, null);
      }
    } else if (out.url) out.extraUrls.push(tok);
    else out.url = tok;
  }
  return out;
}
