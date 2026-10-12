**REQUIRED:** Read `README.md` before doing anything else. It documents the project's purpose, setup, and commands.

**REQUIRED:** Invoke the `ls-agent:vibe` skill and follow its instructions. At the start of every session, ask the user to run `/ls-interactivity:disable-review`.

## Working With the User

- Don't stop to ask questions you can answer yourself. Make the judgment call, build it, and hand the user something to try.

## Architecture

This is a folder extension for [Hunk](https://hunk.dev/): `package.json` lists `src/index.ts` as its entry, and Hunk loads it at startup with its own React and OpenTUI.

- `src/index.ts`: Registers everything with Hunk.
- `src/channel.ts`: The local socket each Hunk review serves decisions on, keyed by repository root.
- `src/listen.ts`: The `hunk review listen` CLI command.
- `src/modal.ts`: The approve/comment/deny modal.
- `skills/hunk-approve/`: The agent skill the README tells people to install.

The user rejected Hunk's own extension dialogs (`context.dialogs`) for this: they can't be styled, and they carry an attribution line. Hunk's extension API has no other overlays and clips panes to their rectangle, so the modal escapes that by taking a ref from a one-row helper pane, walking up to the renderer's root, and attaching its own absolutely positioned renderables there, built from the constructors of the renderables it can reach. None of that is public API, so check it first when a Hunk upgrade breaks the modal.

Closing the helper pane only takes effect once the keyboard mode has fully released and only from a fresh context, so the modal closes it through an event bus listener shortly after the mode exits.

## Commands

- `bun run test`: Run the tests. Fails below 100% coverage.
- `bun run check-types`: Type-check.
- `hunk --extension . diff`: Try the extension from this checkout without installing it.
