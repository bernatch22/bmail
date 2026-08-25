/**
 * maddy.ts — mailbox operations on the Maddy server (bc-mail).
 *
 * Everything runs over gcloud ssh (see ssh.ts) against the maddy CLI on the
 * box: creds for authentication, imap-acct for the actual mailbox, plus the
 * display-names JSON file and the local_domains line in maddy.conf.
 *
 * These functions never prompt and never print: confirmation questions and
 * password display belong to the CLI layer. Generated passwords are
 * RETURNED to the caller and never persisted anywhere.
 */

import type { InfraConfig } from './config.js';
import type { InfraLogger } from './logger.js';
import { silentLogger } from './logger.js';
import { runOnMailbox } from './ssh.js';
import { quoteForSingleQuotes } from './shell.js';
import { requireEmail, EMAIL_PATTERN } from './validate.js';

// ── mailboxes ─────────────────────────────────────────────────────────────────

// List every mailbox address known to Maddy, sorted.
export async function listMailboxes(config: InfraConfig): Promise<string[]> {
  const output = await runOnMailbox(config, 'sudo -u maddy maddy creds list');

  return output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => EMAIL_PATTERN.test(line))
    .sort();
}

export interface CreatedMailbox {
  email: string;
  password: string;
  displayName: string | null;
}

// Create a mailbox with a random password (generated on the box, so the
// secret never travels in the command line). Throws if it already exists.
export async function createMailbox(
  config: InfraConfig,
  email: string,
  options: { displayName?: string } = {},
  logger: InfraLogger = silentLogger,
): Promise<CreatedMailbox> {
  const normalizedEmail = requireEmail(email);
  const quotedEmail = quoteForSingleQuotes(normalizedEmail);

  logger.step(`creating mailbox ${normalizedEmail} …`);

  const remoteScript = [
    `set -e`,
    `if sudo -u maddy maddy creds list 2>/dev/null | grep -qix '${quotedEmail}'; then echo BMAILCTL_EXISTS=1; exit 0; fi`,
    `p=$(openssl rand -hex 16)`,
    `printf '%s\\n%s\\n' "$p" "$p" | sudo -u maddy maddy creds create '${quotedEmail}'`,
    `sudo -u maddy maddy imap-acct create '${quotedEmail}' >/dev/null 2>&1 || true`,
    `echo BMAILCTL_PASSWORD=$p`,
  ].join('\n');

  const output = await runOnMailbox(config, remoteScript);

  if (/BMAILCTL_EXISTS=1/.test(output)) {
    throw new Error(`mailbox already exists: ${normalizedEmail} (rotate its password instead)`);
  }

  const passwordMatch = output.match(/BMAILCTL_PASSWORD=(\S+)/);
  if (!passwordMatch) {
    throw new Error(`unexpected maddy output:\n${output}`);
  }

  if (options.displayName) {
    await setDisplayName(config, normalizedEmail, options.displayName);
  }

  logger.ok(`mailbox ${normalizedEmail} created`);

  return {
    email: normalizedEmail,
    password: passwordMatch[1],
    displayName: options.displayName || null,
  };
}

// Rotate (or explicitly set) the password of an existing mailbox.
// Returns the new password; never stores it.
export async function rotateMailboxPassword(
  config: InfraConfig,
  email: string,
  options: { password?: string } = {},
): Promise<{ email: string; password: string }> {
  const normalizedEmail = requireEmail(email);
  const quotedEmail = quoteForSingleQuotes(normalizedEmail);

  const passwordLine = options.password
    ? `p='${quoteForSingleQuotes(options.password)}'`
    : `p=$(openssl rand -hex 16)`;

  const remoteScript = [
    `set -e`,
    passwordLine,
    `printf '%s\\n%s\\n' "$p" "$p" | sudo -u maddy maddy creds password '${quotedEmail}'`,
    `echo BMAILCTL_PASSWORD=$p`,
  ].join('\n');

  const output = await runOnMailbox(config, remoteScript);

  const passwordMatch = output.match(/BMAILCTL_PASSWORD=(\S+)/);
  if (!passwordMatch) {
    throw new Error(`password rotation failed:\n${output}`);
  }

  return { email: normalizedEmail, password: passwordMatch[1] };
}

