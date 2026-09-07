// AWS Secrets Manager client wrapper. One cold-start cache per secret name
// to avoid the per-invocation network hop. Secrets are fetched lazily on
// first use; failure throws and the alarm fires (W-4).

import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";

const sm = new SecretsManagerClient({});
const cache = new Map<string, unknown>();

export async function getSecret<T>(name: string): Promise<T> {
  const hit = cache.get(name);
  if (hit !== undefined) return hit as T;

  const parsed = JSON.parse(await getSecretRaw(name)) as T;
  cache.set(name, parsed);
  return parsed;
}

const rawCache = new Map<string, string>();

/** The un-parsed SecretString. For secrets whose value may legitimately be
 *  either a JSON object or a bare string — the credentials-api stores the
 *  operator's `value` verbatim ("MAY be a JSON object … or a string"), so
 *  consumers that must tolerate both shapes (llm-anthropic's key
 *  resolution) read raw and parse themselves. */
export async function getSecretRaw(name: string): Promise<string> {
  const hit = rawCache.get(name);
  if (hit !== undefined) return hit;

  const res = await sm.send(new GetSecretValueCommand({ SecretId: name }));
  if (!res.SecretString) {
    throw new Error(`secret "${name}" has no SecretString (binary secret?)`);
  }
  rawCache.set(name, res.SecretString);
  return res.SecretString;
}

export interface AnthropicSecret {
  apiKey: string;
}
export interface NotionSecret {
  apiKey: string;
  databaseId: string;
}
export interface GithubSecret {
  token: string;
}
/**
 * Voyage AI API key. Used by the embedding path on `appendExecution`
 * (Epic-010 Story 4 — DDB-stored embeddings, brute-force kNN). The shape
 * deliberately mirrors `AnthropicSecret` so the call-site pattern in
 * `shared/voyage.ts` stays symmetric.
 */
export interface VoyageSecret {
  apiKey: string;
}
/**
 * Azure OpenAI credential (ADR-0027 §4). Unlike the single-field
 * provider keys above, an Azure call needs four values to resolve at
 * all: the key, the resource endpoint, the *deployment* name (Azure's
 * stand-in for a model id), and the API version. They are kept in ONE
 * secret rather than split across a secret and project attributes —
 * a mismatched endpoint/deployment pair surfaces as a 404 that reads
 * like an auth failure, so the four values must rotate together.
 *
 * `deployment` is the project default; a tool registry entry may
 * override it per call (`model.deployment`).
 */
export interface AzureOpenAISecret {
  apiKey: string;
  endpoint: string;
  deployment: string;
  apiVersion: string;
}
