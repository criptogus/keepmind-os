import WorkspaceConnections from './WorkspaceConnections';
import BotAvatar from '../common/BotAvatar';
import { avatarForAgent } from '../../../shared/avatars';
import type { ToolStep } from '../../../main/execution/CheckpointStore';
import React, { useCallback, useEffect, useState, useRef } from 'react';
import { Alert, Badge, Button, Card, Checkbox, Drawer, Group, MultiSelect, Select, SegmentedControl, Stack, Modal, Text, Textarea, TextInput, Title } from '@mantine/core';
import { useLang } from '../../lib/i18n';
import type { Agent, Approval } from '../../../shared/types';
import type { WorkAction, WorkSnapshot, WorkStatus, WorkTask, WorkPreview, WorkContext } from '../../../shared/work';
import { WORK_TEMPLATES } from '../../../shared/work';
import Deliverable, { downloadText } from './Deliverable';

export default function WorkBench({ onNavigate, selectedTaskId, onTaskOpened, requestComposer, onComposerOpened }: { onNavigate: (section: string) => void; selectedTaskId?: string | null; onTaskOpened?: () => void; requestComposer?: number; onComposerOpened?: () => void }) {
  const { lang } = useLang();
  const tr = (en: string, pt: string) => lang === 'pt' ? pt : en;
  const [data, setData] = useState<WorkSnapshot>({ tasks: [], rules: [] });
  const [agents, setAgents] = useState<Agent[]>([]);
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const [view, setView] = useState('now');
  const [scope, setScope] = useState('all');
  const [projectFilter, setProjectFilter] = useState<string | null>(null);
  const [artifacts, setArtifacts] = useState<import('../../../shared/artifacts').WorkArtifact[]>([]);
  const [preview, setPreview] = useState<WorkPreview | null>(null);
  const goalRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { if (selectedTaskId) { setSelected(selectedTaskId); onTaskOpened?.(); } }, [selectedTaskId, onTaskOpened]);
  useEffect(() => { if (requestComposer) { setSelected(null); goalRef.current?.focus(); goalRef.current?.scrollIntoView({ block: 'center' }); onComposerOpened?.(); } }, [requestComposer, onComposerOpened]);
  const [connection, setConnection] = useState<WorkContext['connection']>({ mode: 'local', actor: 'local', role: 'owner' });
  const [online, setOnline] = useState(false);
  const [syncedAt, setSyncedAt] = useState('');
  const [startImmediately, setStartImmediately] = useState(true);
  const [reviewRequired, setReviewRequired] = useState(false);
  const [goal, setGoal] = useState(''); const [criteria, setCriteria] = useState('');
  const [project, setProject] = useState(''); const [agentId, setAgentId] = useState<string | null>(null);
  const [dependencies, setDependencies] = useState<string[]>([]);
  const [selected, setSelected] = useState<string | null>(null); const [note, setNote] = useState('');
  const [checkpoint, setCheckpoint] = useState<{ available: boolean; steps: ToolStep[] }>({ available: false, steps: [] });
  const [verifiedResult, setVerifiedResult] = useState('');
  const mutationPending = useRef(false);
  const [query, setQuery] = useState(''); const [busy, setBusy] = useState(false);
  const [error, setError] = useState(''); const [loaded, setLoaded] = useState(false);
  const refresh = useCallback(async () => {
    try {
      const context = await window.electronAPI.workContext();
      setApprovals(context.approvals); setData(context.snapshot); setAgents(context.agents); setConnection(context.connection);
      setLoaded(true); setOnline(true); setSyncedAt(new Date().toLocaleTimeString());
    } catch (e) { setOnline(false); throw e; }
  }, []);
  useEffect(() => { void refresh().catch(e => setError(String(e))); const timer = setInterval(() => void refresh().catch(e => setError(String(e))), 3000); return () => clearInterval(timer); }, [refresh]);
  useEffect(() => { if ((!agentId || !agents.some(a => a.id === agentId)) && agents.length) setAgentId(agents[0].id); }, [agents, agentId]);
  const perform = async (fn: () => Promise<unknown>) => { if (mutationPending.current) return; mutationPending.current = true; setBusy(true); setError(''); try { if (!online) throw new Error(tr('Reconnect before making changes.', 'Reconecte antes de alterar o trabalho.')); await fn(); await refresh(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { mutationPending.current = false; setBusy(false); } };
  const create = () => perform(async () => {
    if (!agentId || busy) return;
    const task = await window.electronAPI.workCreate({ goal, criteria, project, agentId, dependencies, reviewRequired });
    setGoal(''); setCriteria(''); setDependencies([]); setSelected(task.id);
    if (startImmediately) await window.electronAPI.workAction(task.id, 'run', '', task.revision);
  });
  const task = data.tasks.find(t => t.id === selected);
  useEffect(() => {
    let active = true; setArtifacts([]); setPreview(null); setCheckpoint({ available: false, steps: [] }); setVerifiedResult('');
    if (selected) void Promise.all([window.electronAPI.workCheckpoint(selected), window.electronAPI.workPreview(selected), window.electronAPI.workArtifacts(selected)]).then(([cp, plan, files]) => {
      if (active) { setCheckpoint(cp); setPreview(plan); setArtifacts(files); }
    }).catch(e => { if (active) setError(String(e)); });
    return () => { active = false; };
  }, [selected, task?.updatedAt]);
  const action = (id: string, kind: WorkAction) => perform(async () => { await window.electronAPI.workAction(id, kind, note, data.tasks.find(t => t.id === id)?.revision); setNote(''); });
  const labels: Record<WorkStatus, string> = { backlog: tr('Ready', 'Prontas'), running: tr('In progress', 'Em andamento'), review: tr('Review', 'Revisar'), done: tr('Delivered', 'Entregues'), blocked: tr('Needs attention', 'Precisa de atenção'), cancelled: tr('Cancelled', 'Canceladas') };
  const color = (status: WorkStatus) => ({ backlog: 'gray', running: 'blue', review: 'orange', done: 'teal', blocked: 'red', cancelled: 'gray' })[status];
  const needsDecision = (t: WorkTask) => t.status === 'review' || t.status === 'blocked' || approvals.some(a => a.context.workTaskId === t.id);
  const selectedAgent = agents.find(a => a.id === agentId);
  const visible = data.tasks.filter(t => `${t.title} ${t.project} ${t.goal}`.toLowerCase().includes(query.toLowerCase()) && (!projectFilter || t.project === projectFilter))
    .filter(t => scope === 'all' || (scope === 'attention' ? needsDecision(t) : scope === 'running' ? t.status === 'running' : scope === 'done' ? t.status === 'done' : !['done','cancelled'].includes(t.status)))
    .sort((a,b) => Number(needsDecision(b)) - Number(needsDecision(a)) || b.updatedAt.localeCompare(a.updatedAt));
  const taskCard = (t: WorkTask) => <button key={t.id} className="km-task" onClick={() => { setSelected(t.id); setNote(''); }}>
    <Group justify="space-between"><Text size="xs" c="dimmed">{t.project}</Text><Badge color={color(t.status)} variant="light" size="sm">{labels[t.status]}</Badge></Group>
    <Text className="km-task-title" fw={600} my="xs">{t.title}</Text>
    <Group justify="space-between"><Group gap={8}><span aria-hidden="true"><BotAvatar definition={avatarForAgent(agents.find(a => a.id === t.agentId) ?? { id: t.agentId })} mood={t.status === 'running' ? 'thinking' : t.status === 'done' ? 'happy' : 'idle'} size={28} showBadge={false} /></span><Text size="xs" c="dimmed">{agents.find(a => a.id === t.agentId)?.name ?? tr('Agent', 'Agente')}</Text></Group><Text size="xs" c="dimmed">{approvals.some(a => a.context.workTaskId === t.id) ? tr('Approval needed', 'Aguarda aprovação') : t.status === 'review' ? tr('Review deliverable →', 'Revisar entrega →') : t.status === 'blocked' ? tr('Resolve blocker →', 'Resolver bloqueio →') : t.status === 'backlog' ? tr('Review plan →', 'Conferir plano →') : new Date(t.updatedAt).toLocaleDateString()}</Text></Group>
  </button>;
  const columns: WorkStatus[] = ['backlog', 'running', 'review', 'done', 'blocked', 'cancelled'];
  const exportWork = () => perform(async () => {
    const json = await window.electronAPI.workExport(); const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = 'keepmind-work.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  return <Stack gap="lg" className="km-workbench">
    <Group justify="space-between" align="center">
      <div><Title order={1}>{tr('What would you like to get done?', 'O que você quer realizar?')}</Title><Text c="dimmed" mt={6}>{tr('Make a request. Follow the progress. Get your delivery.', 'Faça seu pedido. Acompanhe o progresso. Receba a entrega.')}</Text></div>
      <Button variant="subtle" color="gray" onClick={() => setOptionsOpen(true)}>{tr('Workspace options', 'Opções do espaço')}</Button>
    </Group>
    {!online && <Alert color="orange" role="status">{tr('Connecting or offline — changes disabled', 'Conectando ou offline — alterações desabilitadas')}</Alert>}
    {error && <Alert color="red" role="alert" title={tr('Could not complete action', 'Não foi possível concluir')}>{error}</Alert>}
    <Card withBorder padding="lg" className="km-command">
      <Textarea ref={goalRef} aria-label={tr('Your request', 'Seu pedido')} placeholder={tr('Describe the result you need and add any useful context…', 'Descreva o resultado que você precisa e inclua o contexto…')} value={goal} onChange={e => setGoal(e.currentTarget.value)} minRows={2} autosize variant="unstyled" styles={{ input: { fontSize: 18, lineHeight: 1.6 } }} />
      {!goal && <Group gap="xs" mt="xs">{WORK_TEMPLATES.map(template => <Button key={template.id} size="xs" variant="subtle" color="gray" onClick={() => { setGoal(lang === 'pt' ? template.goalPt : template.goal); setCriteria(lang === 'pt' ? template.criteriaPt : template.criteria); goalRef.current?.focus(); }}>{lang === 'pt' ? template.titlePt : template.title}</Button>)}</Group>}
      <Group mt="md" justify="space-between" align="center">
        {agents.length > 1 ? <Select aria-label={tr('Agent', 'Agente')} data={agents.map(a => ({ value: a.id, label: a.name }))} value={agentId} onChange={setAgentId} searchable /> : <Text size="sm" c="dimmed">{selectedAgent?.name || tr('No agent yet', 'Nenhum agente ainda')}</Text>}
        <Button onClick={create} loading={busy} disabled={!goal.trim() || !agentId || !online}>{startImmediately ? tr('Start work', 'Iniciar trabalho') : tr('Save draft', 'Salvar rascunho')}</Button>
      </Group>
      <details className="km-details"><summary>{tr('Customize this request', 'Personalizar pedido')}</summary><Stack mt="md">
        <TextInput label={tr('Project', 'Projeto')} placeholder={tr('Optional project name', 'Nome do projeto (opcional)')} value={project} onChange={e => setProject(e.currentTarget.value)} />
        <Textarea label={tr('What does a good delivery look like?', 'O que define uma boa entrega?')} value={criteria} onChange={e => setCriteria(e.currentTarget.value)} />
        <MultiSelect label={tr('Wait for completed tasks', 'Aguardar tarefas concluídas')} data={data.tasks.map(t => ({ value: t.id, label: t.title }))} value={dependencies} onChange={setDependencies} searchable />
        <Checkbox checked={startImmediately} onChange={e => setStartImmediately(e.currentTarget.checked)} label={tr('Start immediately', 'Iniciar imediatamente')} />
        <Checkbox checked={reviewRequired} onChange={e => setReviewRequired(e.currentTarget.checked)} label={tr('Ask me to accept the final delivery', 'Pedir meu aceite na entrega final')} />
      </Stack></details>
      <Text size="xs" c="dimmed" mt="sm">{tr('Provider usage may incur charges. Sensitive actions still require your approval.', 'O uso do provedor pode gerar custos. Ações sensíveis continuam exigindo sua aprovação.')}{selectedAgent?.config.monthlyBudgetUsd != null && ` ${tr('Agent monthly budget', 'Orçamento mensal do agente')}: US$ ${selectedAgent.config.monthlyBudgetUsd}.`}</Text>
      {loaded && !agents.length && <Button mt="sm" variant="default" onClick={() => onNavigate('new-agent')}>{tr('Create your first agent', 'Criar seu primeiro agente')}</Button>}
    </Card>
    <section aria-label={tr('Requests and deliveries', 'Pedidos e entregas')}>
      <Group justify="space-between" mb="md">
        <Title order={2}>{tr('Your work', 'Seu trabalho')}</Title>
        <Button variant="subtle" color="gray" size="xs" onClick={() => setOptionsOpen(true)}>{connection.mode === 'remote' ? tr('Shared workspace', 'Espaço compartilhado') : tr('Local workspace', 'Espaço local')}</Button>
      </Group>
      <Group gap="xs" mb="md" className="km-work-filters">
        {[{id:'all',label:tr('All', 'Tudo')}, {id:'attention',label:tr('Need your decision', 'Precisam de você')}, {id:'running',label:tr('In progress', 'Em andamento')}, {id:'done',label:tr('Delivered', 'Entregues')}].map(item => <Button key={item.id} size="sm" variant={scope === item.id ? 'light' : 'subtle'} color="gray" aria-pressed={scope === item.id} onClick={() => setScope(item.id)}>{item.label}{item.id === 'attention' && data.tasks.some(needsDecision) ? ` · ${data.tasks.filter(needsDecision).length}` : ''}</Button>)}
      </Group>
      {!!data.tasks.length && <details className="km-details km-filter-options"><summary>{tr('Search and view options', 'Busca e visualização')}</summary><Group mt="sm" mb="md">
        <TextInput style={{ flex: 1, minWidth: 170 }} aria-label={tr('Search work', 'Buscar trabalho')} placeholder={tr('Search requests…', 'Buscar pedidos…')} value={query} onChange={e => setQuery(e.currentTarget.value)} />
        <Select aria-label={tr('Filter project', 'Filtrar projeto')} placeholder={tr('All projects', 'Todos os projetos')} clearable searchable value={projectFilter} onChange={setProjectFilter} data={[...new Set(data.tasks.map(t => t.project))].sort()} />
        <SegmentedControl aria-label={tr('View', 'Visualização')} value={view} onChange={setView} data={[{value:'now',label:tr('List', 'Lista')},{value:'board',label:tr('Board', 'Quadro')}]} />
      </Group></details>}
      {!loaded ? <Text role="status">{tr('Loading…', 'Carregando…')}</Text> : !data.tasks.length ? <div className="km-empty"><Title order={3}>{tr('Your first delivery starts here.', 'Sua primeira entrega começa aqui.')}</Title><Text c="dimmed">{tr('Describe what you need above. Progress and results will appear here.', 'Descreva acima o que você precisa. O progresso e os resultados aparecerão aqui.')}</Text></div>
        : !visible.length ? <div className="km-empty"><Text>{tr('No work matches this view.', 'Nenhum trabalho nesta visualização.')}</Text><Button mt="sm" variant="subtle" onClick={() => { setScope('all'); setProjectFilter(null); setQuery(''); }}>{tr('Show all tasks', 'Ver todas as tarefas')}</Button></div>
        : view === 'now' ? <div className="km-focus-list">{visible.map(taskCard)}</div>
        : <div className="km-board">{columns.filter(status => visible.some(t => t.status === status)).map(status => <section key={status} className="km-column"><Text fw={600} size="sm" mb="md">{labels[status]}</Text>{visible.filter(t => t.status === status).map(taskCard)}</section>)}</div>}
    </section>
    <Modal opened={optionsOpen} onClose={() => setOptionsOpen(false)} title={tr('Workspace options', 'Opções do espaço')}><Stack>
      <Text size="sm">{connection.mode === 'remote' ? `${connection.actor} · ${connection.role}` : tr('Local workspace', 'Espaço local')} · {tr('Updated', 'Atualizado')} {syncedAt}</Text>
      <WorkspaceConnections />
      <Button variant="default" onClick={() => { setOptionsOpen(false); setRulesOpen(true); }}>{tr('Project rules', 'Regras do projeto')} · {data.rules.filter(r => r.status === 'proposed').length}</Button>
      <Button variant="default" onClick={exportWork} disabled={busy}>{tr('Export work', 'Exportar trabalho')}</Button>
    </Stack></Modal>
    <Modal opened={rulesOpen} onClose={() => setRulesOpen(false)} size="lg" title={tr('Project rules', 'Regras do projeto')}><Stack><Text c="dimmed">{tr('Corrections become proposed rules. Only approved rules inform future work in the same project and owner scope.', 'Correções viram propostas de regras. Apenas regras aprovadas orientam novos trabalhos do mesmo projeto e responsável.')}</Text>{data.rules.map(rule => <Card key={rule.id} withBorder><Group justify="space-between"><Text fw={600}>{rule.project} · v{rule.version}</Text><Badge>{rule.status}</Badge></Group><Text my="md" style={{ whiteSpace: 'pre-wrap' }}>{rule.text}</Text><Group>{rule.status !== 'active' && <Button disabled={busy} size="xs" onClick={() => perform(() => window.electronAPI.workReviewRule(rule.id, true, rule.version))}>{tr('Activate', 'Ativar')}</Button>}{rule.status !== 'retired' && <Button disabled={busy} size="xs" variant="default" onClick={() => perform(() => window.electronAPI.workReviewRule(rule.id, false, rule.version))}>{tr('Retire', 'Desativar')}</Button>}</Group></Card>)}</Stack></Modal>
    <Drawer classNames={{ content: 'km-delivery-drawer' }} opened={!!task} onClose={() => setSelected(null)} position="right" size="xl" title={task?.title}>
      {task && <Stack gap="lg">{error && <Alert color="red" role="alert">{error}</Alert>}<Group><Badge color={color(task.status)}>{labels[task.status]}</Badge><Text size="sm">{task.project}</Text></Group>
      {approvals.filter(a => a.context.workTaskId === task.id).map(approval => <Card withBorder key={approval.id}><Text fw={600}>{tr('Decision needed', 'Decisão necessária')}: {approval.action}</Text><Text size="sm" c="dimmed">{String(approval.context.decisionReason || '')}</Text><pre className="km-output">{JSON.stringify(approval.context.args, null, 2)}</pre><Group mt="sm"><Button disabled={busy} onClick={() => perform(() => window.electronAPI.approveAction(approval.id))}>{tr('Approve action', 'Aprovar ação')}</Button><Button variant="default" disabled={busy} onClick={() => perform(() => window.electronAPI.rejectAction(approval.id, note || 'Rejected from task review'))}>{tr('Reject', 'Rejeitar')}</Button></Group></Card>)}
      {task.status === 'done' && <Text size="sm" c="dimmed">{task.acceptedAt ? tr('Accepted by a reviewer', 'Aceita por um revisor') : tr('Delivered automatically. You can request a correction at any time.', 'Entregue automaticamente. Você pode pedir uma correção a qualquer momento.')}</Text>}
      {task.output && <section aria-label={tr('Deliverable', 'Entrega')}>
        <Group justify="space-between" mb="md"><Title order={2}>{tr('Deliverable', 'Entrega')}</Title><Group gap="xs">
          <Button size="xs" variant="default" onClick={async () => { try { await navigator.clipboard.writeText(task.output!); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { setError(tr('Could not copy. Download the delivery instead.', 'Não foi possível copiar. Baixe a entrega.')); } }}>{copied ? tr('Copied', 'Copiado') : tr('Copy', 'Copiar')}</Button>
          <Button size="xs" variant="default" onClick={() => downloadText('delivery.md', task.output!)}>{tr('Download', 'Baixar')}</Button>
          {['review','blocked','cancelled','done'].includes(task.status) && <Button size="xs" variant="light" onClick={() => { noteRef.current?.focus(); noteRef.current?.scrollIntoView({ block: 'center' }); }}>{tr('Request a change', 'Pedir ajuste')}</Button>}
        </Group></Group><Deliverable content={task.output} />
      </section>}
      {!!artifacts.length && <Stack gap="xs"><Text fw={600}>{tr('Files', 'Arquivos')}</Text><Text size="xs" c="dimmed">{tr('Proposed files. Downloading does not apply or execute them.', 'Arquivos propostos. Baixar não aplica nem executa alterações.')}</Text>{artifacts.map(file => <Card withBorder key={file.id}><Group justify="space-between"><Text size="sm">{file.name} · v{file.version}</Text><Button size="xs" variant="default" onClick={() => downloadText(file.name, file.content)}>{tr('Download', 'Baixar')}</Button></Group><details className="km-details"><summary>{tr('View contents', 'Ver conteúdo')}</summary>{/\.md$/i.test(file.name) ? <Deliverable content={file.content} /> : <pre className="km-output">{file.content}</pre>}<Text size="xs" c="dimmed">SHA-256: {file.sha256}</Text></details></Card>)}</Stack>}
      <details className="km-details" open={!task.output || undefined}><summary>{tr('Original request', 'Pedido original')}</summary><Stack mt="md"><Text style={{ whiteSpace: 'pre-wrap' }}>{task.goal}</Text><Card withBorder><Text size="xs" fw={700}>{tr('ACCEPTANCE CRITERIA', 'CRITÉRIOS DE ACEITE')}</Text><Text size="sm" mt="xs">{task.criteria}</Text></Card></Stack></details>
      {preview && <details className="km-details" open={task.status === 'backlog' || undefined}><summary>{tr('Execution details', 'Detalhes da execução')}</summary><Card withBorder className="km-plan" mt="sm"><Text size="xs" c="dimmed">{task.executionId}</Text>
        <Text size="sm" mt="xs">{preview.agentName} · {preview.model}</Text>
        <Text size="xs" c="dimmed">{tr('Configured model; routing may choose another model. Routine deliveries complete automatically unless review was requested.', 'Modelo configurado; o roteamento pode escolher outro modelo. Entregas rotineiras são concluídas automaticamente, salvo revisão solicitada.')}</Text>
        {preview.monthlyBudgetUsd != null && <Text size="sm" mt="sm">{tr('Agent monthly budget', 'Orçamento mensal do agente')}: US$ {preview.monthlyBudgetUsd}</Text>}
        <details className="km-details"><summary>{tr('Available tools', 'Ferramentas disponíveis')} ({preview.tools.length})</summary><Text size="sm" mt="xs">{preview.tools.join(', ') || tr('No tools', 'Sem ferramentas')}</Text><Text size="xs" c="dimmed">{tr('Current permissions and action approvals are checked when execution starts.', 'Permissões e aprovações de ações são verificadas na execução.')}</Text></details>
        {!!preview.dependencies.length && <Stack gap="xs" mt="sm">{preview.dependencies.map(dep => <Button key={dep.id} variant="subtle" justify="flex-start" onClick={() => setSelected(dep.id)}>{dep.accepted ? '✓' : '○'} {dep.title}</Button>)}</Stack>}
        {preview.dependencies.some(dep => !dep.accepted) && <Text size="sm" c="orange">{tr('Waiting for dependent deliveries to be accepted.', 'Aguardando o aceite das entregas anteriores.')}</Text>}
      </Card></details>}
      {task.error && <Alert color="red" title={tr('Next step', 'Próximo passo')}>
        {/API key not configured|OAuth token not configured/.test(task.error) ? <><Text size="sm">{tr('Connect the provider, then return to resume this task.', 'Conecte o provedor e volte para retomar esta tarefa.')}</Text><Button mt="sm" size="xs" variant="default" onClick={() => onNavigate('advanced')}>{tr('Open connections', 'Abrir conexões')}</Button></> : <Text size="sm">{task.error}</Text>}
        <details className="km-details"><summary>{tr('Technical details', 'Detalhes técnicos')}</summary><Text size="xs">{task.error}</Text></details>
      </Alert>}
      {task.status === 'blocked' && checkpoint.steps.filter(step => step.state === 'started').map(step => <Alert color="orange" key={step.key} title={tr('Verify before resuming', 'Confira antes de retomar')}>
        <Text size="sm">{tr('This action may have completed. Check its external effect and record the actual result. It will not be executed again.', 'Esta ação pode ter terminado. Confira o efeito externo e registre o resultado real. Ela não será executada novamente.')}</Text>
        <Text fw={600} mt="sm">{step.name}</Text><pre className="km-output">{JSON.stringify(step.args, null, 2)}</pre>
        <Textarea label={tr('Verified result', 'Resultado conferido')} value={verifiedResult} onChange={e => setVerifiedResult(e.currentTarget.value)} />
        <Button mt="sm" disabled={busy || !verifiedResult.trim()} onClick={() => perform(async () => { await window.electronAPI.workReconcile(task.id, step.key, verifiedResult, task.revision); setVerifiedResult(''); })}>{tr('Record verified result', 'Registrar resultado conferido')}</Button>
      </Alert>)}
      <Group>{['backlog','blocked'].includes(task.status) && <Button disabled={busy || !preview || preview.dependencies.some(dep => !dep.accepted) || checkpoint.steps.some(step => step.state === 'started')} onClick={() => action(task.id, task.status === 'blocked' && checkpoint.available ? 'resume' : 'run')}>{task.status === 'blocked' && checkpoint.available ? tr('Resume checkpoint', 'Retomar etapa salva') : tr('Run task', 'Executar tarefa')}</Button>}{task.status === 'review' && <Button color="teal" disabled={busy} onClick={() => action(task.id, 'accept')}>{tr('Accept result', 'Aceitar entrega')}</Button>}{!['done','cancelled'].includes(task.status) && <Button variant="default" disabled={busy} onClick={() => action(task.id, 'cancel')}>{tr('Cancel', 'Cancelar')}</Button>}</Group>

      <Textarea ref={noteRef} label={tr('What would you like to change?', 'O que você gostaria de ajustar?')} value={note} onChange={e => setNote(e.currentTarget.value)} minRows={3} /><Group><Button disabled={busy || !note.trim()} variant="default" onClick={() => action(task.id, 'comment')}>{tr('Comment', 'Comentar')}</Button>{['review','blocked','cancelled','done'].includes(task.status) && <Button disabled={busy || !note.trim()} variant="default" onClick={() => action(task.id, 'revise')}>{tr('Request revision', 'Pedir revisão')}</Button>}<Button disabled={busy || !note.trim()} variant="light" onClick={() => action(task.id, 'propose-rule')}>{tr('Propose rule', 'Propor regra')}</Button></Group>
      <details className="km-details"><summary>{tr('Activity', 'Atividade')} · {task.events.length}</summary>{[...task.events].reverse().map(event => <div className="km-event" key={event.id}><Text size="xs" c="dimmed">{new Date(event.at).toLocaleString()} · {event.kind}{event.actorId ? ` · ${event.actorId}` : ''}</Text><Text size="sm" style={{ whiteSpace: 'pre-wrap' }}>{event.text}</Text></div>)}</details></Stack>}
    </Drawer>
  </Stack>;
}
