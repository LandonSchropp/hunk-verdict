import { mkdirSync, rmSync } from "node:fs";
import { createServer, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

/** Where the Hunk process with this ID serves its decisions. */
export function socketPath(processId: number): string {
  return join(tmpdir(), "hunk-verdict", `${processId}.sock`);
}

/** The socket one Hunk review serves its decisions on, to however many listeners connect. */
export class Channel {
  #server: Server | undefined;
  #listeners = new Set<Socket>();
  #held: string | undefined;

  constructor(readonly path: string) {}

  open() {
    mkdirSync(dirname(this.path), { recursive: true });
    rmSync(this.path, { force: true });

    this.#server = createServer((socket) => {
      this.#listeners.add(socket);

      if (this.#held) {
        socket.write(this.#held);
        this.#held = undefined;
      }

      socket.on("close", () => this.#listeners.delete(socket));
      socket.on("error", () => socket.destroy());
    });

    this.#server.on("error", () => this.#server?.close());
    this.#server.listen(this.path);
  }

  /**
   * Send one line to every listener, returning how many were listening. With nobody listening, the
   * line is held for the next listener to connect, replacing any line held before it.
   */
  broadcast(line: string): number {
    this.#listeners.forEach((listener) => listener.write(`${line}\n`));

    if (this.#listeners.size === 0) {
      this.#held = `${line}\n`;
    }

    return this.#listeners.size;
  }

  close() {
    this.#listeners.forEach((listener) => listener.destroy());
    this.#server?.close();
    rmSync(this.path, { force: true });
  }
}
