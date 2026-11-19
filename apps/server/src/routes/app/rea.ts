import { createRoute, z } from "@hono/zod-openapi";
import { connectRea, disconnectRea, reaStatus, requirePermission } from "@keepmind/engine";
import { apiError } from "../../http/errors";
import { customConnectorDeps } from "./connectors-custom";
import { type AppDeps, createAppRouter, errors, json, OrgParams, requireSession, security } from "./context";

const tags = ["Connectors"];

const Status = z
  .object({
    status: z.enum(["running", "off"]),
    lastError: z.string().nullable(),
  })
  .openapi("ReaStatus");

const View = z.object({ rea: Status.nullable() });

/**
 * The REA connector's own surface: sidecar status plus connect/disconnect.
 * The `rea-agents` MCP server is an implementation detail; these routes are
 * the only way the apps drive it.
 */
export function reaRoutes(deps: AppDeps) {
  const { db } = deps;
  const app = createAppRouter(deps);
  app.use("/organizations/*", requireSession(deps.auth));
  const rea = () => deps.extras?.rea ?? null;

  app.openapi(
    createRoute({
      method: "get",
      path: "/organizations/{orgId}/rea",
      tags,
      security,
      summary: "REA sidecar status",
      request: { params: OrgParams },
      responses: { 200: json(View), ...errors },
    }),
    async (c) => {
      const orgId = c.req.valid("param").orgId;
      await requirePermission(db, c.get("user").id, orgId, "manage_connectors");
      const r = rea();
      if (!r) return c.json({ rea: null }, 200);
      return c.json({ rea: await reaStatus(r, orgId) }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/organizations/{orgId}/rea/connect",
      tags,
      security,
      summary: "Start (or resume) the org's REA sidecar and register its connector",
      request: { params: OrgParams },
      responses: { 200: json(View), ...errors },
    }),
    async (c) => {
      const orgId = c.req.valid("param").orgId;
      const userId = c.get("user").id;
      await requirePermission(db, userId, orgId, "manage_connectors");
      const r = rea();
      if (!r) return apiError(c, 404, "not_found", "REA is not configured on this server");
      await connectRea({ ...customConnectorDeps(deps), rea: r }, userId, orgId);
      return c.json({ rea: await reaStatus(r, orgId) }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/organizations/{orgId}/rea/disconnect",
      tags,
      security,
      summary: "Disconnect REA: stops the sidecar and revokes the connection",
      request: { params: OrgParams },
      responses: { 200: json(View), ...errors },
    }),
    async (c) => {
      const orgId = c.req.valid("param").orgId;
      const userId = c.get("user").id;
      await requirePermission(db, userId, orgId, "manage_connectors");
      const r = rea();
      if (!r) return apiError(c, 404, "not_found", "REA is not configured on this server");
      await disconnectRea({ ...customConnectorDeps(deps), rea: r }, userId, orgId);
      return c.json({ rea: await reaStatus(r, orgId) }, 200);
    },
  );

  return app;
}
