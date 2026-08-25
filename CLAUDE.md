# bmail — monorepo (migración desde ~/bermail + ~/bmailctl)

Reply in Spanish. Code, comments and commit messages in English.

## Estilo de código — NO NEGOCIABLE

Rails-style: legible ante todo. Cada archivo abre con un comentario de bloque que
dice qué es y por qué existe. Secciones separadas con líneas en blanco y comentarios
de sección. Nombres largos y descriptivos > abreviaturas. Una idea por línea; nada
de one-liners densos, ternarios anidados ni `&&` como control de flujo. Funciones
cortas con espacio alrededor. Comentar el *por qué*, no el qué.

## Qué es esto

Extracción de BMail a librerías reutilizables (web/mobile/desktop) + el controlador.
Fuentes de verdad durante la migración (NO tocar, solo leer):
- `~/bermail`  — webmail vivo en producción (packages/{db,core,web})
- `~/bmailctl` — CLI v0 (bin/bmailctl.mjs, 409 líneas, todo en uno)
- `~/bermail/docs/EMAIL-SYSTEM.md` — infra: Maddy en bc-mail (GCP) + SES + Route 53

## Arquitectura destino

```
packages/contract  → SOLO tipos compartidos. Cero deps. Todos importan de acá.
packages/domain    → lógica de correo pura, sin I/O (threading, reply-resolution,
                     quote/forward, address parsing, folder slugs)
packages/client    → SDK HTTP+WS agnóstico de plataforma (fetch/WS/baseUrl inyectables)
packages/ui        → componentes React reusables (MessageList, ThreadView, Composer…)
packages/db        → hoy @shmail/db: Drizzle+SQLite+FTS5, conexión inyectable, exports
packages/engine    → hoy el corazón de core: ImapService, ImapMonitor, SyncEngine,
                     UserManager, MailService, SmtpSender, InsightProvider (IA plugin)
packages/infra     → lógica de bmailctl como lib: ses.ts, route53.ts, maddy.ts,
                     dns-records.ts (los 3-4 records del cliente), deliverability.ts
apps/server        → Express+WS: SOLO rutas y wiring sobre engine+db
apps/web           → SPA actual adelgazada: usa ui + client
apps/bmailctl      → CLI fina sobre infra (flags + confirmaciones)
apps/bmaild-admin  → (futuro) admin-API en bc-mail sobre infra
```

Regla de dependencias (un solo sentido):
contract ← domain ← (client | db | engine | infra) ← ui ← apps

## Plan de migración — orden y estado

Cada paso deja el sistema corriendo. Marcar [x] al completar.

- [x] 0. Scaffold: package.json workspaces, tsconfig refs, este archivo
- [x] 1. `contract`: unificar los tipos triplicados
       (bermail/packages/db/src/repository.ts + core/src/imap.ts + core/src/types.ts
        + web/src/types.ts → MessageEnvelope, FullMessage, MailboxInfo,
        PaginatedMessages, WsEvent, EmailInsight, AuthUser, Org)
- [x] 2. `db`: migrar @shmail/db → @bmail/db. Añadir `exports` reales, conexión
       inyectable (hoy singleton getDb()), tipos importados de contract.
       DDL: unificar (hoy hay doble fuente: SQL embebido + drizzle schema)
- [x] 3. `domain`: extraer lógica pura:
       - threading/normalizeSubject (de db/repository.ts)
       - reply/counterparty resolution (de web/src/mail.tsx:110+)
       - folder slug mapping (de web/src/router.tsx)
       - address parsing "Name <addr>"
- [x] 4. `engine`: partir bermail/packages/core:
       - imap.ts, imap-monitor.ts, sync.ts, user-manager.ts, session-store.ts
       - MailService: subir la lógica de route-messages.ts (trash está escrito
         6 veces en handlers) a métodos
       - SmtpSender: sacar el nodemailer inline de route-send.ts
       - InsightProvider: ai-service.ts como plugin inyectable en SyncEngine
       - NO migrar (código muerto Outlook): mail-sender.ts, auth.ts (MSAL),
         ws-handler.ts, cli.ts (roto), dep @azure/msal-node
- [ ] 5. `apps/server`: server.ts + route-*.ts + ws-hub.ts + middleware-auth.ts,
       rutas finas sobre engine. Añadir auth bearer junto a la cookie.
       Fijar SESSION_SECRET requerido de env (hoy: random por arranque).
- [ ] 6. `client`: extraer web/src/api.ts + ws.ts → SDK con fetch/WS/baseUrl
       inyectables; onUnauthorized callback (hoy: window.location.href)
- [ ] 7. `ui`: componentes de web/src/components → @bmail/ui
       (mail-display.tsx tiene 638 líneas: partir render/acciones/sanitizado)
- [ ] 8. `apps/web`: SPA sobre ui+client. Purgar .js stale de web/src.
- [ ] 9. `infra`: descomponer bmailctl.mjs:
       - ses.ts: identidades + MAIL FROM. FIX: feedbackHost es
         'feedback-smtp.us-east-1.amazonaws.com' → debe ser '.amazonses.com' (BUG,
         no resuelve). Config sets + eventos SNS por dominio (deliverability nivel 1)
       - route53.ts: hostedZoneId, rrUpsert
       - maddy.ts: ssh gcloud, creds/imap-acct, local_domains, display-names
       - dns-records.ts: generar los records del cliente (esquema 3-4 records:
         MX + SPF include:spf.bmail… + 1 CNAME BYODKIM + DMARC CNAME;
         DMARC SIN aspf=s — con MAIL FROM de SES por defecto, aspf=s rompe DMARC)
