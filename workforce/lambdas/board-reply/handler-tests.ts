// Unit tests for wf-board-reply (ADR-0034).
//
// The board store, the Claude wrapper, the persona/roster reads, recall,
// memory, the knowledge-pack file and CloudWatch are all mocked — these
// tests pin the handler's decision logic: the loop-safety skips, the
// per-board budget, the W-1 guards, the NO_REPLY sentinel, the prompt
// composition (persona + channel contract + knowledge + roster), and the
// hop-bounded delegation (one colleague, answered in-process, no third hop).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@aws-sdk/client-cloudwatch", () => ({
  CloudWatchClient: class {
    send() {
      return Promise.resolve();
    }
  },
  PutMetricDataCommand: class {
    constructor(public input: unknown) {}
  },
}));

const PACK = `# Board knowledge pack

## [about|pinned] What this is (orientation)

Two products in one repository: the Software Talent Network and AI Native Article.

## [mvv|pinned] Mission

Build the operating model for human-agent co-creation.

## [lambdas] Workforce Lambdas

wf-orchestrator dispatches CCR routines every two hours. wf-podcast synthesises audio.

## [governance] Workforce design rules

R-N1 declares the execution surfaces; R-N2 keeps a single state store.
`;
vi.mock("node:fs", () => ({ readFileSync: () => PACK }));

const complete = vi.fn();
vi.mock("../shared/llm-anthropic.js", () => ({
  complete: (...args: unknown[]) => complete(...args),
}));

const getBoardMeta = vi.fn();
const getBoardPost = vi.fn();
const listBoardPosts = vi.fn();
const listCascadeRows = vi.fn();
const countAgentPostsSince = vi.fn();
const createBoardPost = vi.fn();
vi.mock("../shared/board.js", async () => {
  const actual = await vi.importActual<typeof import("../shared/board.js")>("../shared/board.js");
  return {
    BOARD_MAX_HOP: actual.BOARD_MAX_HOP,
    parseMentions: actual.parseMentions,
    getBoardMeta: (...args: unknown[]) => getBoardMeta(...args),
    getBoardPost: (...args: unknown[]) => getBoardPost(...args),
    listBoardPosts: (...args: unknown[]) => listBoardPosts(...args),
    listCascadeRows: (...args: unknown[]) => listCascadeRows(...args),
    countAgentPostsSince: (...args: unknown[]) => countAgentPostsSince(...args),
    createBoardPost: (...args: unknown[]) => createBoardPost(...args),
  };
});

const buildRecallBlock = vi.fn();
vi.mock("../shared/recall-prompt.js", () => ({
  buildRecallBlock: (...args: unknown[]) => buildRecallBlock(...args),
}));
const readIndex = vi.fn();
const readChunk = vi.fn();
vi.mock("../shared/memory.js", () => ({
  readIndex: (...args: unknown[]) => readIndex(...args),
  readChunk: (...args: unknown[]) => readChunk(...args),
}));

const getItem = vi.fn();
const scanAllPrefix = vi.fn();
vi.mock("../shared/ddb.js", () => ({
  getItem: (...args: unknown[]) => getItem(...args),
  scanAllPrefix: (...args: unknown[]) => scanAllPrefix(...args),
}));

const PROJECTS = [
  { pk: "PROJECT#agent-workforce", sk: "META", project_id: "agent-workforce", name: "Agent Workforce (internal trial)" },
  { pk: "PROJECT#self/maya", sk: "META", project_id: "self/maya" },
  { pk: "PROJECT#asp-cloud", sk: "META", project_id: "asp-cloud", name: "ASP Cloud", github_owner: "PSVL", github_repo: "asp-cloud" },
  { pk: "PROJECT#luckyhat", sk: "META", project_id: "luckyhat", name: "LuckyHat" },
];

import { handler } from "./handler.js";

