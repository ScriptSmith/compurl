const UNRESERVED = /[A-Za-z0-9\-_.~]/;

function pct(c: string): string {
  return encodeURIComponent(c).replace(
    /[!'()*]/g,
    (x) => `%${x.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

export interface Style {
  /** Characters that must always be encoded in this position. */
  reserved: string;
  /** How to write a space when the original gives no hint. */
  space: "+" | "%20";
}

/**
 * Percent-encodes decoded text for one position in a URL, keeping the style of `original` (the raw
 * text being replaced): characters it left literal stay literal, and spaces are written the same way.
 */
export function encodeLike(text: string, original: string, style: Style): string {
  const space = style.space === "+" && !original.includes("%20") ? "+" : "%20";
  let out = "";
  for (const c of text) {
    if (c === " ") out += space;
    else if (UNRESERVED.test(c)) out += c;
    else if (c === "%" || style.reserved.includes(c) || /\s/.test(c)) out += pct(c);
    else if (c.charCodeAt(0) < 128 && original.includes(c)) out += c;
    else out += pct(c);
  }
  return out;
}

export const QUERY: Style = { reserved: "&#+%=", space: "+" };
export const QUERY_VALUE: Style = { reserved: "&#+%", space: "+" };
export const SEGMENT: Style = { reserved: "/?#%;", space: "%20" };
export const FRAGMENT: Style = { reserved: "#%", space: "%20" };
export const USERINFO: Style = { reserved: "@:/?#%", space: "%20" };
export const MATRIX: Style = { reserved: ";/?#%=", space: "%20" };
export const INTENT: Style = { reserved: ";#%=", space: "%20" };

/** Encodes raw, mostly-unencoded text such as a whole path: only characters that can't appear. */
export function encodeRaw(text: string, extra = ""): string {
  let out = "";
  for (const c of text) {
    out += /\s/.test(c) || extra.includes(c) || c.charCodeAt(0) > 126 ? pct(c) : c;
  }
  return out;
}

/** Quotes a string for a POSIX shell, using single quotes unless it needs none. */
export function shellQuote(s: string): string {
  if (/^[\w@%+=:,./-]+$/.test(s)) return s;
  return `'${s.replace(/'/g, "'\\''")}'`;
}

/** Quotes a string for a POSIX shell the way `original`, the shell word it replaces, was quoted. */
export function quoteLike(s: string, original: string): string {
  if (original.startsWith("'") && !s.includes("'")) return `'${s}'`;
  if (original.startsWith('"') && !/["\\$`]/.test(s)) return `"${s}"`;
  return shellQuote(s);
}
