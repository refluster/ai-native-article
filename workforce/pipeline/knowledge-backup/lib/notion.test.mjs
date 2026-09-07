import { test } from "node:test";
import assert from "node:assert/strict";
import {
  richTextToMarkdown,
  blocksToMarkdown,
  slugify,
  notionPagePath,
  pageTitle,
  renderNotionPage,
} from "./notion.mjs";

const rt = (text, annotations = {}, href = null) => ({
  plain_text: text,
  annotations: { bold: false, italic: false, code: false, strikethrough: false, ...annotations },
  href,
});

test("rich text preserves annotations and links", () => {
  assert.equal(richTextToMarkdown([rt("plain")]), "plain");
  assert.equal(richTextToMarkdown([rt("b", { bold: true })]), "**b**");
  assert.equal(richTextToMarkdown([rt("i", { italic: true })]), "_i_");
  assert.equal(richTextToMarkdown([rt("c", { code: true })]), "`c`");
  assert.equal(richTextToMarkdown([rt("s", { strikethrough: true })]), "~~s~~");
  assert.equal(richTextToMarkdown([rt("go", {}, "https://x")]), "[go](https://x)");
  assert.equal(richTextToMarkdown(), "");
});

test("renders the block types a prose page is made of", () => {
  const blocks = [
    { type: "heading_1", heading_1: { rich_text: [rt("Title")] } },
    { type: "paragraph", paragraph: { rich_text: [rt("Body")] } },
    { type: "bulleted_list_item", bulleted_list_item: { rich_text: [rt("point")] } },
    { type: "numbered_list_item", numbered_list_item: { rich_text: [rt("first")] } },
    { type: "to_do", to_do: { rich_text: [rt("task")], checked: true } },
    { type: "quote", quote: { rich_text: [rt("said")] } },
    { type: "code", code: { rich_text: [rt("x=1")], language: "python" } },
    { type: "divider", divider: {} },
  ];
  assert.equal(
    blocksToMarkdown(blocks),
    ["# Title", "Body", "- point", "1. first", "- [x] task", "> said", "```python", "x=1", "```", "---"].join("\n"),
  );
});

test("nested children indent under their parent", () => {
  const md = blocksToMarkdown([
    {
      type: "bulleted_list_item",
      bulleted_list_item: { rich_text: [rt("parent")] },
      __children: [{ type: "bulleted_list_item", bulleted_list_item: { rich_text: [rt("child")] } }],
    },
  ]);
  assert.equal(md, "- parent\n  - child");
});

test("an unknown block leaves a visible marker rather than vanishing", () => {
  assert.equal(blocksToMarkdown([{ type: "synced_block", synced_block: {} }]), "_[unsupported block: synced_block]_");
});

test("slugify keeps non-ASCII, strips path-hostile characters, and never returns empty", () => {
  assert.equal(slugify("AI ネイティブ 記事"), "AI-ネイティブ-記事");
  assert.equal(slugify("a/b:c?d*e"), "abcde");
  assert.equal(slugify("///"), "untitled");
  assert.ok(slugify("x".repeat(200)).length <= 80);
});

test("page path keys on the immutable id so a rename moves the file", () => {
  const page = { id: "32fd0f0b-e61e-80bd-89bf-f94965d05e80" };
  assert.equal(notionPagePath(page, "First name", "Articles"), "notion/Articles/First-name--32fd0f0b.md");
  // Renamed page, same id -> same folder, same id suffix.
  assert.equal(notionPagePath(page, "Second name", "Articles"), "notion/Articles/Second-name--32fd0f0b.md");
  // No resolvable parent falls back to a fixed folder, never to the repo root.
  assert.equal(notionPagePath(page, "Loose", null), "notion/_pages/Loose--32fd0f0b.md");
});

test("pageTitle reads whichever property is the title, else Untitled", () => {
  assert.equal(pageTitle({ properties: { Name: { type: "title", title: [rt("Hello")] } } }), "Hello");
  assert.equal(pageTitle({ properties: { Name: { type: "title", title: [] } } }), "Untitled");
  assert.equal(pageTitle({}), "Untitled");
});

test("rendered page carries frontmatter that survives quotes in the title", () => {
  const page = {
    id: "abc",
    url: "https://notion.so/abc",
    created_time: "2026-08-01T00:00:00.000Z",
    last_edited_time: "2026-08-28T10:00:00.000Z",
  };
  const md = renderNotionPage(page, 'The "big" one', "body text", "Articles");
  assert.match(md, /^---\nsource: notion\n/);
  assert.match(md, /title: "The \\"big\\" one"/);
  assert.match(md, /parent: "Articles"/);
  assert.match(md, /last_edited_time: 2026-08-28T10:00:00\.000Z/);
  assert.ok(md.endsWith("body text\n"));
});
