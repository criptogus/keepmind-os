import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { setupDom } from "@keepmind/ui/testing/dom";

setupDom();

import { cleanup } from "@testing-library/react";
import { createFakeApi, seedState } from "./fake-api";
import { renderApp, screen } from "./render";

afterEach(() => {
  cleanup();
  localStorage.clear();
});

const OWN = { termsUrl: "https://example.com/terms", privacyUrl: "https://example.com/privacy" };
/** A server that isn't KeepMind OS's, with these legal links of its own. */
const ownServer = (authConfig: Partial<typeof OWN> = {}) =>
  createFakeApi(seedState({ me: null, instance: { cloud: false, url: "https://chat.example.com" }, authConfig }));
/** KeepMind OS Cloud, with the legal links its servers set by default: on another address than this browser's. */
const cloud = () =>
  createFakeApi(
    seedState({
      me: null,
      authConfig: { termsUrl: "https://keepmind.io/terms", privacyUrl: "https://keepmind.io/privacy" },
    }),
  );

describe("the Terms and the Privacy Policy", () => {
  test("Cloud also uses operator policies instead of upstream legal documents", async () => {
    const replace = spyOn(window.location, "replace").mockImplementation(() => {});
    try {
      for (const kind of ["terms", "privacy"] as const) {
        await renderApp(`/${kind}`, { api: cloud() });
        expect(replace.mock.calls.at(-1)?.[0]).toBe(`https://keepmind.io/${kind}`);
        expect(screen().queryByRole("heading", { level: 1 })).toBeNull();
        cleanup();
      }
    } finally {
      replace.mockRestore();
    }
  });

  test("any other server sends each to its own page, and shows none of the Cloud's", async () => {
    const replace = spyOn(window.location, "replace").mockImplementation(() => {});
    try {
      await renderApp("/terms", { api: ownServer(OWN) });
      expect(replace.mock.calls.map(([url]) => String(url))).toEqual([OWN.termsUrl]);
      expect(screen().queryByRole("heading", { level: 1 })).toBeNull();
      cleanup();
      await renderApp("/privacidade", { api: ownServer(OWN) });
      expect(replace.mock.calls.map(([url]) => String(url))).toEqual([OWN.termsUrl, OWN.privacyUrl]);
      expect(screen().queryByRole("heading", { level: 1 })).toBeNull();
    } finally {
      replace.mockRestore();
    }
  });

  test("without a page of its own it says so, and where to ask", async () => {
    const replace = spyOn(window.location, "replace").mockImplementation(() => {});
    try {
      await renderApp("/terms", { api: ownServer({ privacyUrl: OWN.privacyUrl }) });
      expect(screen().getByRole("heading", { level: 1 }).textContent).toBe("Este servidor não tem página de termos");
      expect(screen().getByText("Precisa de ajuda? Fale com quem cuida deste servidor.")).toBeTruthy();
      cleanup();
      await renderApp("/privacy", { api: ownServer({ termsUrl: OWN.termsUrl }) });
      expect(screen().getByRole("heading", { level: 1 }).textContent).toBe(
        "Este servidor não tem página de privacidade",
      );
      cleanup();
      // An address of this same server would only come back here.
      await renderApp("/terms", { api: ownServer({ termsUrl: "http://localhost:3000/terms" }) });
      expect(screen().getByRole("heading", { level: 1 }).textContent).toBe("Este servidor não tem página de termos");
      expect(replace).not.toHaveBeenCalled();
    } finally {
      replace.mockRestore();
    }
  });
});
