// Figure renderers for report.md DATA blocks → inline SVG/HTML.
// Rules (dataviz skill): thin marks (≤28px, 4px rounded data-end, square at baseline),
// 2px surface gap between touching fills, solid hairline grid, legend for ≥2 series,
// selective direct labels (every point only when ≤8 marks), text wears text tokens (never
// series colour), one axis only (never dual-axis), ≤6 categorical series, status colours
// only for status, every figure has a table twin, native <title> tooltips on marks,
// aria-label on every svg. Colours are CSS custom properties only (R-2).
// Japanese labels are measured with textW() and wrapped with wrap(); margins grow to fit.
//
// The editor writes DATA in several shapes; each type below either is a renderer or an
// adapter that normalises the editor's shape onto a renderer (see `renderers` at the end).
// renderFigure(type, data, ctx) — ctx = { md, id, table } from build-html.mjs:
//   md    : the whole report.md (used to look up the 判定表 for tree leaves)
//   table : { columns, rows } pre-rendered (inline-HTML) cells of a markdown table that
//           follows a `{"table":"following-markdown"}` block.

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const fmt = (v, unit = "") => {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "string") return esc(v);
  const n = Number.isInteger(v) ? v.toLocaleString("en-US") : String(+v.toFixed(3));
  return n + esc(unit);
};
const SER = (i) => `var(--series-${(i % 8) + 1})`;
const isWide = (ch) => /[　-鿿＀-￯]/.test(ch);
// width in em: CJK = 1, ASCII upper/digits ≈ .62, lower ≈ .52, space ≈ .3
const textW = (s) => { let w = 0; for (const ch of String(s ?? "")) w += isWide(ch) ? 1 : ch === " " ? 0.3 : /[A-Z0-9%@#&]/.test(ch) ? 0.64 : /[il.,:;'|!()\[\]]/.test(ch) ? 0.32 : 0.54; return w; };
const NOSTART = /^[、。，．・）」』】〕〉》％%)\]:：;；!！?？ー…〜]/;
// greedy line breaking: latin words stay whole, CJK may break anywhere (simple kinsoku)
function wrap(s, maxUnits) {
  const out = [];
  for (const para of String(s ?? "").split("\n")) {
    const toks = para.match(/[A-Za-z0-9.,'’\-_/+%&@#=:]+ ?|\s+|./gsu) || [""];
    let cur = "", w = 0;
    for (const t of toks) {
      const tw = textW(t);
      if (cur.trim() && w + textW(t.trimEnd()) > maxUnits && !NOSTART.test(t)) { out.push(cur.trimEnd()); cur = t.trimStart(); w = textW(cur); }
      else { cur += t; w += tw; }
    }
    out.push(cur.trimEnd());
  }
  return out.filter((l, i, a) => l || a.length === 1);
}
const linesW = (lines, fs) => Math.max(0, ...lines.map((l) => textW(l) * fs));
// multi-line svg text, vertically centred on cy
function tspans(lines, x, cy, lh, cls, anchor = "end") {
  return lines.map((ln, li) => `<text x="${x}" y="${(cy + (li - (lines.length - 1) / 2) * lh + 4).toFixed(1)}" text-anchor="${anchor}" class="${cls}">${esc(ln)}</text>`).join("");
}
// unit "% of respondents" → suffix "%" for value labels, full text kept for headers
function unitParts(u) {
  const full = String(u ?? "");
  if (!full) return { suffix: "", full: "" };
  if (/^%/.test(full)) return { suffix: "%", full };
  const head = full.split(/[\s(（]/)[0];
  return { suffix: textW(head) <= 3 ? head : "", full };
}
const barPath = (x, y, w, h) => (w <= 0 ? "" : `M${x},${y} h${Math.max(w - 4, 0)} a4,4 0 0 1 4,4 v${h - 8} a4,4 0 0 1 -4,4 h-${Math.max(w - 4, 0)} z`);

function tableTwin(columns, rows, caption = "表形式") {
  return `<details class="fig-table"><summary>${esc(caption)}</summary><table><thead><tr>${columns.map((c) => `<th>${esc(c)}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c, i) => `<t${i === 0 ? "h scope=\"row\"" : "d"}>${esc(c)}</t${i === 0 ? "h" : "d"}>`).join("")}</tr>`).join("")}</tbody></table></details>`;
}
function legend(names, colors) {
  if (!names || names.length < 2) return "";
  return `<div class="legend">${names.map((n, i) => `<span class="legend-item"><span class="swatch" style="background:${colors ? colors[i] : SER(i)}"></span>${esc(n)}</span>`).join("")}</div>`;
}
function note(d, extra = []) {
  const bits = [];
  if (d.n) bits.push(typeof d.n === "object" ? `n=${Object.entries(d.n).map(([k, v]) => `${esc(k)} ${fmt(v)}`).join(" / ")}` : `n=${esc(typeof d.n === "number" ? d.n.toLocaleString("en-US") : d.n)}`);
  if (d.period) bits.push(esc(d.period));
  if (d.scope) bits.push(esc(d.scope));
  for (const e of extra) if (e) bits.push(e);
  if (typeof d.note === "string") bits.push(esc(d.note));
  if (typeof d.annotation === "string") bits.push(esc(d.annotation));
  if (d.not) bits.push(`※ ${esc(d.not)}`);
  return bits.length ? `<p class="fig-note">${bits.join(" · ")}</p>` : "";
}
const svgOpen = (W, H, aria, cls = "chart") => `<svg class="${cls}" viewBox="0 0 ${W} ${Math.ceil(H)}" width="${W}" role="img" aria-label="${esc(aria)}">`;

// ---------- stat tiles (also: `tiles` with org/kind/grade/src) ----------
function statTiles(d) {
  const tiles = (d.tiles || []).map((t) => (t.org ? { label: t.org, kind: t.kind, value: t.value, unit: t.unit, note: t.label, source: [t.src, t.grade ? `確度 ${t.grade}` : ""].filter(Boolean).join(" · ") } : t));
  const kindCls = (k) => (k === "予測" ? "forecast" : k === "実測" ? "actual" : "");
  const html = tiles.map((t) => `<div class="tile"><div class="tile-label">${esc(t.label)}${t.kind ? `<span class="tile-kind ${kindCls(t.kind)}">${esc(t.kind)}</span>` : ""}</div><div class="tile-value">${esc(typeof t.value === "number" ? t.value.toLocaleString("en-US") : t.value)}<span class="tile-unit">${esc(t.unit || "")}</span></div>${t.note ? `<div class="tile-note">${esc(t.note)}</div>` : ""}${t.source ? `<div class="tile-src">${esc(t.source)}</div>` : ""}</div>`).join("");
  const kinds = [...new Set(tiles.map((t) => t.kind).filter(Boolean))];
  const lg = kinds.length >= 2 ? `<div class="legend"><span class="legend-item">区分:</span>${kinds.map((k) => `<span class="legend-item"><span class="tile-kind ${kindCls(k)}">${esc(k)}</span></span>`).join("")}</div>` : "";
  const extra = [];
  if (Array.isArray(d.blocked) && d.blocked.length) extra.push(`取得できなかったサイト: ${d.blocked.map(esc).join("、")}`);
  if (d.grade_legend) extra.push(`確度 ${Object.entries(d.grade_legend).map(([k, v]) => `${esc(k)}=${esc(v)}`).join(" / ")}${d.grade_counts ? ` (${esc(d.grade_counts)})` : ""}`);
  const rows = tiles.map((t) => [t.label + (t.kind ? ` (${t.kind})` : ""), `${t.value}${t.unit || ""}`, t.note || "", t.source || ""]);
  return lg + `<div class="tiles">${html}</div>${note(d, extra)}${tableTwin(["項目", "値", "注", "出典"], rows)}`;
}

