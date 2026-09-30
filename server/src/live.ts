import type { LiveTopic } from '../../shared/src/index.ts';

interface Socket {
  readyState: number;
  send(data: string): void;
  on(event: 'close', cb: () => void): void;
}

const OPEN = 1;

/** Pushes "this changed" notices to every open screen so the hub, phones and laptops stay in sync. */
export class LiveHub {
  private sockets = new Set<Socket>();

  add(socket: Socket) {
    this.sockets.add(socket);
    socket.on('close', () => this.sockets.delete(socket));
    socket.send(JSON.stringify({ type: 'hello' }));
  }

  broadcast(topics: LiveTopic[]) {
    const msg = JSON.stringify({ type: 'changed', topics });
    for (const s of this.sockets) if (s.readyState === OPEN) s.send(msg);
  }

  get size() {
    return this.sockets.size;
  }
}
