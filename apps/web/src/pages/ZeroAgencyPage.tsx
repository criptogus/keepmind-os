import { useAgents, useAiStatus, useCatalog, useConnections, useCustomServers, useSendDm } from "@keepmind/client";
import { connectedItems } from "@keepmind/client/lib/connected";
import { errorText } from "@keepmind/client/lib/errors";
import { can } from "@keepmind/client/lib/permissions";
import { isRightHand } from "@keepmind/client/lib/right-hand";
import { Alert, Button, Field, Input, PageHeader } from "@keepmind/ui";
import { Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ConnectFlow, type FlowState } from "@/components/ConnectFlow";
import { useOrg } from "@/components/org-context";
import { SkillsSection } from "@/components/Skills";
import { TeamMemoryCard } from "@/components/TeamMemory";
import { BRAIN_SCHEMA, ZERO_CONTACT, type ZeroGoal, zeroGoal } from "@/lib/zero-agency";
import "./zero-agency.css";

export function ZeroAgencyPage({ area }: { area: string }) {
  const { t } = useTranslation();
  const { org } = useOrg();
  const navigate = useNavigate();
  const catalog = useCatalog();
  const connections = useConnections(org.id);
  const servers = useCustomServers(org.id);
  const items = connectedItems(connections.data ?? [], servers.data ?? [], catalog.data?.connectors ?? []);
  const connection = (id: string) => items.find((item) => item.def?.id === id);
  const agents = useAgents(org.id);
  const ai = useAiStatus(org.id);
  const send = useSendDm(org.id);
  const coordinator = agents.data?.find((a) => isRightHand(a) && !a.former && a.canTalk !== false);
  const ready = !!coordinator && ai.data?.agents.some((a) => a.agentId === coordinator.id && a.state === "ready");
  const [flow, setFlow] = useState<FlowState | null>(null);
  const [context, setContext] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const key =
    area === "skills" ? "skills" : area === "second-brain" ? "brain" : area === "cybersecurity" ? "cyber" : null;
  const connect = (id: string) => {
    const existing = connection(id);
    if (existing) {
      setFlow({ step: 1, item: existing });
      return;
    }
    const def = catalog.data?.connectors.find((item) => item.id === id);
    if (def) setFlow({ step: 0, def });
  };
  const start = (kind: ZeroGoal) => {
    if (!coordinator || !ready || send.isPending || submitted) return;
    send.mutate(
      { agentId: coordinator.id, body: zeroGoal(kind, context.trim()) },
      {
        onSuccess: () => {
          setSubmitted(true);
          void navigate({ to: "/org/$orgId/dm/agent/$agentId", params: { orgId: org.id, agentId: coordinator.id } });
        },
      },
    );
  };
  if (!key) return <Alert tone="neutral">{t("zero.notFound")}</Alert>;
  const connecting = (id: string) =>
    !can(org, "manage_connectors") || !catalog.data?.connectors.some((c) => c.id === id);
  return (
    <div className="page zero-area">
      <PageHeader title={t(`zero.${key}.title`)} meta={t(`zero.${key}.intro`)} />
      <nav className="zero-area__nav" aria-label={t("zero.products")}>
        {(
          [
            ["skills", "skills"],
            ["second-brain", "brain"],
            ["cybersecurity", "cyber"],
          ] as const
        ).map(([path, label]) => (
          <Link
            key={path}
            to="/org/$orgId/ecosystem/$area"
            params={{ orgId: org.id, area: path }}
            aria-current={path === area ? "page" : undefined}
          >
            {t(`zero.${label}.title`)}
          </Link>
        ))}
      </nav>
      {key === "skills" ? (
        <>
          <SkillsSection />
          <section className="zero-area__option" aria-labelledby="zero-skill">
            <div>
              <h2 id="zero-skill">SuperAgentSkill</h2>
              <p>{t("zero.skills.help")}</p>
            </div>
            <div className="zero-area__actions">
              <Button
                variant="primary"
                disabled={connecting("superagentskill")}
                onClick={() => connect("superagentskill")}
              >
                {connection("superagentskill") ? t("zero.manageConnection") : t("zero.skills.connect")}
              </Button>
              <a className="ac-link" href="https://superagentskill.com" target="_blank" rel="noopener noreferrer">
                {t("zero.skills.visit")}
              </a>
            </div>
          </section>
        </>
      ) : (
        <>
          {key === "brain" && <TeamMemoryCard />}
          <section className="zero-area__option" aria-labelledby="zero-goal">
            <div>
              <h2 id="zero-goal">{t(`zero.${key}.goal`)}</h2>
              <p>{key === "cyber" && "Powered by Liquid Cybersec. "}{t(`zero.${key}.help`)}</p>
            </div>
            <Field label={t(`zero.${key}.context`)} id="zero-context">
              <Input
                id="zero-context"
                value={context}
                onChange={(e) => setContext(e.target.value)}
                maxLength={1000}
                placeholder={t(`zero.${key}.placeholder`)}
              />
            </Field>
            <p className="muted">{t(`zero.${key}.boundary`)}</p>
            {send.isError && <Alert tone="danger">{errorText(t, send.error)}</Alert>}
            {!ready && (
              <Alert tone="neutral">
                {t("zero.needsAI")}{" "}
                <Link to="/org/$orgId/settings/$section" params={{ orgId: org.id, section: "keys" }}>
                  {t("zero.configureAI")}
                </Link>
              </Alert>
            )}
            <div className="zero-area__actions">
              <Button
                variant="primary"
                disabled={!ready || send.isPending || submitted}
                onClick={() => start(key === "brain" ? "github-brain" : "cyber-team")}
              >
                {send.isPending ? t("zero.sending") : t(`zero.${key}.start`)}
              </Button>
              {key === "brain" ? (
                <>
                  <Button disabled={!ready || send.isPending || submitted} onClick={() => start("install-brain")}>
                    {t("zero.brain.install")}
                  </Button>
                  <a
                    className="ac-link"
                    download="keepmind-brain.schema.json"
                    href={`data:application/json;charset=utf-8,${encodeURIComponent(JSON.stringify(BRAIN_SCHEMA, null, 2))}`}
                  >
                    {t("zero.brain.download")}
                  </a>
                </>
              ) : (
                <>
                  <Button disabled={connecting("liquid-cybersec")} onClick={() => connect("liquid-cybersec")}>
                    {connection("liquid-cybersec") ? t("zero.manageConnection") : t("zero.cyber.connect")}
                  </Button>
                  <a
                    className="ac-link"
                    href="https://liquidplatform.org/pricing"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {t("zero.cyber.plans")}
                  </a>
                </>
              )}
            </div>
            <p className="muted">{t("zero.progress")}</p>
          </section>
        </>
      )}
      <footer className="zero-area__footer">
        Zero Agency · <a href={`mailto:${ZERO_CONTACT}`}>{ZERO_CONTACT}</a>
      </footer>
      <ConnectFlow flow={flow} onChange={setFlow} onClose={() => setFlow(null)} />
    </div>
  );
}
