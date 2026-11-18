import { createRoute, z } from "@hono/zod-openapi";
import {
  ensureWhatsAppBridge,
  requirePermission,
  setWhatsAppAnswerAgent,
  stopWhatsAppBridge,
  whatsappSessionView,
} from "@keepmind/engine";
import { type AppDeps, body, createAppRouter, errors, json, OrgParams, requireSession, security } from "./context";

const tags = ["Connectors"];

const Session = z
  .object({
    status: z.enum(["pairing", "connected", "needs_reconnect", "off"]),
    phone: z.string().nullable(),
    lastError: z.string().nullable(),
    /** The live pairing QR while `status` is `pairing`; the apps render it. */
    qr: z.string().nullable(),
    /** The agent that answers inbound WhatsApp messages; null = the workspace right hand. */
    answerAgentId: z.uuid().nullable(),
  })
  .openapi("WhatsAppSession");

const View = z.object({ session: Session.nullable() });

/**
 * The WhatsApp connector's own surface: pairing status (with the live QR),
 * connect/disconnect and which agent answers. The bridge itself is an
 * implementation detail; these routes are the only way the apps drive it.
 */
export function whatsappRoutes(deps: AppDeps) {
  const { db } = deps;
  const app = createAppRouter(deps);
  app.use("/organizations/*", requireSession(deps.auth));
  const whatsapp = () => {
    const w = deps.extras?.whatsapp;
    if (!w) throw new Error("whatsapp is not configured on this server");
    return w;
  };

  app.openapi(
    createRoute({
      method: "get",
      path: "/organizations/{orgId}/whatsapp",
      tags,
      security,
      summary: "WhatsApp pairing status, the live QR and the answering agent",
      request: { params: OrgParams },
      responses: { 200: json(View), ...errors },
    }),
    async (c) => {
      const orgId = c.req.valid("param").orgId;
      await requirePermission(db, c.get("user").id, orgId, "manage_connectors");
      const w = deps.extras?.whatsapp;
      if (!w) return c.json({ session: null }, 200);
      const session = await whatsappSessionView(w, orgId);
      return c.json({ session }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/organizations/{orgId}/whatsapp/connect",
      tags,
      security,
      summary: "Start (or resume) the WhatsApp bridge; the QR arrives on the session",
      request: { params: OrgParams },
      responses: { 200: json(View), ...errors },
    }),
    async (c) => {
      const orgId = c.req.valid("param").orgId;
      await requirePermission(db, c.get("user").id, orgId, "manage_connectors");
      await ensureWhatsAppBridge(whatsapp(), orgId);
      const session = await whatsappSessionView(whatsapp(), orgId);
      return c.json({ session }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/organizations/{orgId}/whatsapp/disconnect",
      tags,
      security,
      summary: "Disconnect WhatsApp: stops the bridge and unlinks the session",
      request: { params: OrgParams },
      responses: { 200: json(View), ...errors },
    }),
    async (c) => {
      const orgId = c.req.valid("param").orgId;
      await requirePermission(db, c.get("user").id, orgId, "manage_connectors");
      await stopWhatsAppBridge(whatsapp(), orgId);
      return c.json({ session: await whatsappSessionView(whatsapp(), orgId) }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "put",
      path: "/organizations/{orgId}/whatsapp/answer-agent",
      tags,
      security,
      summary: "Choose which agent answers inbound WhatsApp messages (null: the right hand)",
      request: {
        params: OrgParams,
        body: body(z.object({ agentId: z.uuid().nullable() })),
      },
      responses: { 200: json(View), ...errors },
    }),
    async (c) => {
      const orgId = c.req.valid("param").orgId;
      await requirePermission(db, c.get("user").id, orgId, "manage_connectors");
      const { agentId } = c.req.valid("json");
      await setWhatsAppAnswerAgent(db, orgId, agentId);
      return c.json({ session: await whatsappSessionView(whatsapp(), orgId) }, 200);
    },
  );

  return app;
}
