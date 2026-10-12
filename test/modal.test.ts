import { registerModal } from "../src/modal.ts";
import { beforeEach, describe, expect, it, mock } from "bun:test";
import type {
  ExtensionCommandContext,
  ExtensionKeyboardMode,
  ExtensionKeyboardModeContext,
  ExtensionPane,
  ExtensionPaneProps,
  HunkExtensionAPI,
} from "hunkdiff/extension";
import type { ReactElement } from "react";

type Handler = (...parameters: any[]) => unknown;

const theme = {
  background: "black",
  panel: "gray",
  panelAlt: "charcoal",
  accent: "blue",
  text: "white",
  badgeAdded: "green",
  badgeRemoved: "red",
};

/** Stands in for OpenTUI's renderables, recording what the modal builds. */
class FakeBox {
  children: FakeBox[] = [];
  parent: FakeBox | null = null;
  [option: string]: any;

  constructor(
    public ctx: unknown,
    options: object,
  ) {
    Object.assign(this, options);
  }

  add(child: FakeBox) {
    child.parent = this;
    this.children.push(child);
    return this.children.length - 1;
  }

  destroyRecursively() {
    this.parent!.children = this.parent!.children.filter(
      (child) => child !== this,
    );
  }
}

class FakeText extends FakeBox {}

/** Every renderable under a node, depth first. */
function descendants(node: FakeBox): FakeBox[] {
  return node.children.flatMap((child) => [child, ...descendants(child)]);
}

/** Register the modal against a stand-in for Hunk, keeping what it registers. */
function registerWithFakeHunk(listeners: number) {
  const commands = new Map<string, Handler>();
  const events = new Map<string, Handler>();
  const panes: ExtensionPane[] = [];
  const modes: ExtensionKeyboardMode[] = [];
  const notify = mock();
  const decide = mock().mockReturnValue(listeners);
  const paneControls = { open: mock(), close: mock() };
  const keyboardModes = { enterMode: mock() };

  const hunk = {
    registerCommand: (command: { id: string }, handler: Handler) =>
      commands.set(command.id, handler),
    registerPane: (pane: ExtensionPane) => panes.push(pane),
    registerKeyboardMode: (mode: ExtensionKeyboardMode) => modes.push(mode),
    events: {
      on: (event: string, handler: Handler) => events.set(event, handler),
      emit: (event: string, payload: unknown) =>
        events.get(event)?.(payload, { notify, panes: paneControls }),
    },
  } as unknown as HunkExtensionAPI;

  registerModal(hunk, decide);

  const root = new FakeBox("context", {});
  const host = new FakeBox("context", {});
  root.add(host);

  const modeContext = { notify } as unknown as ExtensionKeyboardModeContext;

  const ref = () => {
    const element = panes[0]!.component({
      theme,
    } as unknown as ExtensionPaneProps) as ReactElement<{
      ref: (node: unknown) => void;
    }>;

    return element.props.ref;
  };

  return {
    notify,
    decide,
    paneControls,
    keyboardModes,
    root,
    modes,

    /** Press the verdict key, then mount the helper pane it opens. */
    open: () => {
      commands.get("open")!({
        panes: paneControls,
        keyboardModes,
      } as unknown as ExtensionCommandContext);

      const anchor = new FakeText("context", {});
      host.add(anchor);
      ref()(anchor);
    },

    /** Unmount the helper pane. */
    unmount: () => ref()(null),

    press: (name?: string) => modes[0]!.onKey({ name }, modeContext),
    exit: () => modes[0]!.onExit?.(modeContext),

    text: (label: string) =>
      descendants(root).find(
        (node) =>
          node instanceof FakeText && String(node["content"]).includes(label),
      ),
  };
}

