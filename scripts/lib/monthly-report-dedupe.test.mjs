import { test } from "node:test";
import assert from "node:assert/strict";
import { findExistingReport, currentMonth, describeExisting } from "./monthly-report-dedupe.mjs";

/** Minimal row shaped like a Notion database-query result. */
function row({
  id = "page-1",
  author = "maya",
  date = "2026-09-02",
  tags = ["Monthly Report"],
  status = "published",
  title = "Software Talent Network 月次レポート 2026年9月",
  archived = false,
} = {}) {
  return {
    id,
    url: `https://notion.so/${id}`,
    archived,
    properties: {
      Title: { title: [{ plain_text: title }] },
      Author: { rich_text: [{ plain_text: author }] },
      Date: { date: { start: date } },
      Tags: { multi_select: tags.map((name) => ({ name })) },
      Status: { select: { name: status } },
    },
  };
}

const opts = { agent: "maya", month: "2026-09" };

test("blocks a second letter from the same author in the same month", () => {
  const hit = findExistingReport([row()], opts);
  assert.ok(hit);
  assert.equal(hit.id, "page-1");
});

test("the real 2026-09-02 incident: two rows, the second write is refused", () => {
  // Both live rows carried Author=maya, Tags=[Monthly Report], Date=2026-09-02.
  const pages = [row({ id: "c67fc4b00375" }), row({ id: "e1eebfde73b6" })];
  assert.ok(findExistingReport(pages, opts), "the guard must fire on either row");
});

test("a different author in the same month does not block", () => {
  assert.equal(findExistingReport([row({ author: "dario" })], opts), null);
});

test("the same author in a different month does not block", () => {
  assert.equal(findExistingReport([row({ date: "2026-08-03" })], opts), null);
});

test("a row without the series tag does not block", () => {
  assert.equal(findExistingReport([row({ tags: ["AI Strategy"] })], opts), null);
});

test("a Status=archived row does not block — the documented revision path", () => {
  assert.equal(findExistingReport([row({ status: "archived" })], opts), null);
});

test("a Notion-trashed row does not block", () => {
  assert.equal(findExistingReport([row({ archived: true })], opts), null);
  assert.equal(findExistingReport([{ ...row(), in_trash: true }], opts), null);
});

test("author match is exact — a prefix is a different agent", () => {
  assert.equal(findExistingReport([row({ author: "maya-draft" })], opts), null);
  assert.equal(findExistingReport([row({ author: "may" })], opts), null);
});

test("author rich_text is joined across split runs and trimmed", () => {
  const split = row();
  split.properties.Author.rich_text = [{ plain_text: " ma" }, { plain_text: "ya " }];
  assert.ok(findExistingReport([split], opts));
});

test("falls back to text.content when plain_text is absent", () => {
  const r = row();
  r.properties.Author.rich_text = [{ text: { content: "maya" } }];
  assert.ok(findExistingReport([r], opts));
});

test("a VP letter blocks only its own author's slot", () => {
  const pages = [row({ author: "dario" }), row({ author: "mateo" })];
  assert.equal(findExistingReport(pages, { agent: "maya", month: "2026-09" }), null);
  assert.ok(findExistingReport(pages, { agent: "mateo", month: "2026-09" }));
});

test("malformed or missing properties never throw", () => {
  assert.equal(findExistingReport([{}], opts), null);
  assert.equal(findExistingReport([{ properties: {} }], opts), null);
  assert.equal(findExistingReport([{ properties: { Date: { date: null } } }], opts), null);
  assert.equal(findExistingReport(null, opts), null);
  assert.equal(findExistingReport(undefined, opts), null);
});

test("a missing agent or month never blocks — the caller must supply both", () => {
  assert.equal(findExistingReport([row()], { agent: "", month: "2026-09" }), null);
  assert.equal(findExistingReport([row()], { agent: "maya", month: "" }), null);
});

test("an unparseable Date does not block", () => {
  assert.equal(findExistingReport([row({ date: "not-a-date" })], opts), null);
});

test("a custom series tag is honoured", () => {
  const pages = [row({ tags: ["Weekly Report"] })];
  assert.ok(findExistingReport(pages, { ...opts, tag: "Weekly Report" }));
  assert.equal(findExistingReport(pages, opts), null);
});

test("currentMonth is UTC and zero-padded", () => {
  assert.equal(currentMonth(new Date("2026-09-02T01:09:00Z")), "2026-09");
  assert.equal(currentMonth(new Date("2026-01-31T23:59:59Z")), "2026-01");
  // A fire just past UTC midnight on the 1st belongs to the new month.
  assert.equal(currentMonth(new Date("2026-10-01T00:00:01Z")), "2026-10");
});

test("describeExisting names the date, title and url", () => {
  const s = describeExisting(row({ id: "abc" }));
  assert.match(s, /2026-09-02/);
  assert.match(s, /月次レポート/);
  assert.match(s, /notion\.so\/abc/);
});

test("describeExisting survives a row with no title", () => {
  assert.match(describeExisting({ id: "x" }), /\(untitled\)/);
});
