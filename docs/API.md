# BMail API reference

Three parts: the REST/WS API served by `apps/server`, the `@bmail/client`
SDK, and the library surfaces (`contract`, `domain`, `db`, `engine`, `infra`,
plus the MCP tools).

All shapes referenced below are the real types from `@bmail/contract` unless
noted otherwise.

---

## REST API (apps/server)

Base path: `/api`. Bodies are JSON. Errors are `{ "error": string }` with an
appropriate status (400 bad input, 401 unauthenticated, 403 domain not
allowed, 404 not found, 500 with the real error message, 502 mailbox
unavailable).

### Authentication

There is no password store: credentials are verified against Maddy IMAP at
login. The server issues one JWT (12 h, `{ sub: userId, sid }`) usable two
ways:

- **Cookie** — `login` sets an httpOnly `session` cookie (browsers).
- **Bearer** — the same JWT is returned in the login body; send it as
  `Authorization: Bearer <jwt>` (native/CLI clients).

The bearer header wins over the cookie when both are present. The IMAP
password lives only in the server's RAM session store, never in the token.

### Routes

| Method | Path | Auth | Body | Response |
|---|---|---|---|---|
| GET | `/api/health` | none | — | `{ status: 'ok', ts: string }` |
| POST | `/api/auth/login` | none | `{ email, password }` | `{ user: AuthUser, token: string }` (+ sets cookie) |
| GET | `/api/auth/me` | cookie/bearer | — | `{ user: AuthUser }` or 401 |
| POST | `/api/auth/logout` | cookie/bearer | — | `{ ok: true }` (clears cookie, tears down session) |
| GET | `/api/mailboxes` | yes | — | `{ data: MailboxInfo[] }` |
| GET | `/api/mailboxes/:folder/messages?page=&limit=` | yes | — | `PaginatedMessages` (defaults page=1, limit=30) |
| GET | `/api/mailboxes/:folder/messages/:uid` | yes | — | `{ data: FullMessage }` (lazy IMAP body fetch, marks seen) |
| GET | `/api/mailboxes/:folder/messages/:uid/attachments/:partId` | yes | — | raw bytes; `Content-Type`, `Content-Disposition: attachment` (RFC 5987), `Content-Length` |
| POST | `/api/mailboxes/:folder/messages/:uid/read` | yes | — | `{ status: 'ok' }` |
| POST | `/api/mailboxes/:folder/messages/:uid/unread` | yes | — | `{ status: 'ok' }` |
| POST | `/api/mailboxes/:folder/messages/:uid/flag` | yes | — | `{ status: 'ok' }` |
| POST | `/api/mailboxes/:folder/messages/:uid/unflag` | yes | — | `{ status: 'ok' }` |
| POST | `/api/mailboxes/:folder/messages/:uid/trash` | yes | — | `{ status: 'ok' }` |
| POST | `/api/mailboxes/:folder/messages/:uid/archive` | yes | — | `{ status: 'ok' }` |
| POST | `/api/mailboxes/:folder/messages/:uid/move` | yes | `{ destination: string }` | `{ status: 'ok' }` |
| DELETE | `/api/mailboxes/:folder/messages/:uid` | yes | — | `{ status: 'ok' }` (permanent, no trash stop) |
| GET | `/api/search?q=` | yes | — | `{ data: MessageEnvelope[] }` (FTS5) |
| GET | `/api/thread?threadId=` | yes | — | `{ data: FullMessage[] }` (whole conversation, across folders) |
| POST | `/api/sync` | yes | — | `{ status: 'synced' }` |
| POST | `/api/send` | yes | see below | see below |

`:folder` is the URL-encoded IMAP path (`INBOX`, `Sent`, …); `:partId` comes
from the `attachments: AttachmentInfo[]` list of `GET .../messages/:uid`.

### POST /api/send

Send as the logged-in user via Maddy submission (SES relay), with a
best-effort copy appended to Sent under the same Message-ID.

Request body:

```json
{
  "to": "a@x.com, b@y.com",          // required
  "subject": "Hello",                 // required
  "cc": "c@z.com",                    // optional
  "text": "plain body",               // optional
  "html": "<p>html body</p>",         // optional
  "threadId": "…",                    // optional, echoed back for the UI
  "inReplyTo": "<message-id>",        // optional, sets In-Reply-To/References
  "attachments": [                    // optional, base64 JSON (no multipart yet)
    { "filename": "invoice.pdf",
      "contentType": "application/pdf",
      "contentBase64": "…" }
  ]
}
```

Response: `{ status: 'sent', messageId, message }` where `message` is an
envelope-shaped echo (`FullMessage` fields, `uid: 0`) so the UI can render the
sent mail before the next Sent sync. The JSON body limit is 25 MB (base64
inflates ~33%).

