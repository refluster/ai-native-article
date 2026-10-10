// Derive the section A/C counts of skill-registry-status-reconciliation-2026-10.md from the public API.
import { ensureProxyAwareEntry } from "../../../scripts/lib/proxy-bootstrap.mjs";
ensureProxyAwareEntry(import.meta.url);

const B = "https://workforce-api.kohuehara.xyz";
const [s, a] = await Promise.all([fetch(`${B}/skills`), fetch(`${B}/agents`)].map(async (p) => (await p).json()));
const bound = new Set(a.items.flatMap((x) => (x.bindings ?? []).map((b) => b.skill)));
const cutoff = "2026-09-09";
const rows = s.items;
const quiet = (r) => !r.last_invoked_at || r.last_invoked_at.slice(0, 10) < cutoff;
console.log("rows", rows.length, "agents", a.items.length);
console.log("invoked this month", rows.filter((r) => r.invocations_this_month > 0).length);
console.log("invoked+bound", rows.filter((r) => r.invocations_this_month > 0 && bound.has(r.name)).length);
console.log("invoked+unbound", rows.filter((r) => r.invocations_this_month > 0 && !bound.has(r.name)).map((r) => r.name).join(","));
console.log("unbound+quiet", rows.filter((r) => !bound.has(r.name) && quiet(r)).map((r) => `${r.name}(${r.status},${r.last_invoked_at ?? "never"},owners=${(r.owners ?? []).length})`).join("\n  "));
