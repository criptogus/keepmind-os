import { isPaidReturn } from "@keepmind/client/lib/billing";
import { createFileRoute } from "@tanstack/react-router";
import { agentPanelSearch, threadSearch } from "@/lib/open-param";
import { DmPage } from "@/pages/DmPage";

interface AgentDmSearch extends ReturnType<typeof threadSearch>, ReturnType<typeof agentPanelSearch> {
  m?: string;
  paid?: true;
  say?: "team";
}

/** Direct message with an agent (sidebar "Agentes"). */
export const Route = createFileRoute("/org/$orgId/dm/agent/$agentId")({
  // `?m=<message>` opens the DM at that message (a search hit); `?paid`: back from paying for the workspace (the hold
  // banner says the payment is being confirmed), where a new workspace opens its right hand's DM (ADR 0137); `?thread=`
  // is the one in its panel, `?agent=` the agent's page there instead.
  validateSearch: (search: Record<string, unknown>): AgentDmSearch => ({
    ...threadSearch(search),
    ...agentPanelSearch(search),
    ...(typeof search.m === "string" && search.m ? { m: search.m } : {}),
    ...(isPaidReturn(search) ? { paid: true as const } : {}),
    // `?say=team`: the Team page's "tell the right hand what you need" — the DM sends the interview starter once.
    ...(search.say === "team" ? { say: "team" as const } : {}),
  }),
  component: function AgentDm() {
    const { agentId } = Route.useParams();
    const { say } = Route.useSearch();
    return <DmPage key={agentId} target={{ agentId }} focusMessageId={Route.useSearch().m} say={say} />;
  },
});