// ---------- small multiples: one tiny panel per value, each with its own unit ----------
function smallMultiples(d) {
  const panels = (d.panels || d.items || []).map((p) => (Array.isArray(p) ? { label: p[0], value: p[1], unit: d.unit } : p));
  const flags = new Set(d.vendor_flag || []);
  const html = panels.map((p, i) => {
    const pct = typeof p.value === "number" && /^%/.test(p.unit || "");
    const meta = [p.method, p.n ? `n=${p.n}` : "", p.period, p.src].filter(Boolean).map(esc).join(" · ");
    const bar = pct ? `<div class="smx-track" title="${esc(p.label)}: ${fmt(p.value, "%")}"><div class="smx-fill" style="width:${Math.min(100, p.value)}%"></div></div><div class="smx-scale"><span>0</span><span>100%</span></div>` : "";
    return `<div class="smx-p"><div class="smx-l">${esc(p.label)}</div><div class="smx-v">${fmt(p.value, pct ? "%" : "")}</div><div class="smx-u">${esc(pct ? String(p.unit).replace(/^%\s*/, "") : p.unit || "")}</div>${bar}${meta || flags.has(p.src) ? `<div class="smx-m">${meta}${flags.has(p.src) ? ` <span class="flag">ベンダ自社顧客データ</span>` : ""}</div>` : ""}</div>`;
  }).join("");
  return `<div class="smx" role="group" aria-label="${esc(d.aria || "単位ごとの小さな棒")}">${html}</div>` + note(d) + tableTwin(["項目", "値", "単位", "方法", "n", "期間", "出典"], panels.map((p) => [p.label, fmt(p.value), p.unit || "", p.method || "", p.n || "", p.period || "", p.src || ""]));
}

// ---------- horizontal bars (single series, as given) ----------
function hbars(d) {
  const items = (d.items || d.bars || []).map((it) => (Array.isArray(it) ? { label: it[0], value: it[1] } : it));
  const units = new Set(items.map((i) => i.unit ?? d.unit ?? ""));
  if (units.size > 1 || items.some((i) => typeof i.value !== "number")) return smallMultiples({ ...d, panels: items.map((i) => ({ ...i, unit: i.unit ?? d.unit })) });
  const { suffix, full } = unitParts(d.unit ?? items[0]?.unit);
  const vmax = Math.max(0, ...items.map((i) => +i.value || 0), d.ref?.value ?? 0);
  const max = d.max ?? (vmax > 0 && vmax <= 1 ? 1 : vmax * 1.1);
  const fs = 12.5, lh = 15;
  const labs = items.map((i) => wrap(i.label, 230 / fs));
  const labW = Math.max(60, ...labs.map((l) => linesW(l, fs))) * 1.06 + 18;
  const valW = Math.max(...items.map((i) => textW(fmt(i.value, suffix)) * fs)) + 14;
  const W = 720, barH = 20, gap = 12, left = labW, right = valW + 4, top = d.ref ? 22 : 4;
  const rowH = labs.map((l) => Math.max(barH, l.length * lh));
  const H = top + rowH.reduce((a, b) => a + b + gap, 0) + 4;
  const plotW = W - left - right, X = (v) => left + (+v / max) * plotW;
  let svg = svgOpen(W, H, d.aria || `横棒グラフ: ${items.map((i) => `${i.label} ${fmt(i.value, suffix)}`).join("、")}`);
  if (d.ticks) for (const t of d.ticks) svg += `<line x1="${X(t)}" x2="${X(t)}" y1="${top}" y2="${H - 4}" class="grid"/>`;
  let y = top;
  items.forEach((it, i) => {
    const h = rowH[i], by = y + (h - barH) / 2, w = Math.max(0, X(it.value) - left);
    const fill = it.emphasis === false ? "var(--de-emphasis)" : SER(it.series ?? d.series ?? 0);
    svg += tspans(labs[i], left - 8, y + h / 2, lh, "axis-label");
    svg += `<path d="${barPath(left, by, w, barH)}" fill="${fill}"><title>${esc(it.label)}: ${fmt(it.value, suffix)}${full && !suffix ? ` ${esc(full)}` : ""}${it.note ? " · " + esc(it.note) : ""}</title></path>`;
    svg += `<text x="${left + w + 6}" y="${by + barH / 2 + 4}" class="value-label">${fmt(it.value, suffix)}</text>`;
    y += h + gap;
  });
  if (d.ref) { const rx = X(d.ref.value); svg += `<line x1="${rx}" x2="${rx}" y1="${top - 4}" y2="${H - 4}" class="ref-line"/><text x="${rx + 4}" y="${top - 8}" class="axis-label small muted">${esc(d.ref.label)}</text>`; }
  svg += `<line x1="${left}" y1="${top - 2}" x2="${left}" y2="${H - 4}" class="baseline"/></svg>`;
  const extra = full && full !== suffix ? [`単位: ${esc(full)}`] : [];
  return svg + note(d, extra) + tableTwin(["項目", `値${full ? ` (${full})` : ""}`, "注"], items.map((i) => [i.label, fmt(i.value, suffix), i.note || i.src || ""]));
}
// contrast-bar: two (or few) bars against the "no difference" reference
function contrastBar(d) {
  const { suffix } = unitParts(d.unit);
  return hbars({ ...d, items: d.bars || d.items, ref: d.ref ?? (suffix === "倍" ? { value: 1, label: "1倍 = 差なし" } : undefined) });
}

// ---------- grouped bars (categories × series), vertical ----------
function groupedBars(d) {
  const cats = d.categories || [], series = d.series || [], { suffix, full } = unitParts(d.unit);
  const vmax = Math.max(...series.flatMap((s) => s.values.map((v) => +v || 0)));
  const max = d.max ?? (vmax <= 100 && /%/.test(d.unit || "") ? Math.max(vmax * 1.1, 100) : vmax * 1.12);
  const W = 720, H = 300, left = 44, right = 12, top = 18, bottom = 44;
  const plotW = W - left - right, plotH = H - top - bottom;
  const gW = plotW / cats.length, sgap = 6, bw = Math.min(28, (gW - 24) / series.length - sgap);
  let svg = svgOpen(W, H, d.aria || "グループ棒グラフ");
  const step = max > 60 ? 25 : max > 20 ? 10 : 5;
  const ticks = d.ticks || Array.from({ length: Math.floor(max / step) + 1 }, (_, i) => i * step);
  for (const t of ticks) { const y = top + plotH - (t / max) * plotH; svg += `<line x1="${left}" x2="${W - right}" y1="${y}" y2="${y}" class="grid"/><text x="${left - 6}" y="${y + 4}" text-anchor="end" class="axis-label tick">${fmt(t, suffix)}</text>`; }
  const marks = cats.length * series.length;
  cats.forEach((c, ci) => {
    const x0 = left + ci * gW + (gW - series.length * (bw + sgap) + sgap) / 2;
    series.forEach((s, si) => {
      const v = +s.values[ci] || 0, h = (v / max) * plotH, x = x0 + si * (bw + sgap), y = top + plotH - h;
      svg += `<path d="M${x},${top + plotH} v-${Math.max(h - 4, 0)} a4,4 0 0 1 4,-4 h${bw - 8} a4,4 0 0 1 4,4 v${Math.max(h - 4, 0)} z" fill="${SER(si)}"><title>${esc(c)} · ${esc(s.name)}: ${fmt(v, suffix)}</title></path>`;
      if (d.labels !== false && marks <= 8) svg += `<text x="${x + bw / 2}" y="${y - 5}" text-anchor="middle" class="value-label small">${fmt(v, suffix === "%" ? "" : suffix)}</text>`;
    });
    svg += `<text x="${left + ci * gW + gW / 2}" y="${H - bottom + 20}" text-anchor="middle" class="axis-label">${esc(c)}</text>`;
  });
  svg += `<line x1="${left}" x2="${W - right}" y1="${top + plotH}" y2="${top + plotH}" class="baseline"/></svg>`;
  return legend(series.map((s) => s.name)) + svg + note(d) + tableTwin(["区分", ...series.map((s) => `${s.name}${full ? ` (${full})` : ""}`)], cats.map((c, ci) => [c, ...series.map((s) => fmt(s.values[ci], suffix))]));
}

