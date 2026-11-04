// Figure renderers for report.md DATA blocks → inline SVG/HTML.
// Rules (dataviz skill): thin marks (≤24px, 4px rounded data-end, square at baseline),
// 2px surface gap between touching fills, solid hairline grid, legend for ≥2 series,
// selective direct labels, text wears text tokens, every figure has a table twin,
// native <title> tooltips on marks. Colours are CSS custom properties only (R-2).

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const fmt = (v, unit = "") => {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "string") return esc(v);
  const n = Number.isInteger(v) ? v.toLocaleString("en-US") : (Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 10 ? v.toFixed(1) : String(+v.toFixed(2)));
  return n + esc(unit);
};
const SER = (i) => `var(--series-${(i % 8) + 1})`;
const textW = (s) => { let w = 0; for (const ch of String(s)) w += /[　-鿿＀-￯]/.test(ch) ? 1 : 0.55; return w; };

function tableTwin(columns, rows, caption = "表形式") {
  return `<details class="fig-table"><summary>${esc(caption)}</summary><table><thead><tr>${columns.map((c) => `<th>${esc(c)}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c, i) => `<t${i === 0 ? "h scope=\"row\"" : "d"}>${esc(c)}</t${i === 0 ? "h" : "d"}>`).join("")}</tr>`).join("")}</tbody></table></details>`;
}
function legend(names) {
  if (!names || names.length < 2) return "";
  return `<div class="legend">${names.map((n, i) => `<span class="legend-item"><span class="swatch" style="background:${SER(i)}"></span>${esc(n)}</span>`).join("")}</div>`;
}
function note(d) {
  const bits = [];
  if (d.n) bits.push(`n=${esc(d.n)}`);
  if (d.period) bits.push(esc(d.period));
  if (d.scope) bits.push(esc(d.scope));
  if (d.not) bits.push(`※ ${esc(d.not)}`);
  return bits.length ? `<p class="fig-note">${bits.join(" · ")}</p>` : "";
}

// ---------- stat tiles ----------
function statTiles(d) {
  const tiles = (d.tiles || []).map((t) => `<div class="tile"><div class="tile-label">${esc(t.label)}</div><div class="tile-value">${esc(t.value)}<span class="tile-unit">${esc(t.unit || "")}</span></div>${t.note ? `<div class="tile-note">${esc(t.note)}</div>` : ""}${t.source ? `<div class="tile-src">${esc(t.source)}</div>` : ""}</div>`).join("");
  const rows = (d.tiles || []).map((t) => [t.label, `${t.value}${t.unit || ""}`, t.note || "", t.source || ""]);
  return `<div class="tiles">${tiles}</div>${note(d)}${tableTwin(["項目", "値", "注", "出典"], rows)}`;
}

// ---------- horizontal bars (single series, ranked or as given) ----------
function hbars(d) {
  const items = d.items || [];
  const unit = d.unit || "";
  const max = d.max ?? Math.max(...items.map((i) => +i.value || 0), 0) * 1.08;
  const labW = Math.min(220, Math.max(...items.map((i) => textW(i.label))) * 13 + 12);
  const W = 720, barH = 20, gap = 10, left = labW, right = 70;
  const H = items.length * (barH + gap) + 8;
  const plotW = W - left - right;
  let svg = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(d.aria || "横棒グラフ")}">`;
  items.forEach((it, i) => {
    const y = 4 + i * (barH + gap);
    const w = Math.max(0, (+it.value / max) * plotW);
    const hl = it.emphasis === false ? "var(--de-emphasis)" : it.color ? `var(--${it.color})` : SER(it.series ?? 0);
    svg += `<text x="${left - 8}" y="${y + barH / 2 + 4}" text-anchor="end" class="axis-label">${esc(it.label)}</text>`;
    svg += `<path d="M${left},${y} h${Math.max(w - 4, 0)} a4,4 0 0 1 4,4 v${barH - 8} a4,4 0 0 1 -4,4 h-${Math.max(w - 4, 0)} z" fill="${hl}"><title>${esc(it.label)}: ${fmt(it.value, unit)}${it.note ? " · " + esc(it.note) : ""}</title></path>`;
    svg += `<text x="${left + w + 6}" y="${y + barH / 2 + 4}" class="value-label">${fmt(it.value, unit)}</text>`;
  });
  svg += `<line x1="${left}" y1="0" x2="${left}" y2="${H}" class="baseline"/></svg>`;
  return svg + note(d) + tableTwin(["項目", `値${unit ? ` (${unit})` : ""}`, "注"], items.map((i) => [i.label, fmt(i.value, unit), i.note || ""]));
}

