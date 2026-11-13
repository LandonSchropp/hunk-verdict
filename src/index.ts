import { Channel, socketPath } from "./channel.ts";
import { listen, USAGE } from "./listen.ts";
import { registerModal } from "./modal.ts";
import type { HunkExtensionAPI } from "hunkdiff/extension";

let channel: Channel | undefined;
let runs = 0;

export default function registerHunkVerdict(hunk: HunkExtensionAPI) {
  runs++;

  hunk.on("changeset_loaded", () => {
    if (!channel) {
      channel = new Channel(socketPath(process.pid));
      channel.open();
    }
  });

  hunk.on("shutdown", () => {
    if (--runs === 0) {
      channel?.close();
      channel = undefined;
    }
  });

  registerModal(
    hunk,
    (decision) =>
      channel?.broadcast(
        {
          approve: "review-approved",
          comment: "review-commented",
          deny: "review-denied",
        }[decision],
      ) ?? 0,
  );

  hunk.registerCliCommand(
    {
      name: "verdict",
      summary: "Listen for decisions made in a Hunk review",
      usage: USAGE,
    },
    async (parameters, context) => ({
      kind: "exit",
      code: await listen(parameters, context),
    }),
  );
}
