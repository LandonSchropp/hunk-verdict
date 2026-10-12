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

describe("Channel", () => {
  let channel: Channel;

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
