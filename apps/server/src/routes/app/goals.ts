import { createRoute, z } from "@hono/zod-openapi";
import {
  createGoal,
  GOAL_PERIODS,
  GOAL_STATUSES,
  getGoal,
  listGoals,
  NotFoundError,
  requireActiveMembership,
  requireGoalWriter,
  updateGoal,
} from "@keepmind/engine";
import { type AppDeps, body, createAppRouter, errors, json, OrgParams, requireSession, security } from "./context";

const tags = ["Goals"];

const Goal = z.object({
  id: z.uuid(),
  orgId: z.uuid(),
  title: z.string(),
  metric: z.string(),
  target: z.number().nullable(),
  current: z.number(),
  unit: z.string(),
  period: z.string(),
  ownerAgentId: z.uuid().nullable(),
  status: z.string(),
  progressNote: z.string(),
  createdByUserId: z.string().nullable(),
  createdByAgentId: z.uuid().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  owner: z.object({ id: z.uuid(), handle: z.string(), name: z.string() }).nullable(),
});

const GoalParams = OrgParams.extend({ goalId: z.uuid() });
const Period = z.enum(GOAL_PERIODS);
const Status = z.enum(GOAL_STATUSES);

const Write = z.object({
  title: z.string().min(1).max(300),
  metric: z.string().max(500).optional(),
  target: z.number().min(0).nullable().optional(),
  current: z.number().min(0).optional(),
  unit: z.string().max(40).optional(),
  period: Period.optional(),
  ownerAgentId: z.uuid().nullable().optional(),
  status: Status.optional(),
  progressNote: z.string().max(500).optional(),
});

/** Workspace goals (OKRs): the leadership proposes, people activate and track them. */
export function goalRoutes(deps: AppDeps) {
  const { db } = deps;
  const app = createAppRouter(deps);
  app.use("/organizations/*", requireSession(deps.auth));

  app.openapi(
    createRoute({
      method: "get",
      path: "/organizations/{orgId}/goals",
      tags,
      security,
      summary: "List goals",
      request: {
        params: OrgParams,
        query: z.object({ status: Status.optional() }),
      },
      responses: { 200: json(z.object({ goals: z.array(Goal) })), ...errors },
    }),
    async (c) => {
      const { orgId } = c.req.valid("param");
      const { status } = c.req.valid("query");
      await requireActiveMembership(db, c.get("user").id, orgId);
      return c.json({ goals: await listGoals(db, orgId, status) }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/organizations/{orgId}/goals",
      tags,
      security,
      summary: "Create a goal (a person sets it active)",
      request: { params: OrgParams, body: body(Write) },
      responses: { 201: json(Goal), ...errors },
    }),
    async (c) => {
      const { orgId } = c.req.valid("param");
      const userId = c.get("user").id;
      await requireGoalWriter(db, userId, orgId);
      const goal = await createGoal(db, { ...c.req.valid("json"), orgId, createdByUserId: userId });
      const view = await getGoal(db, orgId, goal.id);
      if (!view) throw new NotFoundError("Goal not found");
      return c.json(view, 201);
    },
  );

  app.openapi(
    createRoute({
      method: "patch",
      path: "/organizations/{orgId}/goals/{goalId}",
      tags,
      security,
      summary: "Update a goal (activate a proposal, move its current, change its state)",
      request: {
        params: GoalParams,
        body: body(Write.partial().extend({ title: Write.shape.title.optional() })),
      },
      responses: { 200: json(Goal), ...errors },
    }),
    async (c) => {
      const { orgId, goalId } = c.req.valid("param");
      const userId = c.get("user").id;
      await requireGoalWriter(db, userId, orgId);
      const goal = await updateGoal(db, orgId, goalId, c.req.valid("json"), { userId });
      if (!goal) throw new NotFoundError("Goal not found");
      const view = await getGoal(db, orgId, goalId);
      if (!view) throw new NotFoundError("Goal not found");
      return c.json(view, 200);
    },
  );

  return app;
}
