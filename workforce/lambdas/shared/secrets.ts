// AWS Secrets Manager client wrapper. One cold-start cache per secret name
// to avoid the per-invocation network hop. Secrets are fetched lazily on
// first use; failure throws and the alarm fires (W-4).

import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";

const sm = new SecretsManagerClient({});
const cache = new Map<string, unknown>();

export async function getSecret<T>(name: string): Promise<T> {
  const hit = cache.get(name);
  if (hit !== undefined) return hit as T;

  const res = await sm.send(new GetSecretValueCommand({ SecretId: name }));
  if (!res.SecretString) {
    throw new Error(`secret "${name}" has no SecretString (binary secret?)`);
  }
  const parsed = JSON.parse(res.SecretString) as T;
  cache.set(name, parsed);
  return parsed;
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