// ---------- grouped bars (categories × series), vertical ----------
function groupedBars(d) {
  const cats = d.categories || [], series = d.series || [], unit = d.unit || "";
  const max = d.max ?? Math.max(...series.flatMap((s) => s.values.map((v) => +v || 0))) * 1.12;
  const W = 720, H = 300, left = 44, right = 12, top = 16, bottom = 44;
  const plotW = W - left - right, plotH = H - top - bottom;
  const gW = plotW / cats.length, bw = Math.min(28, (gW - 24) / series.length - 8);
  let svg = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(d.aria || "グループ棒グラフ")}">`;
  const ticks = d.ticks || [0, 25, 50, 75, 100].filter((t) => t <= max);
  for (const t of ticks) { const y = top + plotH - (t / max) * plotH; svg += `<line x1="${left}" x2="${W - right}" y1="${y}" y2="${y}" class="grid"/><text x="${left - 6}" y="${y + 4}" text-anchor="end" class="axis-label tick">${fmt(t, unit)}</text>`; }
  cats.forEach((c, ci) => {
    const x0 = left + ci * gW + (gW - series.length * (bw + 8)) / 2;
    series.forEach((s, si) => {
      const v = +s.values[ci] || 0, h = (v / max) * plotH, x = x0 + si * (bw + 8), y = top + plotH - h;
      svg += `<path d="M${x},${top + plotH} v-${Math.max(h - 4, 0)} a4,4 0 0 1 4,-4 h${bw - 8} a4,4 0 0 1 4,4 v${Math.max(h - 4, 0)} z" fill="${SER(si)}"><title>${esc(c)} · ${esc(s.name)}: ${fmt(v, unit)}</title></path>`;
      if (d.labels !== false) svg += `<text x="${x + bw / 2}" y="${y - 4}" text-anchor="middle" class="value-label small">${fmt(v, unit)}</text>`;
    });
    svg += `<text x="${left + ci * gW + gW / 2}" y="${H - bottom + 18}" text-anchor="middle" class="axis-label">${esc(c)}</text>`;
  });
  svg += `<line x1="${left}" x2="${W - right}" y1="${top + plotH}" y2="${top + plotH}" class="baseline"/></svg>`;
  return legend(series.map((s) => s.name)) + svg + note(d) + tableTwin(["区分", ...series.map((s) => s.name)], cats.map((c, ci) => [c, ...series.map((s) => fmt(s.values[ci], unit))]));
}

// ---------- stacked horizontal bars (rows × series, sums to 100 or max) ----------
function stackedHbar(d) {
  const rows = d.rows || [], series = d.series || [], unit = d.unit || "%";
  const total = d.total ?? 100;
  const labW = Math.min(240, Math.max(...rows.map((r) => textW(r.label))) * 13 + 12);
  const W = 720, barH = 22, gap = 12, left = labW, right = 16, H = rows.length * (barH + gap) + 6;
  const plotW = W - left - right;
  let svg = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(d.aria || "積み上げ横棒")}">`;
  rows.forEach((r, ri) => {
    const y = 3 + ri * (barH + gap);
    let x = left;
    svg += `<text x="${left - 8}" y="${y + barH / 2 + 4}" text-anchor="end" class="axis-label">${esc(r.label)}</text>`;
    r.values.forEach((v, si) => {
      const w = Math.max(0, (+v / total) * plotW - 2);
      svg += `<rect x="${x}" y="${y}" width="${w}" height="${barH}" fill="${SER(si)}"><title>${esc(r.label)} · ${esc(series[si])}: ${fmt(v, unit)}</title></rect>`;
      if (w > 34) svg += `<text x="${x + w / 2}" y="${y + barH / 2 + 4}" text-anchor="middle" class="in-fill${si === 3 ? " dark" : ""}">${fmt(v, unit)}</text>`;
      x += w + 2;
    });
  });
  svg += `</svg>`;
  return legend(series) + svg + note(d) + tableTwin(["区分", ...series.map((s) => `${s} (${unit})`)], rows.map((r) => [r.label, ...r.values.map((v) => fmt(v, unit))]));
}

