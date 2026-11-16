import { type ApiClient, ApiProvider as SharedApiProvider } from "@keepmind/client";
import { playAgentReaction } from "@keepmind/ui";
import type { ReactNode } from "react";

export { useApi } from "@keepmind/client";

/** The shared provider with the web's effects (an agent's face on 👍/👎). */
export function ApiProvider({ client, children }: { client: ApiClient; children: ReactNode }) {
  return (
    <SharedApiProvider client={client} onAgentReaction={playAgentReaction}>
      {children}
    </SharedApiProvider>
  );
}
