import { afterEach, expect, test } from "bun:test";
import { join } from "node:path";
import { setupDom } from "@keepmind/ui/testing";

setupDom();

import { cleanup, fireEvent, render } from "@testing-library/react";
import { Cover } from "../src/components/browser/Cover";
import { declarations, topLevel } from "./built-css";

afterEach(() => cleanup());

test("the computer's KeepMind background preserves loading status and recovery actions in either theme", () => {
  const theme = document.documentElement.dataset.theme;
  try {
    for (const value of ["light", "dark"]) {
      document.documentElement.dataset.theme = value;
      let retried = 0;
      const view = render(
        <Cover
          sky
          color="sky"
          text="Opening your computer"
          help="Waiting for the connection"
          action={
            <button type="button" onClick={() => retried++}>
              Try again
            </button>
          }
        />,
      );
      expect(view.getByRole("status").textContent).toContain("Opening your computer");
      expect(view.getByRole("status").textContent).toContain("Waiting for the connection");
      fireEvent.click(view.getByRole("button", { name: "Try again" }));
      expect(retried).toBe(1);
      expect(view.container.querySelector(".cmp-sky")?.getAttribute("aria-hidden")).toBe("true");
      expect(view.container.querySelector(".km-agent-backdrop")?.getAttribute("data-tone")).toBe("surface");
      expect(view.container.querySelector(".cmp-sky canvas")).toBeNull();
      view.unmount();
    }
  } finally {
    if (theme === undefined) delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = theme;
  }
});

test("the decorative surface follows the window theme, uses lime linework, and cannot intercept clicks", async () => {
  const css = topLevel(await Bun.file(join(import.meta.dir, "../../../packages/ui/src/styles/backdrop.css")).text());
  const value = (selector: string, property: string) =>
    declarations(css, selector).findLast(([p]) => p === property)?.[1];
  expect(value(".km-agent-backdrop", "background")).toBe("transparent");
  expect(value(".km-agent-backdrop", "pointer-events")).toBe("none");
  expect(value(".km-agent-backdrop__fold", "fill")).toContain("var(--raised-2)");
  expect(value(".km-agent-backdrop__accent", "stroke")).toBe("var(--km-backdrop-accent, #c4ff3d)");
});
