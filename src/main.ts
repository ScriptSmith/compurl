import "./style.css";
import {
  charDiff,
  compare,
  itemKey,
  label,
  pathKey,
  type Comparison,
  type Range,
  type Row,
} from "./diff.ts";
import { actionsFor, adderFor, keyFor, type Actions, type AddKind } from "./edit.ts";
import { shellQuote } from "./encode.ts";
import { EXAMPLES } from "./examples.ts";
import { formatCommand, isMultiline } from "./format.ts";
import {
  defaultOptions,
  GROUPS,
  OPTIONS,
  parseUrl,
  toPlain,
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

/** The row being edited, or the row for adding a parameter. */
let editing: { kind: "row"; key: string; focus?: number } | { kind: "add" } | null = null;
/** What each column's editor can do, filled in when the edit row renders. */
let session = new Map<number, Actions & { add?: (value: string) => string }>();

const ICON_COPY =
  '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="5.5" y="5.5" width="8" height="8" rx="1.5"/><path d="M10.5 5.5v-2a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2"/></svg>';
const ICON_EDIT =
  '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10.5 3 13 5.5 6 12.5l-3.25.75L3.5 10z"/></svg>';
const ICON_LINES =
  '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 3.5h11M5.5 8h8M5.5 12.5h8"/></svg>';

const ADD_KINDS: Record<AddKind, { label: string; only: string }> = {
  query: {
    label: "Query parameter",
    only: "Query parameters can only be added to URLs and curl commands",
  },
  header: { label: "Header", only: "Headers can only be added to curl commands" },
  option: { label: "Option", only: "Options can only be added to commands other than curl" },
  env: { label: "Environment variable", only: "Variables can only be added to commands" },
};

const $ = <T extends Element>(sel: string) => document.querySelector<T>(sel)!;
const urlList = $<HTMLDivElement>("#urls");
const addBtn = $<HTMLButtonElement>("#add");
const decoderList = $<HTMLDivElement>("#decoders");
const rulesPanel = $<HTMLDetailsElement>("#rules");
const rulesCount = $<HTMLSpanElement>("#rules-count");
const exampleSelect = $<HTMLSelectElement>("#example");
const decoderHelp = $<HTMLDListElement>("#decoder-help");
const results = $<HTMLElement>("#results");
const copyMenu = $<HTMLDivElement>("#copy-menu");
const toastEl = $<HTMLDivElement>("#toast");

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const idVar = (input: number) => `--id: var(--id-${input})`;
const changed = () => ({
  off: OPTIONS.filter((o) => o.on && !state.opts[o.id]).map((o) => o.id),
  on: OPTIONS.filter((o) => !o.on && state.opts[o.id]).map((o) => o.id),
});

function renderRulesCount() {
  const { off, on } = changed();
  const parts = [
    on.length && `${on.length} turned on`,
    off.length && `${off.length} turned off`,
  ].filter(Boolean);
  rulesCount.textContent = parts.length ? `${parts.join(", ")} from the defaults` : "Defaults";
}

function renderDecoders() {
  decoderList.innerHTML = GROUPS.map(
    (g) => `<div class="rule-group" role="group" aria-label="${esc(g.label)}">
      <span class="rule-group-label">${esc(g.label)}</span>
      <div class="rule-chips">${g.options
        .map(
          (o) =>
            `<label class="opt" title="${esc(o.example)}"><input type="checkbox" data-id="${o.id}"${
              state.opts[o.id] ? " checked" : ""
            }><span>${esc(o.label)}</span></label>`,
        )
        .join("")}</div>
    </div>`,
  ).join("");
  decoderHelp.innerHTML = OPTIONS.map(
    (o) => `<dt>${esc(o.label)}</dt><dd>${esc(o.example)}</dd>`,
  ).join("");
  renderRulesCount();
}

function renderInputs(focus?: number) {
  urlList.innerHTML = state.urls
    .map((_, i) => {
      const L = LETTERS[i]!;
      const hint =
        i === 0
          ? "Paste a URL, a curl command or another shell command"
          : "Paste another to compare, or leave empty";
      return `<div class="url" style="${idVar(i)}">
        <label class="tag" for="u${i}">${L}</label>
        <div class="field">
          <pre class="mirror" aria-hidden="true"></pre>
          <textarea id="u${i}" data-i="${i}" rows="1" spellcheck="false" autocapitalize="off" autocomplete="off" placeholder="${hint}" aria-label="URL ${L}"></textarea>
        </div>
        <div class="url-actions">
          <button type="button" class="icon-btn remove" data-i="${i}" aria-label="Remove ${L}" title="Remove ${L}"></button>
          <button type="button" class="icon-btn copy-open" data-i="${i}" aria-haspopup="menu" aria-expanded="false" aria-label="Copy ${L}" title="Copy ${L}">${ICON_COPY}</button>
          <button type="button" class="icon-btn format" data-i="${i}" hidden>${ICON_LINES}</button>
        </div>
      </div>`;
    })
    .join("");
  urlList.querySelectorAll("textarea").forEach((ta, i) => {
    ta.value = state.urls[i] ?? "";
  });
  addBtn.disabled = state.urls.length >= MAX_URLS;
  if (focus !== undefined) urlList.querySelectorAll("textarea")[focus]?.focus();
}

/** Shows the line-layout button for commands, labelled with what it will do. */
function renderFormatButtons() {
  urlList.querySelectorAll<HTMLButtonElement>(".format").forEach((btn) => {
    const i = Number(btn.dataset.i);
    const raw = state.urls[i] ?? "";
    const command = columns.some((c) => c.input === i && c.parsed.kind !== "url");
    const multiline = isMultiline(raw);
    const next = command ? formatCommand(raw, !multiline) : null;
    btn.hidden = next === null || next === raw.trim();
    const label = multiline
      ? `Put ${LETTERS[i]} on one line`
      : `Put each option in ${LETTERS[i]} on its own line`;
    btn.setAttribute("aria-label", label);
    btn.title = label;
  });
}

function update() {
  columns = state.urls.flatMap((u, i) =>
    u.trim() ? [{ input: i, letter: LETTERS[i]!, parsed: parseUrl(u, state.opts) }] : [],
  );
  cmp = columns.length
    ? compare(
        columns.map((c) => c.parsed.tree),
        state.opts,
      )
    : null;
  renderMirrors();
  renderFormatButtons();
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

const itemKeys = (n: Node | undefined) =>
  new Set(
    n?.t === "arr"
      ? n.items.map((i) => (i.t === "leaf" ? itemKey(i.v, state.opts) : ""))
      : [n?.t === "leaf" ? itemKey(n.v, state.opts) : ""],
  );

function mirrorHtml(
  text: string,
  spans: Span[],
  index: Comparison["index"],
  solo: boolean,
): string {
  let out = "";
  let pos = 0;
  for (const s of spans) {
    if (s.hidden || s.start < pos) continue;
    const key = pathKey(s.path);
    const row = index.get(key);
    const shared =
      row?.compact &&
      s.item !== undefined &&
      row.cells.every((c) => itemKeys(c).has(itemKey(s.item!, state.opts)));
    const st = solo ? "solo" : shared ? "same" : (row?.status ?? "same");
    const raw = text.slice(s.start, s.end);
    let body = esc(raw);
    if (st === "solo" && s.valueStart !== undefined) {
      body = `<span class="k">${esc(text.slice(s.start, s.valueStart))}</span>${esc(text.slice(s.valueStart, s.end))}`;
    } else if (st === "diff") {
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
    const solo = columns.length === 1;
    pre.classList.toggle("solo", !!col && solo);
    pre.innerHTML =
      col && cmp ? mirrorHtml(text, col.parsed.spans, cmp.index, solo) : esc(text) + " ";
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

const viaTag = (via: string | undefined, r: Row) =>
  via && via !== "query" && via !== r.path[r.path.length - 1]
    ? ` <span class="via">${esc(via)}</span>`
    : "";
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
  const others = r.cells.filter((x, i) => i !== j && x).map(itemKeys);
  const flag = r.status !== "same" && columns.length > 1;
  const chips = c.items
    .map((i) => {
      const v = i.t === "leaf" ? i.v : null;
      const odd =
        flag && others.some((s) => !s.has(i.t === "leaf" ? itemKey(i.v, state.opts) : ""));
      return `<span class="chip${odd ? " odd" : ""}">${scalarText(v)}</span>`;
    })
    .join("");
  return `<span class="list">${chips || '<span class="empty">no items</span>'}</span>${viaTag(c.via, r)}`;
}

function cellHtml(c: Node, r: Row, j: number): string {
  if (c.t === "leaf") return leafHtml(c, r, j);
  if (r.compact && c.t === "arr") return listHtml(c, r, j);
  const count = c.t === "obj" ? c.entries.size : c.items.length;
  const params = c.via === "query" || c.via === "hash params" || c.via === "query string";
  const noun = c.t === "arr" ? "item" : params ? "parameter" : "key";
  return `<span class="count">${plural(count, noun)}</span>${viaTag(c.via, r)}`;
}

function cellInput(j: number, value: string, multiline: boolean, placeholder: string): string {
  const rows = Math.min(12, Math.max(1, value.split("\n").length));
  return `<textarea class="cell-input" data-j="${j}" rows="${rows}" spellcheck="false"${
    multiline ? ' data-multiline="1"' : ""
  } placeholder="${esc(placeholder)}" aria-label="${esc(placeholder)}">${esc(value)}</textarea>`;
}

const editButtons = `<div class="edit-buttons">
    <button type="button" class="save-edit">Save</button>
    <button type="button" class="cancel-edit">Cancel</button>
  </div>`;

function editRowHtml(r: Row): string {
  session = new Map();
  const full = r.path.map(label).join(" › ");
  const addKey =
    columns.map((c) => keyFor(state.urls[c.input]!, state.opts, r.path)).find(Boolean) ?? null;
  let multiline = false;
  const cells = columns.map((col, j) => {
    const raw = state.urls[col.input]!;
    const a = actionsFor(raw, state.opts, r.path);
    let body: string;
    if (a.apply) {
      session.set(j, a);
      multiline ||= !!a.multiline;
      body = cellInput(j, a.current ?? "", !!a.multiline, `Value in ${col.letter}`);
    } else if (!r.cells[j] && addKey) {
      const add = adderFor(raw, state.opts, addKey.kind);
      if (add) {
        session.set(j, { add: (v) => add(addKey.key, (addKey.prefix ?? "") + v) });
        body = addKey.flag
          ? `<button type="button" class="add-flag" data-j="${j}">Add ${esc(addKey.key)} to ${col.letter}</button>`
          : cellInput(j, "", false, `Add to ${col.letter}`);
      } else body = `<p class="cant">Can't add this to ${col.letter}.</p>`;
    } else {
      if (a.remove) session.set(j, a);
      body = `<p class="cant">${r.cells[j] ? "This value can't be edited directly." : "Not present."}</p>`;
    }
    const remove = a.remove
      ? `<button type="button" class="link remove-value" data-j="${j}">Remove from ${col.letter}</button>`
      : "";
    return `<td data-col="${col.letter}" style="${idVar(col.input)}" class="editing"><div class="edit-cell">${body}${remove}</div></td>`;
  });
  const hint = multiline
    ? "Ctrl+Enter to save, one value per line"
    : "Enter to save, Esc to cancel";
  return `<tr class="edit-row" style="--depth:${r.depth}" data-k="${esc(r.key)}">
    <th scope="row" class="part" title="${esc(full)}"><span class="key">${esc(label(r.path[r.path.length - 1]!))}</span>${editButtons}<p class="edit-hint">${hint}</p></th>
    ${cells.join("")}</tr>`;
}

/** What can be added to the current inputs, most common first. */
function addKinds(): AddKind[] {
  const kinds = new Set<AddKind>();
  for (const c of columns) {
    if (c.parsed.kind === "command") kinds.add("option").add("env");
    else kinds.add("query");
    if (c.parsed.kind === "curl") kinds.add("header");
  }
  return (Object.keys(ADD_KINDS) as AddKind[]).filter((k) => kinds.has(k));
}

function addRowHtml(): string {
  session = new Map();
  const kinds = addKinds();
  const kind =
    kinds.length > 1
      ? `<select class="add-kind" aria-label="What to add">${kinds
          .map((k) => `<option value="${k}">${ADD_KINDS[k].label}</option>`)
          .join("")}</select>`
      : "";
  const hint = kinds.includes("option")
    ? "Enter to save, Esc to cancel. Leave every value empty to add an option with no value."
    : "Enter to save, Esc to cancel";
  const cells = columns
    .map(
      (col, j) =>
        `<td data-col="${col.letter}" style="${idVar(col.input)}" class="editing"><div class="edit-cell">${cellInput(
          j,
          "",
          false,
          `Value for ${col.letter}, or leave empty`,
        )}</div></td>`,
    )
    .join("");
  return `<tr class="edit-row add-row" style="--depth:0" data-kind="${kinds[0]}">
    <th scope="row" class="part"><input class="add-key" type="text" placeholder="Name" aria-label="Name" spellcheck="false">${kind}${editButtons}<p class="edit-hint">${hint}</p></th>
    ${cells}</tr>`;
}

function rowHtml(r: Row, n: number): string {
  if (editing?.kind === "row" && editing.key === r.key) return editRowHtml(r);
  const st = n > 1 ? r.status : "solo";
  const full = r.path.map(label).join(" › ");
  const k = esc(r.key);
  const open = !state.collapsed.has(r.key);
  const twisty = r.children.length
    ? `<button type="button" class="twisty" data-k="${k}" aria-expanded="${open}" aria-label="${open ? "Collapse" : "Expand"} ${esc(full)}"></button>`
    : "";
  const edit = `<button type="button" class="icon-btn row-edit" data-k="${k}" aria-label="Edit ${esc(full)}" title="Edit">${ICON_EDIT}</button>`;
  const part = `<th scope="row" class="part" title="${esc(full)}">${twisty}<span class="key">${esc(label(r.path[r.path.length - 1]!))}</span>${edit}</th>`;
  const copy = `<button type="button" class="icon-btn cell-copy" aria-label="Copy value" title="Copy value">${ICON_COPY}</button>`;
  const cells =
    st === "same"
      ? `<td class="shared" colspan="${n}" data-col="All" data-j="0"><div>${cellHtml(r.cells[0]!, r, 0)}</div>${copy}</td>`
      : r.cells
          .map((c, j) => {
            const col = columns[j]!;
            const attrs = `data-col="${col.letter}" data-j="${j}" style="${idVar(col.input)}"`;
            return c
              ? `<td ${attrs}><div>${cellHtml(c, r, j)}</div>${copy}</td>`
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
    const col = columns[0]!;
    const what = { url: "URL", curl: "curl command", command: "command" }[col.parsed.kind];
    const total = c.counts.same + c.counts.diff + c.counts.partial;
    return `<div class="summary"><p class="tally">${plural(total, "value")} decoded from ${what} ${col.letter}. Paste another into a second field to compare them.</p>
      <div class="summary-actions"><button type="button" class="add-param">Add parameter</button></div></div>`;
  }
  const { same, diff, partial } = c.counts;
  return `<div class="summary">
    <p class="tally" aria-live="polite">${plural(same + diff + partial, "value")} compared:
      <span class="count-diff">${diff} different</span>,
      <span class="count-partial">${partial} missing from some URLs</span>,
      <span class="count-same">${same} identical</span>.</p>
    <div class="summary-actions">
      <button type="button" class="add-param">Add parameter</button>
      <label class="switch"><input type="checkbox" id="only"${state.only ? " checked" : ""}><span>Only show differences</span></label>
    </div>
  </div>`;
}

function renderResults() {
  if (!cmp) {
    results.innerHTML = `<p class="empty-state">Paste a URL or curl command above to see its parts, or pick an example. Fill a second field to compare them.</p>`;
    return;
  }
  const n = columns.length;
  if (editing?.kind === "row" && !cmp.index.has(editing.key)) editing = null;
  const rows: string[] = editing?.kind === "add" ? [addRowHtml()] : [];
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
  if (editing) {
    const focus = editing.kind === "row" ? editing.focus : undefined;
    const target =
      editing.kind === "add"
        ? results.querySelector<HTMLElement>(".add-key")
        : (results.querySelector<HTMLElement>(`.cell-input[data-j="${focus ?? ""}"]`) ??
          results.querySelector<HTMLElement>(".edit-row .cell-input, .edit-row button"));
    target?.focus();
  }
}

function setUrls(next: string[]) {
  state.urls = next;
  renderInputs();
  update();
}

function saveEdit() {
  if (!editing) return;
  const next = [...state.urls];
  const inputs = results.querySelectorAll<HTMLTextAreaElement>(".edit-row .cell-input");
  try {
    if (editing.kind === "add") {
      const name = results.querySelector<HTMLInputElement>(".add-key")!.value.trim();
      const kind = (results.querySelector<HTMLSelectElement>(".add-kind")?.value ??
        results.querySelector<HTMLElement>(".add-row")!.dataset.kind) as AddKind;
      const filled = [...inputs].filter((ta) => ta.value !== "");
      if (!name) return toast("Enter a name first.");
      const flag = kind === "option" && !filled.length;
      if (!filled.length && !flag) return toast("Enter a value for at least one input.");
      const skipped: string[] = [];
      for (const ta of flag ? inputs : filled) {
        const col = columns[Number(ta.dataset.j)]!;
        const add = adderFor(next[col.input]!, state.opts, kind);
        if (add) next[col.input] = add(name, ta.value);
        else skipped.push(col.letter);
      }
      if (skipped.length) toast(`${ADD_KINDS[kind].only}. Skipped ${skipped.join(", ")}.`);
    } else {
      for (const ta of inputs) {
        const j = Number(ta.dataset.j);
        const col = columns[j]!;
        const s = session.get(j);
        if (s?.apply && ta.value !== s.current) next[col.input] = s.apply(ta.value);
        else if (s?.add && ta.value !== "") next[col.input] = s.add(ta.value);
      }
    }
  } catch (e) {
    toast(`Couldn't save that: ${(e as Error).message}`);
    return;
  }
  editing = null;
  setUrls(next);
}

function cancelEdit() {
  const key = editing?.kind === "row" ? editing.key : null;
  editing = null;
  renderResults();
  if (key) results.querySelector<HTMLElement>(`.row-edit[data-k="${CSS.escape(key)}"]`)?.focus();
}

async function copyText(text: string, done: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast(done);
  } catch {
    toast("Couldn't copy to the clipboard.");
  }
}

let menuButton: HTMLButtonElement | null = null;

function closeCopyMenu(refocus = false) {
  if (copyMenu.hidden) return;
  copyMenu.hidden = true;
  menuButton?.setAttribute("aria-expanded", "false");
  if (refocus) menuButton?.focus();
  menuButton = null;
}

function openCopyMenu(button: HTMLButtonElement) {
  const i = Number(button.dataset.i);
  const col = columns.find((c) => c.input === i);
  if (!col) return toast("Nothing to copy yet.");
  const { kind } = col.parsed;
  const items: [string, string][] = [["text", kind === "url" ? "Copy URL" : "Copy command"]];
  if (kind === "curl" && col.parsed.url) items.push(["url", "Copy its URL"]);
  if (kind === "url") items.push(["curl", "Copy as curl command"]);
  items.push(["json", "Copy decoded parts as JSON"]);
  copyMenu.innerHTML = items
    .map(
      ([id, text]) =>
        `<button type="button" role="menuitem" data-copy="${id}" data-i="${i}">${text}</button>`,
    )
    .join("");
  copyMenu.hidden = false;
  const r = button.getBoundingClientRect();
  const width = copyMenu.offsetWidth;
  copyMenu.style.top = `${r.bottom + window.scrollY + 4}px`;
  copyMenu.style.left = `${Math.max(16, Math.min(r.right - width, document.documentElement.clientWidth - width - 16)) + window.scrollX}px`;
  button.setAttribute("aria-expanded", "true");
  menuButton = button;
  copyMenu.querySelector<HTMLButtonElement>("button")?.focus();
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
    const draft: Shared = { urls: state.urls, ...changed(), only: state.only };
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
  for (const id of s.on) state.opts[id] = true;
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
  editing = null;
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
  const open = (e.target as Element).closest<HTMLButtonElement>(".copy-open");
  if (open) {
    if (menuButton === open) closeCopyMenu();
    else {
      closeCopyMenu();
      openCopyMenu(open);
    }
    return;
  }
  const format = (e.target as Element).closest<HTMLButtonElement>(".format");
  if (format) {
    const i = Number(format.dataset.i);
    const raw = state.urls[i] ?? "";
    const next = formatCommand(raw, !isMultiline(raw));
    if (next === null) return;
    state.urls[i] = next;
    editing = null;
    renderInputs();
    update();
    urlList.querySelector<HTMLButtonElement>(`.format[data-i="${i}"]`)?.focus();
    return;
  }
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

exampleSelect.insertAdjacentHTML(
  "beforeend",
  EXAMPLES.map((e) => `<option value="${e.id}">${esc(e.label)}</option>`).join(""),
);
exampleSelect.addEventListener("change", () => {
  const example = EXAMPLES.find((e) => e.id === exampleSelect.value);
  exampleSelect.value = "";
  if (!example) return;
  state.urls = [...example.urls];
  state.collapsed.clear();
  renderInputs();
  update();
});

$("#share").addEventListener("click", async () => {
  const hash = await encodeShare({ urls: state.urls, ...changed(), only: state.only });
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
  renderRulesCount();
  update();
});

const RULES_KEY = "compurl:rules-open";
try {
  const saved = localStorage.getItem(RULES_KEY);
  if (saved === "false" || (saved === null && matchMedia("(max-width: 640px)").matches)) {
    rulesPanel.open = false;
  }
} catch {
  // Remembering the panel state is optional.
}
rulesPanel.addEventListener("toggle", () => {
  try {
    localStorage.setItem(RULES_KEY, String(rulesPanel.open));
  } catch {
    // Remembering the panel state is optional.
  }
});

results.addEventListener("click", (e) => {
  const target = e.target as Element;
  if (target.closest(".save-edit")) return saveEdit();
  if (target.closest(".cancel-edit")) return cancelEdit();
  if (target.closest(".add-param")) {
    editing = { kind: "add" };
    return renderResults();
  }
  const rowEdit = target.closest<HTMLButtonElement>(".row-edit");
  if (rowEdit) {
    editing = { kind: "row", key: rowEdit.dataset.k! };
    return renderResults();
  }
  const removeValue = target.closest<HTMLButtonElement>(".remove-value");
  if (removeValue) {
    const j = Number(removeValue.dataset.j);
    const remove = session.get(j)?.remove;
    if (!remove) return;
    const next = [...state.urls];
    next[columns[j]!.input] = remove();
    return setUrls(next);
  }
  const addFlag = target.closest<HTMLButtonElement>(".add-flag");
  if (addFlag) {
    const j = Number(addFlag.dataset.j);
    const add = session.get(j)?.add;
    if (!add) return;
    const next = [...state.urls];
    next[columns[j]!.input] = add("");
    return setUrls(next);
  }
  const cellCopy = target.closest<HTMLButtonElement>(".cell-copy");
  if (cellCopy) {
    const row = cmp?.index.get(cellCopy.closest<HTMLElement>("tr")!.dataset.k!);
    const node = row?.cells[Number(cellCopy.closest<HTMLElement>("td")!.dataset.j)];
    if (!node) return;
    const text = node.t === "leaf" ? String(node.v) : JSON.stringify(toPlain(node), null, 2);
    return void copyText(text, "Value copied.");
  }
  const btn = target.closest<HTMLButtonElement>(".twisty");
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

results.addEventListener("dblclick", (e) => {
  const td = (e.target as Element).closest<HTMLElement>("td[data-j]");
  const tr = td?.closest<HTMLElement>("tr[data-k]");
  if (!td || !tr || tr.classList.contains("edit-row")) return;
  editing = { kind: "row", key: tr.dataset.k!, focus: Number(td.dataset.j) };
  renderResults();
});

results.addEventListener("keydown", (e) => {
  const el = e.target as HTMLElement;
  if (!el.closest(".edit-row")) return;
  if (e.key === "Escape") {
    e.preventDefault();
    cancelEdit();
  } else if (
    e.key === "Enter" &&
    (e.ctrlKey ||
      e.metaKey ||
      (!e.shiftKey && !(el as HTMLTextAreaElement).dataset?.multiline && el.tagName !== "SELECT"))
  ) {
    e.preventDefault();
    saveEdit();
  }
});

copyMenu.addEventListener("click", (e) => {
  const item = (e.target as Element).closest<HTMLButtonElement>("[data-copy]");
  if (!item) return;
  const i = Number(item.dataset.i);
  const col = columns.find((c) => c.input === i);
  closeCopyMenu(true);
  if (!col) return;
  const raw = state.urls[i]!.trim();
  const texts: Record<string, [string, string]> = {
    text: [raw, `${col.parsed.kind === "url" ? "URL" : "Command"} ${col.letter} copied.`],
    url: [col.parsed.url ?? "", `URL from ${col.letter} copied.`],
    curl: [`curl ${shellQuote(raw)}`, `curl command for ${col.letter} copied.`],
    json: [
      JSON.stringify(toPlain(col.parsed.tree), null, 2),
      `Decoded parts of ${col.letter} copied.`,
    ],
  };
  const [text, done] = texts[item.dataset.copy!]!;
  void copyText(text, done);
});

copyMenu.addEventListener("keydown", (e) => {
  const items = [...copyMenu.querySelectorAll<HTMLButtonElement>("button")];
  const i = items.indexOf(document.activeElement as HTMLButtonElement);
  if (e.key === "Escape") closeCopyMenu(true);
  else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    items[(i + (e.key === "ArrowDown" ? 1 : items.length - 1)) % items.length]?.focus();
  }
});

document.addEventListener("click", (e) => {
  const t = e.target as Element;
  if (!copyMenu.hidden && !copyMenu.contains(t) && !t.closest(".copy-open")) closeCopyMenu();
});
window.addEventListener("resize", () => closeCopyMenu());

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