- [ ] 10. `apps/bmailctl`: CLI sobre infra. Mantener compat de comandos.
        Quitar flag muerta --print-password; ~/.bmailctl.json documentado pero
        nunca leído (implementarlo o quitarlo del texto)
- [ ] 11. ATTACHMENTS (nuevo, pedido 2026-08-25):
        - [x] engine: extraer adjuntos en getMessage (mailparser ya los parsea),
          exponer listado {filename, contentType, size, partId} en FullMessage
          (+ MailService.getAttachment(folder, uid, partId) → bytes)
        - server: GET /api/mailboxes/:folder/messages/:uid/attachments/:partId
          (stream, Content-Disposition attachment)
        - [x] engine/SmtpSender: adjuntos en envío (nodemailer attachments)
        - contract: tipos AttachmentInfo; client: métodos download/upload
        - ui/web: chips de adjuntos en MessageView + adjuntar en Composer
- [ ] 12. apps/mcp (nuevo, pedido 2026-08-25): servidor MCP "bmail" para controlar
        todo desde Claude. Stdio, @modelcontextprotocol/sdk. Tools:
        - admin (sobre packages/infra): account_create/list/passwd/delete,
          org_add/list/verify, dns_records (genera los 3-4 records del cliente)
        - correo (sobre engine, creds por env o por tool de login):
          list_messages, read_message, download_attachment, send_message
- [ ] 13. e2e: migrar playwright. Credenciales por ENV (hoy hardcodeadas en
        bermail/e2e/bermail.spec.ts:3-4 — HAY QUE ROTARLAS además)
- [ ] 14. Naming: unificar todo a bmail/@bmail (hoy conviven BMail/shmail/BerMail)

## Pendientes fuera del código (no olvidar)

- ROTAR passwords de hello@bernardocastro.dev y gabriel@deutschepolska.com
  (expuestas en el repo bermail)
- DMARC de bernardocastro.dev está en p=none (docs dicen quarantine) — subir
- Buscar mail de "Maria Macpherson / prueba técnica" — no está en hello@;
  probablemente en me@bernardocastro.dev (falta gcloud auth o password de me@)
- Deploy actual: pm2 `bermail` en bc-mail + estáticos en /var/www/bermail (nginx).
  bermail sigue siendo lo desplegado hasta que apps/server+web estén validados.

## Infra recordatorio rápido

- VM: bc-mail, GCP us-central1-a, proyecto hiding-place-447317-c6, IP 35.223.254.55
- Maddy 0.9.5, /etc/maddy/maddy.conf; buzones imapsql; display names en
  /etc/bmail/display-names.json
- GCP bloquea :25 saliente → salida vía SES us-east-1 (email-smtp:587 STARTTLS).
  tls://…465 rompe TODO el envío en silencio (queda en cola de retry)
- IMAP/SMTP cliente: siempre mail.bernardocastro.dev :993/:465
- DNS: SIEMPRE Route 53 (~/.aws). Nunca GCP.
- SES verifica por DOMINIO: buzón nuevo en dominio verificado = cero DNS

## Estado 2026-08-25

Pasos 0–2 hechos: repo git inicializado (identidad me@bernardocastro.dev),
workspaces npm + `tsc -b` con references (tsconfig.base.json compartido),
`npm install` y build verdes, smoke test runtime de db (upsert, threading por
subject, FTS5) OK.

- `@bmail/contract`: src/{mail,insight,ws,auth}.ts + index. Incluye
  AttachmentInfo (paso 11) y el guard isWsEvent (único helper runtime).
  Decisión: `MessageEnvelope.date` es `string | null` (forma wire de db/web;
  el `Date` de core/imap.ts queda como detalle interno del engine). Se soltó
  el `unread?` legacy de MailboxInfo de web.
- `@bmail/db`: exports reales (`.`, `./schema`, `./repository`).
  `createDatabase(path)` → handle BmailDatabase inyectable; singleton muerto.
  `openDefaultDatabase()` resuelve BMAIL_DB → SHMAIL_DB (legacy) →
  ~/.bermail/shmail.db para seguir leyendo los datos de producción.
  Repository ahora es clase `MailRepository(database)`; lógica de queries,
  FTS5+triggers y threading intactos. DDL a mano sigue siendo la única fuente
  (drizzle schema solo tipa queries; duplicación anotada en comentarios).
  Columna `provider` legacy conservada a propósito.
- Desviación menor detectada (no tocada): packages/ui/src ya contenía copias
  sueltas de {index,repository,schema}.ts de db — parecen restos de un intento
  previo; limpiar en el paso 7.
- `@bmail/domain` (paso 3): threading (normalizeSubject + computeThreadId puro
  con ThreadLookup inyectado), reply (resolveReplyRecipients con el caso
  self-addressed, quoted/forward HTML), addresses ("Name <addr>"), folders
  (slugs Maddy). 26 tests node:test verdes. Pendiente: db aún tiene su copia
  privada de normalizeSubject/computeThreadId — que importe de domain cuando
  se vuelva a tocar db.
- `@bmail/engine` (paso 4 + engine de 11): ImapService/ImapMonitor/SyncEngine/
  UserManager/SessionStore inyectables (MailRepository + OrgRegistry como
  datos con fixture de los 3 orgs, DisplayNameResolver con cache por mtime),
  MailService (trash/move/flags/getMessage con adjuntos + getAttachment por
  partId = índice 1-based de mailparser, re-parsea el source — optimizar
  persistiendo metadata si duele), SmtpSender (creds explícitas, Sent copy
  best-effort con mismo Message-ID, attachments), InsightProvider plugin
  opcional + AnthropicInsightProvider (claude-haiku-4-5). El ws-hub NO migró:
  el engine expone ChangeNotifier (interface) y el hub real va a apps/server.
