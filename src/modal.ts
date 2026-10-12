import type {
  ExtensionPaneProps,
  ExtensionPaneTheme,
  HunkExtensionAPI,
} from "hunkdiff/extension";
import { createElement } from "react";

export type Decision = "approve" | "comment" | "deny";

/** The slice of an OpenTUI renderable the modal builds itself from. */
interface Renderable {
  parent: Renderable | null;
  ctx: unknown;
  add(child: Renderable): number;
  destroyRecursively(): void;
}

interface TextRenderable extends Renderable {
  fg: string;
  bg: string;
}

type RenderableConstructor<Built> = new (
  context: unknown,
  options: object,
) => Built;

const CLOSE_EVENT = "hunk-verdict:close";
const CLOSE_DELAY = 150;
const BUTTON_WIDTH = 11;
const DECISIONS: readonly Decision[] = ["approve", "comment", "deny"];
const SHORTCUTS: Record<string, Decision> = {
  a: "approve",
  c: "comment",
  d: "deny",
};
const NOTICES: Record<Decision, string> = {
  approve: "Approved the review",
  comment: "Sent the comments",
  deny: "Denied the review",
};

/** Pad a label on both sides to the button width. */
function centered(label: string) {
  const left = Math.floor((BUTTON_WIDTH - label.length) / 2);
  return `${" ".repeat(left)}${label}${" ".repeat(BUTTON_WIDTH - label.length - left)}`;
}

/**
 * Register the review modal. `decide` delivers a decision and returns how many listeners
 * heard it.
 */
export function registerModal(
  hunk: HunkExtensionAPI,
  decide: (decision: Decision) => number,
) {
  let selected: Decision = "comment";
  let overlay:
    | {
        backdrop: Renderable;
        buttons: Record<Decision, TextRenderable>;
        theme: ExtensionPaneTheme;
      }
    | undefined;

  const colors = (theme: ExtensionPaneTheme): Record<Decision, string> => ({
    approve: theme.badgeAdded,
    comment: theme.accent,
    deny: theme.badgeRemoved,
  });

  function paint() {
    if (!overlay) {
      return;
    }

    const { buttons, theme } = overlay;
    const palette = colors(theme);

    for (const decision of DECISIONS) {
      const color = palette[decision];
      buttons[decision].fg = decision === selected ? theme.background : color;
      buttons[decision].bg = decision === selected ? color : theme.panelAlt;
    }
  }

  function attach(anchor: Renderable, theme: ExtensionPaneTheme) {
    let root = anchor;

    while (root.parent) {
      root = root.parent;
    }

    const Box = anchor.parent!.constructor as RenderableConstructor<Renderable>;
    const Text = anchor.constructor as RenderableConstructor<TextRenderable>;
    const context = anchor.ctx;

    const backdrop = new Box(context, {
      position: "absolute",
      top: 0,
      left: 0,
      width: "100%",
      height: "100%",
      zIndex: 100,
      justifyContent: "center",
      alignItems: "center",
    });

    const modal = new Box(context, {
      border: true,
      borderColor: theme.accent,
      backgroundColor: theme.panel,
      flexDirection: "column",
      alignItems: "center",
      gap: 1,
      paddingTop: 1,
      paddingBottom: 1,
      paddingLeft: 8,
      paddingRight: 8,
    });

    const row = new Box(context, {
      flexDirection: "row",
      gap: 2,
      backgroundColor: theme.panel,
    });

    const buttons = {
      approve: new Text(context, { content: centered("Approve") }),
      comment: new Text(context, { content: centered("Comment") }),
      deny: new Text(context, { content: centered("Deny") }),
    };

    modal.add(
      new Text(context, {
        content: "Approve these changes?",
        fg: theme.text,
        bg: theme.panel,
      }),
    );
    DECISIONS.forEach((decision) => row.add(buttons[decision]));
    modal.add(row);
    backdrop.add(modal);
    root.add(backdrop);

    overlay = { backdrop, buttons, theme };
    paint();
  }

  function detach() {
    overlay?.backdrop.destroyRecursively();
    overlay = undefined;
  }

  // ponytail: fixed delay, retry until the pane reports closed if it proves flaky.
  // The overlay goes at once. Only the invisible helper pane waits for the delayed close.
  const close = () => {
    detach();
    setTimeout(() => hunk.events.emit(CLOSE_EVENT, {}), CLOSE_DELAY);
  };

  hunk.events.on(CLOSE_EVENT, (_payload, context) =>
    context.panes.close("modal"),
  );

  hunk.registerPane({
    id: "modal",
    title: "Review",
    placement: "bottom",
    height: { preferred: 1, min: 1, max: 1 },
    resizable: false,
    component: ({ theme }: ExtensionPaneProps) =>
      createElement("text", {
        content: "",
        ref: (anchor: Renderable | null) =>
          anchor ? attach(anchor, theme) : detach(),
      }),
  });

  hunk.registerKeyboardMode({
    id: "review",
    title:
      "Review — a approve · c comment · d deny · ←/→ select · enter choose",
    onKey: (key, context) => {
      const step = { left: -1, h: -1, right: 1, l: 1, tab: 1 }[key.name ?? ""];

      if (step) {
        const index = DECISIONS.indexOf(selected) + step + DECISIONS.length;
        selected = DECISIONS[index % DECISIONS.length]!;
        paint();
      }

      const shortcut = SHORTCUTS[key.name ?? ""];

      if (shortcut) {
        selected = shortcut;
      } else if (key.name !== "return" && key.name !== "enter") {
        return "handled";
      }

      if (decide(selected) === 0) {
        context.notify("Nothing is listening for this review", "warning");
      } else {
        context.notify(NOTICES[selected]);
      }

      close();
      return "exit";
    },
    onExit: close,
  });

  hunk.registerCommand(
    {
      id: "review",
      title: "Approve, comment on or deny the changes",
      key: "ctrl+r",
    },
    (context) => {
      selected = "comment";
      context.panes.open("modal");
      context.keyboardModes.enterMode("review");
    },
  );
}
