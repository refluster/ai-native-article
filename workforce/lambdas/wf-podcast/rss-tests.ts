import { describe, it, expect } from "vitest";
import { buildPodcastRss, xmlEscape, toRfc822, type PodcastChannel } from "./rss.js";

const channel: PodcastChannel = {
  title: "AI Native Article — Podcast",
  link: "https://kohuehara.xyz/ai-native-article",
  description: "test show",
  language: "ja",
  author: "Workforce",
  feedSelfUrl: "https://cdn.example/podcast/feed.xml",
};

describe("rss builder", () => {
  it("escapes XML-significant characters", () => {
    expect(xmlEscape(`a & b < c > d "e" 'f'`)).toBe("a &amp; b &lt; c &gt; d &quot;e&quot; &apos;f&apos;");
  });

  it("normalises an ISO date to RFC-822", () => {
    expect(toRfc822("2026-06-28")).toMatch(/^[A-Z][a-z]{2}, 28 Jun 2026/);
  });

  it("emits one <item> per episode with enclosure, guid, and citations in description", () => {
    const xml = buildPodcastRss(channel, [
      {
        slug: "c91368439868",
        title: "テスト回",
        description: "出典: https://example.com/a, https://example.com/b",
        audioUrl: "https://cdn.example/podcast/audio/c91368439868.mp3",
        pubDate: "2026-06-28",
        byteLength: 12345,
      },
    ]);
    expect(xml).toContain("<rss version=\"2.0\"");
    expect(xml).toContain("<guid isPermaLink=\"false\">c91368439868</guid>");
    expect(xml).toContain('url="https://cdn.example/podcast/audio/c91368439868.mp3"');
    expect(xml).toContain('length="12345"');
    expect(xml).toContain("type=\"audio/mpeg\"");
    // citations are carried in the description (mandatory — ADR-0016)
    expect(xml).toContain("<description>出典: https://example.com/a, https://example.com/b</description>");
    expect(xml).toContain('<atom:link href="https://cdn.example/podcast/feed.xml"');
  });

  it("produces a feed with zero items when there are no episodes", () => {
    const xml = buildPodcastRss(channel, []);
    expect(xml).toContain("<channel>");
    expect(xml).not.toContain("<item>");
  });
});
