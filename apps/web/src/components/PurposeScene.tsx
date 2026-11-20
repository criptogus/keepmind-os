import { type PurposeKind, SCENE_FACES, SCENE_H, SCENE_LINES, SCENE_W } from "@keepmind/client/lib/purpose-scene";
import { type AgentAppearance, Avatar, cx, KeepMindBackdrop } from "@keepmind/ui";
import type { CSSProperties } from "react";
import { AgentAvatar } from "@/components/AgentAvatar";
import { type PurposeLife, sceneAgentKey, WAKE_STEP_MS } from "@/components/purpose-life";

/**
 * The scene of an answer to "what will you use KeepMind OS for?" (ADR 0159), the onboarding's brand moment, drawn
 * with the app's own faces and the org chart's lines, over the cards' horizon (`CardHorizon`). For me: the person
 * signing up in the middle (their photo, or their initials as everywhere), their agents around them, each joined to
 * them. For a team: an org chart, them on top, people and agents under them. The other answer rests (its agents doze,
 * their zz); choosing one draws its lines and wakes its agents in a wave (`usePurposeLife`: a z pops off each, eyes
 * open, a hop), and from then on they look at the pointer; the agent whose pill works bobs. Pointing at an agent
 * points at its pill. Decorative: the answer says it in words.
 *
 * Laid out on the shared stage (`SCENE_W`×`SCENE_H`, scaled down on a phone), the phone's drawing too.
 */
/** Who is signing up: their account's name and photo (Google's, or one they set), if any. */
export type PurposeYou = { name: string; image: string | null };

/** A pixel portrait of someone on the team (anyone). */
const TEAMMATE = "/onboarding/person-31.jpg";

export function PurposeScene({
  kind,
  chosen,
  you,
  life,
}: {
  kind: PurposeKind;
  chosen: boolean;
  you: PurposeYou;
  life: PurposeLife;
}) {
  const faces = SCENE_FACES[kind];
  return (
    <span className="onb-scene" data-kind={kind} data-chosen={chosen || undefined} data-gaze="" aria-hidden="true">
      <span className="onb-scene__sky">
        <KeepMindBackdrop strength={chosen ? 1 : 0.4} />
      </span>
      <span className="onb-scene__room">
        <span className="onb-scene__stage">
          <svg
            className="onb-scene__lines"
            viewBox={`0 0 ${SCENE_W} ${SCENE_H}`}
            width={SCENE_W}
            height={SCENE_H}
            aria-hidden="true"
          >
            {SCENE_LINES[kind].map((d, i) => (
              <path
                // biome-ignore lint/suspicious/noArrayIndexKey: a fixed drawing
                key={i}
                d={d}
                pathLength={1}
                className="onb-scene__line"
                style={{ "--i": i } as CSSProperties}
              />
            ))}
          </svg>
          {faces.map((f, i) => (
            <span
              // biome-ignore lint/suspicious/noArrayIndexKey: a fixed cast
              key={i}
              className={cx("onb-scene__face", life.working === i && "is-bob")}
              style={{ left: f.x - f.size / 2, top: f.y - f.size / 2, width: f.size, height: f.size }}
              onPointerEnter={life.hasPill(i) ? () => life.point(i) : undefined}
              onPointerLeave={life.hasPill(i) ? () => life.point(null) : undefined}
            >
              {"look" in f ? (
                <AgentAvatar
                  name={sceneAgentKey(kind, i)}
                  appearance={f.look as AgentAppearance}
                  size="md"
                  state={life.awake(i) ? "idle" : "sleeping"}
                  reactionKey={sceneAgentKey(kind, i)}
                />
              ) : "you" in f ? (
                <Avatar kind="person" name={you.name} imageUrl={you.image ?? undefined} size="lg" />
              ) : (
                <Avatar kind="person" name="" imageUrl={TEAMMATE} size="lg" />
              )}
              {life.waking && "look" in f && (
                <span
                  className="onb-zpop"
                  aria-hidden="true"
                  style={{ animationDelay: `${life.wakeOrder(i) * WAKE_STEP_MS}ms` }}
                />
              )}
            </span>
          ))}
        </span>
      </span>
    </span>
  );
}

export type { PurposeKind };
