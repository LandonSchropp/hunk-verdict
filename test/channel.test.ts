import { Channel, socketPath } from "../src/channel.ts";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { createConnection, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

let directory: string;

beforeEach(() => {
  directory = realpathSync(mkdtempSync(join(tmpdir(), "channel-")));
});

afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

describe("socketPath", () => {
  it("names the socket after the process", () => {
    expect(socketPath(1234)).toBe(join(tmpdir(), "hunk-verdict", "1234.sock"));
  });
});

interface Listener {
  socket: Socket;
  lines: string[];
}

describe("Channel", () => {
  let channel: Channel;

  /** Connect a listener that records every line it receives. */
  async function connectListener(): Promise<Listener> {
    const socket = createConnection(channel.path);
    const lines: string[] = [];
    socket.on("data", (data) => lines.push(data.toString()));
    await new Promise((connected) => socket.once("connect", connected));
    await Bun.sleep(20);
    return { socket, lines };
  }

  beforeEach(() => {
    channel = new Channel(join(directory, "sockets", "review.sock"));
    channel.open();
  });

  afterEach(() => {
    channel.close();
  });

  describe("#broadcast", () => {
    describe("when nothing is listening", () => {
      it("returns zero", () => {
        expect(channel.broadcast("approve")).toBe(0);
      });
    });

    describe("when a listener is connected", () => {
      let listener: Socket;
      let received: Promise<string>;

      beforeEach(async () => {
        listener = createConnection(channel.path);
        await new Promise((connected) => listener.once("connect", connected));
        await Bun.sleep(20);
        received = new Promise((resolve) =>
          listener.once("data", (data) => resolve(data.toString())),
        );
      });

      afterEach(() => {
        listener.destroy();
      });

      it("returns how many were listening", () => {
        expect(channel.broadcast("approve")).toBe(1);
      });

      it("sends the line to the listener", async () => {
        channel.broadcast("deny");
        expect(await received).toBe("deny\n");
      });
    });

    describe("when a listener disconnects", () => {
      beforeEach(async () => {
        const listener = createConnection(channel.path);
        await new Promise((connected) => listener.once("connect", connected));
        listener.destroy();
        await Bun.sleep(20);
      });

      it("stops counting it", () => {
        expect(channel.broadcast("approve")).toBe(0);
      });
    });
  });

  describe("when a decision is made while nothing is listening", () => {
    let next: Listener;

    beforeEach(async () => {
      channel.broadcast("deny");
      channel.broadcast("approve");
      next = await connectListener();
    });

    afterEach(() => {
      next.socket.destroy();
    });

    it("sends the latest one to the next listener", () => {
      expect(next.lines.join("")).toBe("approve\n");
    });

    describe("when another listener connects afterward", () => {
      let later: Listener;

      beforeEach(async () => {
        later = await connectListener();
      });

      afterEach(() => {
        later.socket.destroy();
      });

      it("doesn't send it again", () => {
        expect(later.lines).toEqual([]);
      });
    });
  });

  describe("when a decision reaches a listener", () => {
    let later: Listener;

    beforeEach(async () => {
      const first = await connectListener();
      channel.broadcast("approve");
      first.socket.destroy();
      later = await connectListener();
    });

    afterEach(() => {
      later.socket.destroy();
    });

    it("isn't sent to later listeners", () => {
      expect(later.lines).toEqual([]);
    });
  });

  describe("when a listener breaks off mid-write", () => {
    beforeEach(async () => {
      const listener = createConnection(channel.path);
      await new Promise((connected) => listener.once("connect", connected));
      await Bun.sleep(20);
      listener.resetAndDestroy();
      channel.broadcast("approve");
      await Bun.sleep(50);
      channel.broadcast("approve");
      await Bun.sleep(50);
    });

    it("stops counting it", () => {
      expect(channel.broadcast("approve")).toBe(0);
    });
  });

  describe("when the socket can't be served", () => {
    let blocked: Channel;

    beforeEach(async () => {
      // Unix sockets can't be bound at paths this long.
      blocked = new Channel(join(directory, `${"x".repeat(200)}.sock`));
      blocked.open();
      await Bun.sleep(20);
    });

    it("reports nothing listening", () => {
      expect(blocked.broadcast("approve")).toBe(0);
    });
  });

  describe("#close", () => {
    let ended: Promise<unknown>;

    beforeEach(async () => {
      const listener = createConnection(channel.path);
      await new Promise((connected) => listener.once("connect", connected));
      await Bun.sleep(20);
      ended = new Promise((resolve) => listener.once("close", resolve));
      channel.close();
    });

    it("disconnects the listeners", async () => {
      expect(await ended).toBeDefined();
    });

    it("removes the socket", () => {
      expect(existsSync(channel.path)).toBe(false);
    });
  });
});