### WebSocket

- **Endpoint**: `/ws` on the same host/port (`ws://host:port/ws`).
- **Auth on the upgrade request**, in this order: `Authorization: Bearer`
  header → `?token=<jwt>` query parameter (for browser/RN WebSocket
  constructors, which cannot set headers) → the `session` cookie.
  Unauthenticated upgrades get `401` and the socket is destroyed.
- On connect the server sends
  `{ "type": "connected", "payload": { "timestamp": "<ISO>" } }`.
- Every frame is a `WsEvent`:

```ts
type WsEventType = 'connected' | 'new_message' | 'mailbox_update' | 'sync_update';
interface WsEvent { type: WsEventType; payload: Record<string, unknown>; }
```

Events are per-user notifications (never broadcast across tenants); clients
should re-fetch through the HTTP API rather than trusting the payload.

---

## @bmail/client SDK

Platform-agnostic: `fetch`, the WebSocket constructor and the base URL are
injectable, so the same SDK runs in browsers, Node (>= 18) and React Native.
Non-2xx responses throw `BmailApiError` (carries `.status`).

### Constructor

```ts
new BmailClient(options: BmailClientOptions)

interface BmailClientOptions {
  baseUrl: string;                       // "https://mail.example.com" or "" for same-origin
  fetch?: FetchLike;                     // defaults to globalThis.fetch
  WebSocketImpl?: WebSocketConstructorLike; // defaults to globalThis.WebSocket
  authMode: 'cookie' | 'bearer';
  token?: string;                        // initial bearer token (bearer mode)
  onUnauthorized?: () => void;           // called on any 401 (except login)
}
```

### Methods

| Method | Signature | Notes |
|---|---|---|
| `login` | `(email, password) => Promise<AuthUser>` | Bearer mode captures the returned token automatically |
| `logout` | `() => Promise<void>` | Drops the captured token |
| `me` | `() => Promise<AuthUser \| null>` | null when not authenticated |
| `setToken` / `token` | `(token: string \| null) => void` / getter | Manual token management |
| `listMailboxes` | `() => Promise<MailboxInfo[]>` | |
| `listMessages` | `(folder, { page?, limit? }?) => Promise<PaginatedMessages>` | Defaults page 1, limit 30 |
| `getMessage` | `(folder, uid) => Promise<FullMessage>` | |
| `getThread` | `(threadId) => Promise<FullMessage[]>` | Conversation across folders |
| `markSeen` | `(folder, uid, seen = true) => Promise<void>` | |
| `flag` | `(folder, uid, flagged = true) => Promise<void>` | \Flagged (star) |
| `move` | `(folder, uid, destination) => Promise<void>` | |
| `trash` / `archive` | `(folder, uid) => Promise<void>` | |
| `delete` | `(folder, uid) => Promise<void>` | Permanent |
| `send` | `(params: SendMessageParams) => Promise<{ message: FullMessage }>` | Attachments as base64 (`OutgoingAttachment[]`) |
| `getAttachmentUrl` | `(folder, uid, partId) => string` | Absolute URL — cookie-mode `<a href>` downloads |
| `downloadAttachment` | `(folder, uid, partId) => Promise<DownloadedAttachment>` | `{ filename, contentType, bytes: Uint8Array }` — use in bearer mode |
| `connect` | `(wsUrl?) => BmailSocket` | Derives ws(s)://…/ws from baseUrl when omitted |

`BmailSocket`: `connect()`, `disconnect()`, `subscribe(listener) => unsubscribe`,
`unsubscribe(listener)`. Reconnects with exponential backoff (1s → 30s max),
validates frames with `isWsEvent`, and in bearer mode appends `?token=` on
every (re)connect from a token supplier — a refreshed token is picked up
without recreating the socket.

### Example — web (cookie mode, same-origin)

```ts
import { BmailClient } from '@bmail/client';

const client = new BmailClient({
  baseUrl: '',
  authMode: 'cookie',
  onUnauthorized: () => router.navigate('/login'),
});

await client.login('me@example.com', 'secret');
const inbox = await client.listMessages('INBOX', { page: 1, limit: 30 });

// Same-origin baseUrl cannot derive a ws URL — pass it explicitly:
const socket = client.connect(`wss://${location.host}/ws`);
const stop = socket.subscribe((event) => {
  if (event.type === 'new_message') refetchInbox();
});
```

### Example — Node / native (bearer mode)

```ts
import { BmailClient } from '@bmail/client';
import WebSocket from 'ws';

const client = new BmailClient({
  baseUrl: 'https://mail.example.com',
  authMode: 'bearer',
  WebSocketImpl: WebSocket as never,
});