// ---------- dumbbell (before/after or A vs B per item) ----------
function dumbbell(d) {
  const items = d.items || [], names = d.seriesNames || ["A", "B"], unit = d.unit || "";
  const max = d.max ?? Math.max(...items.flatMap((i) => [+i.a, +i.b])) * 1.1, min = d.min ?? 0;
  const labW = Math.min(240, Math.max(...items.map((i) => textW(i.label))) * 13 + 12);
  const W = 720, rowH = 32, left = labW, right = 24, H = items.length * rowH + 10, plotW = W - left - right;
  const X = (v) => left + ((+v - min) / (max - min)) * plotW;
  let svg = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(d.aria || "ダンベルチャート")}">`;
  items.forEach((it, i) => {
    const y = 8 + i * rowH + rowH / 2;
    svg += `<text x="${left - 8}" y="${y + 4}" text-anchor="end" class="axis-label">${esc(it.label)}</text>`;
    svg += `<line x1="${X(it.a)}" x2="${X(it.b)}" y1="${y}" y2="${y}" class="connector"/>`;
    svg += `<circle cx="${X(it.a)}" cy="${y}" r="6" fill="${SER(0)}" class="ring"><title>${esc(it.label)} · ${esc(names[0])}: ${fmt(it.a, unit)}</title></circle>`;
    svg += `<circle cx="${X(it.b)}" cy="${y}" r="6" fill="${SER(1)}" class="ring"><title>${esc(it.label)} · ${esc(names[1])}: ${fmt(it.b, unit)}</title></circle>`;
    const lo = Math.min(X(it.a), X(it.b)), hi = Math.max(X(it.a), X(it.b));
    svg += `<text x="${lo - 10}" y="${y + 4}" text-anchor="end" class="value-label small">${fmt(Math.min(+it.a, +it.b), unit)}</text><text x="${hi + 10}" y="${y + 4}" class="value-label small">${fmt(Math.max(+it.a, +it.b), unit)}</text>`;
  });
  svg += `</svg>`;
  return legend(names) + svg + note(d) + tableTwin(["項目", names[0], names[1]], items.map((i) => [i.label, fmt(i.a, unit), fmt(i.b, unit)]));
}

// ---------- line (few series, x categorical/ordinal) ----------
function line(d) {
  const series = d.series || [], unit = d.unit || "";
  const xs = d.x || [...new Set(series.flatMap((s) => s.points.map((p) => p.x)))];
  const max = d.max ?? Math.max(...series.flatMap((s) => s.points.map((p) => +p.y))) * 1.12, min = d.min ?? 0;
  const W = 720, H = 280, left = 48, right = 120, top = 16, bottom = 40, plotW = W - left - right, plotH = H - top - bottom;
  const X = (x) => left + (xs.indexOf(x) / Math.max(xs.length - 1, 1)) * plotW, Y = (y) => top + plotH - ((+y - min) / (max - min)) * plotH;
  let svg = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(d.aria || "折れ線グラフ")}">`;
  const ticks = d.ticks || [0, 25, 50, 75, 100].filter((t) => t <= max && t >= min);
  for (const t of ticks) svg += `<line x1="${left}" x2="${W - right}" y1="${Y(t)}" y2="${Y(t)}" class="grid"/><text x="${left - 6}" y="${Y(t) + 4}" text-anchor="end" class="axis-label tick">${fmt(t, unit)}</text>`;
  xs.forEach((x) => (svg += `<text x="${X(x)}" y="${H - bottom + 18}" text-anchor="middle" class="axis-label">${esc(x)}</text>`));
  series.forEach((s, si) => {
    const pts = s.points.map((p) => `${X(p.x)},${Y(p.y)}`).join(" ");
    svg += `<polyline points="${pts}" fill="none" stroke="${SER(si)}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"${s.dashed ? ' stroke-dasharray="4 4"' : ""}/>`;
    s.points.forEach((p) => (svg += `<circle cx="${X(p.x)}" cy="${Y(p.y)}" r="4.5" fill="${SER(si)}" class="ring"><title>${esc(s.name)} · ${esc(p.x)}: ${fmt(p.y, unit)}</title></circle>`));
    const last = s.points[s.points.length - 1];
    svg += `<text x="${X(last.x) + 10}" y="${Y(last.y) + 4}" class="value-label">${esc(s.name)} ${fmt(last.y, unit)}</text>`;
  });
  svg += `<line x1="${left}" x2="${W - right}" y1="${top + plotH}" y2="${top + plotH}" class="baseline"/></svg>`;
  return legend(series.map((s) => s.name)) + svg + note(d) + tableTwin(["x", ...series.map((s) => s.name)], xs.map((x) => [x, ...series.map((s) => { const p = s.points.find((q) => q.x === x); return p ? fmt(p.y, unit) : "—"; })]));
}

