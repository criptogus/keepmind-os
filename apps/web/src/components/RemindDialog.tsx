import type { Message, MessageReminder } from "@keepmind/client";
import { useCancelMessageReminder, useRemindMessage } from "@keepmind/client";
import { toYmd, upcomingAt } from "@keepmind/client/lib/format";
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

const pad = (n: number) => String(n).padStart(2, "0");
const hm = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const at = (ymd: string, time: string) => {
  const [y, m, d] = ymd.split("-").map(Number);
  const [h, mi] = time.split(":").map(Number);
  return new Date(y ?? 2000, (m ?? 1) - 1, d ?? 1, h ?? 0, mi ?? 0);
};

type When = "in1h" | "tonight" | "tomorrow9" | "nextMonday" | "custom";

/** The instant each preset lands on (local time), recomputed while the dialog is open. */
function presetAt(when: Exclude<When, "custom">, now: Date): Date {
  const day = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const tomorrow = new Date(day.getTime() + 86_400_000);
  switch (when) {
    case "in1h":
      return new Date(now.getTime() + 3_600_000);
    case "tonight": {
      const evening = new Date(day.getTime());
      evening.setHours(18, 0, 0, 0);
      return evening.getTime() > now.getTime() ? evening : new Date(tomorrow.getTime() + 18 * 3_600_000);
    }
    case "tomorrow9": {
      const d = new Date(tomorrow.getTime());
      d.setHours(9, 0, 0, 0);
      return d;
    }
    case "nextMonday": {
      // The Monday of next week at 9: getDay(): Sunday 0 … Monday 1 … Saturday 6.
      const dow = day.getDay();
      const ahead = dow === 1 ? 7 : (8 - dow) % 7 || 7;
      const d = new Date(day.getTime() + ahead * 86_400_000);
      d.setHours(9, 0, 0, 0);
      return d;
    }
  }
}

/**
 * "Lembrar depois" on a message (Slack's remind me): quick presets or a picked
 * date and time, an optional note. Re-reminding the same message moves its
 * time (`useRemindMessage` upserts); an existing reminder can be cancelled here.
 */
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

  const initialCustom = useMemo(() => {
    const d = existing ? new Date(existing.remindAt) : presetAt("tomorrow9", new Date());
    return { day: toYmd(d), time: hm(d) };
  }, [existing]);
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

  const options = (["in1h", "tonight", "tomorrow9", "nextMonday", "custom"] as const).map((key) => ({
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
              min={toYmd(new Date())}
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
