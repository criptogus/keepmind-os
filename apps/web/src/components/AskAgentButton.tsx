import type { Agent } from "@keepmind/client";
import { mayAsk } from "@keepmind/client/lib/audience";
import { setDraftFor } from "@keepmind/client/lib/drafts";
import { agentGrammar } from "@keepmind/client/lib/grammar";
import { rightHandOf } from "@keepmind/client/lib/right-hand";
import { Button, type ButtonProps } from "@keepmind/ui";
import { useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useOrg } from "@/components/org-context";
import { useDirectory } from "@/hooks/useDirectory";

/**
 * To a DM with the agent (the right hand by default), `draft` already in its composer. Nothing for who can't talk to
 * it: the button never fails.
 */
export function AskAgentButton({
  agent,
  draft,
  label,
  variant,
}: {
  agent?: Pick<Agent, "id" | "name" | "canTalk">;
  draft?: string;
  label?: string;
  variant?: ButtonProps["variant"];
}) {
  const { t } = useTranslation();
  const { org } = useOrg();
  const navigate = useNavigate();
  const dir = useDirectory(org.id);
  const who = agent ?? rightHandOf(dir.agents);
  if (!who || !mayAsk(org, who)) return null;
  return (
    <Button
      variant={variant}
      icon="message"
      onClick={() => {
        if (draft) setDraftFor(`agent:${who.id}`, draft);
        void navigate({ to: "/org/$orgId/dm/agent/$agentId", params: { orgId: org.id, agentId: who.id } });
      }}
    >
      {label ?? (draft ? t("common.askAgent", agentGrammar(who.name)) : t("team.sectors.ask", { name: who.name }))}
    </Button>
  );
}
