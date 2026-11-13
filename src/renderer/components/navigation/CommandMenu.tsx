import { useEffect, useState } from 'react';
import { Modal, Stack, TextInput, Button, Text, Alert } from '@mantine/core';
import type { WorkTask } from '../../../shared/work';

export default function CommandMenu({ opened, onClose, items, onNavigate, onTask, pt }: {
  opened: boolean; onClose: () => void; items: Array<{ id: string; label: string }>;
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
  const pages = items.filter(i => i.label.toLocaleLowerCase().includes(term));
  const matches = tasks.filter(t => `${t.title} ${t.project} ${t.goal}`.toLocaleLowerCase().includes(term)).slice(0, 12);
  const choose = (fn: () => void) => { fn(); onClose(); };
  return <Modal opened={opened} onClose={onClose} title={pt ? 'Buscar tarefas e abrir páginas' : 'Search tasks and open pages'} centered>
    <Stack gap="xs">
      <TextInput data-autofocus aria-label={pt ? 'Buscar' : 'Search'} placeholder={pt ? 'Digite um projeto, tarefa ou página…' : 'Type a project, task or page…'} value={query} onChange={e => setQuery(e.currentTarget.value)} onKeyDown={e => {
        if (e.key === 'ArrowDown') { e.preventDefault(); document.querySelector<HTMLButtonElement>('[data-command-result]')?.focus(); }
        if (e.key === 'Enter' && pages.length + matches.length === 1) choose(() => pages.length ? onNavigate(pages[0].id) : onTask(matches[0].id));
      }} />
      <Text size="xs" c="dimmed">{pt ? '↓ e Tab para navegar · Enter para abrir · Esc para fechar' : '↓ and Tab to navigate · Enter to open · Esc to close'}</Text>
      {error && <Alert color="red">{error}</Alert>}
      {!!pages.length && <Text size="xs" fw={700}>{pt ? 'PÁGINAS' : 'PAGES'}</Text>}
      {pages.map(item => <Button data-command-result key={item.id} justify="flex-start" variant="subtle" onClick={() => choose(() => onNavigate(item.id))}>{item.label}</Button>)}
      {!!matches.length && <Text size="xs" fw={700}>{pt ? 'TAREFAS' : 'TASKS'}</Text>}
      {matches.map(task => <Button data-command-result key={task.id} justify="flex-start" variant="subtle" styles={{ label: { whiteSpace: 'normal', textAlign: 'left' }, root: { height: 'auto', minHeight: 38 } }} onClick={() => choose(() => onTask(task.id))}>{task.project} · {task.title}</Button>)}
      {!pages.length && !matches.length && <Text c="dimmed">{pt ? 'Nenhum resultado.' : 'No results.'}</Text>}
    </Stack>
  </Modal>;
}
