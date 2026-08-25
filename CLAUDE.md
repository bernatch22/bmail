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

## Arquitectura

Cuatro librerías, agrupadas por QUIÉN las consume (no por capa). Antes eran
siete — contract/domain/db/engine siempre viajaban juntas, así que hoy son
cuatro CARPETAS de un solo paquete.

```
packages/core   → el motor, server-side. Cuatro carpetas y cuatro subpaths:
                    src/types/  tipos de wire. Cero deps.        @bmail/core/types
                    src/logic/  lógica pura de correo, cero I/O  @bmail/core/logic
                    src/store/  SQLite + FTS5 + MailRepository   @bmail/core/store
                    src/mail/   IMAP, sync, SMTP, sesiones, IA   @bmail/core/mail
packages/sdk    → SDK HTTP+WS agnóstico de plataforma (fetch/WS/baseUrl
                  inyectables). Solo usa @bmail/core/types, y type-only.
packages/react  → componentes React presentacionales (cero fetch adentro)
packages/admin  → operar la plataforma como lib: ses.ts, route53.ts, maddy.ts
                  (ssh directo), dns-records.ts (los 3-4 records del cliente)
apps/server     → Express+WS: SOLO rutas y wiring sobre core
apps/web        → SPA fina: usa sdk + react
apps/cli        → CLI fina sobre admin (el bin sigue llamándose `bmailctl`)
apps/mcp        → servidor MCP "bmail" sobre admin + core
apps/bmaild-admin → (futuro) admin-API en bc-mail sobre admin
```

Regla de dependencias, un solo sentido:

- entre paquetes: `core ← (sdk | react | admin) ← apps`
- dentro de core:  `types ← logic ← store ← mail`

Nada importa "hacia arriba". `types/` no tiene deps de runtime y `logic/` son
funciones puras: por eso sdk y react pueden importar `@bmail/core/types` y
`@bmail/core/logic` sin arrastrar sqlite ni imapflow a un bundle de browser.

## Plan de migración — orden y estado

Cada paso deja el sistema corriendo. Marcar [x] al completar.

- [x] 0. Scaffold: package.json workspaces, tsconfig refs, este archivo
- [x] 1. `core/types`: unificar los tipos triplicados
       (bermail/packages/db/src/repository.ts + core/src/imap.ts + core/src/types.ts
        + web/src/types.ts → MessageEnvelope, FullMessage, MailboxInfo,
        PaginatedMessages, WsEvent, EmailInsight, AuthUser, Org)
- [x] 2. `core/store`: migrar @shmail/db → @bmail/core/store. Añadir `exports` reales, conexión
       inyectable (hoy singleton getDb()), tipos importados de contract.
       DDL: unificar (hoy hay doble fuente: SQL embebido + drizzle schema)
- [x] 3. `core/logic`: extraer lógica pura:
       - threading/normalizeSubject (de db/repository.ts)
       - reply/counterparty resolution (de web/src/mail.tsx:110+)
       - folder slug mapping (de web/src/router.tsx)
       - address parsing "Name <addr>"
- [x] 4. `core/mail`: partir bermail/packages/core:
       - imap.ts, imap-monitor.ts, sync.ts, user-manager.ts, session-store.ts
       - MailService: subir la lógica de route-messages.ts (trash está escrito
         6 veces en handlers) a métodos
       - SmtpSender: sacar el nodemailer inline de route-send.ts
       - InsightProvider: ai-service.ts como plugin inyectable en SyncEngine
       - NO migrar (código muerto Outlook): mail-sender.ts, auth.ts (MSAL),
         ws-handler.ts, cli.ts (roto), dep @azure/msal-node
- [x] 5. `apps/server`: server.ts + route-*.ts + ws-hub.ts + middleware-auth.ts,
       rutas finas sobre engine. Añadir auth bearer junto a la cookie.
       Fijar SESSION_SECRET requerido de env (hoy: random por arranque).
- [x] 6. `sdk`: extraer web/src/api.ts + ws.ts → SDK con fetch/WS/baseUrl
       inyectables; onUnauthorized callback (hoy: window.location.href)
