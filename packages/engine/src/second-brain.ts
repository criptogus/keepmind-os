import type { ContextDeps } from "./context/summaries";
import { createContextToolSource } from "./context/tools";
import type { ToolSource } from "./tools/types";

/** Native Second Brain: reuse the exact memory engine, not a second copy with weaker visibility rules. */
export function createSecondBrainToolSource(deps: ContextDeps): ToolSource {
  const native = createContextToolSource(deps);
  const names: Record<string, string> = {
    search_context: "search_context",
    remember: "remember",
    update_memory: "update_memory",
    forget: "forget",
  };
  return {
    name: "keepmind_second_brain",
    async tools(ctx) {
      return (await native.tools(ctx)).map((tool) =>
        !names[tool.name]
          ? tool
          : {
              ...tool,
              name: tool.name,
              description: `KeepMind Second Brain in this workspace (not an external personal vault). ${tool.description} For an existing external KeepMind vault, use its connected MCP tools; if unavailable offer_connect_app with the person's actual server URL. Never invent a URL, silently copy private memories to the team, or claim external sync.`,
              async execute(input, call) {
                const result = await tool.execute(input, call);
                return { ...result, data: { ...result.data, memoryStore: "workspace", nativeTool: tool.name } };
              },
            },
      );
    },
  };
}
