import { describe, expect, test } from "bun:test";
import { compressToolOutput, minifyJsonOutput, smartCutToolOutput } from "../src/tools/output-filter";

describe("compressToolOutput", () => {
  test("strips ANSI escapes and resolves carriage-return redraws", () => {
    const raw = "\x1b[32mdownloading\x1b[0m 10%\rdownloading 90%\nplain \x1b[1mbold\x1b[0m";
    expect(compressToolOutput(raw)).toBe("downloading 90%\nplain bold");
  });

  test("drops spinner-only and bare progress lines, keeps content", () => {
    const raw = "start\n⠋ working\n⠙ working\n50%\n✓ done\nend";
    const out = compressToolOutput(raw);
    expect(out).toContain("start");
    expect(out).toContain("✓ done");
    expect(out).toContain("end");
    expect(out).not.toContain("⠋");
    expect(out).not.toContain("50%");
  });

  test("keeps numeric and dashed lines that are not progress", () => {
    const raw = "---\n100\n200";
    expect(compressToolOutput(raw)).toBe(raw);
  });

  test("collapses runs of identical lines", () => {
    const raw = `a\n${"same line\n".repeat(5)}b`;
    const out = compressToolOutput(raw);
    expect(out).toContain("same line\n[… ×4 more]");
    expect(out.startsWith("a\n")).toBe(true);
    expect(out.endsWith("b")).toBe(true);
  });

  test("leaves ordinary text untouched", () => {
    const raw = "line one\nline two\nline three";
    expect(compressToolOutput(raw)).toBe(raw);
  });
});

describe("smartCutToolOutput", () => {
  const log = (n: number) =>
    Array.from({ length: n }, (_, i) => `line ${i}`).join("\n") +
    "\nError: build failed at step 9\nTests: 3 failed, 40 passed\n";

  test("returns text under the cap unchanged", () => {
    expect(smartCutToolOutput("short", 100)).toBe("short");
  });

  test("keeps head, elided-middle signal lines and tail within max", () => {
    const big = log(2000);
    const out = smartCutToolOutput(big, 2000);
    expect(out.length).toBeLessThanOrEqual(2000);
    expect(out).toContain("line 0");
    expect(out).toContain("chars elided");
    expect(out).toContain("Error: build failed");
    expect(out).toContain("Tests: 3 failed");
  });

  test("falls back to head + tail when signals overflow", () => {
    const noisy = Array.from({ length: 500 }, () => "error: something").join("\n");
    const out = smartCutToolOutput(noisy, 1000);
    expect(out.length).toBeLessThanOrEqual(1000);
    expect(out).toContain("chars elided");
  });
});

describe("minifyJsonOutput", () => {
  const rows = Array.from({ length: 40 }, (_, i) => ({
    id: i,
    title: `Deal ${i}: "quoted" \\ back, tab\there`,
    notes: "two  spaces\nand a line break stay",
    tags: ["a b", "c"],
    owner: null,
  }));

  test("an indented JSON answer loses only its indentation", () => {
    const pretty = JSON.stringify({ rows, next: null }, null, 2);
    const out = minifyJsonOutput(pretty);
    expect(out).toBe(JSON.stringify({ rows, next: null }));
    expect(JSON.parse(out)).toEqual({ rows, next: null });
    expect(out.length).toBeLessThan(pretty.length * 0.8);
    expect(compressToolOutput(pretty)).toBe(out);
  });

  test("numbers are copied as written: a long id keeps every digit", () => {
    const pretty = `{\n  "id": 1234567890123456789012,\n  "ratio": 1.10,\n  "pad": "${"x".repeat(400)}"\n}`;
    const out = minifyJsonOutput(pretty);
    expect(out).toContain('"id":1234567890123456789012,');
    expect(out).toContain('"ratio":1.10,');
  });

  test("what isn't one JSON document, or is short or already compact, comes back untouched", () => {
    const log = `{ starting build\n  step 1\n${"line\n".repeat(200)}`;
    expect(minifyJsonOutput(log)).toBe(log);
    const short = JSON.stringify({ a: 1, b: [1, 2] }, null, 2);
    expect(minifyJsonOutput(short)).toBe(short);
    const compact = JSON.stringify({ rows });
    expect(minifyJsonOutput(compact)).toBe(compact);
    const prose = `Here is the result:\n${JSON.stringify({ rows }, null, 2)}`;
    expect(minifyJsonOutput(prose)).toBe(prose);
  });
});
