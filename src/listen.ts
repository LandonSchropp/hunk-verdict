import { socketPath } from "./channel.ts";
import type { ExtensionCliCommandContext } from "hunkdiff/extension";
import { execFileSync } from "node:child_process";
import { createConnection, type Socket } from "node:net";
import { resolve } from "node:path";
import { createInterface } from "node:readline";

const RETRY_DELAY = 500;

export const USAGE = "listen [--repo <path>] [--session <id>]";

const HELP = `Usage: hunk verdict ${USAGE}

Prints each decision made in a Hunk review, one line at a time: review-approved,
review-commented or review-denied. Prints review-closed when the review closes,
then exits. Waits for the review to open if it isn't open yet.

Options:

  --repo <path>    Listen to the review of this repository. Defaults to the
                   current directory.
  --session <id>   Listen to this review, when several are open in one
                   repository. Session IDs come from 'hunk session list'.
  --help           Show this help message and exit.
`;

/** One open Hunk review, as `hunk session list` reports it. */
export interface HunkSession {
  sessionId: string;
  pid: number;
  repoRoot: string;
}

/** The Hunk reviews open on this machine. */
export function listHunkSessions(): HunkSession[] {
  try {
    const output = execFileSync("hunk", ["session", "list", "--json"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });

    return JSON.parse(output).sessions;
  } catch {
    return [];
  }
}

/** The root of the repository a directory belongs to, or the directory itself outside one. */
export function repositoryRoot(directory: string): string {
  try {
    return execFileSync(
      "git",
      ["-C", directory, "rev-parse", "--show-toplevel"],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      },
    ).trim();
  } catch {
    return resolve(directory);
  }
}

/** Connect to a review's socket, or reject if the review isn't serving it yet. */
function connect(path: string): Promise<Socket> {
  return new Promise((resolveConnection, reject) => {
    const socket = createConnection(path);
    socket.once("connect", () => resolveConnection(socket));
    socket.once("error", reject);
  });
}

/**
 * Keep looking for the review until it opens and serves its socket. Resolves to the connected
 * socket, to an error message when the review can't be told apart from others, or to undefined if
 * aborted first.
 */
async function waitForReview(
  find: () => HunkSession[],
  describe: string,
  signal: AbortSignal,
): Promise<Socket | string | undefined> {
  while (!signal.aborted) {
    const reviews = find();

    if (reviews.length > 1) {
      const ids = reviews.map((review) => `  ${review.sessionId}`).join("\n");
      return `Error: Several reviews are open in ${describe}. Pass --session with one of:\n${ids}\n`;
    }

    if (reviews[0]) {
      try {
        return await connect(socketPath(reviews[0].pid));
      } catch {
        // The review is open but hasn't loaded its changes yet, so try again shortly.
      }
    }

    await new Promise((wake) => setTimeout(wake, RETRY_DELAY));
  }

  return undefined;
}

/** Run `hunk verdict <arguments>`, returning the exit code. */
export async function listen(
  parameters: readonly string[],
  context: ExtensionCliCommandContext,
  sessions: () => HunkSession[] = listHunkSessions,
) {
  const [command, ...options] = parameters;
  let directory = context.cwd;
  let sessionId: string | undefined;

  if (parameters.includes("--help")) {
    await context.stdout.write(HELP);
    return 0;
  }

  for (let index = 0; index < options.length; index++) {
    const option = options[index];
    const value = options[index + 1];

    if (option === "--repo" && value) {
      directory = resolve(context.cwd, value);
      index++;
    } else if (option === "--session" && value) {
      sessionId = value;
      index++;
    } else {
      await context.stderr.write(
        `Error: The option ${option} is invalid.\n\n${HELP}`,
      );
      return 1;
    }
  }

  if (command !== "listen") {
    await context.stderr.write(
      `Error: The command ${command ?? "(none)"} is invalid.\n\n${HELP}`,
    );
    return 1;
  }

  const root = repositoryRoot(directory);

  const result = await waitForReview(
    () =>
      sessions().filter((session) =>
        sessionId ? session.sessionId === sessionId : session.repoRoot === root,
      ),
    root,
    context.signal,
  );

  if (result === undefined) {
    return 1;
  }

  if (typeof result === "string") {
    await context.stderr.write(result);
    return 1;
  }

  context.signal.addEventListener("abort", () => result.destroy());

  for await (const line of createInterface({ input: result })) {
    await context.stdout.write(`${line}\n`);
  }

  await context.stdout.write("review-closed\n");
  return 0;
}
