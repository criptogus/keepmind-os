import { afterEach, describe, expect, test } from "bun:test";
import { setupDom } from "@keepmind/ui/testing/dom";

setupDom();

import type { Goal } from "@keepmind/client";
import { act, cleanup, fireEvent, within } from "@testing-library/react";
import { ADA_ID, ATLAS_ID, createFakeApi, ORG_ID, seedState } from "./fake-api";
import { renderApp, screen, settle } from "./render";

afterEach(() => cleanup());

const click = (el: Element) => act(async () => fireEvent.click(el));

const goal = (over: Partial<Goal>): Goal => ({
  id: crypto.randomUUID(),
  orgId: ORG_ID,
  title: "Meta",
  metric: "",
  target: null,
  current: 0,
  unit: "",
  period: "monthly",
  ownerAgentId: null,
  status: "active",
  progressNote: "",
  createdByUserId: null,
  createdByAgentId: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  owner: null,
  ...over,
});

const open = async (state = seedState()) => {
  const api = createFakeApi(state);
  await renderApp(`/org/${ORG_ID}/goals`, { api });
  await settle(8);
  return api;
};

describe("Goals: the OKR page", () => {
  test("empty: the page says what a goal is for and offers New goal", async () => {
    await open();
    expect(screen().getByRole("heading", { name: "Metas" })).toBeTruthy();
    expect(screen().getByText("Nenhuma meta ainda")).toBeTruthy();
    expect(screen().getAllByRole("button", { name: "Nova meta" }).length).toBeGreaterThan(0);
  });

  test("a seeded list groups by status, shows progress and the owner", async () => {
    const state = seedState({
      goals: [
        goal({
          title: "100 leads qualificados",
          target: 100,
          current: 37,
          unit: "leads",
          ownerAgentId: ADA_ID,
          owner: { id: ADA_ID, handle: "ada", name: "Ada" },
          progressNote: "Campanha de indicação no ar.",
        }),
        goal({
          title: "Time de marketing montado",
          status: "proposed",
          ownerAgentId: ATLAS_ID,
          owner: { id: ATLAS_ID, handle: "atlas", name: "Atlas" },
        }),
        // Worst case: a title and note that run long, and numbers with many digits.
        goal({
          title:
            "Aumentar a taxa de conversão do funil de captação de clientes enterprise em pelo menos trinta por cento até o fim do trimestre fiscal",
          target: 123456789,
          current: 98765432,
          unit: "micro-conversões qualificadas por canal orgânico",
          status: "paused",
          progressNote:
            "Nota de progresso deliberadamente longa para verificar que o cartão quebra a linha em vez de vazar ou sobrepor os botões de ação em telas estreitas.",
        }),
      ],
    });
    await open(state);
    expect(screen().getByText("100 leads qualificados")).toBeTruthy();
    expect(screen().getByText(/37 de 100 leads/)).toBeTruthy();
    expect(screen().getByText(/@ada/)).toBeTruthy();
    expect(screen().getByText("Campanha de indicação no ar.")).toBeTruthy();
    // Groups: the proposal waits under "Propostas", the paused one under "Pausadas".
    expect(screen().getByText("Propostas")).toBeTruthy();
    expect(screen().getByText("Pausadas")).toBeTruthy();
    // The progress bar exposes its value.
    const bar = screen().getByRole("progressbar", { name: "100 leads qualificados" });
    expect(bar.getAttribute("aria-valuenow")).toBe("37");
    // A goal with no target shows no bar.
    expect(screen().queryByRole("progressbar", { name: "Time de marketing montado" })).toBeNull();
  });

  test("a person creates a goal from the dialog and it joins the list", async () => {
    const state = seedState();
    const api = await open(state);
    await click(screen().getAllByRole("button", { name: "Nova meta" })[0] as Element);
    await settle(2);
    const dialog = screen().getByRole("dialog");
    const field = (label: string) => within(dialog).getByLabelText(label);
    fireEvent.change(field("Meta"), { target: { value: "200 vendas no trimestre" } });
    fireEvent.change(field("Meta numérica"), { target: { value: "200" } });
    fireEvent.change(field("Unidade"), { target: { value: "vendas" } });
    await click(within(dialog).getByRole("button", { name: "Criar meta" }));
    await settle(6);
    expect(screen().getByText("200 vendas no trimestre")).toBeTruthy();
    expect(state.goals?.some((g) => g.title === "200 vendas no trimestre" && g.status === "active")).toBe(true);
    void api;
  });

  test("a proposed goal waits for Activate; activating moves it to Ativas", async () => {
    const proposed = goal({
      title: "Proposta da Maya",
      status: "proposed",
      ownerAgentId: ADA_ID,
      owner: { id: ADA_ID, handle: "ada", name: "Ada" },
    });
    const state = seedState({ goals: [proposed] });
    await open(state);
    expect(screen().getByText("Propostas")).toBeTruthy();
    const card = screen().getByText("Proposta da Maya").closest(".goal-card") as HTMLElement;
    await click(within(card).getByRole("button", { name: "Ativar" }));
    await settle(6);
    expect(state.goals?.[0]?.status).toBe("active");
    expect(screen().getByText("Proposta da Maya")).toBeTruthy();
  });

  test("an agent's proposal is read-only for a member without assign_work", async () => {
    // A member whose resolved permissions are read-only: no New goal, no status actions.
    const state = seedState({
      goals: [goal({ title: "Meta do time", status: "active" })],
    });
    const reader = {
      ...state,
      me: {
        user: { id: "u-joao", name: "João", email: "joao@acme.com.br", image: null },
        organizations: [
          { id: ORG_ID, name: "Acme", role: "member" as const, showActivity: true, permissions: ["read"] },
        ],
      },
    };
    await open(reader);
    expect(screen().getByText("Meta do time")).toBeTruthy();
    expect(screen().queryByRole("button", { name: "Nova meta" })).toBeNull();
    expect(screen().queryByRole("button", { name: "Pausar" })).toBeNull();
  });
});
