# BMail

Self-hosted mail platform, as a TypeScript monorepo.

The backend stack is **Maddy** (IMAP/submission on a GCP VM, `bc-mail`) with
outbound relay through **Amazon SES** and DNS in **Route 53**. On top of that
this repo provides reusable libraries (contract types, pure mail logic, an
HTTP+WS SDK, React components, a SQLite cache, the sync/send engine, and infra
automation), plus the apps: an API server, the webmail SPA, the `bmailctl`
admin CLI, and an MCP server so the whole platform can be driven from Claude.

It is the extraction of the previously monolithic `bermail` webmail and
`bmailctl` v0 script into clean, platform-agnostic packages (web / mobile /
desktop ready). See `CLAUDE.md` for the migration plan and its current state.

## Architecture

```
                 ┌──────────────────────── apps ────────────────────────┐
                 │  apps/server   Express + WS API (routes + wiring)    │
                 │  apps/web      webmail SPA (Vite + React)            │
                 │  apps/bmailctl admin CLI (accounts + orgs)           │
                 │  apps/mcp      "bmail" MCP server (13 tools, stdio)  │
                 └──────────┬───────────────┬──────────────┬────────────┘
                            │               │              │
                     ┌──────▼─────┐   ┌─────▼─────┐  ┌─────▼─────┐
                     │ @bmail/ui  │   │  @bmail/  │  │  @bmail/  │
                     │  (React)   │   │  client   │  │   infra   │
                     └──────┬─────┘   │ (HTTP+WS) │  │(SES/R53/  │
                            │         └─────┬─────┘  │  Maddy)   │
              ┌─────────────┼───────────────┤        └─────┬─────┘
        ┌─────▼─────┐ ┌─────▼──────┐        │              │
        │ @bmail/db │ │@bmail/engine│       │              │
        │ (SQLite + │ │ (IMAP/sync/ │       │              │
        │   FTS5)   │ │ send/users) │       │              │
        └─────┬─────┘ └─────┬──────┘        │              │
              └───────┬─────┴───────────────┴──────────────┘
               ┌──────▼───────┐
               │ @bmail/domain│  pure mail logic, zero I/O
               └──────┬───────┘
               ┌──────▼────────┐
               │ @bmail/contract│  shared wire types, zero deps
               └───────────────┘
```

Dependency rule, one way only:

```
contract ← domain ← (client | db | engine | infra) ← ui ← apps
```

Nothing imports "up". `contract` has zero runtime dependencies; `domain` is
pure functions; the engine never touches HTTP or WebSockets (it only knows the
`ChangeNotifier` interface — the real WS hub lives in `apps/server`).

## Packages and apps

| Workspace | Purpose | Docs |
|---|---|---|
| `packages/contract` | Shared wire types (`MessageEnvelope`, `FullMessage`, `WsEvent`, …). Zero deps. | [docs/API.md](docs/API.md#bmailcontract) |
| `packages/domain` | Pure mail logic: threading, reply resolution, quote/forward HTML, address parsing, folder slugs. | [docs/API.md](docs/API.md#bmaildomain) |
| `packages/client` | Platform-agnostic HTTP+WS SDK (`BmailClient`, `BmailSocket`). Browser / Node / React Native. | [docs/API.md](docs/API.md#bmailclient-sdk) |
| `packages/ui` | Presentational React components (MailList, MailDisplay, ComposePane, …). No fetch inside. | [src/index.ts](packages/ui/src/index.ts) |
| `packages/db` | Local mail cache: Drizzle + better-sqlite3 + FTS5, injectable connection, `MailRepository`. | [docs/API.md](docs/API.md#bmaildb) |
| `packages/engine` | The core: `ImapService`, `ImapMonitor`, `SyncEngine`, `UserManager`, `MailService`, `SmtpSender`, AI insights plugin. | [docs/API.md](docs/API.md#bmailengine) |
| `packages/infra` | Platform ops as a library: SES identities, Route 53, Maddy over SSH, client DNS record sets. | [docs/API.md](docs/API.md#bmailinfra) |
| `apps/server` | Express + WS API server: thin routes over engine + db. | [docs/API.md](docs/API.md#rest-api-appsserver) |
| `apps/web` | Webmail SPA (Vite + React) over `ui` + `client`. | — |
| `apps/bmailctl` | Admin CLI over `infra`: accounts, orgs, DNS records. | `bmailctl --help` |
| `apps/mcp` | MCP server "bmail": admin + live mailbox tools for Claude and other assistants. | [apps/mcp/README.md](apps/mcp/README.md) |

## Quickstart

Requirements: Node >= 18 (native fetch), npm workspaces.

```sh
npm install          # install all workspaces
npx tsc -b           # build everything (project references)

# tests live per package (node:test):
npm test -w @bmail/domain
npm test -w @bmail/client
```

Run the API server (needs `SESSION_SECRET`; reads the mail cache from
`BMAIL_DB`, falling back to the legacy `~/.bermail/shmail.db`):

```sh
SESSION_SECRET=... npm run dev -w @bmail/server    # tsx, port 3001 by default
```

Run the webmail in dev (proxies `/api` and `/ws` to `127.0.0.1:3001`):

```sh
npm run dev -w @bmail/web
```

Admin CLI (drives Maddy over `gcloud ssh` and SES/Route 53 over local `aws`
credentials; config via `BMAIL_*` env vars or `~/.bmailctl.json`):

```sh
node apps/bmailctl/dist/bmailctl.js --help
bmailctl account create someone@example.com --name "Some One"
bmailctl org records example.com --lean
```

MCP server — install into every detected assistant (Claude Code, Codex,
Cursor, Windsurf, Antigravity, Gemini CLI):

```sh
node apps/mcp/dist/main.js install
```

See [apps/mcp/README.md](apps/mcp/README.md) for credentials and tool details.

## Deployment

Production runs on the `bc-mail` VM (GCP): Maddy owns the mailboxes
(imapsql), the Node API runs under **pm2**, and **nginx** serves the SPA
statics and proxies `/api` + `/ws`. The local SQLite is a rebuildable cache —
migrating the app never touches the mail data. The zero-downtime cutover plan
(new server on `:3002` next to the old one, nginx switch, seconds of impact)
is documented in [CLAUDE.md — "Cutover a producción"](CLAUDE.md#cutover-a-producción-sin-downtime-de-imapsmtp).

## Status

Migration steps 0–12 are done (all packages, server, web, bmailctl, MCP
server, attachments end to end). Pending: e2e Playwright migration and the
final naming unification. The legacy `bermail` deployment remains what is live
in production until `apps/server` + `apps/web` are validated there.
