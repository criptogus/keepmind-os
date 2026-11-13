import React from 'react';
import { Group, Text, Title } from '@mantine/core';
import HelpTip from './HelpTip';

interface PageHeaderProps {
  title: string;
  /** One-line plain-language explanation of what this page is for. */
  subtitle?: string;
  /** Optional "?" tooltip with a longer explanation. */
  help?: string;
  actions?: React.ReactNode;
}

/** Consistent page heading: title + plain subtitle + optional help + actions. */
export default function PageHeader({ title, subtitle, help, actions }: PageHeaderProps) {
  return (
    <Group justify="space-between" align="flex-start" className="km-page-header">
      <div className="km-page-heading" style={{ minWidth: 0 }}>
        <Group gap={6} align="center">
          <Title order={2} size="h4">{title}</Title>
          {help && <HelpTip label={help} />}
        </Group>
        {subtitle && (
          <Text size="sm" c="dimmed" mt={2}>{subtitle}</Text>
        )}
      </div>
      {actions && <div className="km-page-actions">{actions}</div>}
    </Group>
  );
}