// ---------- stacked horizontal bars (rows × series, sums to 100 or total) ----------
function stackedHbar(d) {
  let series = d.series || [], rows = d.rows || [];
  if (d.segments) { series = d.segments.map((s) => s[0]); rows = [{ label: d.row_label || d.rowLabel || "全体", values: d.segments.map((s) => s[1]) }]; }
  rows = rows.map((r) => (Array.isArray(r) ? { label: r[0], values: r.slice(1) } : r));
  const { suffix, full } = unitParts(d.unit || "%");
  const total = d.total ?? 100;
  const refs = d.reference ? Object.entries(d.reference) : [];
  const fs = 12.5, lh = 15;
  const labs = rows.map((r) => wrap(r.label, 220 / fs));
  const labW = Math.max(40, ...labs.map((l) => linesW(l, fs))) * 1.06 + 18;
  const W = 720, barH = 24, gap = 12, left = labW, right = 24, top = refs.length ? 24 : 4;
  const rowH = labs.map((l) => Math.max(barH, l.length * lh));
  const H = top + rowH.reduce((a, b) => a + b + gap, 0) + 18;
  const plotW = W - left - right, X = (v) => left + (v / total) * plotW;
  let svg = svgOpen(W, H, d.aria || "積み上げ横棒");
  for (const t of [0, 25, 50, 75, 100].filter((t) => t <= total)) svg += `<line x1="${X(t)}" x2="${X(t)}" y1="${top}" y2="${H - 18}" class="grid"/><text x="${X(t)}" y="${H - 4}" text-anchor="middle" class="axis-label tick">${t}${esc(suffix)}</text>`;
  let y = top;
  const remainders = [];
  rows.forEach((r, ri) => {
    const h = rowH[ri], by = y + (h - barH) / 2;
    let x = left;
    svg += tspans(labs[ri], left - 8, y + h / 2, lh, "axis-label");
    r.values.forEach((v, si) => {
      const full_w = (+v / total) * plotW, w = Math.max(0, full_w - 2), last = si === r.values.length - 1;
      const shape = last ? barPath(x, by, w, barH) : `M${x},${by} h${w} v${barH} h-${w} z`;
      svg += `<path d="${shape}" fill="${SER(si)}"><title>${esc(r.label)} · ${esc(series[si])}: ${fmt(v, suffix)}</title></path>`;
      const lab = fmt(v, suffix);
      if (w > textW(lab) * 12 + 8) svg += `<text x="${x + w / 2}" y="${by + barH / 2 + 4}" text-anchor="middle" class="in-fill${si === 3 ? " dark" : ""}">${lab}</text>`;
      x += full_w;
    });
    const sum = r.values.reduce((a, b) => a + (+b || 0), 0);
    if (sum < total - 0.5) remainders.push(`${r.label}: 内訳の合計 ${fmt(+sum.toFixed(1), suffix)} (残り ${fmt(+(total - sum).toFixed(1), suffix)} は内訳に無い)`);
    y += h + gap;
  });
  refs.forEach(([lab, v]) => { const rx = X(+v); svg += `<line x1="${rx}" x2="${rx}" y1="${top - 6}" y2="${H - 20}" class="ref-line"><title>${esc(lab)}: ${fmt(+v, suffix)}</title></line><text x="${rx + 4}" y="${top - 10}" class="axis-label small">参照: ${esc(lab)} ${fmt(+v, suffix)}</text>`; });
  svg += `</svg>`;
  const extra = [full !== suffix ? `単位: ${esc(full)}` : "", ...remainders.map(esc)];
  return legend(series) + svg + note(d, extra) + tableTwin(["区分", ...series.map((s) => `${s} (${full})`)], [...rows.map((r) => [r.label, ...r.values.map((v) => fmt(v, suffix))]), ...refs.map(([k, v]) => [`参照: ${k}`, fmt(+v, suffix)])]);
}

// ---------- dumbbell (A vs B per item) ----------
function dumbbell(d) {
  const items = (d.items || d.rows || []).map((r) => (Array.isArray(r) ? { label: r[0], a: r[1], b: r[2] } : r));
  const names = d.seriesNames || d.series || ["A", "B"], { suffix } = unitParts(d.unit);
  const min = d.min ?? 0, max = d.max ?? (Math.max(...items.flatMap((i) => [+i.a, +i.b])) <= 100 ? 100 : Math.max(...items.flatMap((i) => [+i.a, +i.b])) * 1.1);
  const fs = 12.5, lh = 15;
  const labs = items.map((i) => wrap(i.label, 210 / fs));
  const labW = Math.max(...labs.map((l) => linesW(l, fs))) * 1.06 + 18;
  const W = 720, left = labW, right = 44, top = 6;
  const rowH = labs.map((l) => Math.max(32, l.length * lh + 10));
  const H = top + rowH.reduce((a, b) => a + b, 0) + 24, plotW = W - left - right;
  const X = (v) => left + ((+v - min) / (max - min)) * plotW;
  let svg = svgOpen(W, H, d.aria || "ダンベルチャート");
  const step = (max - min) / 4;
  for (let t = min; t <= max + 1e-9; t += step) svg += `<line x1="${X(t)}" x2="${X(t)}" y1="${top}" y2="${H - 20}" class="grid"/><text x="${X(t)}" y="${H - 5}" text-anchor="middle" class="axis-label tick">${fmt(+t.toFixed(2), suffix)}</text>`;
  let y0 = top;
  items.forEach((it, i) => {
    const y = y0 + rowH[i] / 2;
    svg += tspans(labs[i], left - 8, y, lh, "axis-label");
    svg += `<line x1="${X(it.a)}" x2="${X(it.b)}" y1="${y}" y2="${y}" class="connector"/>`;
    svg += `<circle cx="${X(it.a)}" cy="${y}" r="6" fill="${SER(0)}" class="ring"><title>${esc(it.label)} · ${esc(names[0])}: ${fmt(it.a, suffix)}</title></circle>`;
    svg += `<circle cx="${X(it.b)}" cy="${y}" r="6" fill="${SER(1)}" class="ring"><title>${esc(it.label)} · ${esc(names[1])}: ${fmt(it.b, suffix)}</title></circle>`;
    const lo = Math.min(X(it.a), X(it.b)), hi = Math.max(X(it.a), X(it.b));
    svg += `<text x="${lo - 10}" y="${y + 4}" text-anchor="end" class="value-label small">${fmt(Math.min(+it.a, +it.b), suffix)}</text><text x="${hi + 10}" y="${y + 4}" class="value-label small">${fmt(Math.max(+it.a, +it.b), suffix)}</text>`;
    y0 += rowH[i];
  });
  svg += `</svg>`;
  return legend(names) + svg + note(d) + tableTwin(["項目", names[0], names[1]], items.map((i) => [i.label, fmt(i.a, suffix), fmt(i.b, suffix)]));
}

// ---------- line (few series, x categorical/ordinal, one shared x) ----------
function line(d) {
  const series = (d.series || []).map((s) => ({ ...s, points: s.points.map((p) => (Array.isArray(p) ? { x: p[0], y: p[1] } : p)) }));
  const { suffix } = unitParts(d.unit);
  const xs = d.x || [...new Set(series.flatMap((s) => s.points.map((p) => p.x)))];
  const max = d.max ?? Math.max(...series.flatMap((s) => s.points.map((p) => +p.y))) * 1.12, min = d.min ?? 0;
  const endLab = series.map((s) => `${s.name} ${fmt(s.points[s.points.length - 1].y, suffix)}`);
  const W = 720, H = 280, left = 64, right = Math.min(260, linesW(endLab, 12.5) + 24), top = 16, bottom = 40, plotW = W - left - right, plotH = H - top - bottom;
  // optional proportional time axis (xDates: ISO dates aligned with xs) and log y axis (log: true, min > 0)
  const tms = d.xDates ? d.xDates.map((v) => new Date(v).getTime()) : null;
  const X = tms ? (x) => { const i = xs.indexOf(x); return left + ((tms[i] - tms[0]) / Math.max(tms[tms.length - 1] - tms[0], 1)) * plotW; } : (x) => left + (xs.indexOf(x) / Math.max(xs.length - 1, 1)) * plotW;
  const lmin = d.log ? Math.max(min, d.min ?? 1) : min;
  const Y = d.log ? (y) => top + plotH - ((Math.log10(Math.max(+y, lmin)) - Math.log10(lmin)) / (Math.log10(max) - Math.log10(lmin))) * plotH : (y) => top + plotH - ((+y - min) / (max - min)) * plotH;
  let svg = svgOpen(W, H, d.aria || "折れ線グラフ");
  if (d.capAt) { svg += `<rect x="${left}" y="${top}" width="${plotW}" height="${Math.max(0, Y(d.capAt) - top)}" fill="var(--surface-2)"/><text x="${left + 6}" y="${top + 14}" class="axis-label small muted">${esc(d.capLabel || "計測上限")}</text>`; }
  const ticks = d.ticks || (d.log ? [1, 10, 100, 1000, 10000].filter((t) => t >= lmin && t <= max) : [0, 25, 50, 75, 100].filter((t) => t <= max && t >= min));
  for (const t of ticks) svg += `<line x1="${left}" x2="${W - right}" y1="${Y(t)}" y2="${Y(t)}" class="grid"/><text x="${left - 6}" y="${Y(t) + 4}" text-anchor="end" class="axis-label tick">${fmt(t, suffix)}</text>`;
  xs.forEach((x, i) => { if (tms && xs.length > 7 && i % 2 === 1 && i !== xs.length - 1) return; svg += `<text x="${X(x)}" y="${H - bottom + 18}" text-anchor="middle" class="axis-label${tms ? " small" : ""}">${esc(x)}</text>`; });
  series.forEach((s, si) => {
    const pts = s.points.map((p) => `${X(p.x)},${Y(p.y)}`).join(" ");
    svg += `<polyline points="${pts}" fill="none" stroke="${SER(si)}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"${s.dashed ? ' stroke-dasharray="4 4"' : ""}/>`;
    s.points.forEach((p) => (svg += `<circle cx="${X(p.x)}" cy="${Y(p.y)}" r="4.5" fill="${SER(si)}" class="ring"><title>${esc(s.name)} · ${esc(p.x)}: ${fmt(p.y, suffix)}</title></circle>`));
    const last = s.points[s.points.length - 1];
    svg += `<text x="${X(last.x) + 10}" y="${Y(last.y) + 4}" class="value-label">${esc(endLab[si])}</text>`;
  });
  svg += `<line x1="${left}" x2="${W - right}" y1="${top + plotH}" y2="${top + plotH}" class="baseline"/></svg>`;
  return legend(series.map((s) => s.name)) + svg + note(d) + tableTwin(["x", ...series.map((s) => s.name)], xs.map((x) => [x, ...series.map((s) => { const p = s.points.find((q) => q.x === x); return p ? fmt(p.y, suffix) : "—"; })]));
}

