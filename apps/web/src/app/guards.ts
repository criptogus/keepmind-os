import type { Me } from "@keepmind/client";
import { authConfigQuery, meQuery } from "@keepmind/client";
import type { LegalKind } from "@keepmind/i18n/legal";
import { redirect } from "@tanstack/react-router";
import type { RouterContext } from "./router-context";

/** Route guard: the signed-in person, or a redirect to /login that comes back afterwards. */
export async function requireUser(context: RouterContext, href: string): Promise<Me> {
  const me = await context.queryClient.ensureQueryData(meQuery(context.api));
  if (!me) throw redirect({ to: "/login", search: { redirect: href } });
  return me;
}

/**
 * The signed-in person, sure to include `orgId` when they belong to it: the
 * cached list can predate a workspace just created or joined, so a miss asks
 * the server again before saying "you're not part of this organization".
 */
export async function requireUserIn(context: RouterContext, href: string, orgId: string): Promise<Me> {
  const me = await requireUser(context, href);
  if (me.organizations.some((o) => o.id === orgId)) return me;
  const fresh = await context.queryClient.fetchQuery({ ...meQuery(context.api), staleTime: 0 });
  if (!fresh) throw redirect({ to: "/login", search: { redirect: href } });
  return fresh;
}

/** Use operator-configured legal policies; never substitute upstream terms. */
export async function legalPage(context: RouterContext, kind: LegalKind): Promise<boolean> {
  const config = await context.queryClient.ensureQueryData(authConfigQuery(context.api));
  // Upstream legal documents do not apply to the KeepMind service.
  // Only an explicitly configured operator policy may be presented.
  const own = kind === "terms" ? config.termsUrl : config.privacyUrl;
  // A page at this same address is this app's, which would land back here.
  if (own && new URL(own, window.location.href).origin !== window.location.origin) throw redirect({ href: own });
  return false;
}
