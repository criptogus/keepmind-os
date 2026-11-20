import {
  type Message,
  type MessageReminder,
  useCancelMessageReminder,
  useMessageReminders,
  useRemindMessage,
} from "@keepmind/client";
import { textOrMedia } from "@keepmind/client/lib/media";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { StyleSheet, View } from "react-native";
import { Button, Card, Filters, Icon, IconButton, type IconName, Locked, Text, useToast } from "@/ui";
import { Face } from "../shared/Face";
import { useColors, useOrgId, useWhen } from "../shared/hooks";
import { previewOf } from "../shared/logic";
import { SheetTitle } from "../shared/PromptForm";
import { ActionList, successHaptic, Tile, useSurface } from "../shared/parts";
import { useSheet } from "../shared/SheetHost";
import { TextArea } from "../shared/TextArea";
import {
  atDayTime,
  type ClockTime,
  checkWhen,
  dayChoices,
  dayOffsetOf,
  defaultCustom,
  MINUTE_STEP,
  type ReminderPreset,
  reminderPresets,
  stepTime,
} from "./logic";
import { useWhenLabel } from "./RemindSheet";

const PRESET_ICON: Record<ReminderPreset, IconName> = { inHour: "clock", tonight: "moon", tomorrowMorning: "sun" };

/**
 * "Lembrar depois" on a message (Slack's remind me, the web dialog's twin): a private notification at the picked
 * time that opens the message — not a message an agent posts in the chat (that's `RemindSheet`, the composer's).
 * One per person per message: picking again moves the time, and a set one can be cancelled here.
 */