describe("registerModal", () => {
  let hunk: ReturnType<typeof registerWithFakeHunk>;

  beforeEach(() => {
    hunk = registerWithFakeHunk(1);
  });

  it("labels the status bar Verdict", () => {
    expect(hunk.modes[0]!.title).toStartWith("Verdict — ");
  });

  describe("when the reviewer opens the modal", () => {
    beforeEach(() => {
      hunk.open();
    });

    it("opens the helper pane", () => {
      expect(hunk.paneControls.open).toHaveBeenCalledWith("modal");
    });

    it("takes over the keyboard", () => {
      expect(hunk.keyboardModes.enterMode).toHaveBeenCalledWith("verdict");
    });

    it("attaches a centered overlay to the root", () => {
      expect(hunk.root.children.at(-1)).toMatchObject({
        position: "absolute",
        width: "100%",
        height: "100%",
        justifyContent: "center",
        alignItems: "center",
      });
    });

    it("asks whether to approve", () => {
      expect(hunk.text("Approve these changes?")).toBeDefined();
    });

    it("selects Comment", () => {
      expect(hunk.text("Comment")!["bg"]).toBe(theme.accent);
    });

    it("puts Comment between Approve and Deny", () => {
      const labels = descendants(hunk.root)
        .map((node) => String(node["content"]).trim())
        .filter((label) => ["Approve", "Comment", "Deny"].includes(label));

      expect(labels).toEqual(["Approve", "Comment", "Deny"]);
    });

    it("renders every button at the same width", () => {
      const widths = ["  Approve", "Comment", "Deny"].map(
        (label) => hunk.text(label)!["content"].length,
      );

      expect(new Set(widths).size).toBe(1);
    });
  });

  describe("when the helper pane closes", () => {
    beforeEach(() => {
      hunk.open();
      hunk.unmount();
    });

    it("removes the overlay", () => {
      expect(hunk.root.children).toHaveLength(1);
    });
  });

  describe("when the helper pane closes before it opened", () => {
    it("does nothing", () => {
      expect(() => hunk.unmount()).not.toThrow();
    });
  });

  describe("when the reviewer moves the selection", () => {
    beforeEach(() => {
      hunk.open();
      hunk.press("right");
    });

    it("highlights Deny", () => {
      expect(hunk.text("Deny")!["bg"]).toBe(theme.badgeRemoved);
    });

    it("dims Comment", () => {
      expect(hunk.text("Comment")!["bg"]).toBe(theme.panelAlt);
    });
  });

  describe("when the reviewer moves the selection past the end", () => {
    beforeEach(() => {
      hunk.open();
      hunk.press("right");
      hunk.press("right");
    });

    it("wraps around to Approve", () => {
      expect(hunk.text("  Approve")!["bg"]).toBe(theme.badgeAdded);
    });
  });

  describe("when the reviewer moves the selection past the start", () => {
    beforeEach(() => {
      hunk.open();
      hunk.press("left");
      hunk.press("left");
    });

    it("wraps around to Deny", () => {
      expect(hunk.text("Deny")!["bg"]).toBe(theme.badgeRemoved);
    });
  });

  describe("when the reviewer presses h", () => {
    beforeEach(() => {
      hunk.open();
      hunk.press("h");
    });

    it("highlights Approve", () => {
      expect(hunk.text("  Approve")!["bg"]).toBe(theme.badgeAdded);
    });
  });

  describe("when the selection moves with no modal on screen", () => {
    it("does nothing", () => {
      expect(hunk.press("left")).toBe("handled");
    });
  });

  describe("when the reviewer presses a key the modal doesn't use", () => {
    beforeEach(() => {
      hunk.open();
    });

    it("keeps the key from reaching the review", () => {
      expect(hunk.press()).toBe("handled");
    });
  });

  describe("when the reviewer chooses Approve", () => {
    let result: unknown;

    beforeEach(() => {
      hunk.open();
      hunk.press("left");
      result = hunk.press("return");
    });

    it("delivers the approval", () => {
      expect(hunk.decide).toHaveBeenCalledWith("approve");
    });

    it("confirms the approval", () => {
      expect(hunk.notify).toHaveBeenCalledWith("Approved the review");
    });

    it("gives the keyboard back", () => {
      expect(result).toBe("exit");
    });

    it("removes the overlay right away", () => {
      expect(hunk.root.children).toHaveLength(1);
    });
  });

  describe("when the reviewer chooses Comment", () => {
    beforeEach(() => {
      hunk.open();
      hunk.press("enter");
    });

    it("delivers the comments", () => {
      expect(hunk.decide).toHaveBeenCalledWith("comment");
    });

    it("confirms the comments", () => {
      expect(hunk.notify).toHaveBeenCalledWith("Sent the comments");
    });
  });

  describe("when the reviewer chooses Deny", () => {
    beforeEach(() => {
      hunk.open();
      hunk.press("right");
      hunk.press("enter");
    });

    it("delivers the denial", () => {
      expect(hunk.decide).toHaveBeenCalledWith("deny");
    });

    it("confirms the denial", () => {
      expect(hunk.notify).toHaveBeenCalledWith("Denied the review");
    });
  });

  describe("when the reviewer presses a", () => {
    let result: unknown;

    beforeEach(() => {
      hunk.open();
      result = hunk.press("a");
    });

    it("approves straight away", () => {
      expect(hunk.decide).toHaveBeenCalledWith("approve");
    });

    it("gives the keyboard back", () => {
      expect(result).toBe("exit");
    });
  });

  describe("when the reviewer presses c", () => {
    beforeEach(() => {
      hunk.open();
      hunk.press("right");
      hunk.press("c");
    });

    it("comments straight away", () => {
      expect(hunk.decide).toHaveBeenCalledWith("comment");
    });
  });

  describe("when the reviewer presses d", () => {
    beforeEach(() => {
      hunk.open();
      hunk.press("d");
    });

    it("denies straight away", () => {
      expect(hunk.decide).toHaveBeenCalledWith("deny");
    });
  });

  describe("when the reviewer chooses", () => {
    beforeEach(async () => {
      hunk.open();
      hunk.press("return");
      await Bun.sleep(250);
    });

    it("closes the helper pane", () => {
      expect(hunk.paneControls.close).toHaveBeenCalledWith("modal");
    });
  });

  describe("when the reviewer cancels", () => {
    beforeEach(async () => {
      hunk.open();
      hunk.exit();
      await Bun.sleep(250);
    });

    it("closes the helper pane", () => {
      expect(hunk.paneControls.close).toHaveBeenCalledWith("modal");
    });

    it("removes the overlay", () => {
      expect(hunk.root.children).toHaveLength(1);
    });

    it("delivers nothing", () => {
      expect(hunk.decide).not.toHaveBeenCalled();
    });
  });

  describe("when nothing is listening", () => {
    beforeEach(() => {
      hunk = registerWithFakeHunk(0);
      hunk.open();
      hunk.press("return");
    });

    it("warns the reviewer", () => {
      expect(hunk.notify).toHaveBeenCalledWith(
        "Nothing is listening for this review",
        "warning",
      );
    });
  });
});
