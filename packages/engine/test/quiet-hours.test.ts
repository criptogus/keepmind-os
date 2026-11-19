import { afterEach, describe, expect, test } from "bun:test";
import { eq, schema } from "@keepmind/db";
import { createRoutine, fireDueRoutines, updateOrgSettings, ValidationError } from "../src";
import { inQuietHours, quietHoursEnd, quietHoursOf } from "../src/quiet-hours";
import { type Fixture, setup } from "./fixtures";

let f: Fixture;
afterEach(async () => {
  const current = f;
  f = undefined as unknown as Fixture;
  await current?.close();
});

const deps = () => ({ db: f.db, pubsub: f.pubsub, context: f.context });
const q = { start: "22:00", end: "07:00" };

describe("quiet hours", () => {
  test("the stored value parses; malformed or equal bounds are no window", () => {
    expect(quietHoursOf(null)).toBeNull();
    expect(quietHoursOf({})).toBeNull();
    expect(quietHoursOf({ start: "22:00", end: "22:00" })).toBeNull();
    expect(quietHoursOf({ start: "9pm", end: "07:00" })).toBeNull();
    expect(quietHoursOf(q)).toEqual(q);
  });

  test("inside the window on the zone's wall clock; overnight wraps; the end is the next local end", () => {
    const at = (iso: string) => new Date(iso);
    // UTC window 22:00–07:00.
    expect(inQuietHours(at("2026-11-09T23:00:00Z"), "UTC", q)).toBe(true);
    expect(inQuietHours(at("2026-11-09T06:59:00Z"), "UTC", q)).toBe(true);
    expect(inQuietHours(at("2026-11-09T07:00:00Z"), "UTC", q)).toBe(false);
    expect(inQuietHours(at("2026-11-09T12:00:00Z"), "UTC", q)).toBe(false);
    // Same instant, another zone: 23:00 in São Paulo (02:00 UTC next day) is quiet too, 12:00 there isn't.
    expect(inQuietHours(at("2026-11-10T02:00:00Z"), "America/Sao_Paulo", q)).toBe(true);
    expect(inQuietHours(at("2026-11-10T15:00:00Z"), "America/Sao_Paulo", q)).toBe(false);
    // The end after a slot inside: 06:30 → 07:00 same day; 23:30 → next day 07:00.
    expect(quietHoursEnd(at("2026-11-09T06:30:00Z"), "UTC", q)?.toISOString()).toBe("2026-11-09T07:00:00.000Z");
    expect(quietHoursEnd(at("2026-11-09T23:30:00Z"), "UTC", q)?.toISOString()).toBe("2026-11-10T07:00:00.000Z");
  });

  test("a same-day window ends the same day", () => {
    const day = { start: "12:00", end: "14:00" };
    expect(inQuietHours(new Date("2026-11-09T13:00:00Z"), "UTC", day)).toBe(true);
    expect(inQuietHours(new Date("2026-11-09T15:00:00Z"), "UTC", day)).toBe(false);
    expect(quietHoursEnd(new Date("2026-11-09T13:00:00Z"), "UTC", day)?.toISOString()).toBe("2026-11-09T14:00:00.000Z");
  });
});

describe("routines and quiet hours", () => {
  test("settings refuse a malformed window and a routine's next slot moves to the window's end", async () => {
    f = await setup({ reply: () => ({ chunks: ["ok"] }) });
    await expect(
      updateOrgSettings(f.db, f.owner.id, f.org.id, {
        quietHours: { start: "25:00", end: "07:00" },
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    await updateOrgSettings(f.db, f.owner.id, f.org.id, { quietHours: q });

    const routine = await createRoutine(deps(), f.owner.id, f.org.id, {
      agentId: f.agent.id,
      prompt: "Bom dia.",
      target: { type: "dm" },
      trigger: { type: "schedule", rule: { freq: "daily", times: ["06:30"], timezone: "UTC" } },
    });
    // 06:30 is inside 22:00–07:00: the stored slot is the window's end, not the cron's.
    expect(routine.nextRunAt?.endsWith("T07:00:00.000Z")).toBe(true);

    // A slot that was already stored inside the window (written before it was set) waits for its end too.
    await f.db
      .update(schema.routines)
      .set({ nextRunAt: new Date("2026-12-01T06:30:00.000Z") })
      .where(eq(schema.routines.id, routine.id));
    expect(await fireDueRoutines(deps(), new Date("2026-12-01T06:35:00.000Z"))).toBe(0);
    const [held] = await f.db.select().from(schema.routines).where(eq(schema.routines.id, routine.id));
    expect(held?.nextRunAt?.toISOString()).toBe("2026-12-01T07:00:00.000Z");
    expect(await f.db.select().from(schema.routineRuns)).toHaveLength(0);

    // At the end it fires once, and the next slot is the next day's end.
    expect(await fireDueRoutines(deps(), new Date("2026-12-01T07:01:30.000Z"))).toBe(1);
    const runs = await f.db.select().from(schema.routineRuns);
    expect(runs.map((r) => r.at.toISOString())).toEqual(["2026-12-01T07:00:00.000Z"]);
    const [after] = await f.db.select().from(schema.routines).where(eq(schema.routines.id, routine.id));
    expect(after?.nextRunAt?.toISOString()).toBe("2026-12-02T07:00:00.000Z");
  });

  test("a routine outside the window and a one-off are untouched", async () => {
    f = await setup({ reply: () => ({ chunks: ["ok"] }) });
    await updateOrgSettings(f.db, f.owner.id, f.org.id, { quietHours: q });
    const routine = await createRoutine(deps(), f.owner.id, f.org.id, {
      agentId: f.agent.id,
      prompt: "Bom dia.",
      target: { type: "dm" },
      trigger: { type: "schedule", rule: { freq: "daily", times: ["12:00"], timezone: "UTC" } },
    });
    expect(routine.nextRunAt?.endsWith("T12:00:00.000Z")).toBe(true);
  });
});
