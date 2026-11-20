import type { Agent, Message } from "@keepmind/client";
import { useOverview } from "@keepmind/client";
import { joinNames, whenAt } from "@keepmind/client/lib/format";
import {
  type AgentColor,
  agentGradient,
  agentTones,
  cx,
  drawSprite,
  Icon,
  isDarkSurface,
  KeepMindBackdrop,
  Logo,
  mix,
  PixelSky,
  parseColor,
  pixelBurst,
  pixelOf,
  type SkyOptions,
  softTones,
  spriteTone,
} from "@keepmind/ui";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AgentAvatar } from "@/components/AgentAvatar";
import { AgentBackdrop } from "@/components/AgentBackdrop";
import { useOrg } from "@/components/org-context";
import { useCloseAfterUse } from "@/hooks/useCloseAfterUse";
import { useDirectory } from "@/hooks/useDirectory";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";
import { lookOf } from "@/lib/look";
import { agentActivitySince, dayPart, isNewDay, lastVisit, markVisit } from "@/lib/welcome";

/* KeepMind decorative stages. Functional progress retains its independent renderer. */

const S = Math.sin;

/** An agent's color for drawing (its look, or the default sky). */
export const colorOf = (agent: { appearance?: unknown } | undefined | null): AgentColor =>
  lookOf(agent)?.color ?? "sky";

/* ---------- Channel: the greeting of a new day ---------- */

/** One greeting per workspace per page load: the first channel opened claims it. */
const greetings = new Map<string, { last: number | null; show: boolean; channelId?: string; closed?: boolean }>();
function claimGreeting(orgId: string, channelId: string) {
  let g = greetings.get(orgId);
  if (!g) {
    const last = lastVisit(orgId);
    g = { last, show: isNewDay(last) };
    greetings.set(orgId, g);
    markVisit(orgId);
  }
  if (g.show && !g.channelId) g.channelId = channelId;
  return g;
}

/**
 * The sky band at the top of a channel on the first visit of the day: a greeting and what its agents did since. It
 * closes by itself a while after the person starts using the page, never under the pointer, gliding shut.
 */
export function ChannelWelcome({
  channelId,
  messages,
  agents,
}: {
  channelId: string;
  messages: Message[] | undefined;
  agents: Agent[];
}) {
  const { t, i18n } = useTranslation();
  const { org, me } = useOrg();
  const dir = useDirectory(org.id);
  const overview = useOverview(org.id);
  const [greeting] = useState(() => claimGreeting(org.id, channelId));
  const [closed, setClosed] = useState(greeting.closed ?? false);
  const reduced = usePrefersReducedMotion();
  const box = useRef<HTMLElement>(null);
  const text = useRef<HTMLDivElement>(null);
  const faces = useRef<HTMLDivElement>(null);
  const shut = useRef<HTMLButtonElement>(null);
  const shows =
    greeting.show && greeting.channelId === channelId && !closed && messages !== undefined && greeting.last !== null;
  // Glides shut: its height and the room above it fold to nothing as it fades, the conversation takes the room (the
  // list keeps what is read in place), then it leaves. With reduced motion it only fades.
  const close = () => {
    if (greeting.closed) return;
    greeting.closed = true;
    const el = box.current;
    if (!el || typeof el.animate !== "function") return setClosed(true);
    const gone = () => setClosed(true);
    const fold = [
      { height: `${el.offsetHeight}px`, minHeight: "0px", marginTop: getComputedStyle(el).marginTop, opacity: 1 },
      { height: "0px", minHeight: "0px", marginTop: "0px", opacity: 0 },
    ];
    el.animate(reduced ? [{ opacity: 1 }, { opacity: 0 }] : fold, {
      duration: reduced ? 160 : 240,
      easing: "ease-out",
      fill: "forwards",
    }).finished.then(gone, gone);
  };
  useCloseAfterUse(box, close, shows);
  if (!shows || greeting.last === null || !messages) return null;
  const since = greeting.last;
  const activity = agentActivitySince(messages, since);
  const names = joinNames(
    activity.agentIds.slice(0, 3).map((id) => dir.agentById.get(id)?.name ?? t("channel.unknownAgent")),
    t,
  );
  const waiting = overview.data?.approvalsWaitingForMe ?? 0;
  const firstName = me.user.name.split(/\s+/)[0] ?? me.user.name;
  const crew = (activity.agentIds.length ? activity.agentIds : agents.map((a) => a.id)).slice(0, 3);
  return (
    <section className="sky-welcome" aria-label={t("sky.welcome.label")} ref={box}>
      <KeepMindBackdrop tone="graphite" />
      <div className="sky-welcome__text" ref={text}>
        <span className="sky-welcome__when">
          {t("sky.welcome.lastVisit", { when: whenAt(t, i18n.language, new Date(since).toISOString()) })}
        </span>
        <h2 className="sky-welcome__title">
          {t(`sky.welcome.${dayPart(new Date().getHours())}`, { name: firstName })}
        </h2>
        <p className="sky-welcome__lead">
          {activity.count === 0
            ? t("sky.welcome.quiet")
            : activity.agentIds.length === 1
              ? t("sky.welcome.activityOne", { names, count: activity.count })
              : t("sky.welcome.activityMany", { names, count: activity.count })}{" "}
          {waiting > 0 && t("sky.welcome.approvals", { count: waiting })}
        </p>
      </div>
      {crew.length > 0 && (
        <div className="sky-welcome__crew" aria-hidden="true" ref={faces}>
          {crew.map((id) => (
            <AgentAvatar key={id} agentId={id} name={dir.agentById.get(id)?.name ?? ""} size="lg" />
          ))}
        </div>
      )}
      <button
        type="button"
        className="sky-welcome__close"
        aria-label={t("sky.welcome.dismiss")}
        onClick={close}
        ref={shut}
      >
        <Icon name="close" size={16} />
      </button>
    </section>
  );
}

