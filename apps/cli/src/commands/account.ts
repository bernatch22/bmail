/**
 * commands/account.ts — the `bmailctl account …` command group.
 *
 * Thin layer: validation, confirmation and presentation live here; every
 * actual operation is a call into @bmail/admin. Passwords are printed ONCE
 * to stderr (or emitted in the --json document) and never persisted.
 */

import {
  type InfraConfig,
  createMailbox,
  listMailboxes,
  rotateMailboxPassword,
  deleteMailbox,
  getDisplayName,
  setDisplayName,
  removeDisplayName,
  requireEmail,
} from '@bmail/admin';

import type { CliFlags } from '../flags.js';
import { CliOutput, color, confirm } from '../output.js';

// ── create ────────────────────────────────────────────────────────────────────

export async function accountCreate(
  config: InfraConfig,
  output: CliOutput,
  email: string | undefined,
  flags: CliFlags,
): Promise<void> {
  const created = await createMailbox(
    config,
    requireEmail(email),
    { displayName: flags.name },
    output.asInfraLogger(),
  );

  if (created.displayName) {
    output.info(color.dim(`  (name: ${created.displayName})`));
  }

  // The client-settings block, exactly what a human needs to paste into
  // their mail client. Shown once — the password is not stored anywhere.
  output.info('');
  output.info(`  ${color.bold('IMAP/SMTP host')}  ${config.mailHost}`);
  output.info(`  ${color.bold('IMAP')}           993 · SSL/TLS`);
  output.info(`  ${color.bold('SMTP')}           465 · SSL/TLS`);
  output.info(`  ${color.bold('Username')}       ${created.email}`);
  output.info(`  ${color.bold('Password')}       ${color.yellow(created.password)}`);
  output.info('');
  output.info(color.dim('  (password shown once — store it now)'));

  output.emit({
    status: 'created',
    email: created.email,
    password: created.password,
    name: created.displayName,
  });
}

// ── list ──────────────────────────────────────────────────────────────────────

export async function accountList(
  config: InfraConfig,
  output: CliOutput,
  flags: CliFlags,
): Promise<void> {
  const allMailboxes = await listMailboxes(config);

  const mailboxes = flags.domain
    ? allMailboxes.filter((address) => address.endsWith(`@${flags.domain!.toLowerCase()}`))
    : allMailboxes;

  if (output.jsonMode) {
    output.emit({ accounts: mailboxes });
    return;
  }

  const plural = mailboxes.length === 1 ? '' : 'es';
  const scope = flags.domain ? ` on ${flags.domain}` : '';

  output.info(color.bold(`\n  ${mailboxes.length} mailbox${plural}${scope}\n`));

  for (const address of mailboxes) {
    console.log('  ' + address);
  }

  output.info('');
}

// ── passwd ────────────────────────────────────────────────────────────────────

export async function accountPasswd(
  config: InfraConfig,
  output: CliOutput,
  email: string | undefined,
  flags: CliFlags,
): Promise<void> {
  const normalizedEmail = requireEmail(email);

  const confirmed = await confirm(
    `Rotate password for ${color.bold(normalizedEmail)}?`,
    flags.yes,
  );
  if (!confirmed) {
    output.info('aborted.');
    return;
  }

  const rotated = await rotateMailboxPassword(config, normalizedEmail, {
    password: flags.password,
  });

  output.ok(`password rotated for ${color.bold(rotated.email)}`);
  output.info(`\n  ${color.bold('New password')}   ${color.yellow(rotated.password)}\n`);

  output.emit({ status: 'rotated', email: rotated.email, password: rotated.password });
}

// ── name ──────────────────────────────────────────────────────────────────────

export async function accountName(
  config: InfraConfig,
  output: CliOutput,
  email: string | undefined,
  name: string | undefined,
  flags: CliFlags,
): Promise<void> {
  const normalizedEmail = requireEmail(email);

  // No name argument → read, or clear when --clear is given.
  if (name == null || name === '') {
    if (flags.clear) {
      await removeDisplayName(config, normalizedEmail);
      output.ok(
        `cleared display name for ${normalizedEmail} (falls back to capitalized local-part)`,
      );
      output.emit({ status: 'cleared', email: normalizedEmail });
      return;
    }

    const currentName = await getDisplayName(config, normalizedEmail);
    const shown = currentName || color.dim('(none — capitalized local-part)');

    output.info(`\n  ${normalizedEmail}  →  ${color.bold(shown)}\n`);
    output.emit({ email: normalizedEmail, name: currentName });
    return;
  }

  await setDisplayName(config, normalizedEmail, name);

  output.ok(
    `display name for ${color.bold(normalizedEmail)} → ${color.bold(name)}  ` +
      color.dim('(live, no redeploy)'),
  );
  output.emit({ status: 'named', email: normalizedEmail, name });
}

// ── delete ────────────────────────────────────────────────────────────────────

export async function accountDelete(
  config: InfraConfig,
  output: CliOutput,
  email: string | undefined,
  flags: CliFlags,
): Promise<void> {
  const normalizedEmail = requireEmail(email);

  const confirmed = await confirm(
    `${color.red('Delete')} mailbox ${color.bold(normalizedEmail)} and ALL its mail?`,
    flags.yes,
  );
  if (!confirmed) {
    output.info('aborted.');
    return;
  }

  await deleteMailbox(config, normalizedEmail);

  output.ok(`mailbox ${color.bold(normalizedEmail)} deleted`);
  output.emit({ status: 'deleted', email: normalizedEmail });
}