// one small line panel with its own x axis (for small multiples; never a shared/dual axis)
function linePanel(p, si) {
  const pts = p.points, W = 340, H = 210, left = 50, right = 12, top = 22, bottom = 44, plotW = W - left - right, plotH = H - top - bottom;
  const min = p.min ?? 0, max = p.max ?? 100, inset = 46;
  const X = (i) => left + inset + (i / Math.max(pts.length - 1, 1)) * (plotW - 2 * inset), Y = (y) => top + plotH - ((+y - min) / (max - min)) * plotH;
  let svg = svgOpen(W, H, `${p.title}: ${pts.map((q) => `${q.x} ${fmt(q.y, p.suffix)}`).join(" → ")}`, "chart panel");
  for (const t of p.ticks || [0, 25, 50, 75, 100]) svg += `<line x1="${left}" x2="${W - right}" y1="${Y(t)}" y2="${Y(t)}" class="grid"/><text x="${left - 6}" y="${Y(t) + 4}" text-anchor="end" class="axis-label tick">${fmt(t, p.suffix)}</text>`;
  svg += `<line x1="${left}" x2="${W - right}" y1="${top + plotH}" y2="${top + plotH}" class="baseline"/>`;
  const colW = Math.min((plotW - 2 * inset) / Math.max(pts.length - 1, 1), 2 * inset);
  pts.forEach((q, i) => { const ls = wrap(q.x, Math.max(6, (colW - 8) / 11.5 / 1.06)); ls.forEach((ln, li) => (svg += `<text x="${X(i)}" y="${top + plotH + 16 + li * 14}" text-anchor="middle" class="axis-label small">${esc(ln)}</text>`)); });
  svg += `<polyline points="${pts.map((q, i) => `${X(i)},${Y(q.y)}`).join(" ")}" fill="none" stroke="${SER(si)}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"${p.dashed ? ' stroke-dasharray="5 4"' : ""}/>`;
  pts.forEach((q, i) => (svg += `<circle cx="${X(i)}" cy="${Y(q.y)}" r="4.5" fill="${SER(si)}" class="ring"><title>${esc(p.title)} · ${esc(q.x)}: ${fmt(q.y, p.suffix)}</title></circle><text x="${X(i)}" y="${Y(q.y) - 10}" text-anchor="middle" class="value-label small">${esc(q.label ?? fmt(q.y, p.suffix))}</text>`));
  return svg + `</svg>`;
}
function panelGrid(panels, aria) {
  return `<div class="panels" role="group" aria-label="${esc(aria)}">${panels.map((p, i) => `<div class="panel"><div class="panel-t"><span class="swatch" style="background:${SER(i)}"></span>${esc(p.title)}</div>${p.sub ? `<div class="panel-s">${esc(p.sub)}</div>` : ""}${linePanel(p, i)}</div>`).join("")}</div>`;
}
// dual-line: two series measured on different surveys → side-by-side panels, each its own x axis
function dualLine(d) {
  const series = (d.series || []).map((s) => ({ ...s, points: s.points.map((p) => (Array.isArray(p) ? { x: p[0], y: p[1] } : p)) }));
  const sameX = series.length > 1 && series.every((s) => JSON.stringify(s.points.map((p) => p.x)) === JSON.stringify(series[0].points.map((p) => p.x)));
  if (sameX) return line({ ...d, series });
  const panels = series.map((s) => { const { suffix } = unitParts(s.unit ?? d.unit); const mx = Math.max(...s.points.map((p) => +p.y)); return { title: s.name, sub: s.src ? `出典 ${s.src}` : "", suffix, points: s.points, dashed: true, max: suffix === "%" ? 100 : mx * 1.2, ticks: suffix === "%" ? [0, 25, 50, 75, 100] : undefined }; });
  const xs = [...new Set(series.flatMap((s) => s.points.map((p) => p.x)))];
  return panelGrid(panels, d.aria || "別調査の 2 系列 (横軸は調査ごと)") + note(d, ["横軸は系列ごとに別の調査期間 (共通軸ではない)"]) +
    tableTwin(["系列", "時点", "値"], series.flatMap((s) => s.points.map((p) => [s.name, p.x, fmt(p.y, unitParts(s.unit ?? d.unit).suffix)]))) + (xs.length ? "" : "");
}
// dose-response: each effect = baseline 100 → relative change, one panel per relationship
function doseResponse(d) {
  const panels = (d.effects || []).map((e) => {
    const xm = String(e.x).match(/^(.*?)\s*([+＋−-][\d.]+\s*\S*)$/), ym = String(e.y).match(/^(.*?)\s*([+＋−-])\s*([\d.]+)\s*%/);
    const delta = ym ? (/[−-]/.test(ym[2]) ? -1 : 1) * +ym[3] : 0;
    const what = ym ? ym[1] : String(e.y);
    return { title: xm ? xm[1] : e.x, sub: `${what} (基準 = 100 の相対値)`, suffix: "", min: 0, max: 100, ticks: [0, 50, 100], points: [{ x: "基準", y: 100 }, { x: xm ? xm[2] : "増加", y: 100 + delta, label: `${100 + delta} (${e.y.replace(what, "").trim()})` }], raw: e };
  });
  const extra = d.null_effects?.length ? [`関係が見られなかったもの: ${d.null_effects.map(esc).join("、")}`] : [];
  return panelGrid(panels, d.aria || "確認の回数・重複と受容確率の関係") + note(d, ["概念図: 起点を 100 とした相対値。横軸は関係ごとに別の変数", ...extra]) +
    tableTwin(["説明変数の変化", "受容確率の変化"], (d.effects || []).map((e) => [e.x, e.y]));
}

