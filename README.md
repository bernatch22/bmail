# BMail

Self-hosted mail platform, as a TypeScript monorepo.

The backend stack is **Maddy** (IMAP/submission on the `bc-mail` VM, reached
over plain SSH) with outbound relay through **Amazon SES** and DNS in
**Route 53**. On top of that this repo provides four libraries — the mail
engine, the client SDK, the React components and the admin library — plus the
apps: an API server, the webmail SPA, the `bmailctl` admin CLI, and an MCP
server so the whole platform can be driven from Claude.

It is the extraction of the previously monolithic `bermail` webmail and
`bmailctl` v0 script into clean, platform-agnostic packages (web / mobile /
desktop ready). See `CLAUDE.md` for the plan and its current state.

The libraries are grouped by **who consumes them**, not by layer: building a
client app means `@bmail/sdk` (plus `@bmail/react` if it is React); running the
service means `@bmail/core`; operating domains and mailboxes means
`@bmail/admin`. One question, one answer.

## Architecture

```
        ┌─────────────────────────── apps ───────────────────────────┐
        │  apps/server   Express + WS API (routes + wiring)          │
        │  apps/web      webmail SPA (Vite + React)                  │
        │  apps/cli      bmailctl — accounts and organizations       │
        │  apps/mcp      "bmail" MCP server (13 tools, stdio)        │
        └───┬──────────────┬───────────────┬──────────────┬──────────┘
            │              │               │              │
     ┌──────▼──────┐ ┌─────▼──────┐  ┌─────▼──────┐       │
     │ @bmail/react│ │ @bmail/sdk │  │@bmail/admin│       │
     │  components │ │  HTTP + WS │  │ SES · R53  │       │
     │             │ │            │  │ Maddy/SSH  │       │
     └──────┬──────┘ └─────┬──────┘  └────────────┘       │
            │              │                              │
            └──────┬───────┘                              │
                   │  (types + logic only)                │
            ┌──────▼──────────────────────────────────────▼──────┐
            │                   @bmail/core                      │
            │                                                    │
            │   types/  wire shapes .............. zero deps     │
            │   logic/  threading, reply, addresses .. zero I/O  │
            │   store/  SQLite + FTS5, MailRepository            │
            │   mail/   IMAP · sync · SMTP · sessions · AI       │
            └────────────────────────────────────────────────────┘
```

Dependency rule, one way only — between packages:

```
core ← (sdk | react | admin) ← apps
```

and inside `core`, between folders:

```
types ← logic ← store ← mail
```

Nothing imports "up". `types/` has zero runtime dependencies and `logic/` is
pure functions, which is why `sdk` and `react` can reach into `@bmail/core/types`
and `@bmail/core/logic` without dragging sqlite or imapflow into a browser
bundle. The engine never touches HTTP or WebSockets either: it only knows the
`ChangeNotifier` interface — the real WS hub lives in `apps/server`.

## Packages and apps

| Workspace | Purpose | Docs |
|---|---|---|
| `packages/core` | The engine: wire types, pure mail logic, the SQLite cache and IMAP/sync/SMTP/sessions/AI. Subpaths: `/types`, `/logic`, `/store`, `/mail`. | [docs/API.md](docs/API.md#bmailcore) |
| `packages/sdk` | Platform-agnostic HTTP+WS SDK (`BmailClient`, `BmailSocket`). Browser / Node / React Native. | [docs/API.md](docs/API.md#bmailsdk) |
| `packages/react` | Presentational React components (MailList, MailDisplay, ComposePane, …). No fetch inside. | [src/index.ts](packages/react/src/index.ts) |
| `packages/admin` | Platform ops as a library: SES identities, Route 53, Maddy over SSH, client DNS record sets. | [docs/API.md](docs/API.md#bmailadmin) |
| `apps/server` | Express + WS API server: thin routes over `core`. | [docs/API.md](docs/API.md#rest-api-appsserver) |
| `apps/web` | Webmail SPA (Vite + React) over `sdk` + `react`. | — |
| `apps/cli` | Admin CLI over `admin` — the bin is still `bmailctl`. | `bmailctl --help` |
| `apps/mcp` | MCP server "bmail": admin + live mailbox tools for Claude and other assistants. | [apps/mcp/README.md](apps/mcp/README.md) |

## Quickstart

Requirements: Node >= 18 (native fetch), npm workspaces.

```sh
npm install          # install all workspaces
npx tsc -b           # build everything (project references)

npm test              # every package that has tests (node:test)
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

Admin CLI (drives Maddy over plain SSH — keys, `~/.ssh/config` alias
`bc-mail` — and SES/Route 53 over local `aws` credentials; config via `BMAIL_*` env vars or `~/.bmailctl.json`):

```sh
node apps/cli/dist/main.js --help
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
server, attachments end to end), and the seven original packages have been
consolidated into the four above. Pending: the e2e Playwright migration.
`apps/server` + `apps/web` are what production serves today; the legacy
`bermail` process stays parked on `:3001` as the rollback.
