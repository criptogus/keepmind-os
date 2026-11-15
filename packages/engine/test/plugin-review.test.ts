import { expect, test } from "bun:test";
import type { schema } from "@agenteschat/db";
import { reviewRecords } from "../src/plugins/review";

const record = (id: string, values: schema.PluginRecord["values"]): schema.PluginRecord => ({
  id,
  values,
  requestId: id,
  fingerprint: id,
  revision: 1,
  createdAt: "2026-01-01",
  updatedAt: "2026-01-01",
});
test("triage is deterministic, distinguishes invalid dates and never merges or invents commitments", () => {
  const records = [
    record("a", { nome: "A", email: "USER@example.com", proximo_contato: "2026-11-14", fonte: "msg:1" }),
    record("b", { nome: "B", email: "user@example.com", proximo_contato: "2026-02-30" }),
    record("c", { nome: "C", etapa: "Ganho", proximo_contato: "2020-01-01", fonte: "msg:2" }),
  ];
  const snapshot = JSON.stringify(records);
  const result = reviewRecords(records, new Date("2026-11-15T12:00:00Z"));
  expect(result.items[0]?.id).toBe("a");
  expect(result.items[0]?.possibleDuplicates).toEqual(["b"]);
  expect(result.items[1]?.reasons).toContain("invalid_next_contact");
  expect(result.items[1]?.nextContact).toBeNull();
  expect(result.items.some((i) => i.id === "c")).toBe(false);
  expect(JSON.stringify(records)).toBe(snapshot);
});
