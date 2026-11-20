import { type Goal, type GoalStatus, goalPercent, useGoals, useUpdateGoal } from "@keepmind/client";
import { errorText } from "@keepmind/client/lib/errors";
import { can } from "@keepmind/client/lib/permissions";
import { useTranslation } from "react-i18next";
import { RefreshControl, StyleSheet, View } from "react-native";
import { useOrg } from "@/providers/org";
import { Button, EmptyState, GroupedHeader, SkeletonList, Text, useToast } from "@/ui";
import { useTheme } from "@/ui/theme";
import { useColors, useOrgId, usePullRefresh } from "../shared/hooks";
import { PushedLargeTitle } from "../shared/PushedLargeTitle";

/** The order the groups show in: what waits on a person first, then what runs, then what ended (the web's). */
const GROUP_ORDER: GoalStatus[] = ["proposed", "active", "paused", "achieved", "dropped"];

/** The line under a goal's title: "37 de 100 leads · ao mês · @ada". */
function goalLine(t: ReturnType<typeof useTranslation>["t"], g: Goal): string {
  const parts: string[] = [];
  if (g.target != null) parts.push(t("goals.of", { current: g.current, target: g.target, unit: g.unit || "" }).trim());
  else if (g.unit) parts.push(`${g.current} ${g.unit}`.trim());
  parts.push(t(`goals.period.${g.period}`));
  if (g.owner) parts.push(`@${g.owner.handle}`);
  return parts.join(" · ");
}

type GoalActionKey = "goals.activate" | "goals.pause" | "goals.resume" | "goals.achieved" | "goals.drop";

/** What a writer can do to a goal in its state; agents only ever propose and report progress (the web's table). */
function goalActions(g: Goal): { status: GoalStatus; key: GoalActionKey; primary?: boolean }[] {
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

/** A goal's progress, the settings' Meter look: a sunken track, the part done in ink. */
function GoalBar({ goal }: { goal: Goal }) {
  const { colors } = useTheme();
  const pct = goalPercent(goal);
  if (pct == null) return null;
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={goal.title}
      accessibilityValue={{ min: 0, max: 100, now: pct }}
      style={[styles.track, { backgroundColor: colors.sunken }]}
    >
      <View style={[styles.done, { width: `${pct}%`, backgroundColor: colors.ink }]} />
    </View>
  );
}

function GoalCard({ goal, writer, onAct }: { goal: Goal; writer: boolean; onAct: (status: GoalStatus) => void }) {
  const { t } = useTranslation();
  const colors = useColors();
  const actions = writer ? goalActions(goal) : [];
  return (
    <View style={[styles.card, { backgroundColor: colors.raised }]}>
      <Text variant="title">{goal.title}</Text>
      <Text variant="footnote" tone="muted">
        {goalLine(t, goal)}
      </Text>
      {goal.progressNote ? (
        <Text variant="footnote" tone="muted">
          {goal.progressNote}
        </Text>
      ) : null}
      <GoalBar goal={goal} />
      {actions.length > 0 ? (
        <View style={styles.acts}>
          {actions.map((a) => (
            <Button
              key={a.key}
              variant={a.primary ? "primary" : "ghost"}
              size="sm"
              label={t(a.key)}
              onPress={() => onAct(a.status)}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}

/**
 * Goals (OKRs), pushed from Você's Work group: the workspace's measurable targets, what the agents proposed and
 * report on. A person activates a proposal and owns its state; the leadership's weekly check reports progress here.
 */
export function GoalsScreen() {
  const { t } = useTranslation();
  const { org } = useOrg();
  const orgId = useOrgId();
  const toast = useToast();
  const list = useGoals(orgId);
  const update = useUpdateGoal(orgId);
  const pull = usePullRefresh(list.refetch);
  const writer = can(org, "assign_work") || can(org, "administrator");
  const goals = list.data?.goals ?? [];
  const act = (goal: Goal, status: GoalStatus) =>
    update.mutate(
      { goalId: goal.id, patch: { status } },
      { onError: (e) => toast({ title: errorText(t, e), icon: "x" }) },
    );
  return (
    <PushedLargeTitle
      title={t("goals.title")}
      grouped
      refreshControl={<RefreshControl refreshing={pull.refreshing} onRefresh={pull.onRefresh} />}
    >
      <View style={styles.in}>
        {list.isLoading ? (
          <SkeletonList rows={4} />
        ) : list.isError && !list.data ? (
          <View style={styles.center}>
            <Text tone="muted" style={styles.centerText}>
              {t("mobile.dashboards.loadFailed")}
            </Text>
            <Button
              variant="secondary"
              size="sm"
              label={t("mobile.common.retry")}
              onPress={() => void list.refetch()}
            />
          </View>
        ) : goals.length === 0 ? (
          <EmptyState size="page" icon="flag" title={t("goals.empty.title")} subtitle={t("goals.empty.text")} />
        ) : (
          GROUP_ORDER.map((status) => {
            const rows = goals.filter((g) => g.status === status);
            if (!rows.length) return null;
            return (
              <View key={status}>
                <GroupedHeader>{`${t(`goals.status.${status}`)} · ${rows.length}`}</GroupedHeader>
                <View style={styles.group}>
                  {rows.map((g) => (
                    <GoalCard key={g.id} goal={g} writer={writer} onAct={(s) => act(g, s)} />
                  ))}
                </View>
              </View>
            );
          })
        )}
      </View>
    </PushedLargeTitle>
  );
}

const styles = StyleSheet.create({
  in: { paddingHorizontal: 16, paddingTop: 8, gap: 16 },
  center: { alignItems: "center", gap: 10, paddingVertical: 32 },
  centerText: { textAlign: "center" },
  group: { gap: 10 },
  card: { borderRadius: 20, padding: 14, gap: 6 },
  track: { height: 6, borderRadius: 999, overflow: "hidden", marginTop: 4 },
  done: { height: 6, borderRadius: 999 },
  acts: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 6 },
});
