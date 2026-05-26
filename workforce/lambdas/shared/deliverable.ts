// Deliverable artefact routing — where each skill's output lands in S3,
// and (for type=article) what additional Notion publish is needed.
//
// v1 1-stage routing: the skill's meta.json declares the deliverable
// shape directly. The runner asks deliverableTargetFor(slug, type, id)
// and writes.

import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import type { DeliverableType } from "./skill.js";

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
 * Resolve the S3 key + external-publish flag for a llm-prose deliverable.
 * See workforce/docs/data-model.md "S3 — wf-bucket-{acct}-{region}-{stage}" for the prefix layout.
 */
export function deliverableTargetFor(
  slug: string,
  type: DeliverableType,
  delivId: string,
): DeliverableTarget {
  switch (type) {
    case "article":
      return { type, s3Key: `articles/${slug}/${delivId}/final.md`, hasExternalPublish: true };
    case "plan":
      return { type, s3Key: `plans/${slug}/${delivId}.md`, hasExternalPublish: false };
    case "design-doc":
      return { type, s3Key: `design-docs/${slug}/${delivId}/intent.md`, hasExternalPublish: false };
    case "launch-plan":
      return { type, s3Key: `launches/${slug}/${delivId}/launch.md`, hasExternalPublish: false };
    case "notification":
    case "pr":
      // notification: handled by the deterministic discord-ping handler — it
      //   writes runs/{slug}/{run_id}/output.txt directly via writeRunArtefact.
      // pr: claude-code-routine dispatches via GHA; the runner writes the
      //   brief to a pr-briefs/ key separately.
      // Neither uses deliverableTargetFor today.
      throw new Error(`deliverableTargetFor: type=${type} not routed through this helper.`);
  }
}

/** Write the llm-prose artefact body to S3. Idempotent for the same (key, body) pair. */
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

/**
 * Write a RUN's output bytes to S3 under the canonical
 * runs/{slug}/{run_id}/output.{ext} key. Used by deterministic handlers
 * and by the LLM path as a uniform audit-trail backup.
 */
export async function writeRunArtefact(
  slug: string,
  runId: string,
  ext: string,
  body: string,
): Promise<string> {
  const key = `runs/${slug}/${runId}/output.${ext}`;
  const contentType =
    ext === "json"
      ? "application/json"
      : ext === "md"
        ? "text/markdown; charset=utf-8"
        : "text/plain; charset=utf-8";
  await s3.send(
    new PutObjectCommand({
      Bucket: bucketName,
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  );
  return key;
}
