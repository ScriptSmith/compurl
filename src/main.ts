import "./style.css";
import {
  charDiff,
  compare,
  label,
  pathKey,
  type Comparison,
  type Range,
  type Row,
} from "./diff.ts";
import { EXAMPLE } from "./example.ts";
import {
  DECODERS,
  defaultOptions,
  parseUrl,
  type Arr,
  type DecoderId,
  type Leaf,
  type Node,
  type Parsed,
  type Seg,
  type Span,
} from "./parse.ts";
import { decodeShare, encodeShare, sanitize, type Shared } from "./share.ts";

const LETTERS = "ABCDEF";
const MAX_URLS = LETTERS.length;
const DRAFT_KEY = "compurl:draft";

interface Column {
  input: number;
  letter: string;
  parsed: Parsed;
}

const state = {
  urls: ["", ""],
  opts: defaultOptions(),
  only: false,
  collapsed: new Set<string>(),
};
let columns: Column[] = [];
let cmp: Comparison | null = null;

const $ = <T extends Element>(sel: string) => document.querySelector<T>(sel)!;
const urlList = $<HTMLDivElement>("#urls");
const addBtn = $<HTMLButtonElement>("#add");
const decoderList = $<HTMLDivElement>("#decoders");
const decoderHelp = $<HTMLDListElement>("#decoder-help");
const results = $<HTMLElement>("#results");
const toastEl = $<HTMLDivElement>("#toast");

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const idVar = (input: number) => `--id: var(--id-${input})`;
const offList = () => DECODERS.filter((d) => !state.opts[d.id]).map((d) => d.id);

function renderDecoders() {
  decoderList.innerHTML = DECODERS.map(
    (d) =>
      `<label class="opt" title="${esc(d.example)}"><input type="checkbox" data-id="${d.id}"${
        state.opts[d.id] ? " checked" : ""
      }><span>${esc(d.label)}</span></label>`,
  ).join("");
  decoderHelp.innerHTML = DECODERS.map(
    (d) => `<dt>${esc(d.label)}</dt><dd>${esc(d.example)}</dd>`,
  ).join("");
}

function renderInputs(focus?: number) {
  urlList.innerHTML = state.urls
    .map((_, i) => {
      const L = LETTERS[i]!;
      const hint = i === 0 ? "https://example.com/page?param=value" : "Paste a URL to compare";
      return `<div class="url" style="${idVar(i)}">
        <label class="tag" for="u${i}">${L}</label>
        <div class="field">
          <pre class="mirror" aria-hidden="true"></pre>
          <textarea id="u${i}" data-i="${i}" rows="1" spellcheck="false" autocapitalize="off" autocomplete="off" placeholder="${hint}" aria-label="URL ${L}"></textarea>
        </div>
        <button type="button" class="remove" data-i="${i}" aria-label="Remove URL ${L}" title="Remove URL ${L}"></button>
      </div>`;
    })
    .join("");
  urlList.querySelectorAll("textarea").forEach((ta, i) => {
    ta.value = state.urls[i] ?? "";
  });
  addBtn.disabled = state.urls.length >= MAX_URLS;
  if (focus !== undefined) urlList.querySelectorAll("textarea")[focus]?.focus();
}

function update() {
  columns = state.urls.flatMap((u, i) =>
    u.trim() ? [{ input: i, letter: LETTERS[i]!, parsed: parseUrl(u, state.opts) }] : [],
  );
  cmp = columns.length ? compare(columns.map((c) => c.parsed.tree)) : null;
  renderMirrors();
  renderResults();
  saveDraft();
}

let pending = 0;
function schedule() {
  if (!pending) {
    pending = requestAnimationFrame(() => {
      pending = 0;
      update();
    });
  }
}

const hasItem = (n: Node | undefined, v: Leaf["v"]) =>
  n?.t === "arr" ? n.items.some((i) => i.t === "leaf" && i.v === v) : n?.t === "leaf" && n.v === v;