const AGENTS = {
  maya: {
    pk: "AGENT#maya",
    sk: "META",
    slug: "maya",
    first_name: "Maya",
    last_name: "Ishikawa",
    role: "Product manager",
    model: "anthropic:claude-sonnet-4-6",
    system_prompt: "You are Maya, the product manager of the workforce.",
    archived: false,
    jd: { mission: "Own the roadmap." },
    identity: { voice: "Direct, warm." },
  },
  dario: {
    pk: "AGENT#dario",
    sk: "META",
    slug: "dario",
    first_name: "Dario",
    last_name: "Bianchi",
    role: "Governance architect",
    model: "anthropic:claude-sonnet-4-6",
    system_prompt: "You are Dario, the governance architect.",
    archived: false,
  },
  ren: {
    pk: "AGENT#ren",
    sk: "META",
    slug: "ren",
    first_name: "Ren",
    last_name: "Sato",
    role: "Engineer",
    model: "anthropic:claude-sonnet-4-6",
    system_prompt: "You are Ren, an engineer.",
    archived: false,
  },
  old: {
    pk: "AGENT#old",
    sk: "META",
    slug: "old",
    first_name: "Old",
    last_name: "Timer",
    role: "Retired",
    model: "anthropic:claude-sonnet-4-6",
    system_prompt: "Retired.",
    archived: true,
  },
};

const META = {
  pk: "BOARD#demo",
  sk: "META",
  board_id: "demo",
  name: "Demo board",
  password_salt: "00",
  password_hash: "11",
  archived: false,
  created_at: "2026-09-12T00:00:00.000Z",
};

function humanPost(overrides: Record<string, unknown> = {}) {
  return {
    pk: "BOARD#demo",
    sk: "POST#01H",
    post_id: "01H",
    board_id: "demo",
    author_kind: "human",
    author: "Hana",
    at: "2026-09-12T01:00:00.000Z",
    body_preview: "How does the orchestrator dispatch work? @maya",
    root_post_id: "01H",
    hop: 0,
    mentions: ["maya"],
    ...overrides,
  };
}

function view(row: ReturnType<typeof humanPost>) {
  return {
    post_id: row.post_id,
    author_kind: row.author_kind,
    author: row.author,
    at: row.at,
    body: row.body_preview,
    hop: row.hop,
    mentions: row.mentions,
  };
}

function completion(text: string, stop_reason = "end_turn") {
  return { text, tokens_in: 120, tokens_out: 60, stop_reason, cost_usd: 0.001 };
}

let ulidCounter = 0;
beforeEach(() => {
  ulidCounter = 0;
  complete.mockReset();
  getBoardMeta.mockReset();
  getBoardMeta.mockResolvedValue(META);
  getBoardPost.mockReset();
  getBoardPost.mockResolvedValue(humanPost());
  listBoardPosts.mockReset();
  listBoardPosts.mockResolvedValue({ posts: [view(humanPost())] });
  listCascadeRows.mockReset();
  listCascadeRows.mockResolvedValue([humanPost()]);
  countAgentPostsSince.mockReset();
  countAgentPostsSince.mockResolvedValue(0);
  createBoardPost.mockReset();
  createBoardPost.mockImplementation(async (input: Record<string, unknown>) => {
    ulidCounter += 1;
    const post_id = `01R${ulidCounter}`;
    const parent = input.reply_to as { post_id: string; root_post_id: string; author: string; author_kind: string };
    const row = {
      pk: "BOARD#demo",
      sk: `POST#${post_id}`,
      post_id,
      board_id: "demo",
      author_kind: input.author_kind,
      author: input.author,
      at: "2026-09-12T01:00:05.000Z",
      body_preview: String(input.body).slice(0, 320),
      reply_to: parent.post_id,
      reply_to_author: parent.author,
      reply_to_author_kind: parent.author_kind,
      root_post_id: parent.root_post_id,
      hop: input.hop,
      mentions: input.mentions,
    };
    return {
      row,
      view: {
        post_id,
        author_kind: input.author_kind,
        author: input.author,
        at: row.at,
        body: input.body,
        reply_to: parent.post_id,
        reply_to_author: parent.author,
        hop: input.hop,
        mentions: input.mentions,
      },
    };
  });
  buildRecallBlock.mockReset();
  buildRecallBlock.mockResolvedValue("");
  readIndex.mockReset();
  readIndex.mockResolvedValue(undefined);
  readChunk.mockReset();
  getItem.mockReset();
  getItem.mockImplementation(async (pk: string) => AGENTS[pk.slice("AGENT#".length) as keyof typeof AGENTS]);
  scanAllPrefix.mockReset();
  scanAllPrefix.mockImplementation(async (prefix: string) => (prefix === "PROJECT#" ? PROJECTS : Object.values(AGENTS)));
});

