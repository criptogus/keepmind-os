import { useTaskManager } from "@keepmind/client";
import { WORK_TICK_MS } from "@keepmind/client/lib/agent-work";
import {
  type AgoraItem,
  type AgoraSection,
  agoraContext,
  agoraPhrase,
  agoraSections,
  agoraTime,
  helpsWhom,
  SHORT_NAME,
  waitsOnSomeone,
} from "@keepmind/client/lib/agora";
import { todayStart } from "@keepmind/client/lib/task-manager";
import { Button, Card, GroupHeading, Icon } from "@keepmind/ui";
import { Link } from "@tanstack/react-router";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { AgentAvatar, withAgentFace } from "@/components/AgentAvatar";
import { ErrorState, LoadingList } from "@/components/Loading";
import { useOrg } from "@/components/org-context";
import { WaitMark } from "@/components/RequestCard";
import { RowName, useOpenTask } from "@/components/tasks/TaskBits";
import { useDirectory } from "@/hooks/useDirectory";
import { useNow } from "@/hooks/useNow";
import "../agora.css";

const SECTIONS: AgoraSection[] = ["you", "working", "waiting"];

/**
 * "Agora" on the Team page (chief-of-staff gaps, item 2): the same rows the Agora popover reads
 * (`useTaskManager` + `agoraSections`), always on the page — who works, what waits on you, what waits on
 * someone else. View-only: stopping and stepping into a task stay in the popover and the task manager.
 */
export function TeamNow() {
  const { t } = useTranslation();
  const { org } = useOrg();
  const view = useTaskManager(org.id, { since: todayStart() });
  const now = useNow(WORK_TICK_MS / 4);
  const sections = useMemo(() => agoraSections(view.data), [view.data]);
  const openTask = useOpenTask();
  const hidden = view.data?.hidden?.total ?? 0;
  const empty = SECTIONS.every((s) => sections[s].length === 0) && hidden === 0;

  const open = (item: AgoraItem) => {
    if (item.kind === "return") {
      openTask({ ...item.ret, messageId: item.ret.replyMessageId });
      return;
    }
    openTask({ ...item.task, messageId: waitsOnSomeone(item.state) ? (item.task.work?.card ?? null) : null });
  };

  return (
    <Card className="team-agora">
      <div className="team-agora__head">
        <h2 className="team-agora__title">{t("team.now.title")}</h2>
        <Button size="sm" variant="ghost" asChild>
          <Link to="/org/$orgId/task-manager" params={{ orgId: org.id }}>
            {t("agora.openManager")}
            <Icon name="chevronRight" size={16} />
          </Link>
        </Button>
      </div>
      {view.isLoading ? (
        <LoadingList count={2} />
      ) : view.isError && !view.data ? (
        <ErrorState error={view.error} onRetry={() => void view.refetch()} />
      ) : empty ? (
        <p className="team-agora__none">{t("team.now.empty")}</p>
      ) : (
        SECTIONS.map((s) =>
          sections[s].length > 0 ? (
            <section key={s} className="team-agora__section" aria-label={t(`agora.sections.${s}`)}>
              <GroupHeading level={3} title={t(`agora.sections.${s}`)} count={sections[s].length} />
              <ul className="agora__rows">
                {sections[s].map((item) => (
                  <TeamNowRow key={item.key} item={item} now={now} onOpen={() => open(item)} />
                ))}
              </ul>
            </section>
          ) : null,
        )
      )}
      {hidden > 0 && <p className="team-agora__none">{t("taskManager.hiddenLine", { count: hidden })}</p>}
    </Card>
  );
}

function TeamNowRow({ item, now, onOpen }: { item: AgoraItem; now: number; onOpen: () => void }) {
  const { t, i18n } = useTranslation();
  const { org } = useOrg();
  const dir = useDirectory(org.id);
  const name = dir.anyAgent(item.agentId)?.name ?? t("channel.unknownAgent");
  const forId = helpsWhom(item);
  const forName = forId ? dir.anyAgent(forId)?.name : undefined;
  const phrase = agoraPhrase(t, i18n.language, item, forName, now);
  const context = agoraContext(t, item);
  const time = agoraTime(i18n.language, item, now);
  const title = `${name} ${phrase}`;
  return (
    <li className="agora-row" data-state={item.state}>
      {item.state === "you" ? (
        <WaitMark still />
      ) : (
        <AgentAvatar
          agentId={item.agentId}
          name={name}
          size="xs"
          state={item.state === "working" ? "thinking" : waitsOnSomeone(item.state) ? "waiting" : "idle"}
        />
      )}
      <RowName
        title={title}
        sub={context}
        tip={[context, time].filter((l): l is string => Boolean(l))}
        onClick={onOpen}
      >
        <span className="agora-row__who">
          <b data-long={name.length > SHORT_NAME || undefined}>{name}</b>{" "}
          <span className="agora-row__phrase">
            {forName ? withAgentFace(phrase, forName, forId ?? undefined) : phrase}
          </span>
        </span>
      </RowName>
      <span className="agora-row__time ac-num">{time ?? ""}</span>
    </li>
  );
}
