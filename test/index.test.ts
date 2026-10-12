import { socketPath } from "../src/channel.ts";
import registerHunkVerdict from "../src/index.ts";
import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import type {
  ExtensionKeyboardMode,
  HunkExtensionAPI,
} from "hunkdiff/extension";
import { existsSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { createConnection, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

type Handler = (...parameters: any[]) => any;

let directory: string;
let events: Map<string, Handler>;
let cliCommands: Map<string, Handler>;
let mode: ExtensionKeyboardMode;
let notify: ReturnType<typeof mock>;

/** Decide in the modal with its shortcut key: a, c or d. */
function press(key: string) {
  mode.onKey({ name: key }, { notify } as never);
}

beforeEach(() => {
  directory = realpathSync(mkdtempSync(join(tmpdir(), "index-")));
  events = new Map();
  cliCommands = new Map();
  notify = mock();

  const hunk = {
    on: (event: string, handler: Handler) => events.set(event, handler),
    registerCommand: () => undefined,
    registerPane: () => undefined,
    registerKeyboardMode: (registered: ExtensionKeyboardMode) =>
      (mode = registered),
    registerCliCommand: (command: { name: string }, handler: Handler) =>
      cliCommands.set(command.name, handler),
    events: { on: () => undefined, emit: () => undefined },
  } as unknown as HunkExtensionAPI;

  registerHunkVerdict(hunk);
});

afterEach(() => {
  events.get("shutdown")!({});
  rmSync(directory, { recursive: true, force: true });
});

describe("registerHunkVerdict", () => {
  describe("when no review has loaded", () => {
    beforeEach(() => {
      press("a");
    });

    it("has nothing to deliver decisions to", () => {
      expect(notify).toHaveBeenCalledWith(
        "Nothing is listening for this review",
        "warning",
      );
    });
  });

  describe("when a review loads", () => {
    beforeEach(() => {
      events.get("changeset_loaded")!({}, { cwd: directory });
    });

    it("serves decisions for its repository", () => {
      expect(existsSync(socketPath(process.pid))).toBe(true);
    });

    describe("when a listener is connected", () => {
      let listener: Socket;
      let received: Promise<string>;

      beforeEach(async () => {
        listener = createConnection(socketPath(process.pid));
        await new Promise((connected) => listener.once("connect", connected));
        await Bun.sleep(20);
        received = new Promise((resolve) =>
          listener.once("data", (data) => resolve(data.toString())),
        );
      });

      afterEach(() => {
        listener.destroy();
      });

      it("delivers approvals to it", async () => {
        press("a");
        expect(await received).toBe("review-approved\n");
      });

      it("delivers comments to it", async () => {
        press("c");
        expect(await received).toBe("review-commented\n");
      });

      it("delivers denials to it", async () => {
        press("d");
        expect(await received).toBe("review-denied\n");
      });
    });
  });

  describe("when a second changeset loads", () => {
    let listener: Socket;
    let closed: boolean;

    beforeEach(async () => {
      events.get("changeset_loaded")!({}, { cwd: directory });
      listener = createConnection(socketPath(process.pid));
      await new Promise((connected) => listener.once("connect", connected));
      closed = false;
      listener.once("close", () => (closed = true));
      events.get("changeset_loaded")!({}, { cwd: directory });
      await Bun.sleep(20);
    });

    afterEach(() => {
      listener.destroy();
    });

    it("keeps the listeners it has", () => {
      expect(closed).toBe(false);
    });
  });

  describe("when Hunk shuts down", () => {
    beforeEach(() => {
      events.get("changeset_loaded")!({}, { cwd: directory });
      events.get("shutdown")!({});
    });

    it("stops serving decisions", () => {
      expect(existsSync(socketPath(process.pid))).toBe(false);
    });
  });

  describe("when hunk verdict runs", () => {
    let output: string;
    let result: unknown;

    beforeEach(async () => {
      output = "";

      result = await cliCommands.get("verdict")!(["--help"], {
        cwd: directory,
        signal: new AbortController().signal,
        stdout: {
          write: async (text: string) => {
            output += text;
          },
        },
        stderr: { write: async () => undefined },
      });
    });

    it("runs the listen command", () => {
      expect(output).toContain("Usage: hunk verdict listen");
    });

    it("exits with the listen command's code", () => {
      expect(result).toEqual({ kind: "exit", code: 0 });
    });
  });
});
