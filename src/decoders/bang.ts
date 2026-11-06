import { put } from "../tree.ts";
import { base64Text } from "./compress.ts";

const TOKEN = /^(\d+)([a-z])(.*)$/s;
const INTEGER = new Set(["i", "j", "u", "e", "x", "y", "v"]);

function decodePct(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

function scalar(type: string, raw: string): unknown {
  if (type === "s") return decodePct(raw);
  if (type === "z") return base64Text(raw, 2) ?? raw;
  if (type === "b") return raw === "1" || raw === "true";
  if (type === "d" || type === "f" || INTEGER.has(type)) {
    const n = Number(raw);
    if (!Number.isFinite(n) || raw === "") throw new SyntaxError("bad number");
    return INTEGER.has(type) && !Number.isSafeInteger(n) ? raw : n;
  }
  return decodePct(raw);
}

/**
 * Parses the `!`-separated protobuf notation in Google Maps URLs, such as
 * `!3m1!4b1!4m5!3m4!1s0x0:0x0!8m2!3d-33.8!4d151.2`. Each token is a field number, a type letter
 * and a value; `m` tokens give the number of following tokens that belong to that message.
 */
export function parseBang(s: string): Record<string, unknown> | null {
  if (!/^!\d+[a-z]/.test(s)) return null;
  const tokens = s.slice(1).split("!");
  let i = 0;
  const message = (end: number): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    while (i < end) {
      const m = TOKEN.exec(tokens[i++]!);
      if (!m) throw new SyntaxError("bad token");
      const [, field, type, raw] = m;
      if (type === "m") {
        const count = Number(raw);
        if (!Number.isInteger(count) || i + count > end) throw new SyntaxError("bad count");
        put(out, `#${field}`, message(i + count));
      } else put(out, `#${field}`, scalar(type!, raw!));
    }
    return out;
  };
  try {
    return message(tokens.length);
  } catch {
    return null;
  }
}

const UNITS: Record<string, string> = {
  z: "zoom",
  m: "altitude (m)",
  a: "a",
  y: "field of view",
  h: "heading",
  t: "tilt",
};

/** Parses a Maps viewport segment such as `@-33.8568,151.2153,15z` or `@x,y,3a,75y,90h,95t`. */
export function parseViewport(seg: string): Record<string, unknown> | null {
  const m = /^@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)((?:,-?\d+(?:\.\d+)?[a-z])*)$/.exec(seg);
  if (!m) return null;
  const out: Record<string, unknown> = { lat: Number(m[1]), lng: Number(m[2]) };
  for (const part of m[3]!.split(",").filter(Boolean)) {
    const unit = part.slice(-1);
    out[UNITS[unit] ?? unit] = Number(part.slice(0, -1));
  }
  return out;
}
