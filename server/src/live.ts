import type { LiveTopic, Nudge } from '../../shared/src/index.ts';

interface Socket {
  readyState: number;
  send(data: string): void;
  on(event: 'close', cb: () => void): void;
}

const OPEN = 1;

/** Pushes "this changed" notices to every open screen so the hub, phones and laptops stay in sync. */
export class LiveHub {
  private sockets = new Set<Socket>();

  /** `build` identifies the served web build, so a screen can reload when it changes. */
  private build: string;
  constructor(build = 'dev') {
    this.build = build;
  }

  add(socket: Socket) {
    this.sockets.add(socket);
    socket.on('close', () => this.sockets.delete(socket));
    socket.send(JSON.stringify({ type: 'hello', build: this.build }));
  }

  /** Heartbeat: lets a screen notice a dead connection. */
  ping() {
    this.send({ type: 'ping' });
  }

  broadcast(topics: LiveTopic[]) {
    this.send({ type: 'changed', topics });
  }

  /** A nudge just fired: the hub chimes and shows a banner. */
  announce(nudges: Nudge[]) {
    this.send({ type: 'nudge', nudges: nudges.map((n) => ({ id: n.id, title: n.title })) });
  }

  private send(msg: object) {
    const text = JSON.stringify(msg);
    for (const s of this.sockets) if (s.readyState === OPEN) s.send(text);
  }

  get size() {
    return this.sockets.size;
  }
}
