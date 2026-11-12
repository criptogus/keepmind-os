import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Button, Card, Group, Stack, Text } from '@mantine/core';
import { useLang } from '../../lib/i18n';

export interface TourStep {
  /** CSS selector for the element to spotlight ([data-tour="..."]). Empty = centered card. */
  target?: string;
  /** Section to navigate to before showing this step. */
  section?: string;
  title: string;
  text: string;
}

interface TourOverlayProps {
  steps: TourStep[];
  /** Called when the user finishes or skips — parent persists the flag. */
  onDone: () => void;
  /** Lets the parent switch sections for steps that need them. */
  onNavigate?: (section: string) => void;
}

const SPOT_PADDING = 8;

/**
 * Lightweight guided tour: dims the screen, spotlights the current target
 * and shows an explanatory card. No dependencies — pure DOM measurement.
 */
export default function TourOverlay({ steps, onDone, onNavigate }: TourOverlayProps) {
  const { t } = useLang();
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const step = steps[index];
  const last = index === steps.length - 1;

  // Navigate first, then wait for the target element to mount (lazy sections).
  useEffect(() => {
    if (step.section) onNavigate?.(step.section);
    let cancelled = false;
    let attempts = 0;
    const find = () => {
      if (cancelled) return;
      const el = step.target ? document.querySelector(step.target) : null;
      if (el || !step.target || attempts++ > 25) {
        if (el) {
          el.scrollIntoView({ block: 'nearest', behavior: 'instant' as ScrollBehavior });
          setRect(el.getBoundingClientRect());
        } else {
          setRect(null);
        }
        return;
      }
      setTimeout(find, 120);
    };
    setRect(null);
    const timer = setTimeout(find, 60);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [index, step, onNavigate]);

  // Re-measure on resize/scroll while a target is shown.
  useLayoutEffect(() => {
    if (!step.target) return;
    const measure = () => {
      const el = document.querySelector(step.target!);
      if (el) setRect(el.getBoundingClientRect());
    };
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [step.target, rect]);

  const go = (delta: number) => {
    const next = index + delta;
    if (next < 0) return;
    if (next >= steps.length) { onDone(); return; }
    setIndex(next);
  };

  // Position the card: below the target if there's room, else above, else centered.
  const cardStyle: React.CSSProperties = { position: 'fixed', zIndex: 10002, width: 340 };
  if (rect) {
    const below = rect.bottom + 12;
    const fitsBelow = below + 220 < window.innerHeight;
    cardStyle.left = Math.min(Math.max(12, rect.left), window.innerWidth - 352);
    cardStyle.top = fitsBelow ? below : Math.max(12, rect.top - 240);
  } else {
    cardStyle.left = '50%';
    cardStyle.top = '38%';
    cardStyle.transform = 'translateX(-50%)';
  }

  const spotlightStyle: React.CSSProperties | null = rect
    ? {
        position: 'fixed',
        zIndex: 10001,
        left: rect.left - SPOT_PADDING,
        top: rect.top - SPOT_PADDING,
        width: rect.width + SPOT_PADDING * 2,
        height: rect.height + SPOT_PADDING * 2,
        borderRadius: 10,
        boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.55)',
        pointerEvents: 'none',
        transition: 'all 120ms ease',
      }
    : null;

  return (
    <>
      {/* Dim layer — click does nothing so the user reads before moving on */}
      <div style={{ position: 'fixed', inset: 0, zIndex: 10000, backgroundColor: 'transparent' }} />
      {spotlightStyle && <div style={spotlightStyle} />}
      <div ref={cardRef} style={cardStyle}>
        <Card withBorder padding="lg" radius="md" shadow="xl" style={{ backgroundColor: 'var(--mantine-color-body)' }}>
          <Stack gap="sm">
            <Group justify="space-between">
              <Text size="xs" c="dimmed" fw={600} tt="uppercase">
                {index + 1} {t('tour.stepOf')} {steps.length}
              </Text>
              <Button size="compact-xs" variant="subtle" color="gray" onClick={onDone}>
                {t('tour.skip')}
              </Button>
            </Group>
            <div>
              <Text fw={700} size="md">{step.title}</Text>
              <Text size="sm" c="dimmed" mt={4}>{step.text}</Text>
            </div>
            <Group justify="space-between">
              <Button
                size="xs"
                variant="default"
                disabled={index === 0}
                onClick={() => go(-1)}
              >
                {t('common.back')}
              </Button>
              <Group gap={4}>
                {steps.map((_, i) => (
                  <span
                    key={i}
                    style={{
                      width: 6, height: 6, borderRadius: '50%',
                      backgroundColor: i === index ? 'var(--mantine-color-dark-6)' : 'var(--mantine-color-gray-4)',
                    }}
                  />
                ))}
              </Group>
              <Button size="xs" onClick={() => go(1)}>
                {last ? t('tour.finish') : t('common.next')}
              </Button>
            </Group>
          </Stack>
        </Card>
      </div>
    </>
  );
}
