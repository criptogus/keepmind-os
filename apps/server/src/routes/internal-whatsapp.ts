import type { OpenAPIHono } from "@hono/zod-openapi";
import { type BridgeEvent, recordWhatsAppEvent, whatsappTokenMatches } from "@keepmind/engine";
import { apiError } from "../http/errors";
import type { AppDeps } from "./app/context";

const MAX_EVENT_BYTES = 64 * 1024;

function bearer(header: string | undefined): string | null {
  const match = /^Bearer\s+(.+)$/i.exec(header ?? "");
  return match?.[1]?.trim() || null;
}

const EVENT_TYPES = new Set(["qr", "connecting", "connected", "disconnected", "logged_out", "message"]);

function isBridgeEvent(body: unknown): body is BridgeEvent {
  if (typeof body !== "object" || body === null) return false;
  const type = (body as { type?: unknown }).type;
  return typeof type === "string" && EVENT_TYPES.has(type);
}

/**
 * The whatsapp-bridge's only door into the engine: session events and inbound
 * messages. Bearer = the per-org spawn token (sealed in `whatsapp_sessions`),
 * compared in constant time. No session cookie, no CSRF — the token is the
 * credential, and it only ever reaches the bridge's own process.
 */
export function registerWhatsAppInternal(api: OpenAPIHono, deps: AppDeps) {
  api.post("/internal/whatsapp/:orgId/event", async (c) => {
    const whatsapp = deps.extras?.whatsapp;
    if (!whatsapp) return apiError(c, 404, "not_found", "WhatsApp is not configured on this server");
    const orgId = c.req.param("orgId");
    const presented = bearer(c.req.header("authorization"));
    if (!presented || !(await whatsappTokenMatches(whatsapp, orgId, presented))) {
      return apiError(c, 401, "unauthorized", "Invalid bridge token");
    }
    const raw = await c.req.text();
    if (raw.length > MAX_EVENT_BYTES) return apiError(c, 413, "too_large", "Event too large");
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      return apiError(c, 400, "invalid_json", "Invalid JSON");
    }
    if (!isBridgeEvent(body)) return apiError(c, 400, "invalid_event", "Unknown event");
    try {
      await recordWhatsAppEvent(whatsapp, orgId, body);
    } catch (error) {
      deps.log?.warn("whatsapp event failed", { orgId, type: body.type, error: String(error) });
      return apiError(c, 500, "event_failed", "Could not record the event");
    }
    return c.json({ ok: true as const });
  });
}
