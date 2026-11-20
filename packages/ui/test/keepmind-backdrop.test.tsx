import { describe, expect, test } from "bun:test";
import { setupDom } from "../testing/dom";
import { canvasPage } from "../testing/frames";

setupDom();

import { act, render } from "@testing-library/react";
import { KeepMindBackdrop } from "../src/components/KeepMindBackdrop";

describe("KeepMind decorative motion", () => {
  test("runs only on screen, follows the latest visibility entry and stops when its page is hidden", async () => {
    const page = canvasPage({ width: 640, height: 160 });
    const previous = Object.getOwnPropertyDescriptor(document, "hidden");
    let hidden = false;
    Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
    const view = render(<KeepMindBackdrop tone="graphite" />);
    const stage = view.container.querySelector(".km-agent-backdrop");
    try {
      if (!stage) throw new Error("KeepMind backdrop did not render");
      expect(stage.hasAttribute("data-moving")).toBe(false);
      await act(async () => page.onScreen(true));
      expect(stage.hasAttribute("data-moving")).toBe(true);
      await act(async () => page.onScreen(true, false));
      expect(stage.hasAttribute("data-moving")).toBe(false);
      await act(async () => page.onScreen(true));
      await act(async () => {
        hidden = true;
        document.dispatchEvent(new Event("visibilitychange"));
      });
      expect(stage.hasAttribute("data-moving")).toBe(false);
      await act(async () => {
        hidden = false;
        document.dispatchEvent(new Event("visibilitychange"));
      });
      expect(stage.hasAttribute("data-moving")).toBe(true);
      await act(async () => view.rerender(<KeepMindBackdrop still />));
      expect(stage.hasAttribute("data-moving")).toBe(false);
      expect(stage.getAttribute("aria-hidden")).toBe("true");
    } finally {
      view.unmount();
      if (previous) Object.defineProperty(document, "hidden", previous);
      else Reflect.deleteProperty(document, "hidden");
      page.close();
    }
  });
});
