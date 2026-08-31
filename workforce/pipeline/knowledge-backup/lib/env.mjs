// Argument + environment plumbing shared by the two ingest entry points.

/** Parse `--key value` / `--flag` pairs. Positional arguments are rejected. */
export function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith("--")) throw new Error(`unexpected argument: ${token}`);
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) {
      args[key] = true;
    } else {
      args[key] = next;
      i++;
    }
  }
  return args;
}

/**
 * Read a required environment variable. Missing configuration is a loud,
 * immediate failure (C-4) — never a run that quietly backs up nothing.
 */
export function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`missing required environment variable ${name}`);
  return value;
}