// ---------- timeline: lanes by kind, labels levelled so they never overlap ----------
// Superseded dates written as "(改正前 YYYY-MM-DD)" in a label are drawn as hollow markers just
// above the main lane with a dashed arc to the new date (arcs sit above the line, labels below).
function timeline(d) {
  let ev = (d.events || []).map((e) => (Array.isArray(e) ? { date: e[0], label: e[1] } : { ...e }));
  const links = [];
  ev.forEach((e) => {
    e.full = e.label;
    const m = String(e.label).match(/\s*[(（]改正前\s*(\d{4}-\d{2}-\d{2})[)）]/);
    if (m) { e.label = e.label.replace(m[0], ""); links.push({ from: m[1], to: e }); }
  });
  for (const s of d.superseded || []) if (!links.some((l) => l.from === s)) ev.push({ date: s, label: "改正前の適用日", kind: "old", full: "改正前の適用日" });
  // jp_guideline_versions: ["YYYY-MM-DD", …] or [["YYYY-MM-DD", "第1.0版"], …]
  (d.jp_guideline_versions || []).forEach((v, i) => { const [date, ver] = Array.isArray(v) ? v : [v, ""]; const what = ver ? `AI事業者GL ${ver}` : i === 0 ? "AI事業者GL 公表" : "AI事業者GL 改訂"; ev.push({ date, label: what, kind: "jp", full: what }); });
  const kn = { main: d.kindNames?.main || (links.length || d.superseded ? "適用日 (改正後)" : "現行"), old: d.kindNames?.old || "改正前の適用日", jp: d.kindNames?.jp || "日本 AI事業者GL", ref: d.kindNames?.ref || "参照" };
  const kcol = (k) => (k === "old" ? "var(--de-emphasis)" : k === "jp" ? SER(2) : k === "ref" ? SER(1) : SER(0));
  const order = ["main", "old", "jp", "ref"];
  const kinds = [...new Set(ev.map((e) => e.kind || "main"))].sort((a, b) => order.indexOf(a) - order.indexOf(b));
  const t = (s) => new Date(s).getTime();
  const dates = [...ev.map((e) => t(e.date)), ...links.map((l) => t(l.from))];
  const y0 = new Date(Math.min(...dates)).getUTCFullYear(), y1 = new Date(Math.max(...dates)).getUTCFullYear() + 1;
  const t0 = d.start ? t(d.start) : t(`${y0}-01-01`), t1 = d.end ? t(d.end) : t(`${y1}-01-01`);
  const fs = 11.5, lh = 14;
  const laneW = Math.max(...kinds.map((k) => linesW(wrap(kn[k], 9), 12))) * 1.06 + 16;
  const W = 760, left = laneW + 8, right = 16, axisY = 22;
  const X = (s) => left + ((t(s) - t0) / (t1 - t0)) * (W - left - right);
  let body = "", y = axisY + 10;
  for (const k of kinds) {
    const list = ev.filter((e) => (e.kind || "main") === k).sort((a, b) => t(a.date) - t(b.date));
    const placed = [], ends = [];
    list.forEach((e) => {
      const lines = [e.date, ...wrap(e.label, 15)], w = linesW(lines, fs) * 1.06 + 4, x = X(e.date);
      let span = [x - 3, x - 3 + w], anchor = "start";
      if (span[1] > W - right) { span = [x + 3 - w, x + 3]; anchor = "end"; }
      let lvl = ends.findIndex((end) => end < span[0] - 8); if (lvl < 0) { lvl = ends.length; ends.push(0); }
      ends[lvl] = span[1];
      placed.push({ e, x, lines, lvl, anchor });
    });
    const slot = Math.max(...placed.map((p) => p.lines.length)) * lh + 10;
    const arcRoom = k === "main" && links.length ? 40 : 0;
    const ly = y + 8 + arcRoom;
    body += `<line x1="${left}" x2="${W - right}" y1="${ly}" y2="${ly}" class="baseline"/>`;
    body += tspans(wrap(kn[k], 9), laneW, ly + 2, 14, "axis-label lane-label");
    if (arcRoom) links.forEach((l, li) => {
      const xa = X(l.from), xb = X(l.to.date), oy = ly - 16, apex = ly - 30 - (li % 2) * 8;
      body += `<path d="M${xa + 5},${oy - 2} C${xa + 20},${apex} ${xb - 12},${apex} ${xb},${ly - 8}" fill="none" class="link-arrow" marker-end="url(#tl-arr)"><title>${esc(l.to.label)}: ${esc(l.from)} → ${esc(l.to.date)}</title></path>`;
      body += `<circle cx="${xa}" cy="${oy}" r="4.5" class="hollow"><title>改正前 ${esc(l.from)} ${esc(l.to.label)}</title></circle>`;
    });
    placed.forEach(({ e, x, lines, lvl, anchor }) => {
      const top = ly + 14 + lvl * slot;
      body += `<line x1="${x}" x2="${x}" y1="${ly}" y2="${top - 2}" class="connector thin"/>`;
      lines.forEach((ln, li) => (body += `<text x="${anchor === "start" ? x - 3 : x + 3}" y="${top + 10 + li * lh}" text-anchor="${anchor}" class="${li === 0 ? "axis-label tick small" : `axis-label small${k === "old" ? " muted" : ""}`}">${esc(ln)}</text>`));
      body += `<circle cx="${x}" cy="${ly}" r="5" fill="${kcol(k)}" class="ring"><title>${esc(e.date)} ${esc(e.full || e.label)}</title></circle>`;
    });
    y = ly + 14 + ends.length * slot + 8;
  }
  const H = y;
  let grid = "";
  for (let yy = new Date(t0).getUTCFullYear(); yy <= new Date(t1).getUTCFullYear(); yy++) { const s = `${yy}-01-01`; const x = X(s); if (t(s) >= t0 && t(s) <= t1) grid += `<line x1="${x}" x2="${x}" y1="${axisY}" y2="${H - 4}" class="grid"/>${x < W - right - 16 ? `<text x="${x}" y="${axisY - 6}" text-anchor="middle" class="axis-label tick">${yy}</text>` : ""}`; }
  const svg = svgOpen(W, H, d.aria || "タイムライン") + `<defs><marker id="tl-arr" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" class="arrow-head"/></marker></defs>` + grid + body + `</svg>`;
  const extra = [];
  if (d.gdpr) extra.push(`参照: GDPR は発効 ${esc(d.gdpr.in_force)} → 適用 ${esc(d.gdpr.applies)}${d.gdpr.months ? ` (${esc(d.gdpr.months)} か月)` : ""}`);
  const lgItems = kinds.map((k) => `<span class="legend-item"><span class="swatch" style="background:${kcol(k)}"></span>${esc(kn[k])}</span>`);
  if (links.length) lgItems.push(`<span class="legend-item"><span class="swatch hollow-sw"></span>${esc(kn.old)} (破線の矢印 → 延期後)</span>`);
  const lg = lgItems.length >= 2 ? `<div class="legend">${lgItems.join("")}</div>` : "";
  const rows = [...ev.map((e) => [e.date, e.full || e.label, kn[e.kind || "main"] || e.kind]), ...links.map((l) => [l.from, `${l.to.label} (改正前の適用日 → ${l.to.date})`, kn.old])];
  return lg + svg + note(d, extra) + tableTwin(["日付", "事象", "区分"], rows.sort((a, b) => (a[0] > b[0] ? 1 : -1)));
}

// ---------- matrix (rows × cols, categorical cell values with legend) ----------
function matrix(d) {
  let rows = d.rows || [], cols = d.cols || d.columns || [], cells = d.cells || [], lg = d.legend || {};
  if (rows.length && typeof rows[0] === "object" && rows[0].cells) {
    // editor shape: rows [{name, kind, cells:[text]}] → level by row kind (binding strength)
    const kinds = [...new Set(rows.map((r) => r.kind).filter(Boolean))];
    const lvl = (k) => (kinds.length ? 3 - kinds.indexOf(k) : 2);
    const absent = (s) => /^(—|-|NOT FOUND)/.test(String(s).trim());
    cells = rows.map((r) => r.cells.map((c) => ({ v: absent(c) ? 0 : Math.max(1, lvl(r.kind)), label: c, tip: `${r.name} × ${c}` })));
    lg = { ...Object.fromEntries(kinds.map((k) => [Math.max(1, lvl(k)), k])), 0: "該当なし / 未確認" };
    rows = rows.map((r) => r.name);
  }
  const cls = (v) => ({ 0: "m0", 1: "m1", 2: "m2", 3: "m3", 4: "m4" }[v] || "m0");
  let html = `<div class="matrix-wrap"><table class="matrix"><thead><tr><th></th>${cols.map((c) => `<th>${esc(c)}</th>`).join("")}</tr></thead><tbody>`;
  rows.forEach((r, ri) => { html += `<tr><th scope="row">${esc(r)}</th>${cols.map((_, ci) => { const c = cells[ri]?.[ci]; const v = typeof c === "object" ? c.v : c; const label = typeof c === "object" ? c.label : lg[v] ?? ""; const tip = typeof c === "object" && c.tip ? c.tip : ""; return `<td class="${cls(v)}" title="${esc(tip || label)}">${esc(label)}</td>`; }).join("")}</tr>`; });
  html += `</tbody></table></div>`;
  const lgHtml = Object.keys(lg).length ? `<div class="legend">${Object.entries(lg).sort((a, b) => b[0] - a[0]).map(([k, v]) => `<span class="legend-item"><span class="swatch ${cls(+k)}"></span>${esc(v)}</span>`).join("")}</div>` : "";
  return lgHtml + html + note(d);
}

