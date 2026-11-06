import { arr, leaf, obj, type Node, type Obj } from "../tree.ts";
import { formatTime, timeNote } from "./time.ts";

const AZURE_PERMISSIONS: Record<string, string> = {
  r: "read",
  a: "add",
  c: "create",
  w: "write",
  d: "delete",
  x: "delete version",
  y: "permanent delete",
  l: "list",
  t: "tags",
  f: "filter",
  m: "move",
  e: "execute",
  o: "ownership",
  p: "permissions",
  i: "immutability policy",
  u: "update",
};
const AZURE_RESOURCES: Record<string, string> = {
  b: "blob",
  c: "container",
  d: "directory",
  f: "file",
  s: "share",
  bs: "blob snapshot",
  bv: "blob version",
};
const AZURE_SERVICES: Record<string, string> = { b: "blob", f: "file", q: "queue", t: "table" };
const AZURE_TYPES: Record<string, string> = { s: "service", c: "container", o: "object" };

const text = (n: Node | undefined) => (n?.t === "leaf" && typeof n.v === "string" ? n.v : null);
const letters = (s: string, names: Record<string, string>) =>
  s
    .split("")
    .map((c) => names[c] ?? c)
    .join(", ");

function find(q: Obj, name: string): [string, Node] | undefined {
  for (const entry of q.entries) if (entry[0].toLowerCase() === name) return entry;
  return undefined;
}

function note(q: Obj, name: string, fn: (v: string) => string | undefined) {
  const found = find(q, name);
  const v = text(found?.[1]);
  if (found && v !== null) {
    const n = fn(v);
    if (n) (found[1] as { note?: string }).note = n;
  }
}

function sigV4(q: Obj, prefix: "x-amz" | "x-goog", who: string) {
  const cred = find(q, `${prefix}-credential`);
  const credText = text(cred?.[1]);
  if (!cred || credText === null) return;
  const parts = credText.split("/");
  if (parts.length === 5) {
    const scope = obj("credential scope");
    ["", "date", "region", "service", "request type"].forEach((name, i) =>
      scope.entries.set(name || who, leaf(parts[i]!)),
    );
    q.entries.set(cred[0], scope);
  }
  const headers = find(q, `${prefix}-signedheaders`);
  const headerText = text(headers?.[1]);
  if (headers && headerText !== null) {
    q.entries.set(
      headers[0],
      arr(
        headerText.split(";").map((h) => leaf(h)),
        "signed headers",
      ),
    );
  }
  const date = text(find(q, `${prefix}-date`)?.[1]);
  const start =
    date && timeNote(date)
      ? Date.parse(
          date.replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/, "$1-$2-$3T$4:$5:$6Z"),
        )
      : NaN;
  note(q, `${prefix}-date`, timeNote);
  note(q, `${prefix}-expires`, (v) =>
    Number.isNaN(start) || !/^\d+$/.test(v)
      ? undefined
      : `expires ${formatTime(start + Number(v) * 1000)}`,
  );
}

/** Annotates the signing parameters of AWS, Google Cloud Storage and Azure SAS URLs. */
export function annotateSigned(q: Obj) {
  sigV4(q, "x-amz", "access key");
  sigV4(q, "x-goog", "service account");
  if (find(q, "awsaccesskeyid") || find(q, "googleaccessid")) {
    note(q, "expires", (v) =>
      /^\d+$/.test(v) ? `expires ${formatTime(Number(v) * 1000)}` : undefined,
    );
  }
  if (find(q, "sig") && find(q, "sv")) {
    note(q, "sp", (v) => letters(v, AZURE_PERMISSIONS));
    note(q, "sr", (v) => AZURE_RESOURCES[v]);
    note(q, "ss", (v) => letters(v, AZURE_SERVICES));
    note(q, "srt", (v) => letters(v, AZURE_TYPES));
    note(q, "se", (v) => {
      const ms = Date.parse(v);
      return Number.isNaN(ms) ? undefined : `expires ${formatTime(ms)}`;
    });
    note(q, "st", (v) => {
      const ms = Date.parse(v);
      return Number.isNaN(ms) ? undefined : `valid from ${formatTime(ms)}`;
    });
  }
}
