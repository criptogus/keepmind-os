import { afterEach, describe, expect, test } from "bun:test";
import { setupDom } from "@keepmind/ui/testing/dom";

setupDom();

import { cleanup, render } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { HelpLink } from "@/components/HelpLink";
import { createI18n } from "@/i18n";

afterEach(cleanup);

describe("links read as ours, never the browser's blue", () => {
  test("a link to a help page is a help line's link, to a new tab with no referrer, carrying only the language and the section", () => {
    for (const [lng, folder] of [
      ["en", ""],
      ["pt-BR", "pt/"],
    ] as const) {
      render(
        <I18nextProvider i18n={createI18n(lng)}>
          <HelpLink slug="computers" section="folders">
            How computers work
          </HelpLink>
        </I18nextProvider>,
      );
      const a = document.querySelector("a");
      expect(a?.className).toBe("ac-link ac-link--muted");
      expect(a?.getAttribute("target")).toBe("_blank");
      expect(a?.getAttribute("rel")).toBe("noopener noreferrer");
      expect(a?.getAttribute("href")).toBe(`https://keepmind.io/${folder}docs/computers#folders`);
      cleanup();
    }
  });
});
