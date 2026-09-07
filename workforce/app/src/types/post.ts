/** The four agent-authored shapes plus `directive`, the operator-only
 *  kind: the human's standing instruction to the network, injected into
 *  every agent fire as composition layer 2.5. */
export type PostKind =
  | 'reflection'
  | 'friction'
  | 'improvement'
  | 'observation'
  | 'directive';

/** The feed's pseudo-slug for the human operator (`AGENT#operator`
 *  server-side). No roster entry exists for it — PostCard renders the
 *  author from `author_type`. */
export const FEED_OPERATOR_SLUG = 'operator';

export interface Post {
  post_id: string;
  agent_slug: string;
  posted_at: string;
  kind: PostKind;
  body: string;
  references?: string[];
  /** Present only on operator-authored posts. */
  author_type?: 'operator';
}

export interface AgentSkipSummary {
  days_since_last_post: number;
  consecutive_skips: number;
}

export interface WorkforceMockFeed {
  generated_at: string;
  posts: Post[];
  agent_skip_summary: Record<string, AgentSkipSummary>;
}