function mirrorHtml(text: string, spans: Span[], index: Comparison["index"]): string {
  let out = "";
  let pos = 0;
  for (const s of [...spans].sort((a, b) => a.start - b.start)) {
    if (s.start < pos) continue;
    const key = pathKey(s.path);
    const row = index.get(key);
    const shared =
      row?.compact && s.item !== undefined && row.cells.every((c) => hasItem(c, s.item!));
    const st = shared ? "same" : (row?.status ?? "same");
    const raw = text.slice(s.start, s.end);
    let body = esc(raw);
    if (st === "diff") {
      body =
        s.valueStart === undefined
          ? `<mark>${esc(raw)}</mark>`
          : esc(text.slice(s.start, s.valueStart)) +
            `<mark>${esc(text.slice(s.valueStart, s.end))}</mark>`;
    }
    out += `${esc(text.slice(pos, s.start))}<span class="tok t-${st}" data-k="${esc(key)}">${body}</span>`;
    pos = s.end;
  }
  return out + esc(text.slice(pos)) + " ";
}

function renderMirrors() {
  const pres = urlList.querySelectorAll<HTMLPreElement>(".mirror");
  pres.forEach((pre, i) => {
    const text = state.urls[i] ?? "";
    const col = columns.find((c) => c.input === i);
    pre.innerHTML =
      col && cmp && columns.length > 1
        ? mirrorHtml(text, col.parsed.spans, cmp.index)
        : esc(text) + " ";
  });
  hot = null;
}

function marked(s: string, ranges: Range[]): string {
  let out = "";
  let pos = 0;
  for (const [a, b] of ranges) {
    out += `${esc(s.slice(pos, a))}<mark>${esc(s.slice(a, b))}</mark>`;
    pos = b;
  }
  return out + esc(s.slice(pos));
}

const stringOf = (n: Node | undefined) => (n?.t === "leaf" && typeof n.v === "string" ? n.v : null);

function inlineRanges(r: Row, j: number): Range[] {
  if (r.status !== "diff" || columns.length < 2) return [];
  const mine = stringOf(r.cells[j]);
  const base = r.cells.findIndex((c) => stringOf(c) !== null);
  if (mine === null || base < 0) return [];
  if (base !== j) return charDiff(stringOf(r.cells[base])!, mine)?.b ?? [];
  const other = r.cells.length === 2 ? stringOf(r.cells[1 - j]) : null;
  return other === null ? [] : (charDiff(mine, other)?.a ?? []);
}

const viaTag = (via?: string) =>
  via && via !== "query" ? ` <span class="via">${esc(via)}</span>` : "";
const scalarText = (v: Leaf["v"]) =>
  v === "" ? `<span class="empty">empty</span>` : esc(typeof v === "string" ? v : String(v));

function leafHtml(c: Leaf, r: Row, j: number): string {
  const note = c.note ? ` <span class="note">${esc(c.note)}</span>` : "";
  if (typeof c.v !== "string" || c.v === "") {
    return `<span class="${c.v === "" ? "" : "lit"}">${scalarText(c.v)}</span>${note}`;
  }
  return marked(c.v, inlineRanges(r, j)) + note;
}

function listHtml(c: Arr, r: Row, j: number): string {
  const values = (n: Node | undefined) =>
    new Set(
      n?.t === "arr"
        ? n.items.map((i) => (i.t === "leaf" ? i.v : null))
        : [n?.t === "leaf" ? n.v : null],
    );
  const others = r.cells.filter((x, i) => i !== j && x).map(values);
  const flag = r.status !== "same" && columns.length > 1;
  const chips = c.items
    .map((i) => {
      const v = i.t === "leaf" ? i.v : null;
      const odd = flag && others.some((s) => !s.has(v));
      return `<span class="chip${odd ? " odd" : ""}">${scalarText(v)}</span>`;
    })
    .join("");
  return `<span class="list">${chips || '<span class="empty">no items</span>'}</span>${viaTag(c.via)}`;
}

function cellHtml(c: Node, r: Row, j: number): string {
  if (c.t === "leaf") return leafHtml(c, r, j);
  if (r.compact && c.t === "arr") return listHtml(c, r, j);
  const count = c.t === "obj" ? c.entries.size : c.items.length;
  const params = c.via === "query" || c.via === "hash params" || c.via === "query string";
  const noun = c.t === "arr" ? "item" : params ? "parameter" : "key";
  return `<span class="count">${plural(count, noun)}</span>${viaTag(c.via)}`;
}

