import type { schema } from "@keepmind/db";

type PluginRecord = schema.PluginRecord;

const fold = (v: unknown) =>
  String(v ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
function day(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : null;
}
/** Deterministic CRM triage, not inferred promises or automatic external outreach. */
export function reviewRecords(records: PluginRecord[], now: Date) {
  const today = now.toISOString().slice(0, 10);
  const duplicates = new Map<string, string[]>();
  for (const record of records) {
    const key = fold(record.values.email) || [fold(record.values.nome), fold(record.values.empresa)].join("|");
    if (key !== "|") duplicates.set(key, [...(duplicates.get(key) || []), record.id]);
  }
  const items = records
    .map((record) => {
      const values = record.values;
      const date = day(values.proximo_contato);
      const closed = ["ganho", "perdido", "concluido", "won", "lost", "closed"].includes(fold(values.etapa));
      const reasons: string[] = [];
      let priority = 0;
      if (!closed && date && date < today) {
        reasons.push("overdue");
        priority += 100;
      } else if (!closed && date === today) {
        reasons.push("due_today");
        priority += 80;
      }
      if (!closed && !date) {
        reasons.push(values.proximo_contato ? "invalid_next_contact" : "missing_next_contact");
        priority += 40;
      }
      if (!fold(values.fonte)) {
        reasons.push("missing_source");
        priority += 5;
      }
      const key = fold(values.email) || [fold(values.nome), fold(values.empresa)].join("|");
      const possibleDuplicates = (duplicates.get(key) || []).filter((id) => id !== record.id);
      if (possibleDuplicates.length) {
        reasons.push("possible_duplicate");
        priority += 10;
      }
      return {
        id: record.id,
        name: String(values.nome || record.id),
        revision: record.revision,
        priority,
        reasons,
        nextContact: date,
        possibleDuplicates,
      };
    })
    .filter((item) => item.reasons.length)
    .sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
  return {
    asOf: now.toISOString(),
    timezone: "UTC",
    totalRecords: records.length,
    attentionCount: items.length,
    items,
    instruction:
      "Resolve internal data gaps only from evidence. Do not invent dates or sources. Do not merge duplicates or send messages automatically. Use existing authorized routines for periodic review; this tool does not schedule work.",
  };
}