// ---------- plain table (arrays, objects, or the markdown table that follows the block) ----------
const COL_NAMES = { name: "名称", date: "日付", path: "経路", cvss: "CVSS", fix: "修正・緩和", harm: "実害" };
function table(d, ctx = {}) {
  let cols = d.columns || [], rows = d.rows || [], raw = false;
  if (d.table === "following-markdown" && ctx.table) { cols = ctx.table.columns; rows = ctx.table.rows; raw = true; }
  if (rows.length && !Array.isArray(rows[0]) && typeof rows[0] === "object") {
    const keys = [...new Set(rows.flatMap((r) => Object.keys(r)))];
    if (!cols.length) cols = keys.map((k) => COL_NAMES[k] || k);
    rows = rows.map((r) => keys.map((k) => r[k] ?? ""));
  }
  const cell = (c) => { const s = raw ? String(c) : esc(c); return /^NOT FOUND/.test(String(c)) ? `<span class="nf">${s}</span>` : /^\d{4}-\d{2}(-\d{2})?$/.test(String(c)) ? `<span class="nowrap">${s}</span>` : s; };
  return `<div class="table-wrap"><table class="data"><thead><tr>${cols.map((c) => `<th>${raw ? c : esc(c)}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c, i) => `<t${i === 0 ? 'h scope="row"' : "d"}>${cell(c)}</t${i === 0 ? "h" : "d"}>`).join("")}</tr>`).join("")}</tbody></table></div>` + note(d);
}

// ---------- roadmap: stages as cards with gate diamonds between ----------
function roadmap(d) {
  const stages = d.stages || [];
  if (stages.length && stages[0].title === undefined) return stageCards(d);
  const W = 760, boxW = Math.min(150, (W - 40) / stages.length - 16), boxH = 64, top = 20, H = top + boxH + 90;
  let svg = svgOpen(W, H, d.aria || "ロードマップ");
  const totalW = stages.length * boxW + (stages.length - 1) * 16, x0 = (W - totalW) / 2;
  stages.forEach((s, i) => {
    const x = x0 + i * (boxW + 16), fill = s.phase === "later" ? "var(--de-emphasis)" : s.phase === "measure" ? SER(1) : SER(0);
    svg += `<rect x="${x}" y="${top}" width="${boxW}" height="${boxH}" rx="6" fill="${fill}"><title>${esc(s.title)}${s.detail ? ": " + esc(s.detail) : ""}</title></rect>`;
    svg += tspans(String(s.title).split("\n"), x + boxW / 2, top + boxH / 2, 16, "in-fill", "middle");
    if (s.when) svg += `<text x="${x + boxW / 2}" y="${top + boxH + 18}" text-anchor="middle" class="axis-label tick">${esc(s.when)}</text>`;
    if (s.gate) { const gx = x + boxW + 8; svg += `<path d="M${gx},${top + boxH / 2 - 10} l8,10 l-8,10 l-8,-10 z" class="gate-mark"><title>${esc(s.gate)}</title></path><text x="${gx}" y="${top + boxH + 40}" text-anchor="middle" class="axis-label small muted">${esc(s.gate)}</text>`; }
  });
  svg += `</svg>`;
  const lg = `<div class="legend"><span class="legend-item"><span class="swatch" style="background:${SER(0)}"></span>${esc(d.phaseNames?.now || "同時に敷く")}</span><span class="legend-item"><span class="swatch" style="background:${SER(1)}"></span>${esc(d.phaseNames?.measure || "第三者が数える")}</span><span class="legend-item"><span class="swatch" style="background:var(--de-emphasis)"></span>${esc(d.phaseNames?.later || "後段")}</span><span class="legend-item"><span class="dia"></span>ゲート</span></div>`;
  return lg + svg + note(d) + tableTwin(["段階", "時期", "内容", "ゲート"], stages.map((s) => [s.title.replace(/\n/g, " "), s.when || "", s.detail || "", s.gate || ""]));
}
// editor shape: stages [{id,label,items[],quarter,who}], gates [{after,rule}] → HTML cards (reflow on phones)
function stageCards(d) {
  const stages = d.stages || [], gates = d.gates || [];
  const col = (i) => (i === stages.length - 1 && stages.length > 2 ? "var(--de-emphasis)" : SER(i));
  let html = `<div class="stages" role="group" aria-label="${esc(d.aria || "投資の順序")}" style="--n:${stages.length}">`;
  stages.forEach((s, i) => {
    html += `<div class="stage" style="--stage-c:${col(i)}" title="${esc(s.label)}"><div class="stage-head"><span class="stage-id">${esc(s.id || i + 1)}</span>${s.quarter ? `<span class="stage-when">${esc(s.quarter)}</span>` : ""}</div><div class="stage-title">${esc(s.label)}</div>${s.who ? `<div class="stage-who">測る主体: ${esc(s.who)}</div>` : ""}<ul>${(s.items || []).map((it) => `<li>${esc(it)}</li>`).join("")}</ul></div>`;
    const g = gates.find((g) => g.after === s.id);
    if (i < stages.length - 1) html += `<div class="gate-col"${g ? ` title="${esc(g.rule)}"` : ""}>${g ? `<span class="dia" aria-hidden="true"></span><span>${esc(g.rule)}</span>` : `<span class="arrow" aria-hidden="true">→</span>`}</div>`;
  });
  html += `</div>`;
  const lg = `<div class="legend"><span class="legend-item"><span class="dia"></span>ゲート (通過条件)</span></div>`;
  return lg + html + note(d) + tableTwin(["段階", "時期", "内容", "次のゲート"], stages.map((s) => [`${s.id} ${s.label}`, s.quarter || "", (s.items || []).join(" / "), gates.find((g) => g.after === s.id)?.rule || ""]));
}

// ---------- process: S0–S11 stage boxes with gate diamonds (grid wraps 6 → 3 per row) ----------
function processFlow(d) {
  const cols = d.columns || ["段階", "成果物", "審査者"];
  const stages = (d.stages || []).map((s) => (Array.isArray(s) ? { id: s[0], out: s[1], who: s[2] } : { id: s.id, out: s.label || s.out, who: s.who || s.reviewers }));
  const gv = (d.gate_values || []).join(" / ");
  let html = `<ol class="proc" aria-label="${esc(d.aria || `${stages.length} 段階のゲート付きプロセス`)}">`;
  stages.forEach((s, i) => { html += `<li title="${esc(`${s.id} ${s.out} — ${cols[2]}: ${s.who}`)}"><span class="p-id">${esc(s.id)}</span><span class="p-out">${esc(s.out)}</span><span class="p-rev">${esc(s.who)}</span>${i < stages.length - 1 ? `<span class="gate" title="${esc(`${s.id} ゲート: ${gv}`)}"></span>` : ""}</li>`; });
  html += `</ol>`;
  const lg = `<div class="legend"><span class="legend-item"><span class="dia"></span>ゲート${gv ? ` (${esc(gv)})` : ""}</span><span class="legend-item"><span class="p-rev-key">小字</span>= ${esc(cols[2])}</span></div>`;
  const borrowed = d.borrowed?.length ? `<p class="fig-note">借用した型: ${d.borrowed.map((b) => `<span class="flag">${esc(b)}</span>`).join(" ")}</p>` : "";
  return lg + html + borrowed + note(d) + tableTwin(cols, stages.map((s) => [s.id, s.out, s.who]));
}

// ---------- gated roadmap: quarters × lanes (作業 / ゲート / 判定者); stacks per quarter on phones ----------
function gatedRoadmap(d) {
  const qs = d.quarters || [];
  const dv = (d.decision_values || []).join(" / ");
  let html = `<div class="groad-wrap"><div class="groad" role="group" aria-label="${esc(d.aria || "ゲート付きロードマップ")}" style="--n:${qs.length}"><div class="glanes" aria-hidden="true"><div></div><div>作業</div><div>ゲート</div><div>判定者</div></div>`;
  qs.forEach((q, i) => {
    html += `<div class="gq"><div class="gq-head">Q${esc(q.q)}${q.label ? ` ${esc(q.label)}` : ""}</div><div class="gq-work" style="--lane-c:${SER(q.lane ?? 0)}">${esc(q.work)}</div><div class="gq-gate" title="${esc(`${q.gate}: ${dv}`)}"><span class="dia"></span>${esc(q.gate)}</div><div class="gq-judge">${esc(q.judge)}</div></div>`;
  });
  html += `</div></div>`;
  const lg = `<div class="legend"><span class="legend-item"><span class="dia"></span>四半期末のゲート${dv ? ` — 判定は ${esc(dv)}` : ""}</span></div>`;
  return lg + html + note(d) + tableTwin(["四半期", "作業", "ゲート", "判定者"], qs.map((q) => [`Q${q.q}`, q.work, q.gate, q.judge]));
}