function rowHtml(r: Row, n: number): string {
  const st = n > 1 ? r.status : "solo";
  const full = r.path.map(label).join(" › ");
  const k = esc(r.key);
  const open = !state.collapsed.has(r.key);
  const twisty = r.children.length
    ? `<button type="button" class="twisty" data-k="${k}" aria-expanded="${open}" aria-label="${open ? "Collapse" : "Expand"} ${esc(full)}"></button>`
    : "";
  const part = `<th scope="row" class="part" title="${esc(full)}">${twisty}<span class="key">${esc(label(r.path[r.path.length - 1]!))}</span></th>`;
  const cells =
    st === "same"
      ? `<td class="shared" colspan="${n}" data-col="All"><div>${cellHtml(r.cells[0]!, r, 0)}</div></td>`
      : r.cells
          .map((c, j) => {
            const col = columns[j]!;
            const attrs = `data-col="${col.letter}" style="${idVar(col.input)}"`;
            return c
              ? `<td ${attrs}><div>${cellHtml(c, r, j)}</div></td>`
              : `<td ${attrs} class="absent"><div>not present</div></td>`;
          })
          .join("");
  return `<tr class="s-${st}${r.children.length ? " branch" : ""}" style="--depth:${r.depth}" data-k="${k}">${part}${cells}</tr>`;
}

function collect(rows: Row[], out: string[], n: number) {
  for (const r of rows) {
    if (state.only && n > 1 && r.status === "same") continue;
    out.push(rowHtml(r, n));
    if (r.children.length && !state.collapsed.has(r.key)) collect(r.children, out, n);
  }
}

function summaryHtml(c: Comparison, n: number): string {
  if (n === 1) {
    return `<div class="summary"><p class="tally">Showing how URL ${columns[0]!.letter} decodes. Add another URL to compare.</p></div>`;
  }
  const { same, diff, partial } = c.counts;
  return `<div class="summary">
    <p class="tally" aria-live="polite">${plural(same + diff + partial, "value")} compared:
      <span class="count-diff">${diff} different</span>,
      <span class="count-partial">${partial} missing from some URLs</span>,
      <span class="count-same">${same} identical</span>.</p>
    <label class="switch"><input type="checkbox" id="only"${state.only ? " checked" : ""}><span>Only show differences</span></label>
  </div>`;
}

function renderResults() {
  if (!cmp) {
    results.innerHTML = `<p class="empty-state">Paste a URL above to see its parts, or load the example. Add a second URL to compare them.</p>`;
    return;
  }
  const n = columns.length;
  const rows: string[] = [];
  collect(cmp.rows, rows, n);
  if (!rows.length) {
    rows.push(
      `<tr style="--depth:0"><td class="none" colspan="${n + 1}">These URLs are identical after decoding.</td></tr>`,
    );
  }
  const heads = columns
    .map(
      (c) => `<th scope="col" style="${idVar(c.input)}"><span class="tag">${c.letter}</span></th>`,
    )
    .join("");
  results.innerHTML = `${summaryHtml(cmp, n)}
    <div class="table-wrap"><table class="grid">
      <colgroup><col class="part-col">${columns.map(() => "<col>").join("")}</colgroup>
      <thead><tr><th scope="col">Part</th>${heads}</tr></thead>
      <tbody>${rows.join("")}</tbody>
    </table></div>`;
}

let hot: string | null = null;
function setHot(k: string | null) {
  if (k === hot) return;
  hot = k;
  urlList.querySelectorAll(".tok.hot").forEach((el) => el.classList.remove("hot"));
  if (!k) return;
  const p = JSON.parse(k) as Seg[];
  urlList.querySelectorAll<HTMLElement>(".tok").forEach((el) => {
    const q = JSON.parse(el.dataset.k!) as Seg[];
    const len = Math.min(p.length, q.length);
    if (p.slice(0, len).every((s, i) => s === q[i])) el.classList.add("hot");
  });
}

let toastTimer = 0;
function toast(msg: string) {
  toastEl.textContent = msg;
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    toastEl.hidden = true;
  }, 3500);
}

function saveDraft() {
  try {
    const draft: Shared = { urls: state.urls, off: offList(), only: state.only };
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  } catch {
    // Storage can be unavailable in private windows; the draft is a convenience.
  }
}

