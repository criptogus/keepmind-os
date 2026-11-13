import { useEffect, useState } from 'react';
import { Modal, Stack, TextInput, Button, Text, Alert } from '@mantine/core';
import type { WorkTask } from '../../../shared/work';

export default function CommandMenu({ opened, onClose, items, actions, onNavigate, onTask, pt }: {
  opened: boolean; onClose: () => void; items: Array<{ id: string; label: string }>;
  actions: Array<{ id: string; label: string; run: () => void }>;
  onNavigate: (id: string) => void; onTask: (id: string) => void; pt: boolean;
}) {
  const [query, setQuery] = useState(''); const [tasks, setTasks] = useState<WorkTask[]>([]);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!opened) return;
    let active = true; setQuery(''); setTasks([]); setError('');
    window.electronAPI.workList().then(data => { if (active) setTasks(data.tasks); }).catch(() => { if (active) setError(pt ? 'Não foi possível buscar as tarefas.' : 'Could not search tasks.'); });
    return () => { active = false; };
  }, [opened, pt]);
  const term = query.toLocaleLowerCase().trim();
  const matchingActions = actions.filter(a => a.label.toLocaleLowerCase().includes(term));
  const pages = items.filter(i => i.label.toLocaleLowerCase().includes(term));
  const matches = tasks.filter(t => `${t.title} ${t.project} ${t.goal}`.toLocaleLowerCase().includes(term)).slice(0, 12);
  const choose = (fn: () => void) => { fn(); onClose(); };
  return <Modal opened={opened} onClose={onClose} title={pt ? 'Buscar tarefas e abrir páginas' : 'Search tasks and open pages'} centered>
    <Stack gap="xs" onKeyDown={e => {
      if (!['ArrowDown', 'ArrowUp'].includes(e.key) || !(e.target instanceof HTMLButtonElement)) return;
      const buttons = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('[data-command-result]'));
      const index = buttons.indexOf(e.target); if (index < 0) return;
      e.preventDefault(); buttons[(index + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus();
    }} style={{ maxHeight: '65vh', overflowY: 'auto' }}>
      <TextInput data-autofocus aria-label={pt ? 'Buscar' : 'Search'} placeholder={pt ? 'Digite um projeto, tarefa ou página…' : 'Type a project, task or page…'} value={query} onChange={e => setQuery(e.currentTarget.value)} onKeyDown={e => {
        if (e.key === 'ArrowDown') { e.preventDefault(); document.querySelector<HTMLButtonElement>('[data-command-result]')?.focus(); }
        if (e.key === 'Enter' && pages.length + matches.length + matchingActions.length === 1) choose(() => matchingActions.length ? matchingActions[0].run() : pages.length ? onNavigate(pages[0].id) : onTask(matches[0].id));
      }} />
      <Text size="xs" c="dimmed">{pt ? '↓ e Tab para navegar · Enter para abrir · Esc para fechar' : '↓ and Tab to navigate · Enter to open · Esc to close'}</Text>
      {error && <Alert color="red">{error}</Alert>}
      {matchingActions.map(item => <Button data-command-result key={item.id} justify="flex-start" variant="light" onClick={() => choose(item.run)}>{item.label}</Button>)}
      {!!pages.length && <Text size="xs" fw={700}>{pt ? 'PÁGINAS' : 'PAGES'}</Text>}
      {pages.map(item => <Button data-command-result key={item.id} justify="flex-start" variant="subtle" onClick={() => choose(() => onNavigate(item.id))}>{item.label}</Button>)}
      {!!matches.length && <Text size="xs" fw={700}>{pt ? 'TAREFAS' : 'TASKS'}</Text>}
      {matches.map(task => <Button data-command-result key={task.id} justify="flex-start" variant="subtle" styles={{ label: { whiteSpace: 'normal', textAlign: 'left' }, root: { height: 'auto', minHeight: 38 } }} onClick={() => choose(() => onTask(task.id))}>{task.project} · {task.title}</Button>)}
      {!pages.length && !matches.length && !matchingActions.length && <Text c="dimmed">{pt ? 'Nenhum resultado.' : 'No results.'}</Text>}
    </Stack>
  </Modal>;
}
