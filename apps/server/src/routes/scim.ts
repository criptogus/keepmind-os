import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import type { OpenAPIHono } from "@hono/zod-openapi";
import { and, asc, eq, schema, sql } from "@keepmind/db";
import { enqueueAccountContact, joinOrganization, onUserCreated, setUserBlocked } from "@keepmind/engine";
import type { Context } from "hono";
import { emailDomain, isCompanyEmail, type SsoSettings, ssoSettings } from "../sso";
import type { AppDeps } from "./app/context";

/**
 * SCIM 2.0 (RFC 7643, 7644) for the company's directory: Microsoft Entra ID and Okta make an account here for each of
 * the company's people and turn it off when the person leaves (ADR 0189). Only `Users`, and only the company's
 * addresses (`SSO_DOMAINS`): every other account is invisible here, whatever the directory asks.
 *
 * - Turning a person off (`active: false`, or `DELETE`) blocks the account (`setUserBlocked`): no sign-in, every
 *   session and phone signed out, every membership read as none, open sockets closed. Nothing they made is deleted.
 * - Turning them back on lifts only a block the directory set (`scim:…`), never one the people who run this server
 *   set.
 * - A removed account answers 404, as RFC 7644 asks; making it again brings the same account back.
 * - An account it makes has no password: the person signs in with the company's sign-in (ADR 0188), and joins
 *   `SSO_WORKSPACE_ID` at once.
 */

const USER_SCHEMA = "urn:ietf:params:scim:schemas:core:2.0:User";
const LIST_SCHEMA = "urn:ietf:params:scim:api:messages:2.0:ListResponse";
const ERROR_SCHEMA = "urn:ietf:params:scim:api:messages:2.0:Error";
const PATCH_SCHEMA = "urn:ietf:params:scim:api:messages:2.0:PatchOp";
const SCIM_TYPE = "application/scim+json";

/** Why an account is blocked, when the directory blocked it: turned off, or removed. */
export const SCIM_DEACTIVATED = "scim:deactivated";
export const SCIM_REMOVED = "scim:removed";
const byDirectory = (reason: string | null) => reason?.startsWith("scim:") === true;

/** A list's pages: SCIM counts from 1, and the directory asks for up to this many at once. */
const MAX_PAGE = 200;

type UserRow = typeof schema.users.$inferSelect;

class ScimError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly scimType?: string,
  ) {
    super(message);
  }
}

/** Whether `token` is the one whose SHA-256 the server was given, in constant time. */
export function scimTokenMatches(expectedSha256: string, token: string): boolean {
  const got = createHash("sha256").update(token).digest();
  const want = Buffer.from(expectedSha256, "hex");
  return want.length === got.length && timingSafeEqual(got, want);
}

/** SCIM's booleans arrive as `true` or, from Entra ID, as the strings `"True"` and `"False"`. */
export function scimBool(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "string" && /^(true|false)$/i.test(value)) return value.toLowerCase() === "true";
  return null;
}

/** The name a SCIM user gives: its display name, else its formatted name, else given and family names. */
export function scimName(resource: Record<string, unknown>): string | null {
  const name = (resource.name ?? {}) as Record<string, unknown>;
  const pick = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  const parts = [pick(name.givenName), pick(name.familyName)].filter(Boolean).join(" ");
  return pick(resource.displayName) ?? pick(name.formatted) ?? (parts || null);
}

/**
 * The one filter the directories send: `userName eq "<address>"` (Okta, Entra ID), or the same on `emails.value`.
 * Returns the address, lower case; anything else is refused as `invalidFilter`.
 */
export function scimFilterEmail(filter: string): string {
  const match = /^\s*(userName|emails(?:\.value|\[type eq "work"\]\.value)?)\s+eq\s+"((?:[^"\\]|\\.)*)"\s*$/i.exec(
    filter,
  );
  if (!match) throw new ScimError(400, 'Only userName eq "…" is supported.', "invalidFilter");
  return (match[2] ?? "").replace(/\\(.)/g, "$1").trim().toLowerCase();
}