- [x] 7. `react`: componentes de web/src/components → @bmail/react
       (mail-display.tsx tiene 638 líneas: partir render/acciones/sanitizado)
- [x] 8. `apps/web`: SPA sobre ui+client. Purgar .js stale de web/src.
- [x] 9. `admin`: descomponer bmailctl.mjs:
       - ses.ts: identidades + MAIL FROM. FIX: feedbackHost es
         'feedback-smtp.us-east-1.amazonaws.com' → debe ser '.amazonses.com' (BUG,
         no resuelve). Config sets + eventos SNS por dominio (deliverability nivel 1)
       - route53.ts: hostedZoneId, rrUpsert
       - maddy.ts: ssh directo con keys (alias bc-mail), creds/imap-acct, local_domains, display-names
       - dns-records.ts: generar los records del cliente (esquema 3-4 records:
         MX + SPF include:spf.bmail… + 1 CNAME BYODKIM + DMARC CNAME;
         DMARC SIN aspf=s — con MAIL FROM de SES por defecto, aspf=s rompe DMARC)
- [x] 10. `apps/cli`: CLI sobre admin. Mantener compat de comandos.
        Quitar flag muerta --print-password; ~/.bmailctl.json documentado pero
        nunca leído (implementarlo o quitarlo del texto)
- [x] 11. ATTACHMENTS (nuevo, pedido 2026-08-25):
        - [x] engine: extraer adjuntos en getMessage (mailparser ya los parsea),
          exponer listado {filename, contentType, size, partId} en FullMessage
          (+ MailService.getAttachment(folder, uid, partId) → bytes)
        - [x] server: GET /api/mailboxes/:folder/messages/:uid/attachments/:partId
          (stream, Content-Disposition attachment)
        - [x] engine/SmtpSender: adjuntos en envío (nodemailer attachments)
        - [x] contract: tipos AttachmentInfo; client: métodos download/upload
          (getAttachmentUrl + downloadAttachment; upload = attachments base64
          en send())
        - [x] ui/web: chips de adjuntos en MessageView + adjuntar en Composer
- [x] 12. apps/mcp (nuevo, pedido 2026-08-25): servidor MCP "bmail" para controlar
        todo desde Claude. Stdio, @modelcontextprotocol/sdk. Tools:
        - admin (sobre packages/admin): account_create/list/passwd/delete,
          org_add/list/verify, dns_records (genera los 3-4 records del cliente)
        - correo (sobre engine, creds por env o por tool de login):
          list_messages, read_message, download_attachment, send_message
- [ ] 13. e2e: migrar playwright. Credenciales por ENV (hoy hardcodeadas en
        bermail/e2e/bermail.spec.ts:3-4 — HAY QUE ROTARLAS además)
- [x] 14. Naming: unificado a bmail/@bmail. Ya no quedan @shmail/@bermail en
        código ni en docs (solo como referencia histórica al origen).
- [x] 15. Consolidación 7 → 4 paquetes (pedido 2026-08-25): core (types+logic+
        store+mail), sdk, react, admin; apps/bmailctl → apps/cli. Movimiento
        mecánico: cero cambios de lógica, mismos tests (26+20), y el bundle de
        web salió con el MISMO hash que producción (index-jlONSDRn.js).

## Pendientes fuera del código (no olvidar)

- ROTAR passwords de hello@bernardocastro.dev y gabriel@deutschepolska.com
  (expuestas en el repo bermail). Berna dijo 2026-08-25: NO rotar por ahora.
- DMARC: hecho 2026-08-25 — los tres dominios (bernardocastro.dev,
  deutschepolska.com, kickboxingzf.com) en `p=reject`, sin `aspf=s` (el MAIL
  FROM por defecto de SES rompe la alineación SPF estricta). De paso se
  corrigió el MX de bounce de kickboxingzf (.amazonaws.com → .amazonses.com).
- Deploy actual: cutover HECHO 2026-08-25 — pm2 `bmail` (:3002) + estáticos en
  /var/www/bmail sirven los tres webmails. El viejo `bermail` (:3001) sigue
  parado como rollback, junto con /etc/nginx/backup-precutover/. Apagarlo
  cuando pasen unos días estable.
