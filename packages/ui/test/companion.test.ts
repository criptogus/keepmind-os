import { expect, test } from "bun:test";
import { COMPANIONS, companionIndex } from "../src/agent/companion";

test("saved appearances resolve to the original KeepMind family without changing user data", () => {
  expect(COMPANIONS).toEqual(["Kivo", "Luma", "Nexo", "Faro"]);
  expect(companionIndex("graphite")).toBe(0);
  expect(companionIndex("teal")).toBe(0);
  expect(companionIndex("violet")).toBe(1);
  expect(companionIndex("amber")).toBe(2);
  expect(companionIndex("#123456")).toBe(3);
});