// ---------- timeline ----------
function timeline(d) {
  const ev = (d.events || []).slice().sort((a, b) => (a.date > b.date ? 1 : -1));
  const half = Math.ceil(ev.length / 2); const W = 760, y0 = 40 + 22 * half, H = y0 + 70 + 22 * half, left = 40, right = 40;
  const t = (s) => new Date(s).getTime();
  const t0 = d.start ? t(d.start) : t(ev[0].date), t1 = d.end ? t(d.end) : t(ev[ev.length - 1].date);
  const X = (s) => left + ((t(s) - t0) / (t1 - t0)) * (W - left - right);
  let svg = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(d.aria || "タイムライン")}"><line x1="${left}" x2="${W - right}" y1="${y0}" y2="${y0}" class="baseline"/>`;
  const years = []; for (let y = new Date(t0).getFullYear(); y <= new Date(t1).getFullYear(); y++) years.push(y);
  years.forEach((y) => { const s = `${y}-01-01`; if (t(s) >= t0 && t(s) <= t1) svg += `<line x1="${X(s)}" x2="${X(s)}" y1="${y0 - 6}" y2="${y0 + 6}" class="baseline"/><text x="${X(s)}" y="${y0 + 22}" text-anchor="middle" class="axis-label tick">${y}</text>`; });
  ev.forEach((e, i) => {
    const x = X(e.date), up = i % 2 === 0, ly = up ? y0 - 24 - 22 * Math.floor(i / 2) : y0 + 44 + 22 * Math.floor(i / 2);
    const col = e.kind === "old" ? "var(--de-emphasis)" : e.kind === "jp" ? SER(2) : e.kind === "ref" ? SER(1) : SER(0);
    svg += `<line x1="${x}" x2="${x}" y1="${y0}" y2="${ly + (up ? 6 : -12)}" class="connector"/><circle cx="${x}" cy="${y0}" r="5" fill="${col}" class="ring"><title>${esc(e.date)} ${esc(e.label)}</title></circle>`;
    svg += `<text x="${x}" y="${ly}" text-anchor="middle" class="axis-label small${e.kind === "old" ? " muted" : ""}">${esc(e.date)} ${esc(e.label)}</text>`;
  });
  svg += `</svg>`;
  const kinds = [...new Set(ev.map((e) => e.kind || "main"))];
  const kindName = { main: d.kindNames?.main || "現行", old: d.kindNames?.old || "改正前", jp: d.kindNames?.jp || "日本", ref: d.kindNames?.ref || "参照" };
  const lg = `<div class="legend">${kinds.map((k) => `<span class="legend-item"><span class="swatch" style="background:${k === "old" ? "var(--de-emphasis)" : k === "jp" ? SER(2) : k === "ref" ? SER(1) : SER(0)}"></span>${esc(kindName[k] || k)}</span>`).join("")}</div>`;
  return lg + svg + note(d) + tableTwin(["日付", "事象", "区分"], ev.map((e) => [e.date, e.label, kindName[e.kind || "main"] || e.kind]));
}