export function registerScim(api: OpenAPIHono, deps: AppDeps) {
  const expected = deps.config.SCIM_TOKEN_SHA256;
  const sso = ssoSettings(deps.config);
  if (!expected || !sso) return;
  const { db } = deps;
  const base = `${deps.config.PUBLIC_URL.replace(/\/$/, "")}/api/scim/v2`;

  const reply = (c: Context, status: number, body: unknown) =>
    c.body(JSON.stringify(body), status as 200, { "content-type": SCIM_TYPE });
  const fail = (c: Context, error: unknown) => {
    if (!(error instanceof ScimError)) throw error;
    return reply(c, error.status, {
      schemas: [ERROR_SCHEMA],
      status: String(error.status),
      detail: error.message,
      ...(error.scimType ? { scimType: error.scimType } : {}),
    });
  };

  /** An account as the directory sees it. */
  const resource = (user: UserRow) => {
    const [givenName, ...rest] = user.name.split(" ");
    return {
      schemas: [USER_SCHEMA],
      id: user.id,
      userName: user.email,
      name: { formatted: user.name, givenName, ...(rest.length ? { familyName: rest.join(" ") } : {}) },
      displayName: user.name,
      emails: [{ value: user.email, type: "work", primary: true }],
      active: user.blockedAt === null,
      meta: {
        resourceType: "User",
        created: user.createdAt.toISOString(),
        lastModified: user.updatedAt.toISOString(),
        location: `${base}/Users/${user.id}`,
      },
    };
  };

  /** One of the company's accounts the directory may see; a removed one or anyone else's is not found. */
  const companyUser = async (id: string) => {
    const [user] = await db.select().from(schema.users).where(eq(schema.users.id, id));
    if (!user || !isCompanyEmail(sso, user.email) || user.blockedReason === SCIM_REMOVED) {
      throw new ScimError(404, "No such user.");
    }
    return user;
  };

  const reload = async (id: string) => {
    const [user] = await db.select().from(schema.users).where(eq(schema.users.id, id));
    if (!user) throw new ScimError(404, "No such user.");
    return user;
  };

  /** On or off, as the directory says. On lifts only the directory's own block. */
  const setActive = async (user: UserRow, active: boolean, offReason = SCIM_DEACTIVATED) => {
    if (!active) {
      if (user.blockedAt === null || byDirectory(user.blockedReason)) {
        await setUserBlocked({ db, pubsub: deps.adapters.pubsub }, user.id, { blocked: true, reason: offReason });
      }
      return;
    }
    if (user.blockedAt !== null && byDirectory(user.blockedReason)) {
      await setUserBlocked({ db, pubsub: deps.adapters.pubsub }, user.id, { blocked: false, reason: null });
    }
  };

  const rename = async (user: UserRow, name: string | null) => {
    if (!name || name === user.name) return;
    await db.update(schema.users).set({ name, updatedAt: new Date() }).where(eq(schema.users.id, user.id));
  };

  /** The address a directory's change carries must be the account's: the address is how the person signs in. */
  const sameAddress = (user: UserRow, userName: unknown) => {
    if (userName === undefined) return;
    if (typeof userName !== "string" || userName.trim().toLowerCase() !== user.email) {
      throw new ScimError(400, "An account's userName (its email) can't change here.", "mutability");
    }
  };

  const scim = api.basePath("/scim/v2");

  // The bearer token, on every request.
  scim.use("*", async (c, next) => {
    const header = c.req.header("authorization") ?? "";
    const token = /^Bearer\s+(.+)$/i.exec(header)?.[1]?.trim() ?? "";
    if (!token || !scimTokenMatches(expected, token)) {
      return reply(c, 401, { schemas: [ERROR_SCHEMA], status: "401", detail: "A valid bearer token is required." });
    }
    await next();
  });

  scim.get("/ServiceProviderConfig", (c) =>
    reply(c, 200, {
      schemas: ["urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig"],
      patch: { supported: true },
      bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },
      filter: { supported: true, maxResults: MAX_PAGE },
      changePassword: { supported: false },
      sort: { supported: false },
      etag: { supported: false },
      authenticationSchemes: [
        { type: "oauthbearertoken", name: "Bearer token", description: "The token set in SCIM_TOKEN_SHA256." },
      ],
    }),
  );

  scim.get("/ResourceTypes", (c) =>
    reply(c, 200, {
      schemas: [LIST_SCHEMA],
      totalResults: 1,
      Resources: [
        {
          schemas: ["urn:ietf:params:scim:schemas:core:2.0:ResourceType"],
          id: "User",
          name: "User",
          endpoint: "/Users",
          schema: USER_SCHEMA,
        },
      ],
    }),
  );

  scim.get("/Users", async (c) => {
    try {
      const filter = c.req.query("filter");
      const startIndex = Math.max(1, Number.parseInt(c.req.query("startIndex") ?? "1", 10) || 1);
      const count = Math.min(MAX_PAGE, Math.max(0, Number.parseInt(c.req.query("count") ?? "100", 10) || 0));
      if (filter) {
        const email = scimFilterEmail(filter);
        const [user] = isCompanyEmail(sso, email)
          ? await db.select().from(schema.users).where(eq(schema.users.email, email))
          : [];
        const found = user && user.blockedReason !== SCIM_REMOVED ? [user] : [];
        return reply(c, 200, {
          schemas: [LIST_SCHEMA],
          totalResults: found.length,
          startIndex: 1,
          itemsPerPage: found.length,
          Resources: found.map(resource),
        });
      }
      const company = companyAccounts(sso);
      const [{ total } = { total: 0 }] = await db
        .select({ total: sql<number>`count(*)::int` })
        .from(schema.users)
        .where(company);
      const rows = await db
        .select()
        .from(schema.users)
        .where(company)
        .orderBy(asc(schema.users.createdAt), asc(schema.users.id))
        .offset(startIndex - 1)
        .limit(count);
      return reply(c, 200, {
        schemas: [LIST_SCHEMA],
        totalResults: total,
        startIndex,
        itemsPerPage: rows.length,
        Resources: rows.map(resource),
      });
    } catch (error) {
      return fail(c, error);
    }
  });

  scim.get("/Users/:id", async (c) => {
    try {
      return reply(c, 200, resource(await companyUser(c.req.param("id"))));
    } catch (error) {
      return fail(c, error);
    }
  });

  scim.post("/Users", async (c) => {
    try {
      const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
      if (!body) throw new ScimError(400, "The body must be a SCIM User.", "invalidSyntax");
      const email = typeof body.userName === "string" ? body.userName.trim().toLowerCase() : "";
      if (!emailDomain(email)) throw new ScimError(400, "userName must be the person's email.", "invalidValue");
      if (!isCompanyEmail(sso, email)) {
        throw new ScimError(400, "Only the company's email domains (SSO_DOMAINS) can be provisioned.", "invalidValue");
      }
      const active = body.active === undefined ? true : scimBool(body.active);
      if (active === null) throw new ScimError(400, "active must be true or false.", "invalidValue");
      const name = scimName(body) ?? email.split("@")[0] ?? email;

      const [existing] = await db.select().from(schema.users).where(eq(schema.users.email, email));
      if (existing && existing.blockedReason !== SCIM_REMOVED) {
        throw new ScimError(409, "A user with this userName already exists.", "uniqueness");
      }
      if (existing) {
        // Removed before and made again: the same account, back.
        await setUserBlocked({ db, pubsub: deps.adapters.pubsub }, existing.id, { blocked: false, reason: null });
        await rename(await reload(existing.id), name);
        if (!active) await setActive(await reload(existing.id), false);
        return reply(c, 201, resource(await reload(existing.id)));
      }

      const id = randomUUID();
      const now = new Date();
      await db.insert(schema.users).values({ id, name, email, emailVerified: true, createdAt: now, updatedAt: now });
      await onUserCreated(db, id).catch((error) => deps.log?.error("post-signup setup failed", { userId: id, error }));
      await enqueueAccountContact(db, id).catch(() => {});
      await joinCompanyWorkspace(deps, sso, id);
      if (!active) await setActive(await reload(id), false);
      return reply(c, 201, resource(await reload(id)));
    } catch (error) {
      return fail(c, error);
    }
  });

  scim.put("/Users/:id", async (c) => {
    try {
      const user = await companyUser(c.req.param("id"));
      const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
      if (!body) throw new ScimError(400, "The body must be a SCIM User.", "invalidSyntax");
      sameAddress(user, body.userName);
      const active = body.active === undefined ? true : scimBool(body.active);
      if (active === null) throw new ScimError(400, "active must be true or false.", "invalidValue");
      await rename(user, scimName(body));
      await setActive(await reload(user.id), active);
      return reply(c, 200, resource(await reload(user.id)));
    } catch (error) {
      return fail(c, error);
    }
  });

  scim.patch("/Users/:id", async (c) => {
    try {
      const user = await companyUser(c.req.param("id"));
      const body = (await c.req.json().catch(() => null)) as { schemas?: unknown; Operations?: unknown } | null;
      if (!body || !Array.isArray(body.Operations)) {
        throw new ScimError(400, `The body must be a ${PATCH_SCHEMA} with Operations.`, "invalidSyntax");
      }
      let active: boolean | undefined;
      const named: Record<string, unknown> = {};
      for (const raw of body.Operations as Record<string, unknown>[]) {
        const op = String(raw.op ?? "").toLowerCase();
        if (op !== "add" && op !== "replace") continue;
        const path = typeof raw.path === "string" ? raw.path : null;
        // Without a path the value holds the attributes (Entra ID sends both forms).
        const bare = raw.value && typeof raw.value === "object" ? (raw.value as Record<string, unknown>) : {};
        const values: Record<string, unknown> = path ? { [path]: raw.value } : bare;
        for (const [key, value] of Object.entries(values)) {
          const attribute = key.toLowerCase();
          if (attribute === "active") {
            const on = scimBool(value);
            if (on === null) throw new ScimError(400, "active must be true or false.", "invalidValue");
            active = on;
          } else if (attribute === "username") {
            sameAddress(user, value);
          } else if (attribute === "displayname") {
            named.displayName = value;
          } else if (attribute === "name" && value && typeof value === "object") {
            named.name = { ...(named.name as object), ...(value as object) };
          } else if (attribute.startsWith("name.")) {
            named.name = { ...(named.name as object), [key.slice(5)]: value };
          }
          // Other attributes (phone numbers, titles, the directory's extensions) aren't kept here.
        }
      }
      if (named.displayName !== undefined || named.name !== undefined) {
        const current = resource(user);
        await rename(
          user,
          scimName({
            displayName: named.displayName ?? (named.name ? undefined : current.displayName),
            name: { ...current.name, ...(named.name as object) },
          }),
        );
      }
      if (active !== undefined) await setActive(await reload(user.id), active);
      return reply(c, 200, resource(await reload(user.id)));
    } catch (error) {
      return fail(c, error);
    }
  });

  scim.delete("/Users/:id", async (c) => {
    try {
      const user = await companyUser(c.req.param("id"));
      await setActive(user, false, SCIM_REMOVED);
      return c.body(null, 204);
    } catch (error) {
      return fail(c, error);
    }
  });
}

/** The company's accounts the directory sees: its domains, not removed. */
function companyAccounts(sso: SsoSettings) {
  const domains = sql.join(
    sso.domains.map((d) => sql`${d}`),
    sql`, `,
  );
  return and(
    sql`lower(split_part(${schema.users.email}, '@', 2)) in (${domains})`,
    sql`${schema.users.blockedReason} is distinct from ${SCIM_REMOVED}`,
  );
}

/** `SSO_WORKSPACE_ID`, for an account the directory made: as the company's sign-in does (ADR 0188). */
async function joinCompanyWorkspace(deps: AppDeps, sso: SsoSettings, userId: string) {
  const workspaceId = sso.workspaceId;
  if (!workspaceId) return;
  await deps.db
    .transaction((tx) => joinOrganization(tx, workspaceId, userId, "member"))
    .catch((error) => deps.log?.error("company workspace not joined", { userId, workspaceId, error }));
}
