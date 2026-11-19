#!/usr/bin/env node
import { parseBridgeArgs } from "../src/config.ts";
// Entry point spawned by the KeepMind OS server (see engine whatsapp supervisor).
// Runs under Node: Baileys crypto is Node-oriented. In dev, run with tsx/bun
// against src/index.ts; packaged builds ship a compiled bundle next to this file.
import { startBridge } from "../src/index.ts";

const cfg = parseBridgeArgs(process.argv.slice(2));
const handle = await startBridge(cfg);
console.log(`whatsapp-bridge org=${cfg.orgId} port=${handle.port}`);

const shutdown = async () => {
  await handle.close();
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
