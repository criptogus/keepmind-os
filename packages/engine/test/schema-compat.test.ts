import { describe, expect, test } from "bun:test";
import { MISSION_MCP_TOOLS } from "@keepmind/adapters";
import { toBrainSchema, validateJson } from "../src";

describe("toBrainSchema", () => {
  test("plain object schemas pass unchanged (the mission tools included)", () => {
    for (const tool of MISSION_MCP_TOOLS) {
      const expected = { ...tool.inputSchema, type: "object", properties: tool.inputSchema.properties ?? {} };
      expect(toBrainSchema(tool.inputSchema)).toEqual(expected);
    }
  });

  test("$ref is inlined from $defs and definitions; cycles and unknown refs become anything", () => {
    const out = toBrainSchema({
      $schema: "http://json-schema.org/draft-07/schema#",
      type: "object",
      $defs: {
        repo: { type: "string", minLength: 1 },
        node: { type: "object", properties: { next: { $ref: "#/$defs/node" } } },
      },
      definitions: { pr: { type: "integer", minimum: 1 } },
      properties: {
        repo: { $ref: "#/$defs/repo", description: "owner/name" },
        pr: { $ref: "#/definitions/pr" },
        tree: { $ref: "#/$defs/node" },
        far: { $ref: "https://example.com/schema.json" },
      },
      required: ["repo"],
    });
    expect(JSON.stringify(out)).not.toContain("$ref");
    expect(out.$defs).toBeUndefined();
    expect(out.definitions).toBeUndefined();
    expect(out.$schema).toBeUndefined();
    expect(out.properties).toEqual({
      repo: { type: "string", minLength: 1, description: "owner/name" },
      pr: { type: "integer", minimum: 1 },
      tree: { type: "object", properties: { next: {} } },
      far: {},
    });
    expect(out.required).toEqual(["repo"]);
  });

  test("a top-level oneOf becomes one object: properties united, required only what every variant needs", () => {
    const out = toBrainSchema({
      oneOf: [
        {
          type: "object",
          description: "by id",
          properties: { id: { type: "string" }, verbose: { type: "boolean" } },
          required: ["id", "verbose"],
          additionalProperties: false,
        },
        {
          type: "object",
          description: "by name",
          properties: { name: { type: "string" }, verbose: { type: "boolean" } },
          required: ["name", "verbose"],
        },
      ],
    });
    expect(out.oneOf).toBeUndefined();
    expect(out.type).toBe("object");
    expect(Object.keys(out.properties as object).sort()).toEqual(["id", "name", "verbose"]);
    expect(out.required).toEqual(["verbose"]);
    expect(out.additionalProperties).toBeUndefined();
    expect(String(out.description)).toContain("by id");
    // What either variant accepts, the merged schema accepts too.
    expect(validateJson(out, { id: "1", verbose: true })).toEqual([]);
    expect(validateJson(out, { name: "a", verbose: false })).toEqual([]);
  });

  test("a top-level allOf is merged; a schema with no type gets an object root", () => {
    const out = toBrainSchema({
      allOf: [
        { type: "object", properties: { a: { type: "string" } }, required: ["a"], additionalProperties: false },
        { properties: { b: { type: "number" } }, required: ["b"] },
      ],
    });
    expect(out).toEqual({
      type: "object",
      properties: { a: { type: "string" }, b: { type: "number" } },
      required: ["a", "b"],
    });
    expect(toBrainSchema({})).toEqual({ type: "object", properties: {} });
  });

  test("a property whose type is implied gets one: strict providers (Moonshot's tool check) refuse it otherwise", () => {
    const out = toBrainSchema({
      type: "object",
      properties: {
        kind: { enum: ["document", "table"] },
        count: { enum: [1, 2] },
        flag: { const: true },
        nested: { properties: { inner: { enum: ["x"] } } },
        list: { items: { enum: ["a", "b"] } },
        anything: {},
      },
    });
    expect(out.properties).toEqual({
      kind: { enum: ["document", "table"], type: "string" },
      count: { enum: [1, 2], type: "integer" },
      flag: { const: true, type: "boolean" },
      nested: { properties: { inner: { enum: ["x"], type: "string" } }, type: "object" },
      list: { items: { enum: ["a", "b"], type: "string" }, type: "array" },
      anything: {},
    });
  });
});
