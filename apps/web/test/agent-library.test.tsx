import { afterEach, expect, test } from "bun:test";
import { setupDom } from "@keepmind/ui/testing/dom";

setupDom();

import { presetLevels, RESTRICTED_ROLE_IDS } from "@keepmind/client/lib/new-agent";
import { en, ptBR } from "@keepmind/i18n";
import { act, cleanup, fireEvent } from "@testing-library/react";
import { CreateAgentButton, NewAgentProvider } from "@/components/new-agent/NewAgentDialog";
import { createFakeApi, seedState } from "./fake-api";
import { renderPage, screen, settle } from "./render";

afterEach(() => {
  cleanup();
  sessionStorage.clear();
});

async function open(personal = false) {
  const state = seedState();
  if (personal && state.me?.organizations[0]) state.me.organizations[0].mode = "personal";
  await renderPage(
    <NewAgentProvider>
      <CreateAgentButton />
    </NewAgentProvider>,
    { api: createFakeApi(state), org: true },
  );
  await act(async () => fireEvent.click(screen().getByRole("button", { name: "Criar agente" })));
  await settle(6);
  return state;
}

test("search finds an inspired profile, keeps edits when switching and saves the instructions", async () => {
  const state = await open();
  const search = screen().getByRole("searchbox");
  await act(async () => fireEvent.change(search, { target: { value: "Warren Buffett" } }));
  expect(screen().getAllByRole("option")).toHaveLength(2); // from scratch stays reachable
  const reachable = screen()
    .getAllByRole("option")
    .find((option) => option.tabIndex === 0);
  expect(reachable?.textContent).toContain("Do zero");
  if (!reachable) throw new Error("Filtered list must remain reachable by keyboard");
  await act(async () => fireEvent.keyDown(reachable, { key: "ArrowDown" }));
  expect(screen().getByRole("option", { name: /Valor/ }).getAttribute("aria-selected")).toBe("true");
  await act(async () => fireEvent.keyDown(search, { key: "Enter" }));
  expect(state.calls.some((c) => c.method === "agents.create")).toBe(false);
  await act(async () => fireEvent.click(screen().getByRole("option", { name: /Valor/ })));
  await settle();
  const name = screen().getByRole("textbox", { name: ptBR.newAgentCard.name });
  await act(async () => fireEvent.change(name, { target: { value: "Valor de teste" } }));
  await act(async () => fireEvent.click(screen().getByRole("option", { name: /Do zero/ })));
  await act(async () => fireEvent.click(screen().getByRole("option", { name: /Valor de teste/ })));
  expect((screen().getByRole("textbox", { name: ptBR.newAgentCard.name }) as HTMLInputElement).value).toBe(
    "Valor de teste",
  );
  await act(async () => fireEvent.click(screen().getByRole("button", { name: /Criar Valor de teste/ })));
  await settle(12);
  const payload = state.calls.find((c) => c.method === "agents.create")?.args[1] as {
    name: string;
    instructions: string;
  };
  expect(payload?.name).toBe("Valor de teste");
  expect(payload?.instructions).toContain("Não é Warren Buffett");
  expect(payload?.instructions).toContain("margem de segurança");
  const access = state.calls.find((c) => c.method === "access.set")?.args[2] as {
    all: boolean;
    connectors: Record<string, boolean>;
  };
  expect(access?.all).toBe(false);
  expect(access?.connectors).toEqual({});
});

test("personal workspaces keep personal starters and can find specialists; empty search has recovery", async () => {
  await open(true);
  expect(
    screen()
      .getAllByRole("option", { name: /Clara/ })
      .some((el) => el.getAttribute("data-pick") === "clara"),
  ).toBe(true);
  const search = screen().getByRole("searchbox");
  await act(async () => fireEvent.change(search, { target: { value: "financas" } }));
  expect(screen().getByRole("option", { name: /Otto/ })).toBeTruthy();
  await act(async () => fireEvent.change(search, { target: { value: "desenvolvimento" } }));
  expect(screen().getByRole("option", { name: /Ada/ })).toBeTruthy();
  await act(async () => fireEvent.change(search, { target: { value: "Cybersec" } }));
  expect(screen().getByRole("option", { name: /Sentinela/ })).toBeTruthy();
  await act(async () => fireEvent.change(search, { target: { value: "xxxxxxxxxxxx" } }));
  expect(screen().getByText(ptBR.newAgentCard.noTemplates)).toBeTruthy();
  expect(screen().getByRole("option", { name: /Do zero/ })).toBeTruthy();
});

test("specialist and inspired templates never inherit connected tool access implicitly", () => {
  const connections = [
    { id: "github-connected", def: { id: "github" } },
    { id: "private-mcp", def: null },
  ];
  for (const id of RESTRICTED_ROLE_IDS) {
    for (const personal of [true, false])
      expect(presetLevels(id, connections, personal)).toEqual({ "github-connected": "none", "private-mcp": "none" });
    for (const dict of [ptBR, en]) {
      const role = dict.newAgent.roles[id as keyof typeof dict.newAgent.roles];
      expect(role.instructions.length).toBeLessThan(16000);
      expect(role.instructions.length).toBeGreaterThan(500);
    }
  }
});