/* ---------- Agent page: the cover in the agent's color ---------- */

/** The faces and pills on a sky, which its pixel agents keep clear of (`SkyOptions.clear`). */
type Clear = SkyOptions["clear"];

/** The shared KeepMind stage, with a gentle increase in motion while the agent works. */
export function AgentCover({ busy }: { color: AgentColor; busy: boolean; at?: number; clear?: Clear }) {
  return (
    <div className="agp-cover__sky" data-busy={busy || undefined} aria-hidden="true">
      <AgentBackdrop busy={busy} />
    </div>
  );
}

/** A deep navy the cover's tones are pulled toward at night (a new agent waiting for its AI, ADR 0164). */
const NIGHT_NAVY = "#040818";

/**
 * Where a cover's face is, in shares of its box (the face's upper quarter, which sits on the sky): the first element
 * `clear` gives; without one, `at` across near the bottom.
 */
export function facePool(
  host: { current: HTMLElement | null },
  clear: Clear | undefined,
  at = 0.1,
): () => [number, number] {
  return () => {
    const face = clear?.()[0];
    const box = host.current?.getBoundingClientRect();
    if (!face || !box?.width || !box.height) return [at, 0.83];
    const f = face.getBoundingClientRect();
    return [(f.left + f.width / 2 - box.left) / box.width, (f.top + f.height / 4 - box.top) / box.height];
  };
}

/**
 * The agent page's cover sky (AgentCover), as options: only the light tones of its color, fading into the page at the
 * bottom, a pool of light behind its face so the face's own dither never melts into the sky's, 2 px pixels and a few
 * faint pixel agents. The new agent's card and its conversation's band use it too (ADR 0164): `night` (0..1, read on
 * every frame) pulls the tones toward a deep navy while the agent has no AI, and back as it gets one.
 *
 * `surface` is the token of what the sky sits on (the page by default; the card's well, the chat card's face), so its
 * last tone is that color and it ends with no seam. On a dark surface it is the window's surface rising into its
 * color, as the app's other skies are there (`softTones`): the color near the top and as a glow behind the face, the
 * rest melting into the dark below. The light theme's sky is the same as before.
 */
export function agentCoverOptions(
  color: AgentColor,
  o: { busy?: boolean; clear?: Clear; pool: () => [number, number]; night?: () => number; surface?: string },
): SkyOptions {
  const busy = o.busy ?? false;
  // Read with the tones on each frame (the theme can change), before the field is drawn.
  let dark = false;
  return {
    pixel: 2,
    surface: o.surface ?? "--bg",
    palette: (surface) => {
      dark = isDarkSurface(surface);
      const night = o.night?.() ?? 0;
      const toNight = (tones: string[]) =>
        night <= 0.001 ? tones : tones.map((tone, i) => mix(tone, NIGHT_NAVY, night * (0.9 - i * 0.07)));
      // Dark: from the surface (0) up to the color (last); the field puts the color on top and behind the face.
      if (dark) return toNight(softTones(color, surface));
      // Light: mid to near white, then most of the way to the surface: no deep tones on the cover.
      const light = agentTones(color).slice(3);
      return toNight([...light, mix(light[light.length - 1] ?? surface, surface, 0.6)]);
    },
    body: spriteTone(color),
    speed: busy ? 2.6 : 1,
    rise: busy ? 2.4 : 1,
    near: 0,
    faint: 1,
    sprites: busy ? { area: 5300, max: 14 } : { area: 10560, max: 8 },
    clear: o.clear,
    light: 0,
    // Light: lighter toward the bottom and the right, where the page's text starts. Dark: the color at the top, the
    // surface at the bottom (the pool lifts the face's glow back toward the color).
    base: (u, v, tt) =>
      dark
        ? 0.86 - 0.16 * u - 0.82 * v + 0.05 * S(u * 4 + tt * 0.5)
        : 0.28 + 0.3 * u + 0.62 * v * v + 0.05 * S(u * 4 + tt * 0.5),
    blobs: () => {
      const [x, y] = o.pool();
      return [[x, y, 0.3, dark ? 0.55 : 0.75]];
    },
  };
}

