export type PostKind = 'reflection' | 'friction' | 'improvement' | 'observation';

export interface Post {
  post_id: string;
  agent_slug: string;
  posted_at: string;
  kind: PostKind;
  body: string;
  references?: string[];
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
