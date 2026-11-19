import { createRoute, z } from "@hono/zod-openapi";
import {
  connectWhatsApp,
  disconnectWhatsApp,
  listWhatsAppChats,
  requirePermission,
  setWhatsAppAnswerAgent,
  setWhatsAppChatApproval,
  whatsappSessionView,
} from "@keepmind/engine";
import { apiError } from "../../http/errors";
import { customConnectorDeps } from "./connectors-custom";
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

const Chat = z
  .object({
    chatId: z.string(),
    participantName: z.string().nullable(),
    threadRootId: z.uuid(),
    /** When a `manage_connectors` admin let the answer agent reply here; null = mirrored but silent. */
    approvedAt: z.string().nullable(),
    createdAt: z.string(),
  })
  .openapi("WhatsAppChat");

const Chats = z.object({ chats: z.array(Chat) });

/**
 * The WhatsApp connector's own surface: pairing status (with the live QR),
 * connect/disconnect and which agent answers. The bridge itself is an
 * implementation detail; these routes are the only way the apps drive it.
 */
export function whatsappRoutes(deps: AppDeps) {
  const { db } = deps;
  const app = createAppRouter(deps);
  app.use("/organizations/*", requireSession(deps.auth));
  const whatsapp = () => deps.extras?.whatsapp ?? null;

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
      const userId = c.get("user").id;
      await requirePermission(db, userId, orgId, "manage_connectors");
      // Registers the first-party connector row too: its tools become
      // grantable to agents and disconnect revokes them.
      const w = whatsapp();
      if (!w) return apiError(c, 404, "not_found", "WhatsApp is not configured on this server");
      await connectWhatsApp({ ...customConnectorDeps(deps), whatsapp: w }, userId, orgId);
      const session = await whatsappSessionView(w, orgId);
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
      const userId = c.get("user").id;
      await requirePermission(db, userId, orgId, "manage_connectors");
      const w = whatsapp();
      if (!w) return apiError(c, 404, "not_found", "WhatsApp is not configured on this server");
      await disconnectWhatsApp({ ...customConnectorDeps(deps), whatsapp: w }, userId, orgId);
      return c.json({ session: await whatsappSessionView(w, orgId) }, 200);
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
      const w = deps.extras?.whatsapp;
      return c.json({ session: w ? await whatsappSessionView(w, orgId) : null }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/organizations/{orgId}/whatsapp/chats",
      tags,
      security,
      summary: "Mirrored WhatsApp chats and which ones the answer agent may reply in",
      request: { params: OrgParams },
      responses: { 200: json(Chats), ...errors },
    }),
    async (c) => {
      const orgId = c.req.valid("param").orgId;
      await requirePermission(db, c.get("user").id, orgId, "manage_connectors");
      return c.json({ chats: await listWhatsAppChats(db, orgId) }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "put",
      path: "/organizations/{orgId}/whatsapp/chats/{chatId}",
      tags,
      security,
      summary: "Approve or revoke a chat: approved chats get agent replies, others stay mirrored but silent",
      request: {
        params: OrgParams.extend({ chatId: z.string() }),
        body: body(z.object({ approved: z.boolean() })),
      },
      responses: { 200: json(z.object({ chat: Chat.nullable() })), ...errors },
    }),
    async (c) => {
      const { orgId, chatId } = c.req.valid("param");
      await requirePermission(db, c.get("user").id, orgId, "manage_connectors");
      const { approved } = c.req.valid("json");
      const chat = await setWhatsAppChatApproval(db, orgId, chatId, approved);
      if (!chat) return apiError(c, 404, "not_found", "WhatsApp chat not found");
      return c.json({ chat }, 200);
    },
  );

  return app;
}
