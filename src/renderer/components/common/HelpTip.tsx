import React from 'react';
import { ActionIcon, Tooltip } from '@mantine/core';

interface HelpTipProps {
  /** Plain-language explanation shown on hover/tap. */
  label: string;
  size?: number;
}

/** Small "?" affordance that explains a term in plain language. */
export default function HelpTip({ label, size = 14 }: HelpTipProps) {
  return (
    <Tooltip label={label} multiline w={260} withArrow position="top">
      <ActionIcon
        size={size}
        variant="subtle"
        color="gray"
        radius="xl"
        aria-label={label}
        style={{ verticalAlign: 'middle' }}
      >
        ?
      </ActionIcon>
    </Tooltip>
  );
}
