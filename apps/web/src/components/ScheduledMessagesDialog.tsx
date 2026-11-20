import type { ScheduledMessage } from "@keepmind/client";
import { channelsQuery, useApi, useCancelScheduledMessage, useDms, useScheduledMessages } from "@keepmind/client";
import { upcomingAt } from "@keepmind/client/lib/format";
import { Button, Dialog, DialogBody, Icon } from "@keepmind/ui";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useOrg } from "@/components/org-context";
import { useToast } from "@/lib/toast";

/**
 * My scheduled messages (Slack's "Scheduled" list): each pending send with its time and a cancel. `channelId`
 * narrows it to one conversation (the composer's chip); absent, every pending one in the workspace.
 */
export function ScheduledMessagesDialog({ channelId, onClose }: { channelId?: string; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const { org } = useOrg();
  const api = useApi();
  const toast = useToast();
  const pending = useScheduledMessages(org.id);
  const channels = useQuery({ ...channelsQuery(api, org.id), enabled: !channelId });
  const dms = useDms(org.id);
  const cancel = useCancelScheduledMessage(org.id);

  const nameOf = (id: string) => {
    const ch = channels.data?.find((c) => c.id === id);
    if (ch) return `#${ch.name}`;
    const dm = dms.data?.find((d) => d.channelId === id);
    return dm?.with.name ?? "";
  };
  const rows = (pending.data ?? []).filter((m) => !channelId || m.channelId === channelId);

  const cancelOne = (m: ScheduledMessage) =>
    cancel.mutate(m.id, {
      onSuccess: () => toast.show(t("schedule.cancelled")),
      onError: () => toast.show(t("schedule.failed"), "error"),
    });

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t("schedule.listTitle")}
      closeLabel={t("common.close")}
      width={520}
    >
      <DialogBody>
        {pending.isPending ? (
          <p className="schedule__empty">{t("common.loading")}</p>
        ) : rows.length === 0 ? (
          <div className="schedule__empty">
            <Icon name="clock" size={20} />
            <p>{t("schedule.empty")}</p>
          </div>
        ) : (
          <ul className="schedule__list">
            {rows.map((m) => (
              <li key={m.id} className="schedule__row">
                <div className="schedule__row-main">
                  <span className="schedule__row-when">{upcomingAt(t, i18n.language, m.sendAt)}</span>
                  {!channelId && nameOf(m.channelId) && (
                    <span className="schedule__row-where">{nameOf(m.channelId)}</span>
                  )}
                  <span className="schedule__row-body" title={m.body}>
                    {m.body
                      .trim()
                      .split("\n")
                      .find((l) => l.trim()) || t("schedule.attachmentOnly")}
                  </span>
                </div>
                <Button
                  variant="default"
                  size="sm"
                  onClick={() => cancelOne(m)}
                  loading={cancel.isPending && cancel.variables === m.id}
                >
                  {t("schedule.cancel")}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </DialogBody>
    </Dialog>
  );
}
