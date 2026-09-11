import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ProjectMetaRow } from "./project.js";
import type { OpenExternalPrInput } from "./external-pr.js";

// ---------------------------------------------------------------------------
// Module mocks — must be declared before the dynamic import below
// ---------------------------------------------------------------------------

vi.mock("./project.js", () => ({
  getProject: vi.fn(),
  asProjectId: vi.fn((id: string) => id),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function makeProject(
  overrides: Partial<ProjectMetaRow> = {},
): ProjectMetaRow {
  return {
    pk: "PROJECT#test-project",
    sk: "META",
    project_id: "test-project" as ProjectMetaRow["project_id"],
    status: "active",
    owner_agent: "maya",
    github_owner: "acme-org",
    github_repo: "acme-repo",
    ...overrides,
  } as ProjectMetaRow;
}

function makeInput(overrides: Partial<OpenExternalPrInput> = {}): OpenExternalPrInput {
  return {
    project_id: "test-project",
    agent_slug: "maya",
    skill_name: "issue-implement",
    run_id: "run-abc123",
    path: "output/report.md",
    body: "# Report\n\nHello world.",
    github: { token: "ghp_test_token" },
    ...overrides,
  };
}

/** Build an ordered list of mock Response objects for the 8-step happy path. */
function happyPathResponses(): Response[] {
  return [
    // Step 1: GET /repos → default_branch
    new Response(JSON.stringify({ default_branch: "main" }), { status: 200 }),
    // Step 2: GET /git/refs/heads/main → tip commit SHA
    new Response(
      JSON.stringify({ object: { sha: "tip-sha-001" } }),
      { status: 200 },
    ),
    // Step 3: GET /git/commits/tip-sha-001 → base tree SHA
    new Response(
      JSON.stringify({ tree: { sha: "base-tree-sha-001" } }),
      { status: 200 },
    ),
    // Step 4: POST /git/blobs → blob SHA
    new Response(JSON.stringify({ sha: "blob-sha-001" }), { status: 201 }),
    // Step 5: POST /git/trees → new tree SHA
    new Response(JSON.stringify({ sha: "new-tree-sha-001" }), { status: 201 }),
    // Step 6: POST /git/commits → new commit SHA
    new Response(
      JSON.stringify({ sha: "new-commit-sha-001" }),
      { status: 201 },
    ),
    // Step 7: POST /git/refs → branch created (returns the ref object; we only check ok)
    new Response(
      JSON.stringify({ ref: "refs/heads/workforce/maya/run-abc123" }),
      { status: 201 },
    ),
    // Step 8: POST /repos/.../pulls → PR created
    new Response(
      JSON.stringify({
        number: 42,
        html_url: "https://github.com/acme-org/acme-repo/pull/42",
      }),
      { status: 201 },
    ),
  ];
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("openExternalPr", () => {
  let getProject: ReturnType<typeof vi.fn>;
  let openExternalPr: (input: OpenExternalPrInput) => Promise<unknown>;

  beforeEach(async () => {
    vi.clearAllMocks();

    const projectMod = await import("./project.js");
    getProject = projectMod.getProject as ReturnType<typeof vi.fn>;

    const mod = await import("./external-pr.js");
    openExternalPr = mod.openExternalPr;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("happy path: returns pr_url, pr_number, branch_name", async () => {
    getProject.mockResolvedValueOnce(makeProject());
    for (const r of happyPathResponses()) {
      mockFetch.mockResolvedValueOnce(r);
    }

    const result = (await openExternalPr(makeInput())) as {
      pr_url: string;
      pr_number: number;
      branch_name: string;
    };

    expect(result.pr_url).toBe(
      "https://github.com/acme-org/acme-repo/pull/42",
    );
    expect(result.pr_number).toBe(42);
    expect(result.branch_name).toBe("workforce/maya/run-abc123");
  });

  it("makes exactly 8 fetch calls in sequence", async () => {
    getProject.mockResolvedValueOnce(makeProject());
    for (const r of happyPathResponses()) {
      mockFetch.mockResolvedValueOnce(r);
    }

    await openExternalPr(makeInput());

    expect(mockFetch).toHaveBeenCalledTimes(8);
  });

  it("step 1 fetches repo endpoint with correct URL and Bearer token", async () => {
    getProject.mockResolvedValueOnce(makeProject());
    for (const r of happyPathResponses()) {
      mockFetch.mockResolvedValueOnce(r);
    }

    await openExternalPr(makeInput());

    const [url, opts] = mockFetch.mock.calls[0] as [
      string,
      { headers: Record<string, string> },
    ];
    expect(url).toBe("https://api.github.com/repos/acme-org/acme-repo");
    expect(opts.headers["authorization"]).toBe("Bearer ghp_test_token");
    expect(opts.headers["user-agent"]).toBe("wf-external-pr");
  });

  it("step 7 creates branch with correct ref name", async () => {
    getProject.mockResolvedValueOnce(makeProject());
    for (const r of happyPathResponses()) {
      mockFetch.mockResolvedValueOnce(r);
    }

    await openExternalPr(makeInput());

    const [, opts] = mockFetch.mock.calls[6] as [
      string,
      { method: string; body: string },
    ];
    const payload = JSON.parse(opts.body) as { ref: string; sha: string };
    expect(payload.ref).toBe("refs/heads/workforce/maya/run-abc123");
    expect(payload.sha).toBe("new-commit-sha-001");
  });

  it("step 8 opens a draft PR against the default branch", async () => {
    getProject.mockResolvedValueOnce(makeProject());
    for (const r of happyPathResponses()) {
      mockFetch.mockResolvedValueOnce(r);
    }

    await openExternalPr(makeInput());

    const [, opts] = mockFetch.mock.calls[7] as [
      string,
      { method: string; body: string },
    ];
    const payload = JSON.parse(opts.body) as {
      draft: boolean;
      base: string;
      head: string;
    };
    expect(payload.draft).toBe(true);
    expect(payload.base).toBe("main");
    expect(payload.head).toBe("workforce/maya/run-abc123");
  });

  it("PR body contains audit trail fields", async () => {
    getProject.mockResolvedValueOnce(makeProject());
    for (const r of happyPathResponses()) {
      mockFetch.mockResolvedValueOnce(r);
    }

    await openExternalPr(makeInput());

    const [, opts] = mockFetch.mock.calls[7] as [
      string,
      { body: string },
    ];
    const payload = JSON.parse(opts.body) as { body: string };
    expect(payload.body).toContain("maya");
    expect(payload.body).toContain("issue-implement");
    expect(payload.body).toContain("test-project");
    expect(payload.body).toContain("run-abc123");
    expect(payload.body).toContain("workforce/maya/run-abc123");
    expect(payload.body).toContain("R-N9");
  });

  it("throws when project is not found", async () => {
    getProject.mockResolvedValueOnce(undefined);

    await expect(openExternalPr(makeInput())).rejects.toThrow(
      'project "test-project" not found in DynamoDB',
    );

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("throws when project is missing github_owner", async () => {
    getProject.mockResolvedValueOnce(
      makeProject({ github_owner: undefined }),
    );

    await expect(openExternalPr(makeInput())).rejects.toThrow(
      "missing github_owner or github_repo",
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("throws when project is missing github_repo", async () => {
    getProject.mockResolvedValueOnce(
      makeProject({ github_repo: undefined }),
    );

    await expect(openExternalPr(makeInput())).rejects.toThrow(
      "missing github_owner or github_repo",
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("throws a descriptive error when GitHub API returns non-2xx on step 1", async () => {
    getProject.mockResolvedValueOnce(makeProject());
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ message: "Not Found" }), { status: 404 }),
    );

    await expect(openExternalPr(makeInput())).rejects.toThrow(
      "external-pr get-repo: GitHub API 404",
    );
  });

  it("throws a descriptive error when step 4 (blob creation) fails", async () => {
    getProject.mockResolvedValueOnce(makeProject());
    // Steps 1-3 succeed
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ default_branch: "main" }), { status: 200 }),
    );
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ object: { sha: "tip-sha-001" } }),
        { status: 200 },
      ),
    );
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ tree: { sha: "base-tree-sha-001" } }),
        { status: 200 },
      ),
    );
    // Step 4 fails
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ message: "Repository is archived" }),
        { status: 422 },
      ),
    );

    await expect(openExternalPr(makeInput())).rejects.toThrow(
      "external-pr create-blob: GitHub API 422",
    );
  });

  it("throws a descriptive error when step 8 (create PR) fails", async () => {
    getProject.mockResolvedValueOnce(makeProject());
    const responses = happyPathResponses();
    // Replace last response with a failure
    responses[7] = new Response(
      JSON.stringify({ message: "Unprocessable Entity" }),
      { status: 422 },
    );
    for (const r of responses) {
      mockFetch.mockResolvedValueOnce(r);
    }

    await expect(openExternalPr(makeInput())).rejects.toThrow(
      "external-pr create-pr: GitHub API 422",
    );
  });

  it("uses github_owner and github_repo from the project row in API URLs", async () => {
    getProject.mockResolvedValueOnce(
      makeProject({ github_owner: "custom-org", github_repo: "custom-repo" }),
    );
    for (const r of happyPathResponses()) {
      mockFetch.mockResolvedValueOnce(r);
    }

    await openExternalPr(makeInput());

    const step1Url = mockFetch.mock.calls[0][0] as string;
    expect(step1Url).toContain("custom-org/custom-repo");
  });
});

// ---------------------------------------------------------------------------
// externalPrBranchName
// ---------------------------------------------------------------------------

describe("externalPrBranchName", () => {
  it("produces workforce/{agent}/{run_id}", async () => {
    const { externalPrBranchName } = await import("./external-pr.js");
    expect(externalPrBranchName("maya", "run-xyz")).toBe(
      "workforce/maya/run-xyz",
    );
  });

  it("preserves the full run_id (including hyphens and digits)", async () => {
    const { externalPrBranchName } = await import("./external-pr.js");
    expect(externalPrBranchName("nadia", "01J9Q7WWBM3JXKVQP3")).toBe(
      "workforce/nadia/01J9Q7WWBM3JXKVQP3",
    );
  });
});
