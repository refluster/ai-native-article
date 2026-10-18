// Tests for the groundability predicate and the markup stripper.
//
// `node:test` — no new dependency, and reachable from the repo root, which
// nothing else in scripts/ was. Run with `npm run test:scripts`.
//
// Each assertion names the defect it guards against, because the reason these
// exist is that the first version of isGroundable() ANDed a character floor
// with a whitespace-token floor and so rejected every Japanese source on a
// Japanese-first site. A four-line fixture table would have caught it before
// review did.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

import {
  isGroundable,
  htmlToText,
  MIN_CHARS,
  MIN_WORDS,
  classifyJinaResponse,
  errorCause,
  isPdfBytes,
  pdfToText,
} from "./source-fetch.mjs";

const ja =
  "生成AIの導入によって、現場の意思決定はどのように変わるのか。" +
  "本稿では、実際に運用しているチームの記録をもとに検討する。";
const en =
  "The quick brown fox jumps over the lazy dog while the team ships another " +
  "increment of the pipeline and reviews the resulting telemetry. ";

test("a long Japanese body is groundable despite a near-zero word count", () => {
  const text = ja.repeat(60); // ~3,500 chars, ~1 whitespace token
  assert.ok(text.length >= MIN_CHARS);
  assert.ok(
    text.split(/\s+/).filter(Boolean).length < MIN_WORDS,
    "fixture must actually trip the word floor, or it tests nothing",
  );
  assert.equal(isGroundable(text), true);
});

test("a long English body is groundable", () => {
  assert.equal(isGroundable(en.repeat(30)), true);
});

test("a body under the character floor is not groundable, in either script", () => {
  assert.equal(isGroundable("a".repeat(MIN_CHARS - 1)), false);
  assert.equal(isGroundable(ja.repeat(2)), false);
});

test("a short English body with enough characters but too few words is rejected", () => {
  // e.g. a nav-only bot-wall page: long, but not prose.
  const text = "x".repeat(MIN_CHARS + 500);
  assert.equal(isGroundable(text), false);
});

test("htmlToText drops script contents instead of counting them as prose", () => {
  const html =
    "<html><head><script>var padding='" +
    "z".repeat(4000) +
    "';</script></head><body><p>Hello world.</p></body></html>";
  const text = htmlToText(html);
  assert.ok(!text.includes("padding"), "script body leaked into the text");
  assert.ok(
    text.length < 100,
    `script contents inflated the extracted text to ${text.length} chars — ` +
      "that padding can push a bot-wall page over the groundability floor",
  );
  assert.ok(text.includes("Hello world."));
});

test("htmlToText decodes entities and strips tags", () => {
  assert.equal(htmlToText("<p>a &amp; b &lt;c&gt;</p>"), "a & b <c>");
});

test("an r.jina.ai anonymous-access block is not mistaken for throttling", () => {
  // Most of the recorded "jina=403" history: retrying in 12s cannot help.
  const body =
    '{"data":null,"code":403,"name":"AbuseAlleviationError","status":40305,' +
    '"message":"Anonymous access to domain qz.com blocked until …"}';
  assert.equal(classifyJinaResponse(403, body), "anon-blocked");
  assert.equal(classifyJinaResponse(429, ""), "throttled");
  assert.equal(classifyJinaResponse(503, ""), "throttled");
  // A relayed origin 403 (a consent page) is final, not a throttle.
  assert.equal(classifyJinaResponse(403, "Title: axios\n\nManage your tracker preferences"), "final");
});

test("errorCause unwraps undici's bare 'fetch failed'", () => {
  const err = new TypeError("fetch failed", {
    cause: Object.assign(new Error("Headers Overflow Error"), { code: "UND_ERR_HEADERS_OVERFLOW" }),
  });
  assert.equal(errorCause(err), "UND_ERR_HEADERS_OVERFLOW");
});

test("PDFs are recognised by magic bytes, not by the server's Content-Type", () => {
  assert.equal(isPdfBytes(Buffer.from("%PDF-1.7\n…")), true);
  assert.equal(isPdfBytes(Buffer.from("<!doctype html>")), false);
});

test("pdfToText extracts a PDF's text layer", async (t) => {
  // Minimal one-page PDF with a text object. Skipped where poppler is absent —
  // the fetcher reports that case as "pdftotext not installed" and falls back.
  const which = spawnSync("pdftotext", ["-v"]);
  if (which.error) return t.skip("pdftotext not installed");
  const stream = "BT /F1 12 Tf 72 720 Td (Grounded source text) Tj ET";
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R " +
      "/Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [];
  objs.forEach((o, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) pdf += `${String(off).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;

  const out = await pdfToText(Buffer.from(pdf, "latin1"));
  assert.equal(out.ok, true, out.error);
  assert.match(out.text, /Grounded source text/);
});
