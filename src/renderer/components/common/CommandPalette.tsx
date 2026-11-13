import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Badge, Group, Modal, Stack, Text, TextInput } from '@mantine/core';
import { useLang } from '../../lib/i18n';

export interface PaletteCommand {
  id: string;
  label: string;
  /** Extra match terms (not shown). */
  keywords?: string;
  /** Right-side hint, e.g. section name or shortcut. */
  hint?: string;
  run: () => void;
}

interface CommandPaletteProps {
  opened: boolean;
  onClose: () => void;
  commands: PaletteCommand[];
}

/**
 * Cmd/Ctrl+K command palette — fuzzy substring filter, arrow-key navigation,
 * Enter to run. Dependency-free on top of Mantine.
 */
export default function CommandPalette({ opened, onClose, commands }: CommandPaletteProps) {
  const { t } = useLang();
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter((c) =>
      `${c.label} ${c.keywords ?? ''} ${c.hint ?? ''}`.toLowerCase().includes(q)
    );
  }, [commands, query]);

  useEffect(() => {
    setIndex(0);
  }, [query, opened]);

  useEffect(() => {
    const el = listRef.current?.children[index] as HTMLElement | undefined;
    el?.scrollIntoView({ block: 'nearest' });
  }, [index]);

  const run = (cmd: PaletteCommand | undefined) => {
    if (!cmd) return;
    onClose();
    // Defer so the modal finishes closing before navigation/state changes.
    setTimeout(cmd.run, 0);
  };

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      withCloseButton={false}
      padding={0}
      radius="md"
      size="lg"
      centered
      zIndex={300}
      styles={{ content: { backgroundColor: 'var(--mantine-color-body)' } }}
    >
      <TextInput
        autoFocus
        value={query}
        onChange={(e) => setQuery(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setIndex((i) => Math.min(i + 1, filtered.length - 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setIndex((i) => Math.max(i - 1, 0)); }
          else if (e.key === 'Enter') { e.preventDefault(); run(filtered[index]); }
        }}
        placeholder={t('cmdk.placeholder')}
        size="md"
        variant="unstyled"
        styles={{ input: { padding: '14px 16px', fontSize: 14 } }}
      />
      <div ref={listRef} style={{ maxHeight: 320, overflowY: 'auto', borderTop: '1px solid var(--mantine-color-gray-3)' }}>
        {filtered.length === 0 ? (
          <Text size="sm" c="dimmed" ta="center" py="lg">{t('cmdk.noResults')}</Text>
        ) : (
          <Stack gap={0}>
            {filtered.map((cmd, i) => (
              <button
                key={cmd.id}
                onMouseEnter={() => setIndex(i)}
                onClick={() => run(cmd)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 8,
                  width: '100%',
                  padding: '10px 16px',
                  border: 'none',
                  borderBottom: i === filtered.length - 1 ? 'none' : '1px solid var(--mantine-color-gray-1)',
                  backgroundColor: i === index ? 'var(--mantine-color-gray-1)' : 'transparent',
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  textAlign: 'left',
                }}
              >
                <Text size="sm" fw={i === index ? 600 : 400}>{cmd.label}</Text>
                {cmd.hint && <Badge size="sm" variant="light" color="gray">{cmd.hint}</Badge>}
              </button>
            ))}
          </Stack>
        )}
      </div>
      <Group gap="md" px="md" py={8} style={{ borderTop: '1px solid var(--mantine-color-gray-3)' }}>
        <Text size="xs" c="dimmed">↑↓ {t('cmdk.navigate')}</Text>
        <Text size="xs" c="dimmed">↵ {t('cmdk.select')}</Text>
        <Text size="xs" c="dimmed">esc {t('cmdk.close')}</Text>
      </Group>
    </Modal>
  );
}