- El deploy vivo es de ANTES de la consolidación: mismo comportamiento, pero
  el próximo deploy sube el árbol nuevo (rutas de pm2 apuntan a ~/bmail).

## Infra recordatorio rápido

- VM: bc-mail, GCP us-central1-a, IP 35.223.254.55. Se llega por SSH directo
  (alias `bc-mail` en ~/.ssh/config, key google_compute_engine) — NO por gcloud
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

- `@bmail/core/types`: src/{mail,insight,ws,auth}.ts + index. Incluye
  AttachmentInfo (paso 11) y el guard isWsEvent (único helper runtime).
  Decisión: `MessageEnvelope.date` es `string | null` (forma wire de db/web;
  el `Date` de core/imap.ts queda como detalle interno del engine). Se soltó
  el `unread?` legacy de MailboxInfo de web.
- `@bmail/core/store`: exports reales (`.`, `./schema`, `./repository`).
  `createDatabase(path)` → handle BmailDatabase inyectable; singleton muerto.
  `openDefaultDatabase()` resuelve BMAIL_DB → SHMAIL_DB (legacy) →
  ~/.bermail/shmail.db para seguir leyendo los datos de producción.
  Repository ahora es clase `MailRepository(database)`; lógica de queries,
  FTS5+triggers y threading intactos. DDL a mano sigue siendo la única fuente
  (drizzle schema solo tipa queries; duplicación anotada en comentarios).
  Columna `provider` legacy conservada a propósito.
- Desviación menor detectada (no tocada): packages/react/src ya contenía copias
  sueltas de {index,repository,schema}.ts de db — parecen restos de un intento
  previo; limpiar en el paso 7.
- `@bmail/core/logic` (paso 3): threading (normalizeSubject + computeThreadId puro
  con ThreadLookup inyectado), reply (resolveReplyRecipients con el caso
  self-addressed, quoted/forward HTML), addresses ("Name <addr>"), folders
  (slugs Maddy). 26 tests node:test verdes. Pendiente: db aún tiene su copia
  privada de normalizeSubject/computeThreadId — que importe de domain cuando
  se vuelva a tocar db.
- `@bmail/core/mail` (paso 4 + engine de 11): ImapService/ImapMonitor/SyncEngine/
  UserManager/SessionStore inyectables (MailRepository + OrgRegistry como
  datos con fixture de los 3 orgs, DisplayNameResolver con cache por mtime),
  MailService (trash/move/flags/getMessage con adjuntos + getAttachment por
  partId = índice 1-based de mailparser, re-parsea el source — optimizar
  persistiendo metadata si duele), SmtpSender (creds explícitas, Sent copy
  best-effort con mismo Message-ID, attachments), InsightProvider plugin
  opcional + AnthropicInsightProvider (claude-haiku-4-5). El ws-hub NO migró:
  el engine expone ChangeNotifier (interface) y el hub real va a apps/server.
- `apps/server` (paso 5 + endpoint de adjuntos de 11): rutas finas sobre engine,
  WsHub implementa ChangeNotifier, auth cookie+bearer (login devuelve el token),
  SESSION_SECRET obligatorio, adjuntos en /api/send como JSON base64 (multipart
  es TODO); `tsc -b` y smoke test de arranque verdes.
- `@bernatch22/bmail` (paso 6 + client de 11): BmailClient (fetch/WS/baseUrl
  inyectables, authMode cookie|bearer, onUnauthorized en vez de navegar) +
  BmailSocket (backoff exponencial, guard isWsEvent, token bearer por ?token=)
  + adjuntos (getAttachmentUrl/downloadAttachment, upload base64 en send);
  20 tests node:test verdes. (resuelto: el upgrade WS del server ya lee
  ?token= y monta move/DELETE, commit 6cb0e5f.)
- admin+cli: hechos y commiteados (5b3b020); feedbackHost corregido,
  esquema lean en dns-records.ts, ~/.bmailctl.json implementado.
