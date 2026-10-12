import { Channel, socketPath } from "../src/channel.ts";
import {
  type HunkSession,
  listen,
  listHunkSessions,
  repositoryRoot,
} from "../src/listen.ts";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { ExtensionCliCommandContext } from "hunkdiff/extension";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PROCESS_ID = 900_001;
const OTHER_PROCESS_ID = 900_002;

let directory: string;
let channel: Channel;
let controller: AbortController;
let sessions: HunkSession[];
let stdout: string;
let stderr: string;

function session(overrides: Partial<HunkSession> = {}): HunkSession {
  return {
    sessionId: "session-1",
    pid: PROCESS_ID,
    repoRoot: directory,
    ...overrides,
  };
}

function run(...parameters: string[]) {
  return listen(
    parameters,
    {
      cwd: directory,
      signal: controller.signal,
      stdout: {
        write: async (text: string | Uint8Array) => {
          stdout += text;
        },
      },
      stderr: {
        write: async (text: string | Uint8Array) => {
          stderr += text;
        },
      },
    } as unknown as ExtensionCliCommandContext,
    () => sessions,
  );
}

/** Give the listener time to connect to the channel. */
function connected() {
  return Bun.sleep(50);
}

beforeEach(() => {
  directory = realpathSync(mkdtempSync(join(tmpdir(), "listen-")));
  Bun.spawnSync(["git", "init", "--quiet", directory]);
  channel = new Channel(socketPath(PROCESS_ID));
  controller = new AbortController();
  sessions = [];
  stdout = "";
  stderr = "";
});

afterEach(() => {
  controller.abort();
  channel.close();
  rmSync(directory, { recursive: true, force: true });
});

describe("listHunkSessions", () => {
  describe("when Hunk is installed", () => {
    it("returns a list", () => {
      expect(Array.isArray(listHunkSessions())).toBe(true);
    });
  });

  describe("when Hunk can't be found", () => {
    let path: string | undefined;

    beforeEach(() => {
      path = process.env["PATH"];
      process.env["PATH"] = "";
    });

    afterEach(() => {
      process.env["PATH"] = path;
    });

    it("returns no reviews", () => {
      expect(listHunkSessions()).toEqual([]);
    });
  });
});

describe("repositoryRoot", () => {
  describe("when the directory is inside a repository", () => {
    beforeEach(() => {
      mkdirSync(join(directory, "nested"));
    });

    it("returns the repository's root", () => {
      expect(repositoryRoot(join(directory, "nested"))).toBe(directory);
    });
  });

  describe("when the directory is outside a repository", () => {
    let outside: string;

    beforeEach(() => {
      outside = realpathSync(mkdtempSync(join(tmpdir(), "outside-")));
    });

    afterEach(() => {
      rmSync(outside, { recursive: true, force: true });
    });

    it("returns the directory itself", () => {
      expect(repositoryRoot(outside)).toBe(outside);
    });
  });
});

describe("listen", () => {
  describe("when asked for help", () => {
    it("prints the usage", async () => {
      await run("--help");
      expect(stdout).toContain("Usage: hunk verdict listen");
    });

    it("exits successfully", async () => {
      expect(await run("listen", "--help")).toBe(0);
    });
  });

  describe("when the command is missing", () => {
    it("exits with an error", async () => {
      expect(await run()).toBe(1);
    });
  });

  describe("when the command is unknown", () => {
    it("names the command", async () => {
      await run("watch");
      expect(stderr).toContain("The command watch is invalid");
    });
  });

  describe("when an option is unknown", () => {
    it("names the option", async () => {
      await run("listen", "--loud");
      expect(stderr).toContain("The option --loud is invalid");
    });
  });

  describe("when an option has no value", () => {
    it("exits with an error", async () => {
      expect(await run("listen", "--session")).toBe(1);
    });
  });

  describe("when the repository's review is open", () => {
    let exitCode: Promise<number>;

    beforeEach(async () => {
      sessions = [session()];
      channel.open();
      exitCode = run("listen");
      await connected();
    });

    it("prints each decision, then review-closed when the review closes", async () => {
      channel.broadcast("deny");
      channel.broadcast("approve");
      await Bun.sleep(20);
      channel.close();
      await exitCode;
      expect(stdout).toBe("deny\napprove\nreview-closed\n");
    });

    it("exits successfully when the review closes", async () => {
      channel.close();
      expect(await exitCode).toBe(0);
    });
  });

  describe("when the review opens later", () => {
    let exitCode: Promise<number>;

    beforeEach(async () => {
      exitCode = run("listen");
      await Bun.sleep(100);
      sessions = [session()];
      channel.open();

      // The listener looks again every half second until the review opens.
      await Bun.sleep(700);
    });

    it("waits for it", async () => {
      channel.close();
      await exitCode;
      expect(stdout).toBe("review-closed\n");
    });
  });

  describe("when the review is open but not serving decisions yet", () => {
    let exitCode: Promise<number>;

    beforeEach(async () => {
      sessions = [session()];
      exitCode = run("listen");
      await Bun.sleep(100);
      channel.open();
      await Bun.sleep(700);
    });

    it("waits for it", async () => {
      channel.close();
      expect(await exitCode).toBe(0);
    });
  });

  describe("when --repo names another directory", () => {
    let elsewhere: string;
    let exitCode: Promise<number>;

    beforeEach(async () => {
      elsewhere = realpathSync(
        mkdtempSync(join(tmpdir(), "listen-elsewhere-")),
      );
      sessions = [session({ repoRoot: elsewhere })];
      channel.open();
      exitCode = run("listen", "--repo", elsewhere);
      await connected();
    });

    afterEach(() => {
      rmSync(elsewhere, { recursive: true, force: true });
    });

    it("listens to that repository's review", async () => {
      channel.broadcast("approve");
      await Bun.sleep(20);
      channel.close();
      await exitCode;
      expect(stdout).toBe("approve\nreview-closed\n");
    });
  });

  describe("when several reviews are open in the repository", () => {
    beforeEach(() => {
      sessions = [
        session(),
        session({ sessionId: "session-2", pid: OTHER_PROCESS_ID }),
      ];
    });

    it("exits with an error", async () => {
      expect(await run("listen")).toBe(1);
    });

    it("lists the sessions to choose from", async () => {
      await run("listen");
      expect(stderr).toContain("session-1\n  session-2");
    });
  });

  describe("when --session picks one of several reviews", () => {
    let exitCode: Promise<number>;

    beforeEach(async () => {
      sessions = [
        session({ sessionId: "session-2", pid: OTHER_PROCESS_ID }),
        session(),
      ];
      channel.open();
      exitCode = run("listen", "--session", "session-1");
      await connected();
    });

    it("listens to that review", async () => {
      channel.broadcast("deny");
      await Bun.sleep(20);
      channel.close();
      await exitCode;
      expect(stdout).toBe("deny\nreview-closed\n");
    });
  });

  describe("when stopped before a review opens", () => {
    let exitCode: Promise<number>;

    beforeEach(async () => {
      exitCode = run("listen");
      await Bun.sleep(50);
      controller.abort();
    });

    it("exits with an error", async () => {
      expect(await exitCode).toBe(1);
    });
  });

  describe("when stopped while listening", () => {
    let exitCode: Promise<number>;

    beforeEach(async () => {
      sessions = [session()];
      channel.open();
      exitCode = run("listen");
      await connected();
      controller.abort();
    });

    it("exits", async () => {
      expect(await exitCode).toBe(0);
    });
  });
});
