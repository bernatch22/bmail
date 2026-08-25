/**
 * ws-hub.ts — Per-user WebSocket fan-out, the server-side ChangeNotifier.
 *
 * The engine only knows the ChangeNotifier interface; this is the real
 * implementation backed by the `ws` package. Events are delivered per user
 * (never broadcast), so one tenant's mail activity can never leak into
 * another tenant's socket.
 */

import type { WebSocket } from 'ws';

import type { WsEvent } from '@bmail/core/types';
import type { ChangeNotifier } from '@bmail/core';

export class WsHub implements ChangeNotifier {
  private readonly socketsByUser = new Map<string, Set<WebSocket>>();

  /** Register a freshly authenticated socket for a user. */
  add(userId: string, socket: WebSocket): void {
    let sockets = this.socketsByUser.get(userId);
    if (!sockets) {
      sockets = new Set();
      this.socketsByUser.set(userId, sockets);
    }
    sockets.add(socket);

    // Sockets self-deregister when they die, however they die.
    socket.on('close', () => this.remove(userId, socket));
    socket.on('error', () => this.remove(userId, socket));
  }

  remove(userId: string, socket: WebSocket): void {
    const sockets = this.socketsByUser.get(userId);
    if (!sockets) {
      return;
    }

    sockets.delete(socket);
    if (sockets.size === 0) {
      this.socketsByUser.delete(userId);
    }
  }

  /** ChangeNotifier: deliver an event to every live socket of one user. */
  sendToUser(userId: string, event: WsEvent): void {
    const sockets = this.socketsByUser.get(userId);
    if (!sockets) {
      return;
    }

    const wireMessage = JSON.stringify(event);
    for (const socket of sockets) {
      // readyState 1 === OPEN; anything else would throw or buffer forever.
      if (socket.readyState === 1) {
        socket.send(wireMessage);
      }
    }
  }
}
