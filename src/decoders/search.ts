import { put } from "../tree.ts";

const TOKEN = /(-?[A-Za-z_][\w.-]*):(?!\/\/)("[^"]*"|[^\s"]+)|"([^"]*)"|(\S+)/g;
const SEARCH_KEYS = /^(?:q|query|search|s|filter|jql)$/i;

/**
 * Splits search syntax such as `is:pr is:open label:"bug fix" crash` into qualifiers and the
 * remaining free-text terms. Returns null when there are no qualifiers.
 */
export function parseSearch(t: string, key?: string): Record<string, unknown> | null {
  const out: Record<string, unknown> = {};
  const terms: string[] = [];
  let tokens = 0;
  let qualifiers = 0;
  for (const m of t.matchAll(TOKEN)) {
    tokens++;
    if (m[1] !== undefined) {
      qualifiers++;
      put(out, m[1], m[2]!.replace(/^"(.*)"$/, "$1"));
    } else terms.push(m[3] ?? m[4]!);
  }
  if (!qualifiers || (tokens < 2 && !(key && SEARCH_KEYS.test(key)))) return null;
  if (terms.length) out.terms = terms.join(" ");
  return out;
}
