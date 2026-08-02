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

import {
  isGroundable,
  htmlToText,
  MIN_CHARS,
  MIN_WORDS,
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
