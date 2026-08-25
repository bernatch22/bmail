# @bmail/mcp — the "bmail" MCP server

Control the whole mail platform from Claude over stdio: platform
administration (Maddy mailboxes, SES organizations, DNS record sets) and a
live mailbox (list, read, download attachments, send) — no local database.

## Install

Build first (`npm run build` at the repo root), then let the server wire
itself into every assistant found on this machine (Claude Code, Claude
Desktop-style hosts, Codex, Cursor, Windsurf, Antigravity, Gemini CLI):

```sh
node apps/mcp/dist/main.js install
```

Variants:

```sh
node apps/mcp/dist/main.js install --list      # show what is detected, change nothing
node apps/mcp/dist/main.js install claude      # only the platforms you name
node apps/mcp/dist/main.js install --remove    # take the bmail entry back out
node apps/mcp/dist/main.js install --with-env  # also copy BMAIL_MCP_EMAIL/PASSWORD into the config
```

Each config file is backed up to `<file>.bak` before the first write, and
re-running repairs the existing `bmail` entry instead of adding a second one.

Manual fallback for Claude Code:

```sh
claude mcp add bmail -- node /Users/berna/bmail/apps/mcp/dist/main.js
```

## Mail credentials

The `mail_*` tools act as one mailbox. Configure it via environment:

```sh
claude mcp add bmail \
  -e BMAIL_MCP_EMAIL=me@bernardocastro.dev \
  -e BMAIL_MCP_PASSWORD=... \
  -- node /Users/berna/bmail/apps/mcp/dist/main.js
```

Or skip the env vars and call the `mail_login` tool in-session; it verifies
the credentials against IMAP and keeps them in memory only (they override the
env for the life of the server process).

## Tools

| tool | what it does |
|---|---|
| `account_create` `{email, name?}` | new Maddy mailbox; returns the password once |
| `account_list` `{domain?}` | all mailboxes, optionally per domain |
| `account_passwd` `{email}` | rotate to a new random password |
| `account_delete` `{email, confirm}` | destructive — refuses without `confirm: true` |
| `org_list` | SES domain identities with verification standing |
| `org_verify` `{domain}` | re-check sending/DKIM/MAIL FROM for one domain |
| `org_add` `{domain, webmail?, confirm}` | full onboarding — refuses without `confirm: true` |
| `dns_records` `{domain, lean?}` | structured records + paste-ready text block |
| `mail_login` `{email, password}` | switch the active mailbox (in-memory) |
| `mail_list` `{folder?, limit?}` | envelopes straight from IMAP, newest first |
| `mail_read` `{folder, uid}` | parsed body + attachment list (partIds) |
| `mail_attachment` `{folder, uid, partId, outDir?}` | saves to disk (default `~/Downloads`), returns the path |
| `mail_send` `{to, subject, body, inReplyTo?, attachments?}` | SMTP send + Sent copy; attachments are local file paths |

## Notes

- Admin tools use your local `gcloud` and `aws` sessions, exactly like
  `bmailctl` — same defaults, same `BMAIL_*` env overrides, same
  `~/.bmailctl.json`.
- Mail tools connect per call: the server opens a fresh IMAP connection for
  each operation and closes it. An MCP server idles for long stretches, and a
  parked IMAP socket only accumulates reconnect churn; a login to our own
  Maddy box costs milliseconds.
