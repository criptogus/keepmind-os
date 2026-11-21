import {
  GOAL_PERIODS,
  type Goal,
  type GoalPeriod,
  type GoalStatus,
  goalPercent,
  useAgents,
  useCreateGoal,
  useGoals,
  useUpdateGoal,
} from "@keepmind/client";
import { errorText } from "@keepmind/client/lib/errors";
import { can } from "@keepmind/client/lib/permissions";
import {
  Button,
  Dialog,
  DialogBody,
  DialogFooter,
  EmptyState,
  Field,
  GroupHeading,
  Input,
  PageHeader,
  Select,
} from "@keepmind/ui";
import type { TFunction } from "i18next";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ErrorState, LoadingCards } from "@/components/Loading";
import { useOrg } from "@/components/org-context";
import { useToast } from "@/lib/toast";
import "./goals.css";

/** The order the groups show in: what waits on a person first, then what runs, then what ended. */
const GROUP_ORDER: GoalStatus[] = ["proposed", "active", "paused", "achieved", "dropped"];

/** The line a goal shows under its title: "12 of 50 leads · monthly · @maya". */
function goalLine(t: TFunction, g: Goal): string {
  const parts: string[] = [];
  if (g.target != null) parts.push(t("goals.of", { current: g.current, target: g.target, unit: g.unit || "" }).trim());
  else if (g.unit) parts.push(`${g.current} ${g.unit}`.trim());
  parts.push(t(`goals.period.${g.period}`));
  if (g.owner) parts.push(`@${g.owner.handle}`);
  return parts.join(" · ");
}

type GoalActionKey = "goals.activate" | "goals.pause" | "goals.resume" | "goals.achieved" | "goals.drop";

/** What a writer can do to a goal in its state; agents only ever propose and report progress. */
function goalActions(g: Goal, writer: boolean): { status: GoalStatus; key: GoalActionKey; primary?: boolean }[] {
  if (!writer) return [];
  switch (g.status) {
    case "proposed":
      return [
        { status: "active", key: "goals.activate", primary: true },
        { status: "dropped", key: "goals.drop" },
      ];
    case "active":
      return [
        { status: "paused", key: "goals.pause" },
        { status: "achieved", key: "goals.achieved" },
        { status: "dropped", key: "goals.drop" },
      ];
    case "paused":
      return [
        { status: "active", key: "goals.resume", primary: true },
        { status: "dropped", key: "goals.drop" },
      ];
    default:
      return [];
  }
}

function GoalCard({ goal, writer, onAct }: { goal: Goal; writer: boolean; onAct: (status: GoalStatus) => void }) {
  const { t } = useTranslation();
  const pct = goalPercent(goal);
  const actions = goalActions(goal, writer);
  return (
    <div className="ac-card goal-card">
      <div className="goal-card__text">
        <span className="goal-card__title">{goal.title}</span>
        <span className="goal-card__meta">{goalLine(t, goal)}</span>
        {goal.progressNote && <span className="goal-card__note">{goal.progressNote}</span>}
        {pct != null && (
          <span
            className="goal-card__bar"
            role="progressbar"
            aria-valuenow={pct}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={goal.title}
          >
            <span className="goal-card__fill" style={{ width: `${pct}%` }} />
          </span>
        )}
      </div>
      {actions.length > 0 && (
        <span className="goal-card__acts ac-actrow">
          {actions.map((a) => (
            <Button key={a.key} size="sm" variant={a.primary ? "primary" : "ghost"} onClick={() => onAct(a.status)}>
              {t(a.key)}
            </Button>
          ))}
        </span>
      )}
    </div>
  );
}