// Delete a mailbox and all its mail. Destructive and unguarded on purpose:
// the confirmation question lives in the CLI, not here.
export async function deleteMailbox(config: InfraConfig, email: string): Promise<void> {
  const normalizedEmail = requireEmail(email);
  const quotedEmail = quoteForSingleQuotes(normalizedEmail);

  // The maddy removes use --yes because without it they hang on a tty prompt.
  const remoteScript = [
    `sudo -u maddy maddy imap-acct remove --yes '${quotedEmail}' 2>/dev/null || true`,
    `sudo -u maddy maddy creds remove --yes '${quotedEmail}' 2>/dev/null || true`,
    `echo BMAILCTL_DONE`,
  ].join('\n');

  await runOnMailbox(config, remoteScript);

  // Best effort: a stale display-name entry is harmless, so a failure here
  // must not turn a successful delete into an error.
  await removeDisplayName(config, normalizedEmail).catch(() => {});
}

// ── display names ─────────────────────────────────────────────────────────────
//
// Persisted in /etc/bmail/display-names.json on the box. The webmail reads
// that file (mtime-cached), so a change here goes live with no redeploy.

// Read the whole email → display-name map.
export async function readDisplayNames(config: InfraConfig): Promise<Record<string, string>> {
  const output = await runOnMailbox(
    config,
    `sudo cat ${config.displayNamesPath} 2>/dev/null || echo '{}'`,
  );

  try {
    return JSON.parse(output.trim() || '{}');
  } catch {
    return {};
  }
}

// Replace the whole map on the box. The JSON travels base64-encoded so no
// quoting/escaping in the remote shell can corrupt it (names carry spaces,
// quotes, accents — base64 sidesteps all of it).
export async function writeDisplayNames(
  config: InfraConfig,
  displayNames: Record<string, string>,
): Promise<void> {
  const json = JSON.stringify(displayNames, null, 2);
  const base64Payload = Buffer.from(json, 'utf8').toString('base64');
  const parentDirectory = config.displayNamesPath.replace(/\/[^/]+$/, '');

  const remoteScript = [
    `set -e`,
    `sudo mkdir -p ${parentDirectory}`,
    `echo '${base64Payload}' | base64 -d | sudo tee ${config.displayNamesPath} >/dev/null`,
    `sudo chmod 644 ${config.displayNamesPath}`,
    `echo BMAILCTL_DONE`,
  ].join('\n');

  await runOnMailbox(config, remoteScript);
}

// Set one address's display name.
export async function setDisplayName(
  config: InfraConfig,
  email: string,
  displayName: string,
): Promise<void> {
  const normalizedEmail = requireEmail(email);
  const displayNames = await readDisplayNames(config);

  displayNames[normalizedEmail] = displayName;

  await writeDisplayNames(config, displayNames);
}

// Read one address's display name (null when it falls back to the
// capitalized local-part).
export async function getDisplayName(config: InfraConfig, email: string): Promise<string | null> {
  const normalizedEmail = requireEmail(email);
  const displayNames = await readDisplayNames(config);

  return displayNames[normalizedEmail] ?? null;
}

// Clear one address's display name, if set.
export async function removeDisplayName(config: InfraConfig, email: string): Promise<void> {
  const normalizedEmail = email.toLowerCase();
  const displayNames = await readDisplayNames(config);

  if (displayNames[normalizedEmail] != null) {
    delete displayNames[normalizedEmail];
    await writeDisplayNames(config, displayNames);
  }
}

// ── local_domains ─────────────────────────────────────────────────────────────

// Append a domain to $(local_domains) in maddy.conf and reload Maddy.
// Idempotent: an already-present domain leaves the file untouched.
// The edit runs as a small python script shipped base64-over-ssh, because a
// regex edit written in shell quoting would be unreadable and fragile.
export async function addLocalDomain(
  config: InfraConfig,
  domain: string,
  logger: InfraLogger = silentLogger,
): Promise<void> {
  logger.step('Maddy: add to local_domains + reload');

  const pythonScript = [
    `import re,sys`,
    `p=${JSON.stringify(config.maddyConf)}`,
    `d=${JSON.stringify(domain)}`,
    `s=open(p).read()`,
    `m=re.search(r'(\\$\\(local_domains\\)\\s*=\\s*)([^\\n]*)',s)`,
    `sys.exit('local_domains not found') if not m else None`,
    `doms=m.group(2).split()`,
    `print('exists') if d in doms else None`,
    `s=s[:m.start(2)]+' '.join(doms+[d])+s[m.end(2):] if d not in doms else s`,
    `open(p,'w').write(s)`,
    `print('ok')`,
  ].join('\n');

  const base64Payload = Buffer.from(pythonScript, 'utf8').toString('base64');

  await runOnMailbox(
    config,
    `echo '${base64Payload}' | base64 -d | sudo python3 - && sudo systemctl reload maddy 2>/dev/null || sudo systemctl restart maddy`,
  );
}
