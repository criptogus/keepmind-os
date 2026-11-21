import { expect, test } from "bun:test";
import { readableResult } from "../src/lib/work";

test("a compact JSON answer gets its lines back for people, and nothing else changes", () => {
  expect(readableResult('{"a":1,"b":[1,2]}')).toBe('{\n  "a": 1,\n  "b": [\n    1,\n    2\n  ]\n}');
  // A number a double can't hold would come back changed: shown as it was.
  expect(readableResult('{"id":1234567890123456789012}')).toBe('{"id":1234567890123456789012}');
  expect(readableResult("3 files changed")).toBe("3 files changed");
  expect(readableResult('{\n  "a": 1\n}')).toBe('{\n  "a": 1\n}');
  expect(readableResult("{not json")).toBe("{not json");
});
