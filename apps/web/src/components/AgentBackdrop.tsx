import { KeepMindBackdrop } from "@keepmind/ui";

/** The shared graphite stage for agent portraits. */
export function AgentBackdrop({ busy = false }: { busy?: boolean }) {
  return <KeepMindBackdrop tone="graphite" busy={busy} />;
}
