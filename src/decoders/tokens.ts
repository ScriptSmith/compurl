import { unzlibSync } from "fflate";
import { base64Bytes, base64Text, utf8 } from "./compress.ts";

export interface Decoded {
  via: string;
  value: Record<string, unknown>;
}

function json(text: string | null | undefined): unknown {
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);

const size = (b: Uint8Array | null) => `${b?.length ?? 0} bytes`;

/** JWS (three parts) and JWE (five parts) compact tokens. */
export function jwt(t: string): Decoded | null {
  const parts = t.split(".");
  if ((parts.length !== 3 && parts.length !== 5) || !parts.every((p) => /^[\w-]*$/.test(p))) {
    return null;
  }
  const header = json(base64Text(parts[0]!, 4));
  if (!isRecord(header) || typeof header.alg !== "string") return null;
  if (parts.length === 5) {
    return {
      via: "JWE",
      value: {
        header,
        "encrypted key": size(base64Bytes(parts[1]!, 0)),
        iv: parts[2],
        ciphertext: size(base64Bytes(parts[3]!, 0)),
        tag: parts[4],
      },
    };
  }
  const payload = json(base64Text(parts[1]!, 2));
  if (payload === undefined) return null;
  return { via: "JWT", value: { header, payload, signature: parts[2] } };
}

/** Flask and other itsdangerous tokens: `payload.timestamp.signature`, payload optionally zlib'd. */
export function itsdangerous(t: string): Decoded | null {
  const m = /^(\.?)([\w-]+)(?:\.([\w-]{4,8}))?\.([\w-]{20,})$/.exec(t);
  if (!m) return null;
  const [, compressed, body, stamp, signature] = m;
  let bytes = base64Bytes(body!, 2);
  if (!bytes) return null;
  if (compressed) {
    try {
      bytes = unzlibSync(bytes);
    } catch {
      return null;
    }
  }
  const payload = json(utf8(bytes));
  if (payload === undefined || (!isRecord(payload) && !Array.isArray(payload))) return null;
  const value: Record<string, unknown> = { payload };
  if (stamp) {
    const sb = base64Bytes(stamp, 4);
    if (!sb) return null;
    value.timestamp = sb.reduce((n, b) => n * 256 + b, 0);
  }
  value.signature = signature;
  return { via: compressed ? "itsdangerous (zlib)" : "itsdangerous", value };
}

function railsPayload(text: string): unknown {
  const v = json(text);
  if (!isRecord(v) || !isRecord(v._rails)) return v;
  const env = v._rails;
  const inner = typeof env.message === "string" ? base64Text(env.message, 2) : null;
  const message = inner ? (json(inner) ?? inner) : env.data;
  return { message, expires: env.exp ?? null, purpose: env.pur ?? null };
}

/** Rails MessageVerifier (`data--digest`) and MessageEncryptor (`data--iv--tag`) output. */
export function rails(t: string): Decoded | null {
  let m = /^([A-Za-z0-9+/=_-]{8,})--([0-9a-f]{40}|[0-9a-f]{64})$/.exec(t);
  if (m) {
    const bytes = base64Bytes(m[1]!);
    if (!bytes) return null;
    const marshal = bytes[0] === 4 && bytes[1] === 8;
    const text = marshal ? null : utf8(bytes);
    const data = marshal ? `Ruby Marshal data, ${size(bytes)}` : text && railsPayload(text);
    if (data === undefined || data === null) return null;
    return { via: "Rails signed message", value: { data, digest: m[2] } };
  }
  m = /^([A-Za-z0-9+/]+={0,2})--([A-Za-z0-9+/]+={0,2})--([A-Za-z0-9+/]+={0,2})$/.exec(t);
  if (m) {
    const [ct, iv, tag] = m.slice(1).map((p) => base64Bytes(p!, 4));
    if (!ct || !iv || !tag || iv.length !== 12 || tag.length !== 16) return null;
    return {
      via: "Rails encrypted message",
      value: { ciphertext: size(ct), iv: m[2], "auth tag": m[3] },
    };
  }
  return null;
}

const SIGNATURE_BYTES: Record<string, number> = { v1: 256, v2: 64, v3: 96, v4: 64 };

/** PASETO tokens, such as `v4.public.<payload>.<footer>`. */
export function paseto(t: string): Decoded | null {
  const m = /^(v[1-4])\.(local|public)\.([\w-]+)(?:\.([\w-]+))?$/.exec(t);
  if (!m) return null;
  const [, version, purpose, body, footer] = m;
  const bytes = base64Bytes(body!, 4);
  if (!bytes) return null;
  const value: Record<string, unknown> = { version, purpose };
  if (purpose === "public") {
    const sig = SIGNATURE_BYTES[version!]!;
    const claims = json(utf8(bytes.subarray(0, Math.max(0, bytes.length - sig))));
    if (claims === undefined) return null;
    value.claims = claims;
    value.signature = `${sig} bytes`;
  } else value.payload = `encrypted, ${size(bytes)}`;
  if (footer) {
    const text = base64Text(footer, 2);
    value.footer = json(text) ?? text ?? footer;
  }
  return { via: "PASETO", value };
}