// ---------- matrix (rows × cols, categorical cell values with legend) ----------
function matrix(d) {
  const rows = d.rows || [], cols = d.cols || [], cells = d.cells || [], lg = d.legend || {};
  const cls = (v) => ({ 0: "m0", 1: "m1", 2: "m2", 3: "m3", 4: "m4" }[v] || "m0");
  let html = `<div class="matrix-wrap"><table class="matrix"><thead><tr><th></th>${cols.map((c) => `<th>${esc(c)}</th>`).join("")}</tr></thead><tbody>`;
  rows.forEach((r, ri) => { html += `<tr><th scope="row">${esc(r)}</th>${cols.map((_, ci) => { const c = cells[ri]?.[ci]; const v = typeof c === "object" ? c.v : c; const label = typeof c === "object" ? c.label : lg[v] ?? ""; const tip = typeof c === "object" && c.tip ? c.tip : ""; return `<td class="${cls(v)}" title="${esc(tip || label)}">${esc(label)}</td>`; }).join("")}</tr>`; });
  html += `</tbody></table></div>`;
  const lgHtml = Object.keys(lg).length ? `<div class="legend">${Object.entries(lg).map(([k, v]) => `<span class="legend-item"><span class="swatch ${cls(k)}"></span>${esc(v)}</span>`).join("")}</div>` : "";
  return lgHtml + html + note(d);
}

// ---------- plain table ----------
function table(d) {
  const cols = d.columns || [], rows = d.rows || [];
  return `<div class="table-wrap"><table class="data"><thead><tr>${cols.map((c) => `<th>${esc(c)}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c, i) => `<t${i === 0 ? 'h scope="row"' : "d"}>${esc(c)}</t${i === 0 ? "h" : "d"}>`).join("")}</tr>`).join("")}</tbody></table></div>` + note(d);
}

// ---------- flow / roadmap (stages with gates) ----------
function roadmap(d) {
  const stages = d.stages || [];
  const W = 760, boxW = Math.min(150, (W - 40) / stages.length - 16), boxH = 64, top = 20, H = top + boxH + 90 + (d.gates ? 0 : 0);
  let svg = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(d.aria || "ロードマップ")}">`;
  const totalW = stages.length * boxW + (stages.length - 1) * 16, x0 = (W - totalW) / 2;
  stages.forEach((s, i) => {
    const x = x0 + i * (boxW + 16), fill = s.phase === "later" ? "var(--de-emphasis)" : s.phase === "measure" ? SER(1) : SER(0);
    svg += `<rect x="${x}" y="${top}" width="${boxW}" height="${boxH}" rx="6" fill="${fill}" opacity="${s.phase === "later" ? 0.9 : 1}"><title>${esc(s.title)}${s.detail ? ": " + esc(s.detail) : ""}</title></rect>`;
    const lines = String(s.title).split("\n");
    lines.forEach((ln, li) => (svg += `<text x="${x + boxW / 2}" y="${top + boxH / 2 + (li - (lines.length - 1) / 2) * 16 + 5}" text-anchor="middle" class="in-fill">${esc(ln)}</text>`));
    if (s.when) svg += `<text x="${x + boxW / 2}" y="${top + boxH + 18}" text-anchor="middle" class="axis-label tick">${esc(s.when)}</text>`;
    if (s.gate) { const gx = x + boxW + 8; svg += `<path d="M${gx},${top + boxH / 2 - 10} l8,10 l-8,10 l-8,-10 z" fill="var(--text-muted)"><title>${esc(s.gate)}</title></path>`; }
    if (s.gate) svg += `<text x="${x + boxW + 8}" y="${top + boxH + 40}" text-anchor="middle" class="axis-label small muted">${esc(s.gate)}</text>`;
  });
  svg += `</svg>`;
  const lg = `<div class="legend"><span class="legend-item"><span class="swatch" style="background:${SER(0)}"></span>${esc(d.phaseNames?.now || "同時に敷く")}</span><span class="legend-item"><span class="swatch" style="background:${SER(1)}"></span>${esc(d.phaseNames?.measure || "第三者が数える")}</span><span class="legend-item"><span class="swatch" style="background:var(--de-emphasis)"></span>${esc(d.phaseNames?.later || "後段")}</span><span class="legend-item">◆ ゲート</span></div>`;
  return lg + svg + note(d) + tableTwin(["段階", "時期", "内容", "ゲート"], stages.map((s) => [s.title.replace(/\n/g, " "), s.when || "", s.detail || "", s.gate || ""]));
}