function loadDraft(): Shared | null {
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY);
    return raw ? sanitize(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

function apply(s: Shared) {
  state.urls = [...s.urls];
  while (state.urls.length < 2) state.urls.push("");
  state.opts = defaultOptions();
  for (const id of s.off) state.opts[id] = false;
  state.only = s.only;
  state.collapsed.clear();
  renderDecoders();
  renderInputs();
  update();
}

urlList.addEventListener("input", (e) => {
  const ta = e.target;
  if (!(ta instanceof HTMLTextAreaElement)) return;
  state.urls[Number(ta.dataset.i)] = ta.value;
  const pre = ta.previousElementSibling;
  if (pre) pre.textContent = ta.value + " ";
  schedule();
});

const URLISH = /^(?:[a-z][a-z0-9+.-]*:|[/?])\S*$/i;

urlList.addEventListener("paste", (e) => {
  const ta = e.target;
  if (!(ta instanceof HTMLTextAreaElement)) return;
  const lines = (e.clipboardData?.getData("text/plain") ?? "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 2 || !lines.every((l) => URLISH.test(l))) return;
  e.preventDefault();
  const start = Number(ta.dataset.i);
  const fit = lines.slice(0, MAX_URLS - start);
  fit.forEach((l, j) => {
    state.urls[start + j] = l;
  });
  renderInputs(start + fit.length - 1);
  update();
  if (fit.length < lines.length)
    toast(`Pasted ${fit.length} of ${lines.length} URLs. compurl compares up to ${MAX_URLS}.`);
  else toast(`Pasted ${plural(fit.length, "URL")} into separate fields.`);
});

urlList.addEventListener("click", (e) => {
  const btn = (e.target as Element).closest<HTMLButtonElement>(".remove");
  if (!btn) return;
  const i = Number(btn.dataset.i);
  if (state.urls.length > 1) state.urls.splice(i, 1);
  else state.urls[0] = "";
  renderInputs(Math.min(i, state.urls.length - 1));
  update();
});

addBtn.addEventListener("click", () => {
  if (state.urls.length >= MAX_URLS) return;
  state.urls.push("");
  renderInputs(state.urls.length - 1);
  update();
});

$("#example").addEventListener("click", () => {
  state.urls = [...EXAMPLE];
  state.collapsed.clear();
  renderInputs();
  update();
});

$("#share").addEventListener("click", async () => {
  const hash = await encodeShare({ urls: state.urls, off: offList(), only: state.only });
  history.replaceState(null, "", hash);
  try {
    await navigator.clipboard.writeText(location.href);
    toast("Link copied. Anyone who opens it can read the URLs it contains.");
  } catch {
    toast("Couldn't copy to the clipboard. The link is in the address bar.");
  }
});

decoderList.addEventListener("change", (e) => {
  const input = e.target as HTMLInputElement;
  state.opts[input.dataset.id as DecoderId] = input.checked;
  update();
});

results.addEventListener("click", (e) => {
  const btn = (e.target as Element).closest<HTMLButtonElement>(".twisty");
  if (!btn) return;
  const k = btn.dataset.k!;
  if (state.collapsed.has(k)) state.collapsed.delete(k);
  else state.collapsed.add(k);
  renderResults();
  results.querySelector<HTMLButtonElement>(`.twisty[data-k="${CSS.escape(k)}"]`)?.focus();
});

results.addEventListener("change", (e) => {
  const input = e.target as HTMLInputElement;
  if (input.id !== "only") return;
  state.only = input.checked;
  renderResults();
  saveDraft();
  $<HTMLInputElement>("#only").focus();
});

results.addEventListener("mouseover", (e) => {
  setHot((e.target as Element).closest<HTMLElement>("tr[data-k]")?.dataset.k ?? null);
});
results.addEventListener("mouseleave", () => setHot(null));

window.addEventListener("hashchange", async () => {
  const s = await decodeShare(location.hash);
  if (s) apply(s);
});

async function init() {
  const shared = (await decodeShare(location.hash)) ?? loadDraft();
  if (shared) apply(shared);
  else {
    renderDecoders();
    renderInputs();
    update();
  }
}

void init();
