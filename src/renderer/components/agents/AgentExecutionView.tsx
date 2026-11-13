import React, { useEffect, useState } from 'react';
import { Badge, Button, Card, Group, Stack, Text, Title } from '@mantine/core';
import { useAgentStore } from '../../store/agentStore';
import type { AgentExecution, ExecutionToolCall } from '../../../shared/types.js';
import { IconBolt } from '../common/icons.js';
import { useLang } from '../../lib/i18n';
import PixelSpinner from '../common/PixelSpinner';
import { sfxDone, sfxError } from '../../lib/sfx';

interface AgentExecutionViewProps {
  agentId: string;
}

interface LiveExecution {
  executionId: string;
  text: string;
  tools: Array<{ name: string; result?: string; error?: string }>;
  done: boolean;
  startedAt: number;
  failed: boolean;
}

function fmtElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}m ${String(s % 60).padStart(2, '0')}s` : `${s}s`;
}

/** One row of the live plan (agentes.chat WorkPlan pattern, monochrome). */
function PlanStep({ state, label }: { state: 'todo' | 'doing' | 'done' | 'failed'; label: string }) {
  return (
    <Group gap={6} wrap="nowrap" align="flex-start">
      <span style={{ width: 14, display: 'inline-flex', justifyContent: 'center', flexShrink: 0, marginTop: 1 }}>
        {state === 'doing' ? <PixelSpinner size={14} /> : state === 'done' ? (
          <Text span size="xs" fw={700}>✓</Text>
        ) : state === 'failed' ? (
          <Text span size="xs" fw={700}>!</Text>
        ) : (
          <span style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: 'var(--mantine-color-gray-5)', display: 'inline-block', marginTop: 4 }} />
        )}
      </span>
      <Text size="xs" c={state === 'todo' ? 'dimmed' : undefined} ff="monospace" style={{ wordBreak: 'break-all' }}>{label}</Text>
    </Group>
  );
}

/** Collapsible persisted tool calls for a finished execution — "what the agent touched". */
function ExecutionToolCalls({ executionId }: { executionId: string }) {
  const { t } = useLang();
  const [open, setOpen] = useState(false);
  const [calls, setCalls] = useState<ExecutionToolCall[] | null>(null);
  const [loading, setLoading] = useState(false);

  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (next && calls === null) {
      setLoading(true);
      try {
        setCalls(await window.electronAPI.getExecutionToolCalls(executionId));
      } catch {
        setCalls([]);
      } finally {
        setLoading(false);
      }
    }
  };

  // Pair call/result rows into one item per invocation.
  const items: Array<{ name: string; args?: unknown; result?: string; error?: string }> = [];
  for (const c of calls ?? []) {
    if (c.kind === 'call') {
      items.push({ name: c.name, args: c.args });
    } else {
      const target = [...items].reverse().find((i) => i.name === c.name && i.result === undefined && i.error === undefined);
      if (target) {
        target.result = c.result;
        target.error = c.error;
      }
    }
  }

  return (
    <div>
      <Button size="compact-xs" variant="subtle" onClick={() => void toggle()}>
        {open ? `▾ ${t('aex.toolCalls')}` : `▸ ${t('aex.toolCalls')}`}
      </Button>
      {open && (
        <Card withBorder padding="sm" radius="sm" mt={4} style={{ backgroundColor: 'var(--mantine-color-gray-0)' }}>
          {loading && <Text size="xs" c="dimmed">{t('logs.loading')}</Text>}
          {!loading && items.length === 0 && <Text size="xs" c="dimmed">{t('govsum.empty')}</Text>}
          <Stack gap={4}>
            {items.map((tool, i) => {
              const pending = tool.result === undefined && tool.error === undefined;
              const failed = tool.error !== undefined;
              return (
                <Group key={i} gap={6} wrap="nowrap" align="flex-start">
                  <span style={{ width: 14, display: 'inline-flex', justifyContent: 'center', flexShrink: 0, marginTop: 2 }}>
                    {pending ? <PixelSpinner size={14} /> : failed ? (
                      <Text span size="xs" fw={700}>!</Text>
                    ) : (
                      <Text span size="xs" fw={700}>✓</Text>
                    )}
                  </span>
                  <div style={{ minWidth: 0 }}>
                    <Text size="xs" ff="monospace" fw={500} style={{ wordBreak: 'break-all' }}>{tool.name}</Text>
                    {tool.args !== undefined && (
                      <Text size="xs" c="dimmed" ff="monospace" lineClamp={2} style={{ wordBreak: 'break-word' }}>
                        {JSON.stringify(tool.args)}
                      </Text>
                    )}
                    {(tool.result !== undefined || tool.error) && (
                      <Text size="xs" c={failed ? 'dark' : 'dimmed'} ff="monospace" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }} lineClamp={3}>
                        {tool.error ? `error: ${tool.error}` : tool.result}
                      </Text>
                    )}
                  </div>
                </Group>
              );
            })}
          </Stack>
        </Card>
      )}
    </div>
  );
}

export default function AgentExecutionView({ agentId }: AgentExecutionViewProps) {
  const { t } = useLang();
  const { executions, loading, error, fetchExecutions, cancelExecution } = useAgentStore();
  const [live, setLive] = useState<LiveExecution | null>(null);
  const [now, setNow] = useState(Date.now());

  // 1s tick for the elapsed-time readout while work is live.
  useEffect(() => {
    if (!live || live.done) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [live?.done]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    fetchExecutions(agentId);
    const interval = setInterval(() => fetchExecutions(agentId), 3000);
    const unsubscribe = window.electronAPI.onAgentEvent((event) => {
      setLive((prev) => {
        const base = prev && prev.executionId === event.executionId
          ? prev
          : { executionId: event.executionId, text: '', tools: [], done: false, startedAt: Date.now(), failed: false };
        if (event.type === 'chunk' && typeof event.data === 'string') {
          return { ...base, text: base.text + event.data };
        }
        if (event.type === 'tool_call') {
          const name = (event.data as { name?: string })?.name || 'tool';
          return { ...base, tools: [...base.tools, { name }] };
        }
        if (event.type === 'tool_result') {
          const d = event.data as { name?: string; result?: string; error?: string };
          const tools = [...base.tools];
          for (let i = tools.length - 1; i >= 0; i--) {
            if (tools[i].name === d?.name && tools[i].result === undefined && tools[i].error === undefined) {
              tools[i] = { ...tools[i], result: d.result, error: d.error };
              break;
            }
          }
          return { ...base, tools };
        }
        if (event.type === 'done' || event.type === 'error') {
          if (!base.done) {
            if (event.type === 'error') sfxError(); else sfxDone();
          }
          return { ...base, done: true, failed: event.type === 'error' };
        }
        return base;
      });
    });
    return () => { clearInterval(interval); unsubscribe(); };
  }, [agentId, fetchExecutions]);

  const handleCancel = async (executionId: string) => {
    await cancelExecution(executionId);
  };

  const agentExecutions = executions.filter(e => e.agentId === agentId);

  if (loading && agentExecutions.length === 0 && !live) {
    return (
      <Stack align="center" gap="sm" py="xl">
        <PixelSpinner size={24} />
        <Text c="dimmed">{t('aex.loading')}</Text>
      </Stack>
    );
  }

  if (error) {
    return <Text c="dimmed">{t('common.error')}: {error}</Text>;
  }

  if (agentExecutions.length === 0 && !live) {
    return (
      <Card withBorder padding="xl" radius="md">
        <Stack align="center" gap="sm">
          <IconBolt />
          <Text fw={500}>{t('aex.empty')}</Text>
          <Text size="sm" c="dimmed">{t('aex.emptyHint')}</Text>
        </Stack>
      </Card>
    );
  }

  return (
    <Stack gap="md">
      <Group justify="space-between">
        <Title order={3} size="h5">{t('aex.history')}</Title>
        <Button size="xs" variant="default" onClick={() => fetchExecutions(agentId)}>{t('common.refresh')}</Button>
      </Group>

      {live && !live.done && (
        <Card withBorder padding="md" radius="md" className="km-enter">
          <Stack gap="sm">
            <Group justify="space-between">
              <Group gap="xs">
                <PixelSpinner size={16} label={t('aex.streaming')} />
                <Badge size="sm" variant="light" color="gray">{t('aex.streaming')}</Badge>
                <Text size="xs" c="dimmed">{t('aex.elapsed')} {fmtElapsed(now - live.startedAt)}</Text>
              </Group>
              {live.tools.length > 0 && (
                <Text size="xs" c="dimmed">
                  {t('aex.lastTool')}: <Text span ff="monospace">{live.tools[live.tools.length - 1].name}</Text>
                </Text>
              )}
            </Group>
            <div className="km-progress" style={{ height: 4, backgroundColor: 'var(--mantine-color-gray-3)', borderRadius: 2 }} />
            {/* Live plan: request → each tool → response (WorkPlan pattern). */}
            <Card withBorder padding="sm" radius="sm" style={{ backgroundColor: 'var(--mantine-color-gray-0)' }}>
              <Text size="xs" fw={600} mb={4}>{t('aex.plan')}</Text>
              <Stack gap={2}>
                <PlanStep state="done" label={t('aex.stepStart')} />
                {live.tools.slice(0, 6).map((tool, i) => (
                  <PlanStep
                    key={i}
                    state={tool.result !== undefined || tool.error !== undefined ? (tool.error ? 'failed' : 'done') : 'doing'}
                    label={tool.name}
                  />
                ))}
                {live.tools.length > 6 && (
                  <Text size="xs" c="dimmed">+{live.tools.length - 6}</Text>
                )}
                <PlanStep
                  state={live.done ? 'done' : live.text ? 'doing' : 'todo'}
                  label={t('aex.stepRespond')}
                />
              </Stack>
            </Card>

            {live.tools.length > 0 && (
              <Card withBorder padding="sm" radius="sm" style={{ backgroundColor: 'var(--mantine-color-gray-0)' }}>
                <Text size="xs" fw={600} mb={4}>{t('aex.toolCalls')}</Text>
                <Stack gap={2}>
                  {live.tools.map((tool, i) => {
                    const pending = tool.result === undefined && tool.error === undefined;
                    const failed = tool.error !== undefined;
                    return (
                      <Group key={i} gap={6} wrap="nowrap" align="flex-start">
                        <span style={{ width: 14, display: 'inline-flex', justifyContent: 'center', flexShrink: 0, marginTop: 2 }}>
                          {pending ? <PixelSpinner size={14} /> : failed ? (
                            <Text span size="xs" fw={700} c="dark">!</Text>
                          ) : (
                            <Text span size="xs" fw={700}>✓</Text>
                          )}
                        </span>
                        <div style={{ minWidth: 0 }}>
                          <Text size="xs" ff="monospace" fw={500} style={{ wordBreak: 'break-all' }}>{tool.name}</Text>
                          {(tool.result !== undefined || tool.error) && (
                            <Text size="xs" c={failed ? 'dark' : 'dimmed'} ff="monospace" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }} lineClamp={3}>
                              {tool.error ? `error: ${tool.error}` : tool.result}
                            </Text>
                          )}
                        </div>
                      </Group>
                    );
                  })}
                </Stack>
              </Card>
            )}
            {live.text && (
              <Card withBorder padding="sm" radius="sm" style={{ backgroundColor: 'var(--mantine-color-gray-0)' }}>
                <Text size="xs" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{live.text}</Text>
              </Card>
            )}
          </Stack>
        </Card>
      )}

      {agentExecutions.map((execution) => (
        <Card key={execution.id} withBorder padding="md" radius="md" className="km-enter">
          <Stack gap="sm">
            <Group justify="space-between">
              <Group gap={6}>
                <Badge size="sm" variant="light" color="gray">{execution.status}</Badge>
                {execution.output && typeof execution.output === 'object' && (execution.output as Record<string, unknown>).dryRun === true && (
                  <Badge size="sm" variant="filled" color="yellow">{t('aex.dryRun')}</Badge>
                )}
              </Group>
              <Text size="xs" c="dimmed">
                {execution.startedAt ? new Date(execution.startedAt).toLocaleString() : t('aex.notStarted')}
              </Text>
            </Group>

            {execution.status === 'running' && (
              <>
                <div className="km-progress" style={{ height: 4, backgroundColor: 'var(--mantine-color-gray-3)', borderRadius: 2, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${execution.progress}%`, backgroundColor: 'var(--mantine-color-dark-9)', transition: 'width 0.3s ease' }} />
                </div>
                <Text size="xs" c="dimmed">
                  {t('aex.elapsed')} {execution.startedAt ? fmtElapsed(now - new Date(execution.startedAt).getTime()) : '—'}
                </Text>
              </>
            )}

            <div>
              <Text size="xs" fw={600} tt="uppercase" c="dimmed" mb={4}>{t('logs.input')}</Text>
              <Card withBorder padding="sm" radius="sm" style={{ backgroundColor: 'var(--mantine-color-gray-0)' }}>
                <Text size="xs" ff="monospace" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                  {JSON.stringify(execution.input, null, 2)}
                </Text>
              </Card>
            </div>

            {execution.output && typeof execution.output === 'object' && Array.isArray((execution.output as Record<string, unknown>).plannedActions) && (
              <div>
                <Text size="xs" fw={600} tt="uppercase" c="dimmed" mb={4}>{t('aex.plannedActions')}</Text>
                <Card withBorder padding="sm" radius="sm" style={{ backgroundColor: 'var(--mantine-color-gray-0)' }}>
                  <Stack gap={4}>
                    {((execution.output as Record<string, unknown>).plannedActions as Array<{ name: string; args: unknown }>).map((a, i) => (
                      <Group key={i} gap={6} wrap="nowrap" align="flex-start">
                        <Text span size="xs" ff="monospace" fw={600} c="dark">{i + 1}.</Text>
                        <div style={{ minWidth: 0 }}>
                          <Text size="xs" ff="monospace" fw={600} style={{ wordBreak: 'break-all' }}>{a.name}</Text>
                          <Text size="xs" c="dimmed" ff="monospace" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }} lineClamp={2}>
                            {JSON.stringify(a.args)}
                          </Text>
                        </div>
                      </Group>
                    ))}
                    {((execution.output as Record<string, unknown>).plannedActions as unknown[]).length === 0 && (
                      <Text size="xs" c="dimmed">{t('aex.noActions')}</Text>
                    )}
                  </Stack>
                </Card>
              </div>
            )}

            {execution.status !== 'running' && execution.status !== 'pending' && (
              <ExecutionToolCalls executionId={execution.id} />
            )}

            {execution.output && (
              <div>
                <Text size="xs" fw={600} tt="uppercase" c="dimmed" mb={4}>{t('logs.output')}</Text>
                <Card withBorder padding="sm" radius="sm" style={{ backgroundColor: 'var(--mantine-color-gray-0)', maxHeight: 200, overflow: 'auto' }}>
                  <Text size="xs" ff="monospace" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                    {typeof execution.output === 'string'
                      ? execution.output
                      : JSON.stringify(execution.output, null, 2)}
                  </Text>
                </Card>
              </div>
            )}

            {execution.error && (
              <div>
                <Text size="xs" fw={600} tt="uppercase" c="dimmed" mb={4}>{t('common.error')}</Text>
                <Card withBorder padding="sm" radius="sm" style={{ backgroundColor: 'var(--mantine-color-gray-0)' }}>
                  <Text size="xs" ff="monospace">{execution.error}</Text>
                </Card>
              </div>
            )}

            {execution.status === 'running' && (
              <Group justify="flex-end">
                <Button size="compact-xs" variant="default" onClick={() => handleCancel(execution.id)}>{t('common.cancel')}</Button>
              </Group>
            )}
          </Stack>
        </Card>
      ))}
    </Stack>
  );
}