// ---------- flow diagram: generic boxes + arrows laid out in rows ----------
function diagram(d) {
  // d.rows: [[{id,label,kind?}], ...]; d.edges: [[fromId,toId,label?]]
  const rows = d.rows || [], W = 760, boxH = 52, rowGap = 56, top = 16;
  const H = top + rows.length * boxH + (rows.length - 1) * rowGap + 16;
  const pos = {};
  rows.forEach((r, ri) => { const bw = Math.min(170, (W - 32) / r.length - 12); const total = r.length * bw + (r.length - 1) * 12; const x0 = (W - total) / 2; r.forEach((b, bi) => (pos[b.id] = { x: x0 + bi * (bw + 12), y: top + ri * (boxH + rowGap), w: bw, h: boxH, b })); });
  let svg = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(d.aria || "図")}"><defs><marker id="arr" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="var(--text-muted)"/></marker></defs>`;
  (d.edges || []).forEach(([a, b, label]) => { const A = pos[a], B = pos[b]; if (!A || !B) return; const x1 = A.x + A.w / 2, y1 = A.y + A.h, x2 = B.x + B.w / 2, y2 = B.y; svg += `<path d="M${x1},${y1} C${x1},${(y1 + y2) / 2} ${x2},${(y1 + y2) / 2} ${x2},${y2 - 2}" fill="none" stroke="var(--text-muted)" stroke-width="1.5" marker-end="url(#arr)"/>`; if (label) svg += `<text x="${(x1 + x2) / 2 + 6}" y="${(y1 + y2) / 2 + 4}" class="axis-label small muted">${esc(label)}</text>`; });
  Object.values(pos).forEach(({ x, y, w, h, b }) => { const kind = b.kind || "main"; const fill = kind === "human" ? SER(1) : kind === "third" ? SER(2) : kind === "muted" ? "var(--de-emphasis)" : kind === "plain" ? "var(--surface-2)" : SER(0); const ink = kind === "plain" ? "axis-label" : "in-fill"; svg += `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="6" fill="${fill}" ${kind === "plain" ? 'stroke="var(--border)"' : ""}><title>${esc(b.tip || b.label)}</title></rect>`; const lines = String(b.label).split("\n"); lines.forEach((ln, li) => (svg += `<text x="${x + w / 2}" y="${y + h / 2 + (li - (lines.length - 1) / 2) * 15 + 5}" text-anchor="middle" class="${ink}">${esc(ln)}</text>`)); });
  svg += `</svg>`;
  const kinds = d.kindNames || {};
  const lg = Object.keys(kinds).length ? `<div class="legend">${Object.entries(kinds).map(([k, v]) => `<span class="legend-item"><span class="swatch" style="background:${k === "human" ? SER(1) : k === "third" ? SER(2) : k === "muted" ? "var(--de-emphasis)" : k === "plain" ? "var(--surface-2)" : SER(0)}"></span>${esc(v)}</span>`).join("")}</div>` : "";
  return lg + svg + note(d) + tableTwin(["要素", "種別", "説明"], Object.values(pos).map(({ b }) => [b.label.replace(/\n/g, " "), kinds[b.kind || "main"] || b.kind || "", b.tip || ""]));
}

