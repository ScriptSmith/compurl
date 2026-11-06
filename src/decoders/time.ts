import type { Scalar } from "../tree.ts";

const MIN_MS = Date.UTC(2000, 0, 1);
const MAX_MS = Date.UTC(2100, 0, 1);
const plausible = (ms: number) => ms >= MIN_MS && ms < MAX_MS;

export function formatTime(ms: number): string {
  const iso = new Date(ms).toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 19)}${iso.slice(19, 23) === ".000" ? "" : iso.slice(19, 23)} UTC`;
}

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const X_EPOCH = 1288834974657n;
const DISCORD_EPOCH = 1420070400000n;
const GREGORIAN_OFFSET_MS = 12219292800000;

/** Returns a readable UTC time for values that look like timestamps or time-ordered IDs. */
export function timeNote(v: Scalar): string | undefined {
  if (typeof v === "number") return Number.isFinite(v) ? timeNote(String(v)) : undefined;
  if (typeof v !== "string") return undefined;
  const s = v.trim();

  if (/^\d{10}(?:\.\d{1,6})?$/.test(s)) {
    const ms = Number(s) * 1000;
    return plausible(ms) ? formatTime(ms) : undefined;
  }
  if (/^\d{13}$/.test(s)) {
    const ms = Number(s);
    return plausible(ms) ? formatTime(ms) : undefined;
  }
  if (/^\d{17,19}$/.test(s)) {
    const ticks = BigInt(s) >> 22n;
    const parts = [
      ["X", Number(ticks + X_EPOCH)],
      ["Discord", Number(ticks + DISCORD_EPOCH)],
    ] as const;
    const shown = parts.filter(([, ms]) => plausible(ms) && ms > Date.UTC(2010, 10, 4));
    return shown.length
      ? `Snowflake time: ${shown.map(([n, ms]) => `${formatTime(ms)} if ${n}`).join(", ")}`
      : undefined;
  }

  let m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(s);
  if (m) {
    const [, y, mo, d, h, mi, se] = m.map(Number) as number[];
    return formatTime(Date.UTC(y!, mo! - 1, d!, h!, mi!, se!));
  }
  if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?[+-]\d{2}:?\d{2}$/.test(s)) {
    const ms = Date.parse(s.replace(" ", "T").replace(/([+-]\d{2})(\d{2})$/, "$1:$2"));
    return Number.isNaN(ms) ? undefined : formatTime(ms);
  }

  m = /^([0-9a-f]{8})-([0-9a-f]{4})-([17])([0-9a-f]{3})-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.exec(s);
  if (m) {
    const [, low, mid, version, hi] = m;
    let ms: number;
    if (version === "7") ms = parseInt(low! + mid!, 16);
    else {
      const ticks = (BigInt(`0x${hi}`) << 48n) | (BigInt(`0x${mid}`) << 32n) | BigInt(`0x${low}`);
      ms = Number(ticks / 10000n) - GREGORIAN_OFFSET_MS;
    }
    return plausible(ms) ? `UUIDv${version} time: ${formatTime(ms)}` : undefined;
  }

  if (/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/i.test(s)) {
    let ms = 0;
    for (const c of s.slice(0, 10).toUpperCase()) ms = ms * 32 + CROCKFORD.indexOf(c);
    return plausible(ms) ? `ULID time: ${formatTime(ms)}` : undefined;
  }
  return undefined;
}
