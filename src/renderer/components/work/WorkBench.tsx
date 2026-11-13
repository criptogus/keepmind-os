import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Badge, Button, Card, Drawer, Group, MultiSelect, Select, Stack, Tabs, Text, Textarea, TextInput, Title } from '@mantine/core';
import { useLang } from '../../lib/i18n';
import type { Agent, Approval } from '../../../shared/types';
import type { WorkAction, WorkSnapshot, WorkStatus, WorkTask } from '../../../shared/work';
import { WORK_TEMPLATES } from '../../../shared/work';
import ApprovalQueue from '../governance/ApprovalQueue';

export default function WorkBench({ onNavigate }: { onNavigate: (section: string) => void }) {
  const { lang } = useLang();
  const tr = (en: string, pt: string) => lang === 'pt' ? pt : en;
  const [data, setData] = useState<WorkSnapshot>({ tasks: [], rules: [] });
  const [agents, setAgents] = useState<Agent[]>([]);
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [goal, setGoal] = useState(''); const [criteria, setCriteria] = useState('');
  const [project, setProject] = useState(''); const [agentId, setAgentId] = useState<string | null>(null);
  const [dependencies, setDependencies] = useState<string[]>([]);
  const [selected, setSelected] = useState<string | null>(null); const [note, setNote] = useState('');
  const [query, setQuery] = useState(''); const [busy, setBusy] = useState(false);
  const [error, setError] = useState(''); const [loaded, setLoaded] = useState(false);
  const refresh = useCallback(async () => {
    const [snapshot, list, pending] = await Promise.all([window.electronAPI.workList(), window.electronAPI.getAgents(), window.electronAPI.getPendingApprovals()]);
    setApprovals(pending);
    setData(snapshot); setAgents(list); setLoaded(true);
  }, []);
  useEffect(() => { void refresh().catch(e => setError(String(e))); const timer = setInterval(() => void refresh().catch(e => setError(String(e))), 3000); return () => clearInterval(timer); }, [refresh]);
  useEffect(() => { if (!agentId && agents.length) setAgentId(agents[0].id); }, [agents, agentId]);
  const perform = async (fn: () => Promise<unknown>) => { setBusy(true); setError(''); try { await fn(); await refresh(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); } };
  const create = () => perform(async () => {
    if (!agentId) return;
    const task = await window.electronAPI.workCreate({ goal, criteria, project, agentId, dependencies });
    setGoal(''); setDependencies([]); setSelected(task.id);
  });
  const task = data.tasks.find(t => t.id === selected);
  const action = (id: string, kind: WorkAction) => perform(async () => { await window.electronAPI.workAction(id, kind, note); setNote(''); });
  const labels: Record<WorkStatus, string> = { backlog: tr('Ready', 'Prontas'), running: tr('In progress', 'Em andamento'), review: tr('Review', 'Revisar'), done: tr('Accepted', 'Aceitas'), blocked: tr('Needs attention', 'Precisa de atenção'), cancelled: tr('Cancelled', 'Canceladas') };
  const color = (status: WorkStatus) => ({ backlog: 'gray', running: 'blue', review: 'orange', done: 'teal', blocked: 'red', cancelled: 'gray' })[status];
  const visible = data.tasks.filter(t => `${t.title} ${t.project} ${t.goal}`.toLowerCase().includes(query.toLowerCase()));
  const columns: WorkStatus[] = ['backlog', 'running', 'review', 'done', 'blocked', 'cancelled'];
  const exportWork = () => perform(async () => {
    const json = await window.electronAPI.workExport(); const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = 'keepmind-work.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  return <Stack gap="xl" className="km-workbench">
    <Group justify="space-between" align="flex-start">
      <div><Text className="km-eyebrow">KEEP MIND · BUILD TOGETHER</Text><Title order={1}>{tr('Your work, moving forward.', 'Seu trabalho, avançando.')}</Title><Text c="dimmed" mt={6}>{tr('Define an outcome. Follow the work. Review the result.', 'Defina um objetivo. Acompanhe o trabalho. Revise a entrega.')}</Text></div>
      <Group><Badge variant="outline" color="teal">MIT · OPEN SOURCE</Badge><Button variant="default" size="xs" onClick={exportWork} disabled={busy}>{tr('Export work', 'Exportar trabalho')}</Button></Group>
    </Group>
    {error && <Alert color="red" role="alert" title={tr('Could not complete action', 'Não foi possível concluir')}>{error}</Alert>}
    <Card withBorder radius="lg" padding="lg" className="km-command">
      <Textarea aria-label={tr('What do you want to accomplish?', 'O que você quer realizar?')} placeholder={tr('What do you want to accomplish? Include a repository, context and desired outcome…', 'O que você quer realizar? Inclua um repositório, contexto e o resultado esperado…')} value={goal} onChange={e => setGoal(e.currentTarget.value)} minRows={3} autosize variant="unstyled" styles={{ input: { fontSize: 18 } }} />
      <Group gap="xs" mt="sm">{WORK_TEMPLATES.map(template => <Button key={template.id} size="compact-xs" variant="light" color="gray" onClick={() => { setGoal(template.goal); setCriteria(template.criteria); }}>{lang === 'pt' ? template.titlePt : template.title}</Button>)}</Group>
      <Group mt="lg" align="end" grow><TextInput label={tr('Project', 'Projeto')} placeholder="keepmind-os" value={project} onChange={e => setProject(e.currentTarget.value)} /><Select label={tr('Agent', 'Agente')} data={agents.map(a => ({ value: a.id, label: a.name }))} value={agentId} onChange={setAgentId} searchable /><Button onClick={create} disabled={!goal.trim() || !agentId || busy}>{tr('Create task', 'Criar tarefa')} ↗</Button></Group>
      <details className="km-details"><summary>{tr('Acceptance criteria & dependencies', 'Critérios de aceite e dependências')}</summary><Stack mt="sm"><Textarea label={tr('What does done look like?', 'O que define uma boa entrega?')} value={criteria} onChange={e => setCriteria(e.currentTarget.value)} /><MultiSelect label={tr('Wait for accepted tasks', 'Aguardar tarefas aceitas')} data={data.tasks.map(t => ({ value: t.id, label: t.title }))} value={dependencies} onChange={setDependencies} searchable /></Stack></details>
      {loaded && !agents.length && <Text size="sm" mt="md">{tr('Create your first agent to start.', 'Crie seu primeiro agente para começar.')} <Button size="compact-xs" variant="subtle" onClick={() => onNavigate('agents')}>{tr('Create agent', 'Criar agente')}</Button></Text>}
    </Card>
    <Tabs defaultValue="board"><Tabs.List><Tabs.Tab value="board">{tr('Work', 'Trabalho')} · {data.tasks.length}</Tabs.Tab><Tabs.Tab value="inbox">{tr('Approvals', 'Aprovações')}</Tabs.Tab><Tabs.Tab value="learning">{tr('Project rules', 'Regras do projeto')} · {data.rules.filter(r => r.status === 'proposed').length}</Tabs.Tab></Tabs.List>
      <Tabs.Panel value="board" pt="lg"><TextInput aria-label={tr('Search work', 'Buscar trabalho')} placeholder={tr('Search tasks or projects…', 'Buscar tarefas ou projetos…')} value={query} onChange={e => setQuery(e.currentTarget.value)} mb="lg" />
        {!loaded ? <Text>{tr('Loading…', 'Carregando…')}</Text> : !data.tasks.length ? <div className="km-empty"><Title order={3}>{tr('A clear goal is a good start.', 'Um objetivo claro é um bom começo.')}</Title><Text c="dimmed">{tr('Start with a repository review. Your decisions, corrections and results stay attached to the work.', 'Comece revisando um repositório. Decisões, correções e resultados ficam junto do trabalho.')}</Text></div> : <div className="km-board">{columns.map(status => <section key={status} className="km-column"><Group justify="space-between" mb="md"><Text fw={600} size="sm">{labels[status]}</Text><Badge color={color(status)} variant="light">{visible.filter(t => t.status === status).length}</Badge></Group>{visible.filter(t => t.status === status).map(t => <button key={t.id} className="km-task" onClick={() => { setSelected(t.id); setNote(''); }}><Text size="xs" c="dimmed">{t.project}</Text><Text fw={600} size="sm" my="xs">{t.title}</Text><Group justify="space-between"><Text size="xs" c="dimmed">{agents.find(a => a.id === t.agentId)?.name ?? 'Agent'}</Text><Text size="xs" c="dimmed">{new Date(t.updatedAt).toLocaleDateString()}</Text></Group></button>)}</section>)}</div>}
      </Tabs.Panel>
      <Tabs.Panel value="inbox" pt="lg"><ApprovalQueue /></Tabs.Panel>
      <Tabs.Panel value="learning" pt="lg"><Stack><Text c="dimmed">{tr('Corrections become proposed rules. Only approved rules inform future work in the same project and owner scope.', 'Correções viram propostas de regras. Apenas regras aprovadas orientam novos trabalhos do mesmo projeto e responsável.')}</Text>{data.rules.map(rule => <Card key={rule.id} withBorder><Group justify="space-between"><Text fw={600}>{rule.project} · v{rule.version}</Text><Badge>{rule.status}</Badge></Group><Text my="md" style={{ whiteSpace: 'pre-wrap' }}>{rule.text}</Text><Group>{rule.status !== 'active' && <Button disabled={busy} size="xs" onClick={() => perform(() => window.electronAPI.workReviewRule(rule.id, true))}>{tr('Activate', 'Ativar')}</Button>}{rule.status !== 'retired' && <Button disabled={busy} size="xs" variant="default" onClick={() => perform(() => window.electronAPI.workReviewRule(rule.id, false))}>{tr('Retire', 'Desativar')}</Button>}</Group></Card>)}</Stack></Tabs.Panel>
    </Tabs>
    <Drawer opened={!!task} onClose={() => setSelected(null)} position="right" size="xl" title={task?.title}>
      {task && <Stack gap="lg"><Group><Badge color={color(task.status)}>{labels[task.status]}</Badge><Text size="sm">{task.project}</Text></Group><Text style={{ whiteSpace: 'pre-wrap' }}>{task.goal}</Text><Card withBorder><Text size="xs" fw={700}>{tr('ACCEPTANCE CRITERIA', 'CRITÉRIOS DE ACEITE')}</Text><Text size="sm" mt="xs">{task.criteria}</Text></Card>
      {approvals.filter(a => a.context.workTaskId === task.id).map(approval => <Card withBorder key={approval.id}><Text fw={600}>{tr('Decision needed', 'Decisão necessária')}: {approval.action}</Text><pre className="km-output">{JSON.stringify(approval.context.args, null, 2)}</pre><Group mt="sm"><Button disabled={busy} onClick={() => perform(() => window.electronAPI.approveAction(approval.id))}>{tr('Approve action', 'Aprovar ação')}</Button><Button variant="default" disabled={busy} onClick={() => perform(() => window.electronAPI.rejectAction(approval.id, note || 'Rejected from task review'))}>{tr('Reject', 'Rejeitar')}</Button></Group></Card>)}
      {task.error && <Alert color="red">{task.error}</Alert>}
      <Group>{['backlog','blocked'].includes(task.status) && <Button disabled={busy} onClick={() => action(task.id, 'run')}>{tr('Run task', 'Executar tarefa')}</Button>}{task.status === 'review' && <Button color="teal" disabled={busy} onClick={() => action(task.id, 'accept')}>{tr('Accept result', 'Aceitar entrega')}</Button>}{!['done','cancelled'].includes(task.status) && <Button variant="default" disabled={busy} onClick={() => action(task.id, 'cancel')}>{tr('Cancel', 'Cancelar')}</Button>}</Group>
      {task.output && <div><Text fw={600} mb="xs">{tr('Deliverable', 'Entrega')}</Text><pre className="km-output">{task.output}</pre><Text size="xs" c="dimmed" mt="xs">{tr('Execution', 'Execução')}: {task.executionId}</Text></div>}
      <Textarea label={tr('Feedback or project rule', 'Comentário ou regra do projeto')} value={note} onChange={e => setNote(e.currentTarget.value)} minRows={3} /><Group><Button disabled={busy || !note.trim()} variant="default" onClick={() => action(task.id, 'comment')}>{tr('Comment', 'Comentar')}</Button>{['review','blocked','cancelled','done'].includes(task.status) && <Button disabled={busy || !note.trim()} variant="default" onClick={() => action(task.id, 'revise')}>{tr('Request revision', 'Pedir revisão')}</Button>}<Button disabled={busy || !note.trim()} variant="light" onClick={() => action(task.id, 'propose-rule')}>{tr('Propose rule', 'Propor regra')}</Button></Group>
      <Text fw={600}>{tr('Activity', 'Atividade')}</Text>{[...task.events].reverse().map(event => <div className="km-event" key={event.id}><Text size="xs" c="dimmed">{new Date(event.at).toLocaleString()} · {event.kind}</Text><Text size="sm" style={{ whiteSpace: 'pre-wrap' }}>{event.text}</Text></div>)}</Stack>}
    </Drawer>
  </Stack>;
}
