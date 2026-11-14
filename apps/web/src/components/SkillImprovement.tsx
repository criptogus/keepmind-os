import { type SkillDetail, useAgents, useAiStatus, useSendDm } from "@agenteschat/client";
import { errorText } from "@agenteschat/client/lib/errors";
import { Alert, Button, Dialog, DialogBody, DialogFooter, Field, Select, Textarea } from "@agenteschat/ui";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useOrg } from "./org-context";

/** Reuses DM dispatch and native skill proposals; never adds tools or skill access. */
export function SkillImprovement({
  skill,
  users,
  onClose,
  onSent,
}: {
  skill: SkillDetail;
  users: { id: string; name: string }[];
  onClose: () => void;
  onSent: () => void;
}) {
  const { t } = useTranslation();
  const { org } = useOrg();
  const navigate = useNavigate();
  const agents = useAgents(org.id);
  const ai = useAiStatus(org.id);
  const send = useSendDm(org.id);
  const eligible = users.filter((user) =>
    agents.data?.some((a) => a.id === user.id && a.canTalk !== false && !a.former),
  );
  const [chosen, setChosen] = useState("");
  const agentId = eligible.some((a) => a.id === chosen) ? chosen : (eligible[0]?.id ?? "");
  const [goal, setGoal] = useState("");
  const ready = ai.data?.agents.some((a) => a.agentId === agentId && a.state === "ready");
  const submit = () => {
    if (!ready || !agentId || send.isPending) return;
    send.mutate(
      { agentId, body: t("keepmindSkills.request", { name: skill.name, version: skill.version, goal: goal.trim() }) },
      {
        onSuccess: () => {
          onSent();
          void navigate({ to: "/org/$orgId/dm/agent/$agentId", params: { orgId: org.id, agentId } });
        },
      },
    );
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => !open && !send.isPending && onClose()}
      title={t("keepmindSkills.improve")}
      closeLabel={t("common.close")}
    >
      <DialogBody>
        <p>{t("keepmindSkills.intro")}</p>
        {eligible.length > 0 ? (
          <>
            <Field label={t("keepmindSkills.agent")}>
              <Select
                value={agentId}
                onValueChange={setChosen}
                options={eligible.map((a) => ({ value: a.id, label: a.name }))}
                disabled={send.isPending}
              />
            </Field>
            <Field label={t("keepmindSkills.goal")} id="skill-improvement-goal">
              <Textarea
                value={goal}
                onChange={(event) => setGoal(event.target.value)}
                placeholder={t("keepmindSkills.goalHint")}
                rows={3}
                maxLength={2000}
                disabled={send.isPending}
              />
            </Field>
            {!ready && !ai.isLoading && (
              <Alert tone="neutral">
                {t("keepmindSkills.noAI")}{" "}
                <Button
                  variant="link"
                  onClick={() => {
                    onSent();
                    void navigate({ to: "/org/$orgId/settings/$section", params: { orgId: org.id, section: "usage" } });
                  }}
                >
                  {t("keepmindSkills.setup")}
                </Button>
              </Alert>
            )}
          </>
        ) : (
          !agents.isLoading && <Alert tone="neutral">{t("keepmindSkills.noAgent")}</Alert>
        )}
        {(agents.isError || ai.isError) && (
          <Alert>
            {t("common.loadFailed")}{" "}
            <Button
              onClick={() => {
                void agents.refetch();
                void ai.refetch();
              }}
            >
              {t("common.retry")}
            </Button>
          </Alert>
        )}
        {send.isError && <Alert>{errorText(t, send.error)}</Alert>}
        <p className="small muted">{t("keepmindSkills.review")}</p>
      </DialogBody>
      <DialogFooter>
        <Button onClick={onClose} disabled={send.isPending}>
          {t("common.cancel")}
        </Button>
        <Button
          variant="primary"
          onClick={submit}
          disabled={!ready || !agentId || send.isPending}
          loading={send.isPending}
        >
          {t("keepmindSkills.submit")}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