// ---------- two-layer: stacked bands × vendor columns, examples placed by vendor name ----------
function twoLayer(d) {
  const layers = d.layers || [], vendors = Object.keys(d.vendors || {});
  const vOf = (ex) => vendors.find((v) => String(ex).startsWith(v)) || vendors.find((v) => String(ex).includes(v));
  let html = `<div class="hscroll"><div class="tl" role="group" aria-label="${esc(d.aria || "再利用の単位 二層")}" style="--n:${vendors.length}"><div></div>${vendors.map((v) => `<div class="tl-vh">${esc(v)}<span class="tl-vk">${esc(d.vendors[v])}</span></div>`).join("")}`;
  layers.forEach((L, li) => {
    html += `<div class="tl-band" style="--band-c:${SER(li === 0 ? 0 : 2)}">${esc(L.name)}</div>`;
    vendors.forEach((v) => { const ex = (L.examples || []).filter((e) => vOf(e) === v); html += `<div class="tl-cell">${ex.length ? ex.map((e) => `<div class="tl-item" title="${esc(e)}">${esc(String(e).replace(new RegExp(`^${v}\\s*`), ""))}</div>`).join("") : `<span class="tl-empty">—</span>`}</div>`; });
  });
  html += `</div></div>`;
  const orphans = layers.flatMap((L) => (L.examples || []).filter((e) => !vOf(e)).map((e) => `${L.name}: ${e}`));
  const extra = [d.reuse_rate ? `再利用率: ${esc(d.reuse_rate)}` : "", orphans.length ? `ベンダ未特定: ${orphans.map(esc).join("、")}` : ""];
  return legend(layers.map((L) => L.name), layers.map((_, i) => SER(i === 0 ? 0 : 2))) + html + note(d, extra) + tableTwin(["層", "ベンダ", "例"], layers.flatMap((L) => (L.examples || []).map((e) => [L.name, vOf(e) || "", e])));
}

// ---------- mapping: three columns joined by connectors; gaps listed under the middle column ----------
function mapping(d) {
  const cols = d.columns || ["A", "B", "C"], rows = d.map || [];
  const empty = (s) => /^(—|-|)$/.test(String(s ?? "").trim());
  let html = `<div class="map" role="group" aria-label="${esc(d.aria || cols.join(" ↔ "))}">`;
  html += cols.map((c, i) => `${i ? `<div></div>` : ""}<div class="map-h">${esc(c)}</div>`).join("");
  rows.forEach((r) => {
    r.forEach((c, i) => {
      if (i) html += `<div class="map-x${empty(c) ? " weak" : ""}" aria-hidden="true"></div>`;
      html += `<div class="map-c${i === 0 ? " k0" : ""}${empty(c) ? " empty" : ""}" title="${esc(r.join(" ↔ "))}">${empty(c) ? "—" : esc(c)}</div>`;
    });
  });
  if (d.gaps?.length) html += `<div class="map-gaps"><div class="map-gt">写像から漏れる経路 (穴)</div><ul>${d.gaps.map((g) => `<li>${esc(g)}</li>`).join("")}</ul></div>`;
  html += `</div>`;
  return html + note(d) + tableTwin(cols, rows.map((r) => r.map((c) => (empty(c) ? "—" : c))).concat((d.gaps || []).map((g) => ["(穴)", g, ""])));
}

// ---------- flow diagram: boxes in rows, optional row labels (bands) and arrows ----------
function diagram(d) {
  // d.rows: [[{id,label,kind?,tip?}], ...]; d.edges: [[fromId,toId,label?]]; d.rowLabels: [..]; d.rowEdges: [[ri,rj,label?]]
  const rows = d.rows || [], W = d.width || 760, rowGap = d.rowGap ?? 40, top = 12, fs = 12, lh = 15;
  const rl = d.rowLabels || [], rlLines = rl.map((s) => wrap(s, 7));
  const left = rl.length ? Math.max(...rlLines.map((l) => linesW(l, 12.5))) + 24 : 16, right = 16, avail = W - left - right;
  const pos = {}, rowY = [], rowHs = [];
  let y = top;
  rows.forEach((r, ri) => {
    const n = r.length, bw = Math.min(n === 1 ? 460 : n === 2 ? 300 : 210, (avail - (n - 1) * 14) / n);
    const lines = r.map((b) => wrap(b.label, (bw - 16) / fs));
    const h = Math.max(44, Math.max(...lines.map((l) => l.length)) * lh + 18);
    const total = n * bw + (n - 1) * 14, x0 = left + (avail - total) / 2;
    r.forEach((b, bi) => (pos[b.id] = { x: x0 + bi * (bw + 14), y, w: bw, h, b, lines: lines[bi] }));
    rowY.push(y); rowHs.push(h); y += h + rowGap;
  });
  const H = y - rowGap + 12;
  const fillOf = (k) => (k === "human" ? SER(1) : k === "third" ? SER(2) : k === "muted" ? "var(--de-emphasis)" : k === "plain" ? "var(--surface-1)" : SER(0));
  let svg = svgOpen(W, H, d.aria || "図") + `<defs><marker id="arr-${esc(d.uid || "d")}" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" class="arrow-head"/></marker></defs>`;
  const mk = `url(#arr-${esc(d.uid || "d")})`;
  rl.forEach((_, ri) => { if (rowY[ri] === undefined) return; svg += `<rect x="4" y="${rowY[ri] - 6}" width="${W - 8}" height="${rowHs[ri] + 12}" rx="8" class="band"/>`; svg += tspans(rlLines[ri], 14, rowY[ri] + rowHs[ri] / 2, 15, "axis-label lane-label", "start"); });
  (d.edges || []).forEach(([a, b, label]) => { const A = pos[a], B = pos[b]; if (!A || !B) return; const x1 = A.x + A.w / 2, y1 = A.y + A.h, x2 = B.x + B.w / 2, y2 = B.y; svg += `<path d="M${x1},${y1} C${x1},${(y1 + y2) / 2} ${x2},${(y1 + y2) / 2} ${x2},${y2 - 2}" fill="none" class="flow-arrow" marker-end="${mk}"/>`; if (label) svg += `<text x="${(x1 + x2) / 2 + 6}" y="${(y1 + y2) / 2 + 4}" class="axis-label small muted">${esc(label)}</text>`; });
  (d.rowEdges || []).forEach(([a, b, label]) => { const x = left + avail / 2, y1 = rowY[a] + rowHs[a] + 6, y2 = rowY[b] - 6; svg += `<path d="M${x},${y1} V${y2 - 2}" fill="none" class="flow-arrow" marker-end="${mk}"/>`; if (label) svg += `<text x="${x + 10}" y="${(y1 + y2) / 2 + 4}" class="axis-label small">${esc(label)}</text>`; });
  Object.values(pos).forEach(({ x, y, w, h, b, lines }) => {
    const kind = b.kind || "main", ink = kind === "plain" || kind === "muted" ? "axis-label box-ink" : "in-fill";
    svg += `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="6" fill="${fillOf(kind)}"${kind === "plain" ? ' class="box-plain"' : ""}><title>${esc(b.tip || b.label)}</title></rect>`;
    svg += tspans(lines, x + w / 2, y + h / 2, lh, ink, "middle");
  });
  svg += `</svg>`;
  const kinds = d.kindNames || {};
  const lg = Object.keys(kinds).length >= 2 ? `<div class="legend">${Object.entries(kinds).map(([k, v]) => `<span class="legend-item"><span class="swatch${k === "plain" ? " m0" : ""}" style="background:${fillOf(k)}"></span>${esc(v)}</span>`).join("")}</div>` : "";
  const rowOf = (id) => rows.findIndex((r) => r.some((b) => b.id === id));
  return lg + svg + note(d, d.extraNotes || []) + tableTwin(d.twinCols || ["要素", "種別", "説明"], Object.values(pos).map(({ b }) => [String(b.label).replace(/\n/g, " "), (rl[rowOf(b.id)] ?? kinds[b.kind || "main"]) || "", b.tip || ""]));
}
// principle-diagram: layers [{name, items[]}] + metrics[] → banded rows, top layer flows into the next
function principleDiagram(d) {
  const kindsBy = ["main", "human", "third"];
  const rows = (d.layers || []).map((L, li) => (L.items || []).map((it, ii) => ({ id: `L${li}-${ii}`, label: it, kind: kindsBy[li % 3] })));
  const rowLabels = (d.layers || []).map((L) => L.name);
  if (d.metrics?.length) { rows.push(d.metrics.map((m, i) => ({ id: `M${i}`, label: m, kind: "plain" }))); rowLabels.push("測る指標"); }
  const rowEdges = rows.slice(1).map((_, i) => [i, i + 1]);
  return diagram({ ...d, uid: "pd", rows, rowLabels, rowEdges, rowGap: 30, aria: d.aria || rowLabels.join(" → ") });
}
// experiment-design: design steps in order, the arms inserted after the randomisation step, aggregator last
function experimentDesign(d) {
  const steps = d.design || [], arms = d.arms || [];
  let ri = steps.findIndex((s) => /割付|ランダム|random/i.test(s)); if (ri < 0) ri = 0;
  const rows = [], edges = [];
  const stepRow = (s, i) => [{ id: `S${i}`, label: s, kind: "plain" }];
  steps.forEach((s, i) => {
    rows.push(stepRow(s, i));
    if (i === ri) rows.push(arms.map((a, ai) => ({ id: `A${ai}`, label: `${a.name}\n${a.setting}`, kind: ai === 0 ? "muted" : "main", tip: `${a.name}: ${a.setting}` })));
  });
  if (d.aggregator) rows.push([{ id: "AGG", label: `集計: ${d.aggregator}`, kind: "third" }]);
  for (let r = 0; r < rows.length - 1; r++) for (const a of rows[r]) for (const b of rows[r + 1]) edges.push([a.id, b.id]);
  const kindNames = { plain: "手順", muted: arms[0] ? `対照群 (${arms[0].name})` : "対照群", main: arms[1] ? `処置群 (${arms[1].name})` : "処置群", third: "第三者の集計" };
  return diagram({ ...d, uid: "ed", rows, edges, rowGap: 26, kindNames, aria: d.aria || "比較実験の設計" });
}

