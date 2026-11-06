import { put } from "../tree.ts";
import { utf8 } from "./compress.ts";

class Reader {
  pos = 0;
  readonly bytes: Uint8Array;
  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
  }
  get done() {
    return this.pos >= this.bytes.length;
  }
  varint(): bigint | null {
    let result = 0n;
    for (let shift = 0n; shift < 70n; shift += 7n) {
      if (this.done) return null;
      const b = this.bytes[this.pos++]!;
      result |= BigInt(b & 0x7f) << shift;
      if (!(b & 0x80)) return result;
    }
    return null;
  }
  take(n: number): Uint8Array | null {
    if (this.pos + n > this.bytes.length) return null;
    const out = this.bytes.subarray(this.pos, this.pos + n);
    this.pos += n;
    return out;
  }
}

const num = (n: bigint): number | string =>
  n <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(n) : n.toString();

const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, "0")).join("");

function le(b: Uint8Array): bigint {
  let n = 0n;
  for (let i = b.length - 1; i >= 0; i--) n = (n << 8n) | BigInt(b[i]!);
  return n;
}

/**
 * Decodes protobuf wire format without a schema. Fields are keyed `#<number>`. Length-delimited
 * fields become text, nested messages or hex, in that order of preference.
 */
export function decodeProtobuf(bytes: Uint8Array, depth = 0): Record<string, unknown> | null {
  if (depth > 12) return null;
  const r = new Reader(bytes);
  const out: Record<string, unknown> = {};
  let fields = 0;
  while (!r.done) {
    const tag = r.varint();
    if (tag === null) return null;
    const field = Number(tag >> 3n);
    const wire = Number(tag & 7n);
    if (field < 1 || field > 536870911) return null;
    let value: unknown;
    if (wire === 0) {
      const v = r.varint();
      if (v === null) return null;
      value = num(v);
    } else if (wire === 1 || wire === 5) {
      const b = r.take(wire === 1 ? 8 : 4);
      if (!b) return null;
      value = num(le(b));
    } else if (wire === 2) {
      const len = r.varint();
      if (len === null || len > BigInt(bytes.length)) return null;
      const b = r.take(Number(len));
      if (!b) return null;
      const text = b.length ? utf8(b) : "";
      value = text ?? decodeProtobuf(b, depth + 1) ?? `0x${hex(b)}`;
    } else return null;
    put(out, `#${field}`, value);
    fields++;
  }
  return fields ? out : null;
}

/** Stricter entry point for values in URLs, where random tokens must not be misread. */
export function protobufFromBytes(bytes: Uint8Array): Record<string, unknown> | null {
  if (bytes.length < 6) return null;
  const msg = decodeProtobuf(bytes);
  if (!msg) return null;
  const top = Object.values(msg).reduce<number>((n, v) => n + (Array.isArray(v) ? v.length : 1), 0);
  return top >= 2 ? msg : null;
}
