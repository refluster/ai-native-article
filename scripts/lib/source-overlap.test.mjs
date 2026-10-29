// Tests for the front-1 source-overlap check (issue #673 slice 2). Pure, no network.
import { test } from "node:test";
import assert from "node:assert/strict";

import { checkSourceOverlap, longestSharedRun, normalizeForOverlap, overlapFrontReport } from "./source-overlap.mjs";
import { assembleFrontStates, countScope } from "./rights-scope.mjs";

const SOURCE_JA =
  "政府は来月から新しい補助金制度を開始すると発表した。対象は従業員五十人以下の事業者で、申請は電子的に受け付ける。" +
  "担当者は、初年度の予算規模は三百億円に上ると説明し、審査には最長で二か月かかる見通しだと述べた。";
const SOURCE_EN =
  "The regulator said on Tuesday that it would require every platform with more than ten million users to publish " +
  "a quarterly report describing how recommendation systems rank content and how often those rankings change.";

test("a script that copies a source passage is flagged, naming the source", () => {
  const script = `今日のニュースです。${SOURCE_JA}以上です。`;
  const r = checkSourceOverlap(script, [{ url: "https://a.example/x", text: SOURCE_JA }]);
  assert.equal(r.ok, false);
  assert.equal(r.flagged[0].url, "https://a.example/x");
  assert.ok(r.flagged[0].length >= 80);
  assert.match(r.reason, /a\.example/);
});

test("copying survives reflow and re-punctuation (English)", () => {
  const copied = SOURCE_EN.replace(/,/g, "").replace(/ /g, "  ").toUpperCase();
  const r = checkSourceOverlap(`Intro. ${copied}`, [{ url: "https://b.example", text: SOURCE_EN }]);
  assert.equal(r.ok, false);
});

test("a paraphrase is not flagged", () => {
  const script = "規制当局は火曜日、利用者が一千万人を超える全てのプラットフォームに対し、おすすめの仕組みが投稿をどう並べ替えているかを四半期ごとに公表させる方針を示した。";
  assert.equal(checkSourceOverlap(script, [{ url: "u", text: SOURCE_JA + SOURCE_EN }]).ok, true);
  const para = "Platforms above ten million users must now publish, every quarter, how their feeds order content.";
  assert.equal(checkSourceOverlap(para, [{ url: "u", text: SOURCE_EN }]).ok, true);
});

test("a short attributed quote is not flagged", () => {
  const quote = "初年度の予算規模は三百億円に上ると説明し";
  assert.ok(normalizeForOverlap(quote).length < 80);
  const script = `担当者は「${quote}」と述べています。それ以外は私たちの言葉で説明します。`;
  assert.equal(checkSourceOverlap(script, [{ url: "u", text: SOURCE_JA }]).ok, true);
});

test("the run length is the longest consecutive match, and threshold is configurable", () => {
  const { length } = longestSharedRun(`xx ${SOURCE_EN} yy`, SOURCE_EN);
  assert.equal(length, normalizeForOverlap(SOURCE_EN).length);
  assert.equal(longestSharedRun("short text here", "short text here", 80).length, 0);
  assert.throws(() => longestSharedRun("a", "b", 0), /positive integer/);
  assert.equal(checkSourceOverlap("short text here", [{ url: "u", text: "short text here" }], { minChars: 5 }).ok, false);
});

test("unfetchable sources are counted as not compared, never as clean", () => {
  const r = checkSourceOverlap("whatever", [
    { url: "a", text: null },
    { url: "b", text: "   " },
  ]);
  assert.equal(r.compared, 0);
  assert.equal(r.total, 2);
  assert.equal(overlapFrontReport(r), null);
});

test("front 1 counts as machine only when every source was compared", () => {
  const full = overlapFrontReport({ compared: 2, total: 2 });
  assert.equal(full.state, "machine");
  const part = overlapFrontReport({ compared: 1, total: 2 });
  assert.equal(part.state, "machine-partial");
  assert.match(part.note, /1 source\(s\) not fetchable/);
  // feeds the scoped verdict: a complete comparison moves N from 0 to 1.
  assert.deepEqual(countScope(assembleFrontStates({ 1: full })), { machine: 1, partial: 0, llm: 0 });
});