/** New goal: what a person sets goes straight to active; the agents' own proposals wait here for Activate. */
function NewGoalDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const { org } = useOrg();
  const toast = useToast();
  const create = useCreateGoal(org.id);
  const agents = useAgents(org.id);
  const [title, setTitle] = useState("");
  const [metric, setMetric] = useState("");
  const [target, setTarget] = useState("");
  const [unit, setUnit] = useState("");
  const [period, setPeriod] = useState<GoalPeriod>("monthly");
  const [ownerAgentId, setOwnerAgentId] = useState("");
  const ready = title.trim().length > 0;
  const submit = () => {
    create.mutate(
      {
        title: title.trim(),
        metric: metric.trim(),
        target: target.trim() === "" ? null : Number(target),
        unit: unit.trim(),
        period,
        ownerAgentId: ownerAgentId || null,
      },
      {
        onSuccess: () => {
          toast.show(t("goals.created"));
          onClose();
        },
        onError: (e) => toast.show(errorText(t, e), "error"),
      },
    );
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={t("goals.new.title")}
      description={t("goals.new.subtitle")}
      closeLabel={t("common.close")}
      width={560}
    >
      <DialogBody className="goal-dialog">
        <Field label={t("goals.new.name")}>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t("goals.new.nameHint")} />
        </Field>
        <Field
          label={t("goals.new.metric")}
          hint={{ name: t("common.about", { label: t("goals.new.metric") }), text: t("goals.new.metricHint") }}
        >
          <Input value={metric} onChange={(e) => setMetric(e.target.value)} />
        </Field>
        <div className="goal-dialog__row">
          <Field label={t("goals.new.target")}>
            <Input
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              inputMode="decimal"
              placeholder={t("goals.new.targetHint")}
            />
          </Field>
          <Field label={t("goals.new.unit")}>
            <Input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder={t("goals.new.unitHint")} />
          </Field>
        </div>
        <div className="goal-dialog__row">
          <Field label={t("goals.new.period")}>
            <Select<GoalPeriod>
              value={period}
              onValueChange={setPeriod}
              options={GOAL_PERIODS.map((p) => ({ value: p, label: t(`goals.period.${p}`) }))}
            />
          </Field>
          <Field
            label={t("goals.new.owner")}
            hint={{ name: t("common.about", { label: t("goals.new.owner") }), text: t("goals.new.ownerHint") }}
          >
            <Select
              value={ownerAgentId}
              onValueChange={setOwnerAgentId}
              options={[
                { value: "", label: t("goals.new.noOwner") },
                ...(agents.data ?? []).map((a) => ({ value: a.id, label: `@${a.handle}` })),
              ]}
            />
          </Field>
        </div>
      </DialogBody>
      <DialogFooter>
        <Button onClick={onClose}>{t("common.cancel")}</Button>
        <Button variant="primary" disabled={!ready || create.isPending} onClick={submit}>
          {t("goals.new.create")}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}

/**
 * Goals (OKRs): the workspace's measurable targets. Agents propose them and move `current` with a review note; a
 * person activates a proposal and owns its state — the leadership's weekly check reports progress here.
 */
export function GoalsPage() {
  const { t } = useTranslation();
  const { org } = useOrg();
  const toast = useToast();
  const list = useGoals(org.id);
  const update = useUpdateGoal(org.id);
  const [creating, setCreating] = useState(false);
  const writer = can(org, "assign_work") || can(org, "administrator");
  const goals = list.data?.goals ?? [];
  const act = (goal: Goal, status: GoalStatus) =>
    update.mutate({ goalId: goal.id, patch: { status } }, { onError: (e) => toast.show(errorText(t, e), "error") });
  return (
    <div className="page page--list goals">
      <PageHeader
        title={t("goals.title")}
        meta={t("goals.subtitle")}
        actions={
          writer && (
            <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>
              {t("goals.new.open")}
            </Button>
          )
        }
      />
      {list.isLoading && <LoadingCards count={3} />}
      {list.isError && !list.data && <ErrorState error={list.error} onRetry={() => void list.refetch()} />}
      {list.data && goals.length === 0 && (
        <EmptyState
          size="page"
          icon="flag"
          title={t("goals.empty.title")}
          actions={
            writer ? (
              <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>
                {t("goals.new.open")}
              </Button>
            ) : undefined
          }
        >
          {t("goals.empty.text")}
        </EmptyState>
      )}
      {list.data && goals.length > 0 && (
        <div className="ac-groups">
          {GROUP_ORDER.map((status) => {
            const rows = goals.filter((g) => g.status === status);
            if (!rows.length) return null;
            return (
              <section key={status} className="goal-group">
                <GroupHeading title={t(`goals.status.${status}`)} count={rows.length} />
                <div className="goal-list">
                  {rows.map((g) => (
                    <GoalCard key={g.id} goal={g} writer={writer} onAct={(s) => act(g, s)} />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
      <NewGoalDialog open={creating} onClose={() => setCreating(false)} />
    </div>
  );
}