/** KeepMind stage for profiles; status and personal appearances remain in the content. */
export function ProfileSky({ person, busy = false }: { color: AgentColor; person?: boolean; busy?: boolean }) {
  return <KeepMindBackdrop tone={person ? "surface" : "graphite"} busy={busy} />;
}

/** Quiet surface while the computer view opens; its controls remain above the backdrop. */
export function ComputerSky(_props: { color: AgentColor; clear?: Clear }) {
  return (
    <span className="cmp-sky" aria-hidden="true">
      <KeepMindBackdrop />
    </span>
  );
}

/* ---------- Sign in and sign up ---------- */

/** KeepMind current below the sign-in form. */
export function AuthHorizon(_props: { clear?: Clear }) {
  return (
    <span className="auth__horizon" aria-hidden="true">
      <KeepMindBackdrop />
    </span>
  );
}

/** KeepMind current behind the download page. */
export function DownloadSky(_props: { clear?: Clear }) {
  return (
    <span className="dlp__sky" aria-hidden="true">
      <KeepMindBackdrop />
    </span>
  );
}

/* ---------- Small moments ---------- */

/** A quicker current behind the activity bar; the status text remains authoritative. */
export function ActivitySky(_props: { color: AgentColor }) {
  return (
    <span className="ac-typing__sky" aria-hidden="true">
      <KeepMindBackdrop busy />
    </span>
  );
}

/** Shared motion while an image is being made; reduced motion is handled by the backdrop. */
export function ImageSky(_props: { color: AgentColor }) {
  return <KeepMindBackdrop busy />;
}

/** Quiet current behind questions and approval cards. */
export function CardSky(_props: { color: AgentColor }) {
  return (
    <span className="ac-approval__sky" aria-hidden="true">
      <KeepMindBackdrop />
    </span>
  );
}

/** KeepMind linework with the connector's brand accent; provider identity remains distinct. */
export function ConnectorSky({ brand }: { brand: string | null }) {
  return (
    <span className="catalog-feat__sky" aria-hidden="true">
      <KeepMindBackdrop accent={brand ?? undefined} />
    </span>
  );
}

/** KeepMind loading stage with the original K mark and readable status. */
export function BootSplash() {
  const { t } = useTranslation();
  return (
    <div className="sky-boot" role="status" aria-live="polite">
      <KeepMindBackdrop tone="graphite" />
      <div className="sky-boot__in">
        <Logo size={40} style={{ fontSize: "clamp(24px, 9vw, 40px)" }} />
        <span>{t("sky.boot")}</span>
      </div>
    </div>
  );
}

/**
 * Readies a burst of an agent's colors from `from` (an approval's agent
 * avatar, else the button): place and colors are read now, since the card may
 * collapse once decided. Call the result when the action went through.
 */
export function prepareBurst(from: HTMLElement): () => void {
  const avatar =
    from.closest(".ac-approval, [data-burst], .ac-details")?.querySelector<HTMLElement>(".ac-avatar") ?? null;
  const box = (avatar ?? from).getBoundingClientRect();
  const css = avatar ? getComputedStyle(avatar) : null;
  const [skyTop, skyBottom] = agentGradient("sky");
  const top = css?.getPropertyValue("--av-top").trim() || skyTop;
  const bottom = css?.getPropertyValue("--av-bottom").trim() || skyBottom;
  return () =>
    pixelBurst(
      { x: box.left + box.width / 2, y: box.top + box.height / 2 },
      [bottom, mix(bottom, top, 0.5), top, mix(top, "#ffffff", 0.5), "#ffffff"],
      bottom,
    );
}

/* ---------- Sidebar ---------- */

/** Current behind a working agent's row. */
export function AgentTrail(_props: { color: AgentColor }) {
  return (
    <span className="sidebar__trail" aria-hidden="true">
      <KeepMindBackdrop busy />
    </span>
  );
}

/** Current behind a working agent's icon. */
export function AgentGlow(_props: { color: AgentColor }) {
  return (
    <span className="sidebar__glow" aria-hidden="true">
      <KeepMindBackdrop busy />
    </span>
  );
}