afterEach(() => {
  vi.clearAllMocks();
});

const EVENT = { board_id: "demo", post_id: "01H", addressed_slug: "maya" };

describe("happy path", () => {
  it("answers as the addressed agent (hop 1) and writes the POST row with LLM metadata", async () => {
    complete.mockResolvedValueOnce(completion("The orchestrator ticks every two hours and matches bindings."));

    const res = await handler(EVENT);

    expect(res).toEqual({ status: "ok", post_ids: ["01R1"] });
    expect(complete).toHaveBeenCalledTimes(1);
    expect(createBoardPost).toHaveBeenCalledTimes(1);
    expect(createBoardPost.mock.calls[0]![0]).toMatchObject({
      board_id: "demo",
      author_kind: "agent",
      author: "maya",
      hop: 1,
      mentions: [],
      finish_reason: "end_turn",
      tokens_in: 120,
      tokens_out: 60,
      skill_version: "0.2.0",
    });
    expect(createBoardPost.mock.calls[0]![0].reply_to.post_id).toBe("01H");
  });

  it("composes persona + channel contract + knowledge + roster into the system prompt, the thread into user", async () => {
    complete.mockResolvedValueOnce(completion("Answer."));
    await handler(EVENT);

    const req = complete.mock.calls[0]![0] as { system: string; user: string; model: string; maxTokens: number };
    expect(req.model).toBe("anthropic:claude-sonnet-4-6");
    expect(req.system).toContain("You are Maya, the product manager");
    expect(req.system).toContain("public Q&A board");
    expect(req.system).toContain("Answer in the language of the post");
    expect(req.system).toContain("bright university student");
    expect(req.system).toContain("Do not use the");
    expect(req.system).toContain("CONFIDENTIALITY");
    expect(req.system).toContain("external client projects");
    expect(req.system).toContain("no repository names");
    expect(req.system).toContain('only as "the founder"');
    // Pinned knowledge always rides along; the relevant section is selected.
    expect(req.system).toContain("What this is (orientation)");
    expect(req.system).toContain("wf-orchestrator dispatches CCR routines");
    // Roster excludes self and archived agents; hop-1 answers may delegate.
    expect(req.system).toContain("@dario — Dario Bianchi, Governance architect");
    expect(req.system).not.toContain("@maya —");
    expect(req.system).not.toContain("@old");
    expect(req.system).toContain("you may hand");
    expect(req.user).toContain("Board: Demo board");
    expect(req.user).toContain("Hana (guest)");
    expect(req.user).toContain("How does the orchestrator dispatch work?");
    expect(req.maxTokens).toBe(2000);
  });

  it("folds recall and memory into the prompt when present, redacted and recall-filtered to internal projects", async () => {
    buildRecallBlock.mockResolvedValueOnce("## Relevant past work\n\n- Shipped the orchestrator tick for asp-cloud (PSVL/asp-cloud).");
    readIndex.mockResolvedValueOnce({ latest_summary_key: "memory/maya/summary.md" });
    readChunk.mockResolvedValueOnce("I care about crisp kill criteria. Koh Uehara wants LuckyHat done; see workforce/skills/x.mjs");
    complete.mockResolvedValueOnce(completion("Answer."));
    await handler(EVENT);
    const req = complete.mock.calls[0]![0] as { system: string };
    expect(req.system).toContain("Shipped the orchestrator tick");
    expect(req.system).toContain("## Your memory (latest summary)");
    expect(req.system).toContain("crisp kill criteria");
    expect(req.system).not.toMatch(/asp-cloud|PSVL|LuckyHat|Uehara|x\.mjs/);
    expect(req.system).toContain("an external client project");
    expect(req.system).toContain("the founder wants");
    // The recall hook keeps only internal-project executions.
    const recallInput = buildRecallBlock.mock.calls[0]![0] as { filter: (r: { row: { project_id: string } }) => boolean };
    expect(recallInput.filter({ row: { project_id: "asp-cloud" } })).toBe(false);
    expect(recallInput.filter({ row: { project_id: "self/maya" } })).toBe(true);
    expect(recallInput.filter({ row: { project_id: "agent-workforce" } })).toBe(true);
  });

  it("redacts a slipped client name, repository or founder detail from the stored answer", async () => {
    complete.mockResolvedValueOnce(completion("We did this on asp-cloud; see https://github.com/refluster/ai-native-article. Koh Uehara decided."));
    const res = await handler(EVENT);
    expect(res.status).toBe("ok");
    const stored = createBoardPost.mock.calls[0]![0].body as string;
    expect(stored).not.toMatch(/asp-cloud|github|refluster|Uehara/i);
    expect(stored).toContain("an external client project");
    expect(stored).toContain("the founder decided");
  });
});