// ---------- tree (issue tree): root → branches → leaves with verdict colour ----------
function tree(d) {
  const branches = d.branches || [];
  const W = 760, colW = 230, leafH = 22, top = 10;
  let y = top; const layout = branches.map((b) => { const h = Math.max(leafH, (b.leaves?.length || 1) * leafH); const item = { b, y, h }; y += h + 10; return item; });
  const H = y + 10;
  const vcol = (v) => (v === "支持" ? "var(--status-good)" : v === "一部支持" ? "var(--status-warning)" : v === "不支持" ? "var(--status-critical)" : "var(--de-emphasis)");
  let svg = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(d.aria || "論点ツリー")}">`;
  svg += `<rect x="8" y="${H / 2 - 30}" width="${colW - 40}" height="60" rx="6" fill="${SER(0)}"/>`;
  String(d.root || "").split("\n").forEach((ln, li, arr) => (svg += `<text x="${8 + (colW - 40) / 2}" y="${H / 2 + (li - (arr.length - 1) / 2) * 15 + 5}" text-anchor="middle" class="in-fill">${esc(ln)}</text>`));
  layout.forEach(({ b, y, h }) => {
    const bx = colW, by = y + h / 2;
    svg += `<path d="M${8 + colW - 40},${H / 2} C${bx - 20},${H / 2} ${bx - 20},${by} ${bx},${by}" fill="none" stroke="var(--border)" stroke-width="1.5"/>`;
    svg += `<rect x="${bx}" y="${by - 12}" width="${colW - 20}" height="24" rx="5" fill="var(--surface-2)" stroke="var(--border)"/><text x="${bx + (colW - 20) / 2}" y="${by + 4}" text-anchor="middle" class="axis-label">${esc(b.label)}</text>`;
    (b.leaves || []).forEach((lf, li) => { const ly = y + li * leafH + leafH / 2; const lx = bx + colW; svg += `<path d="M${bx + colW - 20},${by} C${lx - 12},${by} ${lx - 12},${ly} ${lx},${ly}" fill="none" stroke="var(--border)" stroke-width="1"/>`; svg += `<circle cx="${lx + 7}" cy="${ly}" r="6" fill="${vcol(lf.verdict)}"><title>${esc(lf.id)} ${esc(lf.label)} — ${esc(lf.verdict || "")} / 確度 ${esc(lf.confidence || "")}</title></circle><text x="${lx + 18}" y="${ly + 4}" class="axis-label small">${esc(lf.id)} ${esc(lf.label)}${lf.confidence ? ` (${esc(lf.confidence)})` : ""}</text>`; });
  });
  svg += `</svg>`;
  const lg = `<div class="legend"><span class="legend-item"><span class="swatch" style="background:var(--status-good)"></span>支持</span><span class="legend-item"><span class="swatch" style="background:var(--status-warning)"></span>一部支持</span><span class="legend-item"><span class="swatch" style="background:var(--status-critical)"></span>不支持</span><span class="legend-item"><span class="swatch" style="background:var(--de-emphasis)"></span>未検証</span></div>`;
  return lg + svg + note(d) + tableTwin(["論点", "仮説", "判定", "確度"], branches.flatMap((b) => (b.leaves || []).map((lf) => [b.label, `${lf.id} ${lf.label}`, lf.verdict || "", lf.confidence || ""])));
}

// ---------- verdict heatmap (D or H × 判定 × 確度) ----------
function verdicts(d) {
  const items = d.items || [];
  const vcls = (v) => (v === "支持" ? "v-yes" : v === "一部支持" ? "v-part" : v === "不支持" ? "v-no" : "v-na");
  const ccls = (c) => (c === "高" ? "c-hi" : c === "中" ? "c-mid" : "c-lo");
  let html = `<div class="table-wrap"><table class="verdicts"><thead><tr><th>ID</th><th>主張</th><th>判定</th><th>確度</th><th>根拠の要点</th></tr></thead><tbody>`;
  items.forEach((it) => (html += `<tr><th scope="row">${esc(it.id)}</th><td>${esc(it.claim)}</td><td class="${vcls(it.verdict)}"><span class="chip">${esc(it.verdict)}</span></td><td class="${ccls(it.confidence)}"><span class="chip">${esc(it.confidence)}</span></td><td class="small">${esc(it.basis || "")}</td></tr>`));
  html += `</tbody></table></div>`;
  return html + note(d);
}

export const renderers = { "stat-tiles": statTiles, hbars, "grouped-bars": groupedBars, "stacked-hbar": stackedHbar, dumbbell, line, timeline, matrix, table, roadmap, diagram, tree, verdicts };

export function renderFigure(type, data) {
  if (data && data.html) return data.html; // escape hatch for hand-written SVG/HTML
  const fn = renderers[type];
  if (!fn) return `<p class="fig-note">未対応の図種 (${esc(type)}) — 表形式で表示</p>` + table({ columns: Object.keys(data || {}), rows: [Object.values(data || {}).map((v) => (typeof v === "object" ? JSON.stringify(v) : v))] });
  return fn(data || {});
}