await client.login('me@example.com', 'secret'); // token captured from the body
const message = await client.getMessage('INBOX', 4321);

for (const attachment of message.attachments ?? []) {
  const file = await client.downloadAttachment('INBOX', 4321, attachment.partId);
  await fs.promises.writeFile(file.filename, file.bytes);
}

const socket = client.connect(); // wss://mail.example.com/ws?token=…
```

---

## Library surfaces

### @bmail/contract

Shared wire types, zero runtime dependencies. Everything is
JSON-serializable.

- `MailboxInfo` — `{ path, name, messages, unseen }`
- `MessageEnvelope` — `{ uid, seq, subject, from, date, seen, hasAttachments, preview?, threadId, aiInsight?, folder? }`
- `FullMessage extends MessageEnvelope` — `+ { to, cc, messageId?, textBody, htmlBody, attachments? }`
- `AttachmentInfo` — `{ filename, contentType, size, partId }`
- `PaginatedMessages` — `{ data, total, page, pageSize }`
- `EmailInsight`, `EmailCategory`, `EmailPriority` — AI insight shape
- `WsEvent`, `WsEventType`, `isWsEvent(value)` — the only runtime helper
- `AuthUser` — `{ email, org }`
- `OrgConfig`, `ImapConnConfig` — tenant shapes

### @bmail/domain

Pure functions, zero I/O, only depends on `contract`.

| Function | One line |
|---|---|
| `normalizeSubject(subject)` | Strip Re:/Fwd:/Fw: prefixes, trim, lowercase |
| `isReplySubject(subject)` | True when the subject carries a reply/forward prefix |
| `computeThreadId(headers, lookup)` | JWZ-inspired threading: In-Reply-To → subject grouping (replies only) → own Message-ID; `lookup: ThreadLookup` is injected by the store |
| `resolveReplyRecipients(selected, threadMessages, myEmail)` | Who a reply goes to — retargets my own/self-addressed messages to the thread counterparty |
| `buildReplySubject(subject)` / `buildForwardSubject(subject)` | Prefix "Re: " / "Fwd: " once |
| `buildQuotedBody(replyHtml, source)` | Gmail-style quoted reply HTML ("On …, X wrote:") |
| `buildForwardBody(replyHtml, source, forwardTo)` | Gmail-style forwarded-message block |
| `parseAddress(raw)` / `parseAddressList(rawList)` | `"Name <addr>"` → `{ name, address }` (address lowercased) |
| `extractAddress(raw)` / `extractDomain(raw)` | Bare address / its domain |
| `splitAddressList(rawList)` | Comma split, quote- and angle-bracket-aware |
| `formatAddress(parsed)` | Back to `"Name <addr>"`, quoting names when needed |
| `isSelfAddressed(from, to, myEmail)` | From me AND every recipient is me |
| `folderToSlug(imapPath)` / `slugToFolder(slug)` | URL slug ↔ IMAP path (`MADDY_FOLDERS`, `FOLDER_SLUGS`) |

### @bmail/db

SQLite cache of the mailbox (Drizzle typing + better-sqlite3 + FTS5).

- `createDatabase(path): BmailDatabase` — opens/creates the store, applies
  pragmas (WAL, FK, busy_timeout) and the idempotent DDL, which is the single
  source of truth for the schema (tables + FTS5 virtual table + sync
  triggers). The handle exposes `drizzle`, the raw `sqlite` connection and
  `close()`.
- `openDefaultDatabase()` / `resolveDefaultDatabasePath()` — resolves
  `BMAIL_DB` → `SHMAIL_DB` (legacy) → `~/.bermail/shmail.db`.
- `MailRepository(database)` — all queries as methods. Highlights:
  `getFolders`, `getMessages` (paginated envelopes), `getMessage`,
  `getThreadMessages`, `upsertMessage` (computes the thread id),
  `updateMessageBody` / `hasMessageBody` (lazy body cache),
  `markAsSeen` / `markAsUnseen`, `deleteMessage`, `updateAiInsight`,
  `getUnprocessedMessages`, `getHighestUid`, `searchMessages` (FTS5).
- `normalizeSubject` re-exported; `schema` exported for Drizzle typing.

### @bmail/engine

The core, extracted from bermail. No HTTP anywhere — the server wires it.

| Class / function | Role |
|---|---|
| `OrgRegistry` | Allowed email domains → per-org IMAP config; `fromJsonFile(path)`, `getOrgForEmail(email)` |
| `emailToUserId(email)` / `buildAccountConfig(...)` | Identity plumbing |
| `DisplayNameResolver` | `/etc/bmail/display-names.json` with mtime cache |
| `ImapService` | One authenticated IMAP connection: folders, envelopes, bodies, flags, moves, attachment bytes |
| `ImapMonitor` | IDLE-based new-mail watcher, emits `MailEvent` |
| `SyncEngine` | IMAP → SQLite incremental sync, optional AI enrichment, notifies `SyncChangeHandler` |
| `SessionStore` / `verifyImapCredentials(registry, email, password)` | RAM-only sessions; login check against Maddy |
| `UserManager` | Per-user trio (imap + monitor + sync) lifecycle, `getOrCreate`, idle reaper |
| `MailService` | The operations behind the routes: `listMessages`, `getMessage` (with attachments), `getAttachment(folder, uid, partId)`, `markSeen/markUnseen`, `flag/unflag`, `move`, `trash`, `archive`, `delete` |
| `SmtpSender` | `send(request, sentCopyImap?)` — Maddy submission (:465), Sent copy best-effort with the same Message-ID, attachments |
| `ChangeNotifier` / `NullChangeNotifier` | Interface the server's WsHub implements |
| `InsightProvider` / `AnthropicInsightProvider` | Optional AI-insight plugin |

### @bmail/infra

Platform ops as a library (used by `bmailctl`, the MCP server, and the future
`bmaild-admin`). Drives Maddy over plain SSH with keys (`~/.ssh/config` alias `bc-mail`, override `BMAIL_SSH_TARGET`) and AWS over the local CLIs.

| Module | Exports |
|---|---|
| `config` | `loadConfig()` (`BMAIL_*` env + `~/.bmailctl.json`), `feedbackHostForRegion()` |
| `logger` | `InfraLogger` seam, `silentLogger` |
| `validate` | `requireEmail`, `requireDomain`, the patterns |
| `maddy` | `listMailboxes`, `createMailbox`, `rotateMailboxPassword`, `deleteMailbox`, display-name CRUD, `addLocalDomain` |
| `ses` | `getIdentity`, `listDomainIdentities`, `verifyDomain`, `createDomainIdentity`, `createConfigurationSet` |
| `route53` | `findHostedZoneId`, `buildUpsert`, `applyChanges` |
| `dns-records` | `buildLeanRecords`, `buildLegacyFullRecords`, `formatRecordsForClient` |
| `org` | `onboardOrganization`, `requireHostedZone` |

DNS record schemes:

- **Lean** (`buildLeanRecords`) — the 3–4 records a client pastes into their
  own DNS: MX to our mail host, one SPF TXT with a single include we
  maintain, one `bmail._domainkey` BYODKIM CNAME into a zone we host (we
  rotate keys without touching the client), and an optional `_dmarc` CNAME to
  a policy we host. The DMARC policy deliberately avoids `aspf=s`: SES's
  default MAIL FROM is not a subdomain of the client's domain, so strict SPF
  alignment would fail every send.
- **Legacy full** (`buildLegacyFullRecords`) — the 7 records written straight
  into Route 53 when we host the zone: MX, SPF TXT, DMARC TXT, 3× Easy-DKIM
  CNAME, and bounce-subdomain MX + SPF (with the corrected
  `amazonses.com` feedback host).

### MCP tools (apps/mcp)

Stdio MCP server `bmail` — 13 tools. Admin tools sit on `@bmail/infra` (local
SSH keys and local `aws` session); mail tools speak IMAP/SMTP directly, one fresh
connection per call, no local DB. Credentials via `BMAIL_MCP_EMAIL` /
`BMAIL_MCP_PASSWORD` or the `mail_login` tool (in-memory override).

| Tool | Params | What it does |
|---|---|---|
| `account_create` | `email, name?` | New Maddy mailbox; returns the password once |
| `account_list` | `domain?` | All mailboxes, optionally per domain |
| `account_passwd` | `email` | Rotate to a new random password |
| `account_delete` | `email, confirm` | Destructive — refuses without `confirm: true` |
| `org_list` | — | SES domain identities with verification standing |
| `org_verify` | `domain` | Re-check sending/DKIM/MAIL FROM for one domain |
| `org_add` | `domain, webmail?, confirm` | Full onboarding — refuses without `confirm: true` |
| `dns_records` | `domain, lean?` | Structured records + paste-ready text block |
| `mail_login` | `email, password` | Switch the active mailbox (in-memory) |
| `mail_list` | `folder?, limit?` | Envelopes straight from IMAP, newest first |
| `mail_read` | `folder, uid` | Parsed body + attachment list (partIds) |
| `mail_attachment` | `folder, uid, partId, outDir?` | Saves to disk (default `~/Downloads`), returns the path |
| `mail_send` | `to, subject, body, inReplyTo?, attachments?` | SMTP send + Sent copy; attachments are local file paths |

Install into every detected assistant: `node apps/mcp/dist/main.js install`
(see [apps/mcp/README.md](../apps/mcp/README.md)).
