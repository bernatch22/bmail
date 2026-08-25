/**
 * config.ts — Server configuration, resolved from the environment ONCE at boot.
 *
 * Everything the server needs from the outside world is read here, so the
 * rest of the code takes plain values instead of poking process.env. The one
 * hard rule: SESSION_SECRET is REQUIRED. bermail generated a random secret
 * per boot, which silently logged every user out on every restart — we
 * refuse to start instead.
 */

export interface ServerConfig {
  /** HTTP/WS listen port. */
  port: number;

  /** JWT signing secret. Required — see loadServerConfig(). */
  sessionSecret: string;

  /** Optional path to a JSON org registry file (array of OrgConfig). */
  orgsFile?: string;

  /** Present → enable the Anthropic insight provider. */
  anthropicApiKey?: string;
}

export function loadServerConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const sessionSecret = env.SESSION_SECRET;

  if (!sessionSecret || sessionSecret.trim() === '') {
    throw new Error(
      'SESSION_SECRET is required. Set it in the environment before starting ' +
      'the server (e.g. SESSION_SECRET=$(openssl rand -hex 32)). A random ' +
      'per-boot secret is not acceptable: it invalidates every session on restart.',
    );
  }

  return {
    port: env.PORT ? parseInt(env.PORT, 10) : 3001,
    sessionSecret,
    orgsFile: env.BMAIL_ORGS_FILE || undefined,
    anthropicApiKey: env.ANTHROPIC_API_KEY || undefined,
  };
}
