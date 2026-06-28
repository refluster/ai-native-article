// Pure podcast-RSS builder (Epic-017 Story 6). No I/O — takes the channel
// metadata + the episode list and returns a valid RSS 2.0 + iTunes podcast
// feed string, so it is unit-testable without S3/Notion/Polly. The handler
// owns fetching the episodes and writing the result to the public prefix.
//
// Mandatory: every <item> carries its source citations in <description>
// (the team's citation-mandatory policy — ADR-0016); an episode with empty
// citations is rejected upstream by podcast-script, so by the time it has an
// audioUrl it has citations.

export interface PodcastChannel {
  title: string;
  link: string; // the show's home (the reader site)
  description: string;
  language: string; // e.g. "ja"
  author: string;
  imageUrl?: string;
  feedSelfUrl: string; // the public URL this feed is served from
  // Spotify-required show metadata (Story #1). Cover art + category +
  // explicit + an owner email (used by Spotify to verify ownership) are
  // mandatory for a publishable show; without them submission is rejected.
  category?: string; // an Apple Podcasts category, e.g. "Technology"
  explicit?: boolean; // content advisory; default false
  ownerName?: string;
  ownerEmail?: string; // verification address — must be present to claim the show
  type?: "episodic" | "serial"; // itunes:type
}

export interface PodcastEpisode {
  slug: string; // GUID
  title: string;
  description: string; // the source citations (mandatory)
  audioUrl: string; // the public MP3 enclosure (CDN)
  pubDate: string; // ISO date "YYYY-MM-DD" or RFC-822; normalised below
  durationSec?: number;
  byteLength?: number;
}

/** XML-escape text node / attribute content. */
export function xmlEscape(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Best-effort RFC-822 date (what RSS readers expect) from an ISO date. */
export function toRfc822(date: string): string {
  // Accept "YYYY-MM-DD" or a full ISO timestamp; fall back to the raw string.
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(date);
  if (!m) return date;
  const d = new Date(`${m[1]}-${m[2]}-${m[3]}T09:00:00Z`);
  if (Number.isNaN(d.getTime())) return date;
  return d.toUTCString();
}

function hms(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec));
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const p = (n: number) => String(n).padStart(2, "0");
  return hh > 0 ? `${hh}:${p(mm)}:${p(ss)}` : `${mm}:${p(ss)}`;
}

export function buildPodcastRss(channel: PodcastChannel, episodes: PodcastEpisode[]): string {
  const items = episodes
    .map((ep) => {
      const enclosureLen = ep.byteLength && ep.byteLength > 0 ? ep.byteLength : 0;
      const duration = ep.durationSec ? `\n      <itunes:duration>${hms(ep.durationSec)}</itunes:duration>` : "";
      return [
        "    <item>",
        `      <title>${xmlEscape(ep.title)}</title>`,
        // Citations live in the description (the show notes) — mandatory.
        `      <description>${xmlEscape(ep.description)}</description>`,
        `      <itunes:summary>${xmlEscape(ep.description)}</itunes:summary>`,
        `      <enclosure url="${xmlEscape(ep.audioUrl)}" length="${enclosureLen}" type="audio/mpeg" />`,
        `      <guid isPermaLink="false">${xmlEscape(ep.slug)}</guid>`,
        `      <pubDate>${xmlEscape(toRfc822(ep.pubDate))}</pubDate>${duration}`,
        "    </item>",
      ].join("\n");
    })
    .join("\n");

  const image = channel.imageUrl
    ? `\n    <itunes:image href="${xmlEscape(channel.imageUrl)}" />\n    <image><url>${xmlEscape(channel.imageUrl)}</url><title>${xmlEscape(channel.title)}</title><link>${xmlEscape(channel.link)}</link></image>`
    : "";
  const category = channel.category
    ? `\n    <itunes:category text="${xmlEscape(channel.category)}" />`
    : "";
  const explicit = `\n    <itunes:explicit>${channel.explicit ? "true" : "false"}</itunes:explicit>`;
  const itype = `\n    <itunes:type>${xmlEscape(channel.type ?? "episodic")}</itunes:type>`;
  const owner = channel.ownerEmail
    ? `\n    <itunes:owner><itunes:name>${xmlEscape(channel.ownerName ?? channel.author)}</itunes:name><itunes:email>${xmlEscape(channel.ownerEmail)}</itunes:email></itunes:owner>`
    : "";

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" xmlns:atom="http://www.w3.org/2005/Atom">',
    "  <channel>",
    `    <title>${xmlEscape(channel.title)}</title>`,
    `    <link>${xmlEscape(channel.link)}</link>`,
    `    <language>${xmlEscape(channel.language)}</language>`,
    `    <description>${xmlEscape(channel.description)}</description>`,
    `    <itunes:author>${xmlEscape(channel.author)}</itunes:author>`,
    `    <itunes:summary>${xmlEscape(channel.description)}</itunes:summary>${category}${explicit}${itype}${owner}`,
    `    <atom:link href="${xmlEscape(channel.feedSelfUrl)}" rel="self" type="application/rss+xml" />${image}`,
    items,
    "  </channel>",
    "</rss>",
    "",
  ].join("\n");
}
