import { createKeepMindBrainBridge } from "@keepmind/engine";

// Operator-side process, not an agent launcher. Put credentials in a protected env file, never in chat.
const fetch = createKeepMindBrainBridge({
  upstreamUrl: process.env.KEEPMIND_SB_URL ?? "",
  agentId: process.env.KEEPMIND_SB_AGENT_ID ?? "",
  upstreamToken: process.env.KEEPMIND_SB_UPSTREAM_TOKEN ?? "",
  accessToken: process.env.KEEPMIND_SB_BRIDGE_TOKEN ?? "",
  write: process.env.KEEPMIND_SB_ALLOW_WRITE === "true",
});
const server = Bun.serve({ hostname: "127.0.0.1", port: Number(process.env.KEEPMIND_SB_BRIDGE_PORT ?? 3090), fetch });
console.info(
  `KeepMind Second Brain bridge listening on loopback port ${server.port}. Expose only behind authenticated HTTPS infrastructure.`,
);
