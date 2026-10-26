// Closed enum of failure reasons the runner supplies on an engagement
// (design note workforce/docs/design/repeat-failure-counter.md, #664).
// Never derived by string-normalising `summary`. Kept in its own module so
// the handler's runtime import is independent of shared/project.ts.
export const REASON_CODES = [
  "auth",
  "permission",
  "egress",
  "identity",
  "validation",
  "source_unreachable",
  "write_failed",
  "other",
] as const;
export type ReasonCode = (typeof REASON_CODES)[number];
