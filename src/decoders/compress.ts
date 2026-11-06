import { gunzipSync, inflateSync, unzlibSync } from "fflate";

function hasControlChars(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c < 9 || (c > 13 && c < 32) || c === 127 || c === 0xfffd) return true;
  }
  return false;
}

/** Decodes bytes as UTF-8, or returns null when they aren't clean text. */
export function utf8(bytes: Uint8Array): string | null {
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return hasControlChars(text) ? null : text;
  } catch {
    return null;
  }
}

/** Decodes standard or URL-safe base64 into bytes. */
export function base64Bytes(t: string, min = 8): Uint8Array | null {
  let b = t.replace(/ /g, "+");
  if (b.length < min || !/^[A-Za-z0-9+/_-]+={0,2}$/.test(b)) return null;
  b = b.replace(/-/g, "+").replace(/_/g, "/").replace(/=+$/, "");
  if (b.length % 4 === 1) return null;
  while (b.length % 4) b += "=";
  try {
    return Uint8Array.from(atob(b), (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

export function base64Text(t: string, min = 8): string | null {
  const bytes = base64Bytes(t, min);
  return bytes && utf8(bytes);
}

export interface Inflated {
  text: string;
  kind: "gzip" | "zlib" | "deflate";
}

/** Tries gzip, zlib and raw deflate, keeping the result only if it is clean UTF-8 text. */
export function inflateText(bytes: Uint8Array): Inflated | null {
  const attempt = (kind: Inflated["kind"], fn: (b: Uint8Array) => Uint8Array) => {
    try {
      const text = utf8(fn(bytes));
      return text ? { text, kind } : null;
    } catch {
      return null;
    }
  };
  if (bytes.length < 4) return null;
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) return attempt("gzip", gunzipSync);
  const zlib = (bytes[0]! & 0x0f) === 8 && ((bytes[0]! << 8) | bytes[1]!) % 31 === 0;
  return (zlib && attempt("zlib", unzlibSync)) || attempt("deflate", inflateSync);
}

const URI_SAFE = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+-$";
const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";
const MAX_OUTPUT = 1_000_000;

/** The decompression half of lz-string (pieroxy/lz-string), for its URI-safe and base64 forms. */
function lzDecompress(input: string, alphabet: string): string | null {
  const values = new Map<string, number>();
  for (let i = 0; i < alphabet.length; i++) values.set(alphabet[i]!, i);
  const length = input.length;
  const next = (i: number) => (i < length ? (values.get(input[i]!) ?? -1) : 0);
  for (const c of input) if (!values.has(c)) return null;

  const dictionary: string[] = ["", "", ""];
  let enlargeIn = 4;
  let dictSize = 4;
  let numBits = 3;
  let val = next(0);
  let position = 32;
  let index = 1;

  const read = (n: number) => {
    let bits = 0;
    for (let p = 0; p < n; p++) {
      const resb = val & position;
      position >>= 1;
      if (position === 0) {
        position = 32;
        val = next(index++);
      }
      if (resb > 0) bits |= 1 << p;
    }
    return bits;
  };

  let c: string;
  switch (read(2)) {
    case 0:
      c = String.fromCharCode(read(8));
      break;
    case 1:
      c = String.fromCharCode(read(16));
      break;
    default:
      return "";
  }
  dictionary[3] = c;
  let w = c;
  const result = [c];
  let size = c.length;

  for (;;) {
    if (index > length) return null;
    let code = read(numBits);
    if (code === 0 || code === 1) {
      dictionary[dictSize++] = String.fromCharCode(read(code === 0 ? 8 : 16));
      code = dictSize - 1;
      enlargeIn--;
    } else if (code === 2) {
      return result.join("");
    }
    if (enlargeIn === 0) {
      enlargeIn = 2 ** numBits;
      numBits++;
    }
    let entry: string;
    if (code < dictSize && dictionary[code] !== undefined && code > 2) entry = dictionary[code]!;
    else if (code === dictSize) entry = w + w.charAt(0);
    else return null;
    result.push(entry);
    size += entry.length;
    if (size > MAX_OUTPUT) return null;
    dictionary[dictSize++] = w + entry.charAt(0);
    enlargeIn--;
    w = entry;
    if (enlargeIn === 0) {
      enlargeIn = 2 ** numBits;
      numBits++;
    }
  }
}

/** Decompresses lz-string output, keeping it only when it is printable text. */
export function lzText(t: string): string | null {
  if (t.length < 16) return null;
  const s = t.replace(/ /g, "+");
  const out = /^[A-Za-z0-9+$-]+$/.test(s)
    ? lzDecompress(s, URI_SAFE)
    : /^[A-Za-z0-9+/]+=*$/.test(s)
      ? lzDecompress(s, BASE64)
      : null;
  if (!out || hasControlChars(out)) return null;
  let ascii = 0;
  for (let i = 0; i < out.length; i++) if (out.charCodeAt(i) < 127) ascii++;
  return ascii / out.length >= 0.95 ? out : null;
}
