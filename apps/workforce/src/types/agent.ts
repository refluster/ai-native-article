// Workforce agent manifest types — what the build script emits and the
// SPA consumes from /workforce-agents.json.

export type AgentBinding = {
  cron: string;
  skill: string;
  note?: string;
};

/**
 * Persona JD — Mission / Key Responsibilities / Success Measures.
 * Authored in agent.json. Not a job post; a structured attribute block
 * the profile page renders for orientation.
 */
export interface AgentJD {
  /** One-sentence statement of why this role exists on the workforce. */
  mission: string;
  /** 4-6 verb-led responsibility statements. */
  key_responsibilities: string[];
  /** 3-5 measurable outcomes that prove the role is working. */
  success_measures: string[];
}

/**
 * OpenClaw-style IDENTITY block. Complements JD: JD is what the role
 * does; IDENTITY is who the persona is when they do it.
 */
export interface AgentIdentity {
  /** 3-5 word label, e.g. "Systems-first designer". */
  archetype: string;
  /** 3-5 short operating principles. */
  operating_principles: string[];
  /** One sentence on voice / tone / register. */
  voice: string;
  /** 2-4 hard refusals — things this persona will not do. */
  guardrails: string[];
}

/** A single LinkedIn-style highlight on the agent's track record. */
export interface AgentExperienceHighlight {
  /** ISO date of the milestone. */
  date: string;
  /** Short title (≤ ~80 chars). */
  title: string;
  /** One-sentence impact statement. */
  impact: string;
}

/** Endorsement from a teammate (lateral or reports_to). */
export interface AgentEndorsement {
  /** Slug of the endorsing teammate. */
  from: string;
  /** What they're endorsed for (short phrase). */
  for: string;
}

/**
 * The semantic class of a memory entry. Mirrors the OpenClaw / Hermes
 * MEMORY.md convention — durable facts, standing decisions, lessons
 * learned, preferences that emerged, people / context, and open questions.
 */
export type AgentMemoryKind =
  | 'fact'
  | 'decision'
  | 'lesson'
  | 'preference'
  | 'person'
  | 'open-question';

export interface AgentMemoryEntry {
  /** Short id (8-char ULID-ish) for cross-reference. */
  id: string;
  /** ISO date the entry was committed to memory. */
  date: string;
  kind: AgentMemoryKind;
  /** Short label, 1–5 words. */
  subject: string;
  /** One or two sentences of detail. */
  body: string;
  /** Optional provenance: deliv-id, PR ref, conversation, etc. */
  source?: string;
}

/**
 * Persona long-term memory — OpenClaw / Hermes MEMORY.md analogue.
 * The curated, durable layer the persona "remembers" at session open.
 * Grows monotonically as the agent accumulates experience; entries are
 * append-only and rendered newest-first on the profile.
 */
export interface AgentMemory {
  /** ISO date of the latest append. */
  last_updated: string;
  /** Append-only log; the UI sorts newest-first. */
  entries: AgentMemoryEntry[];
}

/**
 * Persona track record on this Workforce — modeled after LinkedIn's
 * experience block. Authored in agent.json today; live API may layer
 * in `metrics.runs_total_lifetime` etc. when wired.
 */
export interface AgentExperience {
  /** Date the persona was first deployed. */
  joined_at: string;
  /** Up to 5 highlight milestones. */
  highlights: AgentExperienceHighlight[];
  /** Up to 4 endorsements from teammates. */
  endorsements: AgentEndorsement[];
}

export interface WorkforceAgent {
  slug: string;
  first_name: string;
  last_name: string;
  residence: string;
  role: string;
  model: string;
  prompt_version: string;
  budget_monthly_usd: number;
  default_project: string;
  streams: Array<'internal' | 'client' | 'editorial'>;
  bindings: AgentBinding[];
  created_at: string;
  /** First non-heading, non-framing paragraph from system.md. */
  about: string;
  jd?: AgentJD;
  identity?: AgentIdentity;
  experience?: AgentExperience;
  memory?: AgentMemory;
  // ----- Org topology, merged from workforce/agents/_org.json by the build
  // script. `depth` is derived: 0 for nodes with no reports_to (roots),
  // 1 + min(parent depth) otherwise. There is no hard ceiling on N — a
  // 4-deep org renders the same way a 3-deep one does.
  depth: number;
  reports_to: string[];
  direct_reports: string[];
  lateral: string[];
}

export interface WorkforceAgentManifest {
  generated_at: string;
  agents: WorkforceAgent[];
}
