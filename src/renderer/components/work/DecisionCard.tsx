import React, { type ReactNode } from 'react';
import { Badge, Group, Text } from '@mantine/core';

/** A quiet, shared surface; the title says whether this is a question, delivery or action permission. */
export default function DecisionCard({ title, status, children, actions }: {
  title: string; status?: string; children: ReactNode; actions: ReactNode;
}) {
  return <section className="km-decision-card km-enter" aria-label={title}>
    <Group justify="space-between" className="km-decision-heading"><Text fw={600}>{title}</Text>{status && <Badge color="gray" variant="light">{status}</Badge>}</Group>
    <div className="km-decision-body">{children}</div>
    {actions && <Group className="km-decision-actions" gap="sm">{actions}</Group>}
  </section>;
}
