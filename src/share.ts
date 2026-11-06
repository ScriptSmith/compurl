import { DECODERS, type DecoderId } from "./parse.ts";

export interface Shared {
  urls: string[];
  /** Options switched away from their defaults. */
  off: DecoderId[];
  on: DecoderId[];
  only: boolean;
}

const PREFIX = "#s=";

function toBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(s: string): Uint8Array {
  const b = s.replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(b + "=".repeat((4 - (b.length % 4)) % 4)), (c) => c.charCodeAt(0));
}

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream) {
  const body = new Blob([bytes as Uint8Array<ArrayBuffer>]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(body).arrayBuffer());
}

export async function encodeShare(s: Shared): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify(s));
  return PREFIX + toBase64Url(await pipe(json, new CompressionStream("deflate-raw")));
}

export async function decodeShare(hash: string): Promise<Shared | null> {
  if (!hash.startsWith(PREFIX)) return null;
  try {
    const bytes = await pipe(
      fromBase64Url(hash.slice(PREFIX.length)),
      new DecompressionStream("deflate-raw"),
    );
    const v: unknown = JSON.parse(new TextDecoder().decode(bytes));
    return sanitize(v);
  } catch {
    return null;
  }
}

const IDS = new Set<string>(DECODERS.map((d) => d.id));

export function sanitize(v: unknown): Shared | null {
  if (v === null || typeof v !== "object") return null;
  const r = v as Record<string, unknown>;
  if (!Array.isArray(r.urls)) return null;
  const urls = r.urls.filter((u): u is string => typeof u === "string").slice(0, 6);
  const ids = (v: unknown) =>
    Array.isArray(v) ? v.filter((d): d is DecoderId => typeof d === "string" && IDS.has(d)) : [];
  return { urls: urls.length ? urls : [""], off: ids(r.off), on: ids(r.on), only: r.only === true };
}
