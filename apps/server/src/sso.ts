import type { Config } from "@keepmind/config";

/**
 * Company sign-in (ADR 0188): one OpenID Connect provider the server's operator configured (`SSO_OIDC_*`), signed in
 * through Better Auth's generic OAuth plugin as the social provider `sso`. These are its rules, kept apart from
 * `auth.ts` so each one is tested on its own.
 */

/** The provider's id: Better Auth's callback is `/callback/sso`, and its accounts carry this `providerId`. */
export const SSO_PROVIDER = "sso";

/** Where the provider returns: the only path that signs in through it. */
export const SSO_CALLBACK_PATH = `/callback/${SSO_PROVIDER}`;

/** Refused: this address signs in only through the company's sign-in (`SSO_REQUIRED`). */
export const SSO_REQUIRED = "SSO_REQUIRED";
export const SSO_REQUIRED_MESSAGE = "Your company signs in through its own sign-in. Use the company's button.";

/** Refused: the company's provider signed in an address outside `SSO_DOMAINS` (a guest of its directory). */
export const SSO_OTHER_DOMAIN = "SSO_OTHER_DOMAIN";
export const SSO_OTHER_DOMAIN_MESSAGE = "The company's sign-in is only for its own email addresses.";

export interface SsoSettings {
  issuer: string;
  clientId: string;
  clientSecret: string;
  /** On the button: "Continue with <name>". */
  name: string;
  /** Lower case, without duplicates. Empty: any address the provider signs in. */
  domains: string[];
  /** Addresses in `domains` sign in only through it. */
  required: boolean;
  /** The workspace an account it makes joins, as a member. */
  workspaceId: string | null;
}

/** The company's sign-in as configured, or null: `loadConfig` already refused a half-configured one. */
export function ssoSettings(config: Config): SsoSettings | null {
  const { SSO_OIDC_ISSUER: issuer, SSO_OIDC_CLIENT_ID: clientId, SSO_OIDC_CLIENT_SECRET: clientSecret } = config;
  if (!issuer || !clientId || !clientSecret) return null;
  const domains = [
    ...new Set(
      (config.SSO_DOMAINS ?? "")
        .split(",")
        .map((d) => d.trim().toLowerCase())
        .filter(Boolean),
    ),
  ];
  return {
    issuer: issuer.replace(/\/+$/, ""),
    clientId,
    clientSecret,
    name: config.SSO_NAME,
    domains,
    required: config.SSO_REQUIRED && domains.length > 0,
    workspaceId: config.SSO_WORKSPACE_ID ?? null,
  };
}

/** The provider's OpenID configuration: where its endpoints and signing keys are published. */
export const discoveryUrl = (sso: SsoSettings) => `${sso.issuer}/.well-known/openid-configuration`;

/** The domain of an address, lower case; null when it has none. */
export function emailDomain(email: string): string | null {
  const at = email.trim().lastIndexOf("@");
  const domain =
    at > 0
      ? email
          .trim()
          .slice(at + 1)
          .toLowerCase()
      : "";
  return domain.includes(".") ? domain : null;
}

/** Whether the address is one of the company's: its domain is in `SSO_DOMAINS` (exactly, never a subdomain). */
export function isCompanyEmail(sso: SsoSettings | null, email: string): boolean {
  const domain = emailDomain(email);
  return sso !== null && domain !== null && sso.domains.includes(domain);
}

/** Whether the address may only sign in through the company's sign-in. */
export const ssoRequiredFor = (sso: SsoSettings | null, email: string) =>
  sso?.required === true && isCompanyEmail(sso, email);

/** Whether the company's sign-in may sign this address in: with domains set, only theirs. */
export const ssoAccepts = (sso: SsoSettings, email: string) => sso.domains.length === 0 || isCompanyEmail(sso, email);

/** Better Auth's paths that start a sign-in or a sign-up with a password, or a password reset, by address. */
export const PASSWORD_PATHS = new Set(["/sign-in/email", "/sign-up/email", "/request-password-reset"]);

/**
 * The step a Better Auth endpoint context stands for: its path, or for a provider's return, which Better Auth names
 * by its route (`/callback/:id`), `/callback/<provider>`.
 */
export function signInStep(
  context: { path?: string; params?: Record<string, unknown> | null } | null | undefined,
): string | undefined {
  const path = context?.path;
  if (path !== "/callback/:id") return path;
  const id = context?.params?.id;
  return typeof id === "string" ? `/callback/${id}` : path;
}

/** A provider's return: `/callback/<provider>`. The company's own is `SSO_CALLBACK_PATH`. */
export const isProviderReturn = (path: string | undefined) => typeof path === "string" && path.startsWith("/callback/");

/**
 * Why this sign-in step is refused under the company's sign-in, or null. `path`: Better Auth's endpoint (a password
 * form, a provider's return). `email`: the address it signs in. A company address under `SSO_REQUIRED` gets in only
 * through `SSO_CALLBACK_PATH`, and that path takes only the company's addresses when `SSO_DOMAINS` is set.
 */
export function ssoRefusal(
  sso: SsoSettings | null,
  path: string | undefined,
  email: string,
): { code: string; message: string } | null {
  if (!sso) return null;
  if (path === SSO_CALLBACK_PATH) {
    return ssoAccepts(sso, email) ? null : { code: SSO_OTHER_DOMAIN, message: SSO_OTHER_DOMAIN_MESSAGE };
  }
  const signsIn = (path !== undefined && PASSWORD_PATHS.has(path)) || isProviderReturn(path);
  return signsIn && ssoRequiredFor(sso, email) ? { code: SSO_REQUIRED, message: SSO_REQUIRED_MESSAGE } : null;
}

/**
 * The profile the provider returned, as the account takes it: the address in lower case, and confirmed when it is
 * one of the company's (the provider owns that domain, and many, such as Entra ID, never send `email_verified`).
 */
export function ssoProfile(sso: SsoSettings, profile: { email?: unknown; email_verified?: unknown }) {
  const email = typeof profile.email === "string" ? profile.email.trim().toLowerCase() : undefined;
  return {
    ...(email ? { email } : {}),
    ...(email && isCompanyEmail(sso, email) ? { emailVerified: true } : {}),
  };
}
