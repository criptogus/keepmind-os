import type { JsonSchema } from "./json-schema";

/**
 * Tool input schemas as coding CLIs accept them (Claude Code, Codex: ADR 0032
 * bridge). Some MCP clients reject or mishandle `$ref` and a top-level
 * `oneOf`/`anyOf`/`allOf`, and every tool's schema must be an object. This
 * keeps the meaning as close as it can:
 *
 * - `$ref` to `#/$defs/…` or `#/definitions/…` is inlined (cycles and
 *   unknown refs become `{}`: anything), then `$defs`/`definitions`,
 *   `$schema` and `$id` are dropped;
 * - a top-level `allOf` is merged (properties and `required` united);
 * - a top-level `oneOf`/`anyOf` becomes one object: the union of the
 *   variants' properties, required only what every variant requires, the
 *   variants' descriptions kept in the description;
 * - the root always has `type: "object"` and `properties`;
 * - every schema node gets a `type` when one is implied (`enum`, `const`,
 *   `properties`, `items`): strict readers such as Moonshot's tool-schema
 *   check refuse a property whose `type` is not defined.
 *
 * The Tool Gateway still validates the call against the tool's real schema.
 */
export function toBrainSchema(schema: JsonSchema): JsonSchema {
  const defs = {
    ...(isObject(schema.definitions) ? schema.definitions : {}),
    ...(isObject(schema.$defs) ? schema.$defs : {}),
  } as Record<string, JsonSchema>;
  const inlined = inline(schema, defs, new Set(), 0) as JsonSchema;
  const root = flattenTop(inlined);
  const { $defs: _d, definitions: _defs, $schema: _s, $id: _i, ...rest } = root;
  const out: JsonSchema = { ...rest, type: "object" };
  if (!isObject(out.properties)) out.properties = {};
  return ensureTypes(out);
}

/**
 * Adds `type` where the schema implies exactly one and a strict provider
 * requires it (an `enum` of strings is a string, `properties` an object,
 * `items` an array). Nodes that imply nothing — a bare `{}` — stay as they
 * are: the Tool Gateway validates calls against the tool's real schema.
 */
function ensureTypes(schema: JsonSchema): JsonSchema {
  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(walk);
    if (!isObject(node)) return node;
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node)) {
      if (key === "properties" && isObject(value)) {
        out[key] = Object.fromEntries(Object.entries(value).map(([name, sub]) => [name, walk(sub)]));
      } else if ((key === "items" || key === "additionalProperties") && isObject(value)) {
        out[key] = walk(value);
      } else if ((key === "oneOf" || key === "anyOf" || key === "allOf") && Array.isArray(value)) {
        out[key] = value.map(walk);
      } else {
        out[key] = value;
      }
    }
    if (out.type === undefined) {
      const type = impliedType(out);
      if (type) out.type = type;
    }
    return out;
  };
  return walk(schema) as JsonSchema;
}

function impliedType(node: Record<string, unknown>): string | null {
  const of = (value: unknown): string | null => {
    if (value === null) return "null";
    switch (typeof value) {
      case "string":
        return "string";
      case "number":
        return Number.isInteger(value) ? "integer" : "number";
      case "boolean":
        return "boolean";
      case "object":
        return "object";
      default:
        return null;
    }
  };
  if (Array.isArray(node.enum) && node.enum.length > 0) {
    const types = new Set(node.enum.map(of));
    return types.size === 1 ? ([...types][0] ?? null) : null;
  }
  if ("const" in node) return of(node.const);
  if (isObject(node.properties)) return "object";
  if (node.items !== undefined) return "array";
  return null;
}

const MAX_DEPTH = 32;

function inline(value: unknown, defs: Record<string, JsonSchema>, seen: Set<string>, depth: number): unknown {
  if (depth > MAX_DEPTH) return {};
  if (Array.isArray(value)) return value.map((v) => inline(v, defs, seen, depth + 1));
  if (!isObject(value)) return value;
  if (typeof value.$ref === "string") {
    const m = /^#\/(?:\$defs|definitions)\/(.+)$/.exec(value.$ref);
    const name = m?.[1] ? decodeURIComponent(m[1].replace(/~1/g, "/").replace(/~0/g, "~")) : null;
    const target = name ? defs[name] : undefined;
    const { $ref: _ref, ...siblings } = value;
    if (!name || !target || seen.has(name)) return inline(siblings, defs, seen, depth + 1);
    const next = new Set(seen).add(name);
    const resolved = inline(target, defs, next, depth + 1) as JsonSchema;
    return { ...resolved, ...(inline(siblings, defs, seen, depth + 1) as JsonSchema) };
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    if (k === "$defs" || k === "definitions") continue;
    out[k] = inline(v, defs, seen, depth + 1);
  }
  return out;
}

function flattenTop(schema: JsonSchema): JsonSchema {
  let root = { ...schema };
  if (Array.isArray(root.allOf)) {
    const parts = root.allOf.filter(isObject).map((p) => flattenTop(p as JsonSchema));
    delete root.allOf;
    for (const part of parts) root = mergeAll(root, part);
    // One part's `additionalProperties: false` would forbid the other parts' keys.
    if (parts.length > 1) delete root.additionalProperties;
  }
  for (const key of ["oneOf", "anyOf"] as const) {
    const variants = root[key];
    if (!Array.isArray(variants)) continue;
    delete root[key];
    const objects = variants.filter(isObject).map((v) => flattenTop(v as JsonSchema));
    if (objects.length === 0) continue;
    const properties: Record<string, unknown> = { ...(isObject(root.properties) ? root.properties : {}) };
    for (const v of objects) {
      for (const [name, prop] of Object.entries(isObject(v.properties) ? v.properties : {})) {
        properties[name] ??= prop;
      }
    }
    const requiredOf = (v: JsonSchema) => new Set(Array.isArray(v.required) ? v.required.map(String) : []);
    const sets = objects.map(requiredOf);
    const common = [...(sets[0] ?? [])].filter((name) => sets.every((s) => s.has(name)));
    const required = [...new Set([...(Array.isArray(root.required) ? root.required.map(String) : []), ...common])];
    const notes = objects
      .map((v, i) => (typeof v.description === "string" && v.description ? `(${i + 1}) ${v.description}` : ""))
      .filter(Boolean);
    root = {
      ...root,
      properties,
      ...(required.length ? { required } : {}),
      ...(notes.length
        ? {
            description: [typeof root.description === "string" ? root.description : "", `One of: ${notes.join(" ")}`]
              .filter(Boolean)
              .join(" "),
          }
        : {}),
    };
    // The variants may not all forbid extra keys the same way: the merged object can't promise it.
    delete root.additionalProperties;
  }
  return root;
}

function mergeAll(a: JsonSchema, b: JsonSchema): JsonSchema {
  const properties = {
    ...(isObject(a.properties) ? a.properties : {}),
    ...(isObject(b.properties) ? b.properties : {}),
  };
  const required = [
    ...new Set([
      ...(Array.isArray(a.required) ? a.required.map(String) : []),
      ...(Array.isArray(b.required) ? b.required.map(String) : []),
    ]),
  ];
  const { properties: _p, required: _r, ...restB } = b;
  return { ...a, ...restB, properties, ...(required.length ? { required } : {}) };
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