// ---------- tree (issue tree): root → branches → leaves with verdict colour ----------
function verdictTable(md) {
  const map = {};
  for (const m of String(md || "").matchAll(/^\|\s*(H-\d+\.\d+)\s*\|\s*([^|]+?)\s*\|\s*(支持|一部支持|不支持|未検証)\s*\|\s*([^|]+?)\s*\|/gm)) map[m[1]] = { label: m[2], verdict: m[3], confidence: m[4] };
  return map;
}
function tree(d, ctx = {}) {
  const vt = verdictTable(ctx.md);
  const branches = (d.branches || []).map((b) => (Array.isArray(b) ? { label: `${b[0]} ${b[1]}`, leaves: (b[2] || []).map((id) => ({ id, ...(vt[id] || { label: "", verdict: "未検証" }) })) } : b));
  const fs = 11.5, leafH = 22, rootW = 168, gapC = 30;
  const brW = Math.max(150, ...branches.map((b) => textW(b.label) * 12.5 * 1.06 + 22));
  const rootLines = wrap(d.root || "", (rootW - 16) / 12);
  const leafX = 8 + rootW + gapC + brW + gapC;
  const leafText = (lf) => `${lf.id} ${lf.label}${lf.confidence ? ` (${lf.confidence})` : ""}`;
  const W = Math.ceil(Math.max(760, leafX + 18 + Math.max(...branches.flatMap((b) => (b.leaves || []).map((lf) => textW(leafText(lf)) * fs))) + 12));
  let y = 8; const layout = branches.map((b) => { const h = Math.max(leafH, (b.leaves?.length || 1) * leafH); const item = { b, y, h }; y += h + 10; return item; });
  const H = y;
  const vcol = (v) => (v === "支持" ? "var(--status-good)" : v === "一部支持" ? "var(--status-warning)" : v === "不支持" ? "var(--status-critical)" : "var(--de-emphasis)");
  const rootH = Math.max(60, rootLines.length * 15 + 18), bx = 8 + rootW + gapC;
  let svg = svgOpen(W, H, d.aria || "論点ツリー");
  svg += `<rect x="8" y="${H / 2 - rootH / 2}" width="${rootW}" height="${rootH}" rx="6" fill="${SER(0)}"><title>${esc(d.root)}</title></rect>` + tspans(rootLines, 8 + rootW / 2, H / 2, 15, "in-fill", "middle");
  layout.forEach(({ b, y, h }) => {
    const by = y + h / 2;
    svg += `<path d="M${8 + rootW},${H / 2} C${bx - 14},${H / 2} ${bx - 14},${by} ${bx},${by}" fill="none" class="tree-link"/>`;
    svg += `<rect x="${bx}" y="${by - 12}" width="${brW}" height="24" rx="5" class="box-plain"/><text x="${bx + 10}" y="${by + 4}" class="axis-label">${esc(b.label)}</text>`;
    (b.leaves || []).forEach((lf, li) => { const ly = y + li * leafH + leafH / 2; svg += `<path d="M${bx + brW},${by} C${leafX - 12},${by} ${leafX - 12},${ly} ${leafX},${ly}" fill="none" class="tree-link thin"/>`; svg += `<circle cx="${leafX + 7}" cy="${ly}" r="6" fill="${vcol(lf.verdict)}"><title>${esc(lf.id)} ${esc(lf.label)} — ${esc(lf.verdict || "")} / 確度 ${esc(lf.confidence || "")}</title></circle><text x="${leafX + 18}" y="${ly + 4}" class="axis-label small">${esc(leafText(lf))}</text>`; });
  });
  svg += `</svg>`;
  const lg = `<div class="legend"><span class="legend-item"><span class="swatch" style="background:var(--status-good)"></span>支持</span><span class="legend-item"><span class="swatch" style="background:var(--status-warning)"></span>一部支持</span><span class="legend-item"><span class="swatch" style="background:var(--status-critical)"></span>不支持</span><span class="legend-item"><span class="swatch" style="background:var(--de-emphasis)"></span>未検証</span><span class="legend-item">( ) = 確度</span></div>`;
  return lg + `<div class="hscroll">${svg}</div>` + note(d, Object.keys(vt).length ? ["判定と確度は本書末尾の判定表から"] : []) + tableTwin(["論点", "仮説", "判定", "確度"], branches.flatMap((b) => (b.leaves || []).map((lf) => [b.label, `${lf.id} ${lf.label}`, lf.verdict || "", lf.confidence || ""])));
}

// ---------- verdict heatmap (D or H × 判定 × 確度) ----------
function verdicts(d) {
  const items = (d.items || d.rows || []).map((r) => (r.claim ? r : { id: r.id ?? r.d, claim: r.label, verdict: r.verdict, confidence: r.confidence ?? r.conf, basis: r.basis ?? r.note }));
  const vcls = (v) => (v === "支持" ? "v-yes" : v === "一部支持" ? "v-part" : v === "不支持" ? "v-no" : "v-na");
  const ccls = (c) => (c === "高" ? "c-hi" : c === "中" ? "c-mid" : "c-lo");
  let html = `<div class="table-wrap"><table class="verdicts"><thead><tr><th>ID</th><th>主張</th><th>判定</th><th>確度</th><th>根拠の要点</th></tr></thead><tbody>`;
  items.forEach((it) => (html += `<tr><th scope="row">${esc(it.id)}</th><td>${esc(it.claim)}</td><td class="${vcls(it.verdict)}"><span class="chip">${esc(it.verdict)}</span></td><td class="${ccls(it.confidence)}"><span class="chip">${esc(it.confidence)}</span></td><td class="small">${esc(it.basis || "")}</td></tr>`));
  html += `</tbody></table></div>`;
  return html + note(d);
}
function heatmapTable(d, ctx) {
  const rows = d.rows || [];
  if (rows.length && rows[0].verdict !== undefined) return verdicts(d);
  return matrix(d, ctx);
}

export const renderers = {
  "stat-tiles": statTiles, tiles: statTiles,
  hbars, bar: hbars, "contrast-bar": contrastBar,
  "grouped-bars": groupedBars, "grouped-bar": groupedBars,
  "stacked-hbar": stackedHbar, "stacked-bar-horizontal": stackedHbar,
  "small-multiples-bar": smallMultiples,
  dumbbell, line, "dual-line": dualLine, "dose-response-line": doseResponse,
  timeline, matrix, "heatmap-table": heatmapTable, table, verdicts,
  roadmap, "gated-roadmap": gatedRoadmap, process: processFlow,
  diagram, "principle-diagram": principleDiagram, "experiment-design": experimentDesign,
  "two-layer": twoLayer, mapping, tree,
};

export function renderFigure(type, data, ctx = {}) {
  if (data && data.html) return data.html; // escape hatch for hand-written SVG/HTML
  const fn = renderers[type];
  if (!fn) throw new Error(`unknown figure type "${type}" (known: ${Object.keys(renderers).join(", ")})`);
  const out = fn(data || {}, ctx);
  if (/\n\s*\n/.test(out)) throw new Error("renderer emitted a blank line (would end the HTML block in marked)");
  return out;
}
