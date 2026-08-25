# @bmail/sdk

Cliente HTTP + WebSocket del API de [BMail](https://github.com/bernatch22/bmail), el webmail
self-hosted sobre Maddy. **Cero dependencias**: corre en el navegador, en Node, en Electron y en
React Native — `fetch` y `WebSocket` son inyectables.

```sh
npm i @bmail/sdk
```

```ts
import { BmailClient } from '@bmail/sdk'

const cliente = new BmailClient({ baseUrl: 'https://mail.example.com', authMode: 'bearer' })
await cliente.login('me@example.com', 'la-contraseña-imap')

const buzones = await cliente.listMailboxes()
const pagina = await cliente.listMessages('INBOX', { page: 1, limit: 50 })
const mensaje = await cliente.getMessage('INBOX', pagina.data[0].uid)

// Lo que llega solo: el servidor avisa por WebSocket y el socket reconecta
// con backoff. `onStatus` dice cuándo la conexión está viva.
const socket = cliente.connect()
socket.subscribe((evento) => console.log(evento.type, evento.payload))
socket.onStatus((conectado) => console.log(conectado ? 'en directo' : 'reconectando'))
```

## Dos modos de autenticación

| modo | para | cómo |
|---|---|---|
| `cookie` | una SPA en el mismo origen que el servidor | `credentials: 'include'`; el JWT viaja en una cookie httpOnly |
| `bearer` | móvil, escritorio, Node | `login()` captura el token; va en `Authorization` y, en el WebSocket, como `?token=` |

Un 401 en cualquier llamada dispara `onUnauthorized` (nunca navega por su cuenta); el 401 de
`login()` no, porque es «contraseña mal», no «sesión vencida».

## Superficie

`login` · `logout` · `me` · `listMailboxes` · `listMessages` · `getMessage` · `getThread` ·
`markSeen` · `flag` · `move` · `trash` · `archive` · `delete` · `send` (con adjuntos en base64) ·
`getAttachmentUrl` · `downloadAttachment` · `connect` → `BmailSocket`.

Los tipos del contrato (`MailboxInfo`, `MessageEnvelope`, `FullMessage`, `WsEvent`…) van
inlineados en el `.d.ts`: no hay que instalar nada más para nombrarlos.

La referencia completa, ruta por ruta, está en
[docs/API.md](https://github.com/bernatch22/bmail/blob/main/docs/API.md) del repo.