/** The backdrop grows stronger as more agents work; no extra figures compete with their status. */
export function SidebarHorizon({ working, total }: { working: number; total: number }) {
  const share = total > 0 ? Math.min(1, working / Math.min(total, 3)) : 0;
  return (
    <span className="sidebar__horizon" aria-hidden="true">
      <KeepMindBackdrop strength={0.2 + 0.6 * share} busy={working > 0} />
    </span>
  );
}

/** The two parts of the workspace's sky, in CSS pixels: the Mac app's title bar over the sidebar (0 elsewhere). */

/** Shared KeepMind linework in the sidebar and native title bar. */
export function WorkspaceSky({ part, rail = false }: { part: "bar" | "side"; rail?: boolean }) {
  return (
    <span className={cx("workspace-sky", `workspace-sky--${part}`, rail && "workspace-sky--rail")} aria-hidden="true">
      <KeepMindBackdrop />
    </span>
  );
}

/** A quiet current behind the workspace menu. */
export function MenuHorizon() {
  return <KeepMindBackdrop />;
}

/* ---------- Onboarding ---------- */

/** The setup's backdrop follows progress; step controls and labels remain unchanged. */
export function OnboardingHorizon({ progress }: { progress: number; clear?: Clear }) {
  return (
    <span className="onb__horizon" aria-hidden="true">
      <KeepMindBackdrop strength={0.45 + 0.4 * Math.max(0, Math.min(1, progress))} />
    </span>
  );
}

/**
 * The onboarding's progress at the top of the rail: a strip of pixel sky that fills as steps get done, with a pixel
 * agent walking at its front. `progress` is 0..1.
 */
export function OnboardingProgress({ progress }: { progress: number }) {
  const target = Math.max(0, Math.min(1, progress));
  const reduced = usePrefersReducedMotion();
  const level = useRef({ now: target, target });
  level.current.target = target;
  if (reduced) level.current.now = target;
  const body = pixelOf("#333630");
  const eye = pixelOf("#c4ff3d");
  const opts: SkyOptions = {
    pixel: 3,
    surface: "--sunken",
    light: 0,
    palette: (bg) => {
      const [r, g, b] = parseColor(bg);
      const dark = r * 0.3 + g * 0.59 + b * 0.11 < 128;
      const sky = dark ? ["#333630", "#486600", "#87b82a", "#c4ff3d"] : ["#eef7d8", "#c4ff3d", "#87b82a", "#486600"];
      return [bg, mix(bg, "#c4ff3d", dark ? 0.1 : 0.14), ...sky];
    },
    // Called once per frame, before the field: eases the fill toward the target.
    blobs: () => {
      const l = level.current;
      l.now += (l.target - l.now) * 0.06;
      return [];
    },
    base: (u, v, t) => {
      const now = level.current.now;
      if (u > now) return 0.12;
      const head = Math.max(0, 1 - (now - u) * 12);
      return Math.min(1, 0.45 + 0.4 * v + 0.08 * S(u * 22 + t * 1.2) + 0.2 * head);
    },
    after: (f) => {
      const now = level.current.now;
      if (now < 0.01) return;
      const x = Math.max(0, Math.min(f.w - 9, Math.round(now * f.w) - 6));
      drawSprite(f, x, Math.round((f.h - 9) / 2), 1, body, eye, f.t % 3.6 > 3.46);
    },
  };
  return (
    <span className="onb__progress-sky" aria-hidden="true">
      <PixelSky options={opts} />
    </span>
  );
}

/** Neutral KeepMind stage under the team's existing sleeping companions. */
export function TeamAsleepSky() {
  return (
    <span className="onb__plan-sky" aria-hidden="true">
      <KeepMindBackdrop />
    </span>
  );
}

/* ---------- Criar agente ---------- */

/** The same graphite stage as the saved agent's portrait. */
export function AgentPreviewSky(_props: { color: AgentColor; clear?: Clear }) {
  return <AgentBackdrop />;
}

/** Creation confirmation on a theme-aware KeepMind stage. */
export function AgentBornSky(_props: {
  color: AgentColor;
  at: [number, number];
  calm: () => (Element | null)[];
  clear?: Clear;
}) {
  return <KeepMindBackdrop />;
}

/** Branded graphite stage for welcome messages; text and actions stay above it. */
export function WelcomeSky(_props: { calm: () => (Element | null)[]; clear?: Clear }) {
  return <KeepMindBackdrop tone="graphite" />;
}

/** KeepMind current behind wiki imports and agent lists. */
export function WikiSky({ variant }: { variant: "strip" | "glow" }) {
  return (
    <span className={`wiki-sky wiki-sky--${variant}`} aria-hidden="true">
      <KeepMindBackdrop />
    </span>
  );
}