export function MessageRemindSheet({ channelId, message }: { channelId: string; message: Message }) {
  const { t } = useTranslation();
  const orgId = useOrgId();
  const c = useColors();
  const toast = useToast();
  const sheet = useSheet();
  const surface = useSurface();
  const whenLabel = useWhenLabel();
  const { locale } = useWhen();
  const remind = useRemindMessage(orgId);
  const cancel = useCancelMessageReminder(orgId);
  const reminders = useMessageReminders(orgId);
  const existing =
    reminders.data?.find((r: MessageReminder) => r.messageId === message.id && r.doneAt === null) ?? null;

  const [note, setNote] = useState(existing?.note ?? "");
  const [custom, setCustom] = useState<{ dayOffset: number; time: ClockTime } | null>(() => {
    if (!existing) return null;
    const d = new Date(existing.remindAt);
    const days = dayChoices(new Date(), 7);
    const offset = days.findIndex((day) => dayOffsetOf(d, day) === 0);
    return offset >= 0
      ? {
          dayOffset: offset,
          time: { hour: d.getHours(), minute: Math.floor(d.getMinutes() / MINUTE_STEP) * MINUTE_STEP },
        }
      : defaultCustom(new Date());
  });
  const now = useMemo(() => new Date(), []);
  const presets = useMemo(() => reminderPresets(now), [now]);
  const days = useMemo(() => dayChoices(now, 7), [now]);
  const busy = remind.isPending || cancel.isPending;

  const submit = (at: Date) => {
    if (busy) return;
    const check = checkWhen(at, new Date());
    if (check !== "ok") {
      toast({ title: t(`mobile.remind.error.${check}`), icon: "x" });
      return;
    }
    remind.mutate(
      { channelId, messageId: message.id, remindAt: at.toISOString(), note: note.trim() || null },
      {
        onSuccess: () => {
          sheet.close();
          successHaptic();
          toast({ title: t("mobile.remind.done"), subtitle: whenLabel(at), icon: "clock" });
        },
        onError: () => toast({ title: t("mobile.remind.error.failed"), icon: "x" }),
      },
    );
  };

  const cancelExisting = () => {
    if (!existing || busy) return;
    cancel.mutate(existing.id, {
      onSuccess: () => {
        sheet.close();
        toast({ title: t("mobile.remind.cancelled"), icon: "clock" });
      },
      onError: () => toast({ title: t("mobile.remind.error.failed"), icon: "x" }),
    });
  };

  const customAt = custom ? atDayTime(days[custom.dayOffset] ?? now, custom.time) : null;
  const customCheck = customAt ? checkWhen(customAt, new Date()) : "ok";
  const moveTime = (minutes: number) => setCustom((cur) => (cur ? { ...cur, time: stepTime(cur.time, minutes) } : cur));

  return (
    <>
      <SheetTitle
        leading={<Tile icon="clock" />}
        title={t("mobile.remind.title")}
        subtitle={existing ? whenLabel(new Date(existing.remindAt), now) : t("mobile.remind.subPrivate")}
      />
      <View style={[styles.preview, surface]}>
        <Face who={message.author} size={24} live={false} />
        <Text variant="small" tone="ink2" numberOfLines={3} style={styles.grow}>
          {previewOf(textOrMedia(t, message.body, message.meta)) || t("mobile.chat.approvalPreview")}
        </Text>
      </View>
      {custom === null ? (
        <ActionList
          items={[
            ...presets.map(({ preset, at }) => ({
              key: preset,
              icon: PRESET_ICON[preset],
              label: t(`mobile.remind.preset.${preset}`),
              hint: whenLabel(at, now),
              disabled: busy,
              onPress: () => submit(at),
            })),
            {
              key: "custom",
              icon: "pen" as const,
              label: t("mobile.remind.custom"),
              trailing: <Icon name="right" size={18} color={c.faint} />,
              disabled: busy,
              onPress: () => setCustom(defaultCustom(now)),
            },
          ]}
        />
      ) : (
        <>
          <Locked when={busy} style={styles.custom}>
            <Filters
              items={days.map((d, i) => ({
                key: String(i),
                label:
                  i === 0
                    ? t("mobile.time.today")
                    : i === 1
                      ? t("mobile.remind.tomorrow")
                      : new Intl.DateTimeFormat(locale, { weekday: "short", day: "numeric" })
                          .format(d)
                          .replace(".", ""),
              }))}
              value={String(custom.dayOffset)}
              onChange={(key) => setCustom((cur) => (cur ? { ...cur, dayOffset: Number(key) } : cur))}
            />
            <Card>
              <View style={styles.clock}>
                <Stepper
                  value={String(custom.time.hour).padStart(2, "0")}
                  label={t("mobile.remind.hour")}
                  lessLabel={t("mobile.remind.hourLess")}
                  moreLabel={t("mobile.remind.hourMore")}
                  onLess={() => moveTime(-60)}
                  onMore={() => moveTime(60)}
                />
                <Text variant="display" tone="faint">
                  :
                </Text>
                <Stepper
                  value={String(custom.time.minute).padStart(2, "0")}
                  label={t("mobile.remind.minute")}
                  lessLabel={t("mobile.remind.minuteLess", { n: MINUTE_STEP })}
                  moreLabel={t("mobile.remind.minuteMore", { n: MINUTE_STEP })}
                  onLess={() => moveTime(-MINUTE_STEP)}
                  onMore={() => moveTime(MINUTE_STEP)}
                />
              </View>
            </Card>
          </Locked>
          <Text variant="small" tone={customCheck === "ok" ? "muted" : "danger"} style={styles.center}>
            {customAt
              ? customCheck === "ok"
                ? whenLabel(customAt, now)
                : t(`mobile.remind.error.${customCheck}`)
              : ""}
          </Text>
          <Button
            variant="primary"
            wide
            icon="clock"
            label={t("mobile.remind.submit")}
            loading={remind.isPending}
            disabled={busy || !customAt || customCheck !== "ok"}
            onPress={() => {
              if (customAt) submit(customAt);
            }}
          />
          <Button
            variant="ghost"
            wide
            label={t("mobile.remind.quick")}
            disabled={busy}
            onPress={() => setCustom(null)}
          />
        </>
      )}
      <Locked when={busy}>
        <TextArea
          value={note}
          onChangeText={setNote}
          placeholder={t("mobile.remind.notePlaceholder")}
          accessibilityLabel={t("mobile.remind.note")}
          minHeight={48}
        />
      </Locked>
      {existing ? (
        <Button variant="ghost" wide label={t("mobile.remind.cancel")} disabled={busy} onPress={cancelExisting} />
      ) : null}
    </>
  );
}

/** "‹ 14 ›": a number with a step down and up (our buttons, no native picker). */
function Stepper({
  value,
  label,
  lessLabel,
  moreLabel,
  onLess,
  onMore,
}: {
  value: string;
  label: string;
  lessLabel: string;
  moreLabel: string;
  onLess: () => void;
  onMore: () => void;
}) {
  return (
    <View style={styles.stepper}>
      <IconButton icon="back" label={lessLabel} onPress={onLess} />
      <Text
        variant="display"
        style={styles.digits}
        accessibilityLabel={`${label} ${value}`}
        accessibilityLiveRegion="polite"
      >
        {value}
      </Text>
      <IconButton icon="right" label={moreLabel} onPress={onMore} />
    </View>
  );
}

const styles = StyleSheet.create({
  custom: { gap: 12, marginBottom: 8 },
  grow: { flex: 1 },
  center: { textAlign: "center", marginBottom: 8 },
  preview: { flexDirection: "row", gap: 10, padding: 12, borderRadius: 18, marginBottom: 12 },
  clock: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4, paddingVertical: 12 },
  stepper: { flexDirection: "row", alignItems: "center", gap: 2 },
  digits: { minWidth: 48, textAlign: "center", fontVariant: ["tabular-nums"] },
});
