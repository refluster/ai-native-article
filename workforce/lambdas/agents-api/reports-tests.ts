// Unit tests for agents-api/reports.ts — the project-reports read path
// (manifest validation / ordering, slug allowlist, and the GitHub
// contents fetch with the project-scoped token).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../shared/secrets.js", () => ({
  getSecret: vi.fn(async (name: string) => {
    if (!/^wf\/projects\/[^/]+\/github\.token$/.test(name)) {
      throw new Error(`unexpected secret path: ${name}`);
    }
    return { token: "ghp_test" };
  }),
}));

import {
  getProjectReportBody,
  isValidReportSlug,
  listProjectReports,
  sortReportEntries,
  validReportEntries,
  type ReportProject,
} from "./reports.js";

const project: ReportProject = {
  project_id: "project-ind",
  github_owner: "PSVL",
  github_repo: "project-ind",
} as ReportProject;

const entry = (over: Record<string, unknown> = {}) => ({
  slug: "2026-07-21-weekly",
  title: "週報 第1号",
  date: "2026-07-21",
  ...over,
});

describe("isValidReportSlug", () => {
  it("accepts date-prefixed kebab slugs", () => {
    expect(isValidReportSlug("2026-07-21-weekly")).toBe(true);
  });
  it("rejects traversal, slashes and empty", () => {
    expect(isValidReportSlug("../secrets")).toBe(false);
    expect(isValidReportSlug("a/b")).toBe(false);
    expect(isValidReportSlug("")).toBe(false);
    expect(isValidReportSlug(".hidden")).toBe(false);
  });
});

describe("validReportEntries / sortReportEntries", () => {
  it("drops malformed rows and keeps well-formed ones", () => {
    const rows = validReportEntries(
      [entry(), entry({ slug: "../evil" }), entry({ date: "yesterday" }), { title: "no slug" }],
      "project-ind",
    );
    expect(rows.map(r => r.slug)).toEqual(["2026-07-21-weekly"]);
  });
  it("treats a non-array manifest as empty", () => {
    expect(validReportEntries({ oops: true }, "p")).toEqual([]);
  });
  it("orders newest first with slug tiebreak", () => {
    const sorted = sortReportEntries([
      entry({ slug: "b", date: "2026-07-01" }),
      entry({ slug: "z", date: "2026-07-21" }),
      entry({ slug: "a", date: "2026-07-21" }),
    ]);
    expect(sorted.map(r => r.slug)).toEqual(["a", "z", "b"]);
  });
});

describe("GitHub-backed reads", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("lists reports from the repo manifest, tagged with the project id", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify([entry()]),
    });
    const items = await listProjectReports(project);
    expect(items).toEqual([{ ...entry(), project_id: "project-ind" }]);
    const call = fetchMock.mock.calls[0] as [string, { headers: Record<string, string> }];
    expect(call[0]).toBe("https://api.github.com/repos/PSVL/project-ind/contents/reports/manifest.json");
    expect(call[1].headers.authorization).toBe("Bearer ghp_test");
    expect(call[1].headers.accept).toBe("application/vnd.github.raw+json");
  });

  it("maps a missing manifest (404) to an empty list", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 404, text: async () => "" });
    expect(await listProjectReports(project)).toEqual([]);
  });

  it("returns an empty list when the project has no repo configured", async () => {
    const bare = { project_id: "conference" } as ReportProject;
    expect(await listProjectReports(bare)).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("throws on a manifest that exists but is not JSON (fail loud)", async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, text: async () => "not json" });
    await expect(listProjectReports(project)).rejects.toThrow("not valid JSON");
  });

  it("throws on non-404 GitHub failures (fail loud)", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 403, text: async () => "rate limited" });
    await expect(listProjectReports(project)).rejects.toThrow("github contents 403");
  });

  it("fetches one report body and nulls out absent or invalid slugs", async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, text: async () => "# report" });
    expect(await getProjectReportBody(project, "2026-07-21-weekly")).toBe("# report");
    expect((fetchMock.mock.calls[0] as [string, unknown])[0]).toBe(
      "https://api.github.com/repos/PSVL/project-ind/contents/reports/2026-07-21-weekly.md",
    );

    expect(await getProjectReportBody(project, "../evil")).toBeNull();

    fetchMock.mockResolvedValue({ ok: false, status: 404, text: async () => "" });
    expect(await getProjectReportBody(project, "missing")).toBeNull();
  });
});
