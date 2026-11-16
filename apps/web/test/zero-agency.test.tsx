import { afterEach, expect, test } from "bun:test";
import { setupDom } from "@keepmind/ui/testing/dom";

setupDom();

import { act, cleanup, fireEvent } from "@testing-library/react";
import { BRAIN_SCHEMA, zeroGoal } from "@/lib/zero-agency";
import { createFakeApi, ORG_ID, seedState, withRightHand } from "./fake-api";
import { renderApp, screen, settle } from "./render";

afterEach(cleanup);
test("Second Brain offers a downloadable schema without AI, and blocks delegation until ready", async () => {
  const state = seedState({ aiStatus: { agents: [] } as never });
  await renderApp(`/org/${ORG_ID}/ecosystem/second-brain`, { api: createFakeApi(state) });
  await settle(8);
  const link = screen().getByRole("link", { name: "Baixar schema" });
  const schema = JSON.parse(decodeURIComponent(link.getAttribute("href")!.split(",")[1]!));
  expect(schema.required).toContain("visibility");
  expect(schema.properties.visibility.enum).toEqual(["private", "team"]);
  expect((screen().getByRole("button", { name: "Preparar no GitHub" }) as HTMLButtonElement).disabled).toBe(true);
});
test("Cybersec starts a real coordinator message without purchasing or scanning", async () => {
  const state = withRightHand(seedState());
  const api = createFakeApi(state);
  let sent = "";
  const original = api.chat.post;
  api.chat.post = async (...args) => {
    sent = JSON.stringify(args);
    return original(...args);
  };
  await renderApp(`/org/${ORG_ID}/ecosystem/cybersecurity`, { api });
  await settle(8);
  expect(screen().getByText(/Requer plano pago ativo/)).toBeTruthy();
  await act(async () => fireEvent.click(screen().getByRole("button", { name: "Preparar meu time" })));
  await settle(5);
  expect(sent).toContain("verify the account has an active paid plan");
  expect(sent).toContain("Never buy a plan");
});
test("brain schema and delegated plan preserve privacy and require read-back", () => {
  expect(BRAIN_SCHEMA.additionalProperties).toBe(false);
  const plan = zeroGoal("github-brain", "research");
  expect(plan).toContain("private repository");
  expect(plan).toContain("read back files");
  expect(plan).toContain("No automatic memory export");
});
