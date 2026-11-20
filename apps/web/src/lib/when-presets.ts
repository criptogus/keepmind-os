import { toYmd } from "@keepmind/client/lib/format";

const pad = (n: number) => String(n).padStart(2, "0");
export const hm = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

export type When = "in1h" | "tonight" | "tomorrow9" | "nextMonday" | "custom";

export const PRESET_KEYS = ["in1h", "tonight", "tomorrow9", "nextMonday"] as const;

/** `YYYY-MM-DD` + `HH:MM` as a local Date. */
export const at = (ymd: string, time: string) => {
  const [y, m, d] = ymd.split("-").map(Number);
  const [h, mi] = time.split(":").map(Number);
  return new Date(y ?? 2000, (m ?? 1) - 1, d ?? 1, h ?? 0, mi ?? 0);
};

/** The instant each preset lands on (local time), recomputed while a dialog is open. */
export function presetAt(when: Exclude<When, "custom">, now: Date): Date {
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

/** The `{day, time}` a custom picker starts from for `date` (a preset, an existing row, or now+1h). */
export const customOf = (date: Date) => ({ day: toYmd(date), time: hm(date) });