- `@bmail/react` (paso 7 + chips de 11): componentes presentacionales puros —
  cero fetch, cero @bernatch22/bmail; datos y acciones entran por props/callbacks.
  mail-display.tsx partido en mail-display/thread-message/single-message/
  message-body/attachment-chips + lib/{quotes,darkify,format}; las acciones
  IMAP y los updates optimistas subieron a apps/web. AttachmentChips en el
  cuerpo del mensaje (onDownloadAttachment) y adjuntar archivos en ComposePane
  (File[] → callback; el base64 lo hace la app). El quote/forward HTML y la
  detección "es mío" ahora vienen de @bmail/core/logic (se borraron las copias
  inline). tsconfig con module ESNext + Bundler + jsx (lo consume Vite).
- `apps/web` (paso 8 + web de 11): SPA fina — router/auth/store + pages/mail.tsx
  que cablea ui↔client. use-auth sobre BmailClient en modo cookie
  (onUnauthorized navega a /login); WS vía client.connect(wsUrl same-origin);
  reply resolution y folder slugs desde @bmail/core/logic (copias de mail.tsx/
  router.tsx eliminadas). Descarga de adjuntos: client.downloadAttachment →
  Blob → <a download>; envío: File → base64 → send(). Vite con proxy
  /api y /ws a 127.0.0.1:3001. `tsc -b` raíz y `vite build` verdes. Los .js
  stale de bermail no se copiaron (solo .tsx/.ts). Restos de db en ui/src ya
  no existían al empezar el paso.
- `apps/mcp` (paso 12): servidor MCP "bmail" por stdio — 13 tools: admin sobre
  admin (account_create/list/passwd/delete, org_list/verify/add, dns_records
  lean|full; delete y org_add exigen confirm:true) + correo sobre engine por
  IMAP/SMTP directo sin DB local (mail_login/list/read/attachment/send;
  conexión IMAP por llamada, adjuntos a disco, console→stderr para no romper
  el protocolo). `tsc -b` y smoke test initialize+tools/list verdes.
  Self-installer `bmail-mcp install` (portado de ~/pinecall/mcp): detecta
  claude/codex/antigravity/cursor/windsurf/gemini, escribe la entrada "bmail"
  (node + path absoluto a dist/main.js), idempotente con backup .bak,
  --list/--remove/--with-env; sin args el bin sigue siendo el server stdio.

- 2026-08-25: consolidación 7 → 4 paquetes. contract/domain/db/engine son
  ahora core/src/{types,logic,store,mail} con subpaths por carpeta;
  client→sdk, ui→react, infra→admin, apps/bmailctl→apps/cli (bin `bmailctl`
  intacto, entry renombrado a src/main.ts). store/repository.ts ya importa
  normalizeSubject de logic/threading (se borró la copia duplicada). Lo único
  que sigue duplicado a propósito: el computeThreadId privado del repository,
  atado a SQL — portarlo a ThreadLookup cambia comportamiento, no es rename.

## Cutover a producción (sin downtime de IMAP/SMTP)

El correo vive en Maddy (imapsql + /var/lib/maddy/messages) y NO se toca.
La SQLite local es caché reconstruible. Migrar = cambiar la app, no los datos.

1. Deploy apps/server en bc-mail en :3002 (SESSION_SECRET fijo, BMAIL_ORGS_FILE),
   conviviendo con el bermail viejo en :3001.
2. Build de apps/web a /var/www/bmail (separado de /var/www/bermail).
3. Probar contra producción real apuntando a :3002 (login, leer, enviar, adjuntos).
4. Switch: proxy_pass + root de nginx al nuevo, reload. Segundos.
5. Rollback = revertir nginx; el viejo queda parado intacto (pm2 stop bermail).
Efecto visible único: relogin de usuarios del webmail (sesiones en RAM del viejo).
- 2026-08-25: admin ya NO usa gcloud — ssh directo con keys (alias `bc-mail` en
  ~/.ssh/config → 35.223.254.55, key google_compute_engine). Override:
  BMAIL_SSH_TARGET. Campos zone/box/project eliminados de InfraConfig.
