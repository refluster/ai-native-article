// Deliverable artefact routing — where each persona's output lands in S3,
// and (for type=article) what additional Notion publish is needed.
//
// R-N8: the difference between Maya's plan and Aoi's design-doc and Sora's
// article is *just* this dispatch table. The runner doesn't care which
// persona ran; it asks deliverableTargetFor() and writes.

import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import type { DeliverableType } from "./agent.js";

const BUCKET_NAME = process.env.BUCKET_NAME;
if (!BUCKET_NAME) throw new Error("BUCKET_NAME env var is required");
const bucketName: string = BUCKET_NAME;

const s3 = new S3Client({});

export interface DeliverableTarget {
  type: DeliverableType;
  s3Key: string;
  /** True if this type also publishes externally (Notion / GitHub PR). */
  hasExternalPublish: boolean;
}

/**
 * Resolve the S3 key + external-publish flag for a deliverable.
 * See workforce/docs/data-model.md "S3 — wf-bucket-{stage}" for the prefix layout.
 */
export function deliverableTargetFor(
  slug: string,
  type: DeliverableType,
  delivId: string,
): DeliverableTarget {
  switch (type) {
    case "article":
      return {
        type,
        s3Key: `articles/${slug}/${delivId}/final.md`,
        hasExternalPublish: true, // Notion insert
      };
    case "plan":
      return {
        type,
        s3Key: `plans/${slug}/${delivId}.md`,
        hasExternalPublish: false,
      };
    case "design-doc":
      return {
        type,
        s3Key: `design-docs/${slug}/${delivId}/intent.md`,
        hasExternalPublish: false,
      };
    case "launch-plan":
      return {
        type,
        s3Key: `launches/${slug}/${delivId}/launch.md`,
        hasExternalPublish: false,
      };
    case "notification":
      // Webhook side-effect deliverable. The runner records the posted body
      // in S3 for audit (so we can replay what was sent) and POSTs the LLM
      // text to the channel via the trigger_class=webhook post-step.
      return {
        type,
        s3Key: `notifications/${slug}/${delivId}.txt`,
        hasExternalPublish: true,
      };
    case "pr":
      // Ren's path. The R-N1 exception is dispatched via GHA workflow_dispatch;
      // the runner does NOT write the artefact itself — it triggers Claude Code
      // routine on GHA and waits for the PR URL (PR12). Until PR12 lands, this
      // throw is the loud signal that Ren shouldn't be running here.
      throw new Error(
        `deliverableTargetFor: type=pr is dispatched via Claude Code routine on GHA (PR12). Until then, keep Ren paused.`,
      );
  }
}

/** Write the artefact body to S3. Idempotent for the same (key, body) pair. */
export async function writeDeliverableArtefact(
  target: DeliverableTarget,
  bodyMarkdown: string,
): Promise<void> {
  await s3.send(
    new PutObjectCommand({
      Bucket: bucketName,
      Key: target.s3Key,
      Body: bodyMarkdown,
      ContentType: "text/markdown; charset=utf-8",
    }),
  );
}
