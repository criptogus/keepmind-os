import type { Message, MessageReminder } from "@keepmind/client";
import { useCancelMessageReminder, useRemindMessage } from "@keepmind/client";
import { upcomingAt } from "@keepmind/client/lib/format";
import {
  Button,
  DatePicker,
  Dialog,
  DialogBody,
  DialogFooter,
  Field,
  OptionList,
  Textarea,
  TimeSelect,
} from "@keepmind/ui";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useToast } from "@/lib/toast";
import { at, customOf, PRESET_KEYS, presetAt, type When } from "@/lib/when-presets";

export function RemindDialog({
  orgId,
  channelId,
  message,
  existing,
  onClose,
}: {
  orgId: string;
  channelId: string;
  message: Message;
  /** The reminder already on this message for me, when there is one. */
  existing: MessageReminder | null;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const remind = useRemindMessage(orgId);
  const cancel = useCancelMessageReminder(orgId);

  const initialCustom = useMemo(
    () => customOf(existing ? new Date(existing.remindAt) : presetAt("tomorrow9", new Date())),
    [existing],
  );
  const [when, setWhen] = useState<When>(existing ? "custom" : "in1h");
  const [customDay, setCustomDay] = useState(initialCustom.day);
  const [customTime, setCustomTime] = useState(initialCustom.time);
  const [note, setNote] = useState(existing?.note ?? "");

  const target = useMemo(() => {
    if (when === "custom") return at(customDay, customTime);
    return presetAt(when, new Date());
  }, [when, customDay, customTime]);
  // The server wants ~30 s of lead; refuse earlier picks here too.
  const valid = !Number.isNaN(target.getTime()) && target.getTime() > Date.now() + 31_000;

  const submit = () => {
    if (!valid || remind.isPending) return;
    remind.mutate(
      {
        channelId,
        messageId: message.id,
        remindAt: target.toISOString(),
        note: note.trim() || null,
      },
      {
        onSuccess: () => {
          toast.show(t("remind.scheduledFor", { when: upcomingAt(t, i18n.language, target.toISOString()) }));
          onClose();
        },
      },
    );
  };

  const cancelExisting = () => {
    if (!existing || cancel.isPending) return;
    cancel.mutate(existing.id, { onSuccess: onClose });
  };

  const dateLabels = {
    previousMonth: t("common.previousMonth"),
    nextMonth: t("common.nextMonth"),
    choose: t("common.chooseDate"),
  };

  const options = [...PRESET_KEYS, "custom" as const].map((key) => ({
    value: key,
    title: t(`remind.${key}`),
    side: key === "custom" ? undefined : upcomingAt(t, i18n.language, presetAt(key, new Date()).toISOString()),
    children:
      key === "custom" ? (
        <div className="remind__custom">
          <Field label={t("remind.date")} id="remind-date">
            <DatePicker
              value={customDay}
              onChange={setCustomDay}
              locale={i18n.language}
              labels={dateLabels}
              min={customOf(new Date()).day}
            />
          </Field>
          <Field label={t("remind.time")} id="remind-time">
            <TimeSelect value={customTime} onChange={setCustomTime} />
          </Field>
        </div>
      ) : undefined,
  }));

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t("remind.title")}
      closeLabel={t("common.close")}
      width={480}
    >
      <DialogBody>
        <OptionList
          value={when}
          onValueChange={(v) => setWhen(v as When)}
          options={options}
          aria-label={t("remind.when")}
          attached
        />
        <Field label={t("remind.note")} id="remind-note" className="remind__note">
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t("remind.notePlaceholder")}
            rows={2}
            maxLength={500}
          />
        </Field>
      </DialogBody>
      <DialogFooter bar note={existing ? upcomingAt(t, i18n.language, existing.remindAt) : undefined}>
        {existing && (
          <Button variant="danger" onClick={cancelExisting} loading={cancel.isPending}>
            {t("remind.cancel")}
          </Button>
        )}
        <Button variant="primary" onClick={submit} disabled={!valid} loading={remind.isPending}>
          {t("remind.submit")}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