describe("delegation (hop 1 → 2, bounded)", () => {
  it("lets the first answer hand over to ONE colleague, answered in the same invocation, and stops there", async () => {
    complete
      .mockResolvedValueOnce(completion("Governance is Dario's turf — @dario can you take this? (also @ren)"))
      .mockResolvedValueOnce(completion("Happy to. R-N1 declares the surfaces. Maybe @ren knows the code side."));

    const res = await handler(EVENT);

    expect(res).toEqual({ status: "ok", post_ids: ["01R1", "01R2"] });
    expect(complete).toHaveBeenCalledTimes(2);
    // First answer stores both mentions; only the first is delegated to.
    expect(createBoardPost.mock.calls[0]![0]).toMatchObject({ author: "maya", hop: 1, mentions: ["dario", "ren"] });
    expect(createBoardPost.mock.calls[1]![0]).toMatchObject({ author: "dario", hop: 2, mentions: ["ren"] });
    expect(createBoardPost.mock.calls[1]![0].reply_to.post_id).toBe("01R1");
    // The delegate's prompt forbids further hand-overs and carries no roster.
    const second = complete.mock.calls[1]![0] as { system: string; user: string };
    expect(second.system).toContain("You are Dario");
    expect(second.system).toContain("hand-overs are not possible");
    expect(second.system).not.toContain("Colleagues on this board");
    // The delegate sees Maya's hand-over in the transcript and answers it.
    expect(second.user).toContain("Maya Ishikawa (@maya, Product manager)");
    expect(second.user).toContain("The post you were mentioned in");
    expect(second.user).toContain("Governance is Dario's turf");
  });

  it("never delegates back to someone who already answered in the cascade", async () => {
    listCascadeRows.mockResolvedValueOnce([
      humanPost(),
      humanPost({ post_id: "01X", sk: "POST#01X", author_kind: "agent", author: "dario", hop: 1, reply_to: "01H", mentions: [] }),
    ]);
    complete.mockResolvedValueOnce(completion("Ask @dario, he already said it."));
    const res = await handler(EVENT);
    expect(res).toEqual({ status: "ok", post_ids: ["01R1"] });
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it("does not honour a mention from a hop-2 post (the ceiling)", async () => {
    getBoardPost.mockResolvedValueOnce(humanPost({ author_kind: "agent", author: "dario", hop: 2, mentions: ["maya"] }));
    const res = await handler(EVENT);
    expect(res).toEqual({ status: "skipped", reason: "hop_exhausted" });
    expect(complete).not.toHaveBeenCalled();
  });
});

describe("loop safety + skips", () => {
  it("skips when the addressed agent authored the post", async () => {
    getBoardPost.mockResolvedValueOnce(humanPost({ author_kind: "agent", author: "maya", hop: 1 }));
    expect(await handler(EVENT)).toEqual({ status: "skipped", reason: "self" });
    expect(complete).not.toHaveBeenCalled();
  });

  it("skips a duplicate invoke when the agent already answered this post", async () => {
    listCascadeRows.mockResolvedValueOnce([
      humanPost(),
      humanPost({ post_id: "01X", sk: "POST#01X", author_kind: "agent", author: "maya", hop: 1, reply_to: "01H" }),
    ]);
    expect(await handler(EVENT)).toEqual({ status: "skipped", reason: "already_replied" });
    expect(complete).not.toHaveBeenCalled();
  });

  it("skips an agent outside the board's allowlist, a hidden post, and an archived board", async () => {
    getBoardMeta.mockResolvedValueOnce({ ...META, agents: ["dario"] });
    expect(await handler(EVENT)).toEqual({ status: "skipped", reason: "not_on_roster" });

    getBoardPost.mockResolvedValueOnce(humanPost({ hidden: true }));
    expect(await handler(EVENT)).toEqual({ status: "skipped", reason: "hidden" });

    getBoardMeta.mockResolvedValueOnce({ ...META, archived: true });
    expect(await handler(EVENT)).toEqual({ status: "skipped", reason: "archived" });
    expect(complete).not.toHaveBeenCalled();
  });

  it("throws when the per-board daily budget is exhausted", async () => {
    countAgentPostsSince.mockResolvedValueOnce(300);
    await expect(handler(EVENT)).rejects.toThrow(/daily reply budget exhausted/);
    expect(complete).not.toHaveBeenCalled();
  });

  it("throws on a missing board, post, or persona (W-4)", async () => {
    getBoardMeta.mockResolvedValueOnce(undefined);
    await expect(handler(EVENT)).rejects.toThrow(/board demo not found/);
    getBoardPost.mockResolvedValueOnce(undefined);
    await expect(handler(EVENT)).rejects.toThrow(/post 01H not found/);
    getItem.mockResolvedValueOnce({ ...AGENTS.maya, system_prompt: "" });
    await expect(handler(EVENT)).rejects.toThrow(/lacks model\/system_prompt/);
    await expect(handler({ board_id: "", post_id: "x", addressed_slug: "maya" })).rejects.toThrow(/missing/);
  });
});

describe("W-1 guards", () => {
  it("writes nothing on the NO_REPLY sentinel", async () => {
    complete.mockResolvedValueOnce(completion("__NO_REPLY_NEEDED__"));
    expect(await handler(EVENT)).toEqual({ status: "skipped", reason: "no_reply_needed" });
    expect(createBoardPost).not.toHaveBeenCalled();
  });

  it("throws on an LLM-artefact head and on an empty body", async () => {
    complete.mockResolvedValueOnce(completion("As an AI language model, I cannot..."));
    await expect(handler(EVENT)).rejects.toThrow(/llm_artefact_in_head/);
    complete.mockResolvedValueOnce(completion("   "));
    await expect(handler(EVENT)).rejects.toThrow(/empty reply body/);
    expect(createBoardPost).not.toHaveBeenCalled();
  });

  it("propagates the truncation throw from complete()", async () => {
    complete.mockRejectedValueOnce(new Error("llm-anthropic: stop_reason=max_tokens (truncated)"));
    await expect(handler(EVENT)).rejects.toThrow(/max_tokens/);
    expect(createBoardPost).not.toHaveBeenCalled();
  });
});
