import { useScheduleMessage } from "@keepmind/client";
import { upcomingAt } from "@keepmind/client/lib/format";
import { Button, DatePicker, Dialog, DialogBody, DialogFooter, Field, OptionList, TimeSelect } from "@keepmind/ui";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useOrg } from "@/components/org-context";
import { useToast } from "@/lib/toast";
import { at, customOf, PRESET_KEYS, presetAt, type When } from "@/lib/when-presets";

/**
 * "Agendar mensagem" (Slack's schedule send): the composer's text goes out as its person at the picked
 * time, through the same send path as a live message. Presets or a date and time; the preview is the
 * message's first line so it is clear what will be sent.
 */
export function ScheduleMessageDialog({
  channelId,
  threadId,
  replyTo,
  attachments,
  body,
  onClose,
  onDone,
}: {
  channelId: string;
  threadId: string | null;
  /** Quote reply the message carries (`meta.replyTo`), same as a live send. */
  replyTo?: string | null;
  /** Artifact ids attached to it. */
  attachments?: string[];
  /** The composer's text when it was asked (the draft may change after; this is what goes out). */
  body: string;
  onClose: () => void;
  /** After it is scheduled (the composer clears its draft). */
  onDone?: () => void;
}) {
  const { t, i18n } = useTranslation();
  const { org } = useOrg();
  const orgId = org.id;
  const toast = useToast();
  const schedule = useScheduleMessage(orgId);

  const [when, setWhen] = useState<When>("in1h");
  // One id per opened dialog: a retried submit moves the same send instead of queueing a duplicate.
  const [clientId] = useState(() => crypto.randomUUID());
  const [customDay, setCustomDay] = useState(() => customOf(presetAt("tomorrow9", new Date())).day);
  const [customTime, setCustomTime] = useState(() => customOf(presetAt("tomorrow9", new Date())).time);

  const target = useMemo(
    () => (when === "custom" ? at(customDay, customTime) : presetAt(when, new Date())),
    [when, customDay, customTime],
  );
  const valid = !Number.isNaN(target.getTime()) && target.getTime() > Date.now() + 31_000;

  const preview =
    body
      .trim()
      .split("\n")
      .find((l) => l.trim()) ?? "";
  const submit = () => {
    if (!valid || schedule.isPending) return;
    schedule.mutate(
      {
        channelId,
        body,
        threadId,
        replyTo: replyTo ?? null,
        attachments,
        sendAt: target.toISOString(),
        clientId,
      },
      {
        onSuccess: () => {
          toast.show(t("schedule.scheduledFor", { when: upcomingAt(t, i18n.language, target.toISOString()) }));
          onDone?.();
          onClose();
        },
        onError: () => toast.show(t("schedule.failed"), "error"),
      },
    );
  };

  const dateLabels = {
    previousMonth: t("common.previousMonth"),
    nextMonth: t("common.nextMonth"),
    choose: t("common.chooseDate"),
  };

  const options = [...PRESET_KEYS, "custom" as const].map((key) => ({
    value: key,
    title: t(`schedule.${key}`),
    side: key === "custom" ? undefined : upcomingAt(t, i18n.language, presetAt(key, new Date()).toISOString()),
    children:
      key === "custom" ? (
        <div className="schedule__custom">
          <Field label={t("schedule.date")} id="schedule-date">
            <DatePicker
              value={customDay}
              onChange={setCustomDay}
              locale={i18n.language}
              labels={dateLabels}
              min={customOf(new Date()).day}
            />
          </Field>
          <Field label={t("schedule.time")} id="schedule-time">
            <TimeSelect value={customTime} onChange={setCustomTime} />
          </Field>
        </div>
      ) : undefined,
  }));

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t("schedule.title")}
      closeLabel={t("common.close")}
      width={480}
    >
      <DialogBody>
        {preview && (
          <p className="schedule__preview" title={body}>
            {preview}
          </p>
        )}
        <OptionList
          value={when}
          onValueChange={(v) => setWhen(v as When)}
          options={options}
          aria-label={t("schedule.when")}
          attached
        />
      </DialogBody>
      <DialogFooter bar note={upcomingAt(t, i18n.language, target.toISOString())}>
        <Button variant="primary" onClick={submit} disabled={!valid} loading={schedule.isPending}>
          {t("schedule.submit")}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
