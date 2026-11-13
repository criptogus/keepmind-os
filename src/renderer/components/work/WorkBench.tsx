import ProjectAccess from './ProjectAccess';
import ProjectSetup from './ProjectSetup';
import {pageItems,type Project} from '../../../shared/projects';
import ConfigurationChat from './ConfigurationChat';
import { isConfigurationRequest } from '../../../shared/configuration';
import DecisionCard from './DecisionCard';
import ConversationDecision from './ConversationDecision';
import type { ConversationInput } from '../../../shared/conversation';
import { workEventLabel } from '../../lib/workLanguage';
import { describeApproval } from '../../lib/plainLanguage';
import ProviderConnections from '../settings/ProviderConnections';
import MaterialPreview from './MaterialPreview';
import { canReviseWork, deliveryState } from '../../../shared/work';
import BusinessGuide from './BusinessGuide';
import WorkspaceConnections from './WorkspaceConnections';
import BotAvatar from '../common/BotAvatar';
import { avatarForAgent } from '../../../shared/avatars';
import type { ToolStep } from '../../../main/execution/CheckpointStore';
import React, { useCallback, useEffect, useState, useRef } from 'react';
import { Alert, Badge, Button, Card, Checkbox, Group, MultiSelect, Pagination, Select, Stack, Modal, Text, Textarea, TextInput, Title } from '@mantine/core';
import { useLang } from '../../lib/i18n';
import type { Agent, Approval, Team } from '../../../shared/types';
import type { WorkAction, WorkSnapshot, WorkStatus, WorkTask, WorkPreview, WorkContext } from '../../../shared/work';
import { WORK_TEMPLATES } from '../../../shared/work';
import Deliverable, { downloadText } from './Deliverable';

export default function WorkBench({ active = true, onNavigate, selectedTaskId, onTaskOpened, requestComposer, onComposerOpened }: { active?: boolean; onNavigate: (section: string) => void; selectedTaskId?: string | null; onTaskOpened?: () => void; requestComposer?: number; onComposerOpened?: () => void }) {
  const { lang } = useLang();
  const tr = (en: string, pt: string) => lang === 'pt' ? pt : en;
  const [data, setData] = useState<WorkSnapshot>({ tasks: [], rules: [] });
  const [projects,setProjects]=useState<Project[]>([]);
  const [projectId,setProjectId]=useState<string|null>(null);
  const [accessOpen,setAccessOpen]=useState(false);
  const [projectSetup,setProjectSetup]=useState(false);
  const [page,setPage]=useState(1);
  const [teams, setTeams] = useState<Team[]>([]);
  const [showGuide, setShowGuide] = useState(false);
  const [guideGeneration, setGuideGeneration] = useState(0);
  const [directRequest, setDirectRequest] = useState(false);
  const [providerConnected, setProviderConnected] = useState<boolean | null>(null);
  const [allAgents, setAgents] = useState<Agent[]>([]);
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [material, setMaterial] = useState<{ title: string; content: string } | null>(null);
  const [expandedDelivery, setExpandedDelivery] = useState(true);
  const [connectionOpen, setConnectionOpen] = useState(false);
  const [connectionEpoch, setConnectionEpoch] = useState(0);
  const [configuration, setConfiguration] = useState<{text?:string}|null>(null);
  const [copied, setCopied] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const deliveryRef = useRef<HTMLElement>(null);
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const [scope, setScope] = useState('all');
  const [artifacts, setArtifacts] = useState<import('../../../shared/artifacts').WorkArtifact[]>([]);
  const [preview, setPreview] = useState<WorkPreview | null>(null);
  const goalRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { if (selectedTaskId) { setSelected(selectedTaskId); onTaskOpened?.(); } }, [selectedTaskId, onTaskOpened]);
  useEffect(() => { if (requestComposer) { setSelected(null); setConnectionOpen(false); setShowGuide(false); setDirectRequest(true); goalRef.current?.focus(); goalRef.current?.scrollIntoView({ block: 'center' }); onComposerOpened?.(); } }, [requestComposer, onComposerOpened]);
  const [connection, setConnection] = useState<WorkContext['connection']>({ mode: 'local', actor: 'local', role: 'owner' });
  const [online, setOnline] = useState(false);
  const [syncedAt, setSyncedAt] = useState('');
  const [startImmediately, setStartImmediately] = useState(true);
  const [reviewRequired, setReviewRequired] = useState(true);
  const [goal, setGoal] = useState(''); const [criteria, setCriteria] = useState('');
  const [project, setProject] = useState(''); const [agentId, setAgentId] = useState<string | null>(null);
  const [dependencies, setDependencies] = useState<string[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  useEffect(()=>setConfiguration(null),[selected,projectId]);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const note = selected ? notes[selected] || '' : '';
  const setNote = (value: string) => { if (selected) setNotes(prev => ({ ...prev, [selected]: value })); };
  const contextKey = useRef('');
  const [checkpoint, setCheckpoint] = useState<{ available: boolean; steps: ToolStep[] }>({ available: false, steps: [] });
  const [verifiedResult, setVerifiedResult] = useState('');
  const mutationPending = useRef(false);
  const [query, setQuery] = useState(''); const [busy, setBusy] = useState(false);
  const [error, setError] = useState(''); const [connectionError, setConnectionError] = useState(''); const [loaded, setLoaded] = useState(false);
  const refreshSequence = useRef(0);
  const refresh = useCallback(async () => {
    const sequence = ++refreshSequence.current;
    try {
      const context = await window.electronAPI.workContext();
      const remote = context.connection.mode === 'remote' ? await window.electronAPI.workspaceConnection() : null;
      const nextTeams = context.connection.mode === 'local' ? await window.electronAPI.getTeams() : [];
      const nextProjects=context.connection.mode==='local' && context.connection.role!=='member' ? await window.electronAPI.projectList() : [];
      if (sequence !== refreshSequence.current) return;
      const key = JSON.stringify([context.connection.mode, context.connection.actor, context.connection.role, context.connection.projects, remote?.url]);
      if (contextKey.current && contextKey.current !== key) { setProjectId(null);setProjects([]);setConfiguration(null); setSelected(null); setGoal(''); setNotes({}); setMaterial(null); setAgentId(null); setCriteria(''); setProject(''); setDependencies([]); setStartImmediately(true); setReviewRequired(true); setConnectionOpen(false); setShowGuide(false); setDirectRequest(false); setGuideGeneration(n => n + 1); }
      contextKey.current = key;
      setApprovals(context.approvals); setData(context.snapshot); setAgents(context.agents); setConnection(context.connection);
      setTeams(nextTeams);setProjects(nextProjects);
      setLoaded(true); setOnline(true); setConnectionError(''); setSyncedAt(new Date().toLocaleTimeString());
    } catch (e) { if (sequence !== refreshSequence.current) return; setOnline(false); setLoaded(true); throw e; }
  }, []);
  useEffect(() => { void refresh().catch(e => setConnectionError(String(e))); const timer = setInterval(() => void refresh().catch(e => setConnectionError(String(e))), 3000); return () => clearInterval(timer); }, [refresh]);
  const activeProject=projects.find(p=>p.id===projectId);
  const agents=allAgents.filter(a=>projectId ? activeProject?.agentIds.includes(a.id) : !a.config.projectId);
  useEffect(()=>setPage(1),[query,scope,projectId]);
  useEffect(() => { if ((!agentId || !agents.some(a => a.id === agentId)) && agents.length) setAgentId(agents.find(a=>!a.managerId)?.id || agents[0].id); }, [agents, agentId, teams]);
  const perform = async (fn: () => Promise<unknown>) => { if (mutationPending.current) return; mutationPending.current = true; setBusy(true); setError(''); try { if (!online) throw new Error(tr('Reconnect before making changes.', 'Reconecte antes de alterar o trabalho.')); await fn(); await refresh(); } catch (e) { setError(tr('Could not complete this step. Your message is preserved; check the latest conversation and try again.', 'Não foi possível concluir esta etapa. Sua mensagem está preservada; confira a conversa atualizada e tente novamente.')); await refresh().catch(() => {}); } finally { mutationPending.current = false; setBusy(false); } };
  const create = () => { if(connection.mode==='local' && connection.role!=='member' && isConfigurationRequest(goal)){setConfiguration({text:goal});setGoal('');return;} return perform(async () => {
    if (!agentId || busy) return;
    const task = await window.electronAPI.workCreate({ goal, criteria: criteria || tr('Deliver a useful result with sources and explicit limitations.', 'Entregue um resultado útil, com fontes e limitações explícitas.'), projectId:projectId || undefined, project: activeProject?.name || project || tr('Workspace', 'Espaço de trabalho'), agentId, dependencies, reviewRequired });
    setGoal(current => current === goal ? '' : current); setCriteria(current => current === criteria ? '' : current); setDependencies(current => current === dependencies ? [] : current); setSelected(task.id);
    if (startImmediately && (connection.mode !== 'local' || await window.electronAPI.isModelConfigured(selectedAgent!.config.model))) await window.electronAPI.workMessage(task.id, { requestId: crypto.randomUUID(), text: '', mode: 'prepare', language: lang }, task.revision);
  });
  };
  const task = data.tasks.find(t => t.id === selected);
  const delivery = task ? deliveryState(task) : { version: 0, updating: false, nextVersion: 1 };
  const speaker = agents.find(a => a.id === task?.agentId);
  const messages = task ? [
    ...(task.conversation?.turns || []).filter((t,i) => !(i === 0 && t.text === task.goal) && !(t.role === 'assistant' && t.text === task.conversation?.decision?.prompt && t === task.conversation?.turns.at(-1))).map(t => ({ id: t.id, at: t.at, author: t.role === 'user' ? 'you' : 'reply', text: t.text, version: 0 })),
    ...task.events.filter(e => ['revision','comment'].includes(e.kind) && !task.conversation?.turns.some(t => t.role === 'user' && t.text === e.text)).map(e => ({ id: e.id, at: e.at, author: 'you', text: e.text, version: 0 })),
    ...(task.deliveries || []).filter(d => delivery.updating || d.version !== delivery.version).map(d => ({ id: `version-${d.version}`, at: d.at, author: 'team', text: d.content, version: d.version })),
  ].sort((a,b) => a.at.localeCompare(b.at)) : [];
  useEffect(() => { setExpandedDelivery(true); setMaterial(null); setConnectionOpen(false); }, [selected]);
  useEffect(() => { setExpandedDelivery(true); }, [task?.output]);
  useEffect(() => { const timer = setTimeout(() => { if (deliveryRef.current) deliveryRef.current.scrollIntoView({ block: 'start' }); else chatEndRef.current?.scrollIntoView({ block: 'end' }); }, 100); return () => clearTimeout(timer); }, [selected, task?.status, task?.output]);
  useEffect(() => { if (task?.conversation?.turns.length) chatEndRef.current?.scrollIntoView({ block: 'end' }); }, [task?.conversation?.turns.at(-1)?.id]);
  useEffect(() => {
    let live = true; setProviderConnected(null);
    const agent = agents.find(a => a.id === (task?.agentId || agentId));
    if (agent && connection.mode === 'local') void window.electronAPI.isModelConfigured(agent.config.model)
      .then(connected => { if (live) setProviderConnected(connected); }).catch(() => { if (live) setProviderConnected(false); });
    return () => { live = false; };
  }, [task?.id, agentId, agents.find(a => a.id === (task?.agentId || agentId))?.config.model, connection.mode, connectionEpoch, active]);
  useEffect(() => {
    let active = true; setArtifacts([]); setPreview(null); setCheckpoint({ available: false, steps: [] }); setVerifiedResult('');
    if (selected) void Promise.all([window.electronAPI.workCheckpoint(selected), window.electronAPI.workPreview(selected), window.electronAPI.workArtifacts(selected)]).then(([cp, plan, files]) => {
      if (active) { setCheckpoint(cp); setPreview(plan); setArtifacts(files); }
    }).catch(e => { if (active) setError(String(e)); });
    return () => { active = false; };
  }, [selected, task?.updatedAt]);
  const action = (id: string, kind: WorkAction) => perform(async () => { await window.electronAPI.workAction(id, kind, note, data.tasks.find(t => t.id === id)?.revision); if (kind === 'comment' || kind === 'revise') setNotes(current => current[id] === note ? { ...current, [id]: '' } : current); });
  const cancelRequest = async () => {
    if (!task) return;
    if (!task.conversation?.pending) { await action(task.id, 'cancel'); return; }
    try { await window.electronAPI.workAction(task.id, 'cancel', '', task.revision); await refresh(); }
    catch { setError(tr('Could not cancel. Refresh the conversation and try again.', 'Não foi possível cancelar. Atualize a conversa e tente novamente.')); }
  };
  const sendMessage = (choice?: ConversationInput['choice'], text?: string, prepare = false) => {
    if (!task) return;
    const id = task.id; const submitted = text ?? note;
    if(!choice && connection.mode==='local' && connection.role!=='member' && isConfigurationRequest(submitted)){setConfiguration({text:submitted});setNote('');return;}
    const decision = task.conversation?.decision;
    void perform(async () => {
      await window.electronAPI.workMessage(id, {
        requestId: crypto.randomUUID(), text: submitted, language: lang,
        mode: prepare || (!task.output && task.status === 'backlog') ? 'prepare' : 'message',
        ...(choice ? { choice, decisionId: decision?.id } : decision && decision.kind !== 'intent' ? { choice: 'clarify' as const, decisionId: decision.id } : {}),
      }, task.revision);
      setNotes(current => current[id] === submitted ? { ...current, [id]: '' } : current);
    });
  };
  const labels: Record<WorkStatus, string> = { backlog: tr('Ready', 'Prontas'), running: tr('In progress', 'Em andamento'), review: tr('Review', 'Revisar'), done: tr('Delivered', 'Entregues'), blocked: tr('Needs attention', 'Precisa de atenção'), cancelled: tr('Cancelled', 'Canceladas') };
  const color = (status: WorkStatus) => ({ backlog: 'gray', running: 'lime', review: 'lime', done: 'lime', blocked: 'red', cancelled: 'gray' })[status];
  const needsDecision = (t: WorkTask) => !!t.conversation?.decision || t.status === 'review' || t.status === 'blocked' || approvals.some(a => a.context.workTaskId === t.id);
  const selectedAgent = agents.find(a => a.id === agentId);
  const needsGuide = connection.mode === 'local' && connection.role !== 'member' && loaded && (showGuide || (!teams.length && !directRequest));
  const visible = data.tasks.filter(t=>projectId ? t.projectId===projectId : !t.projectId).filter(t => `${t.title} ${t.project} ${t.goal}`.toLowerCase().includes(query.toLowerCase()))
    .filter(t => scope === 'all' || (scope === 'attention' ? needsDecision(t) : scope === 'running' ? t.status === 'running' : scope === 'done' ? t.status === 'done' : !['done','cancelled'].includes(t.status)))
    .sort((a,b) => Number(needsDecision(b)) - Number(needsDecision(a)) || b.updatedAt.localeCompare(a.updatedAt));
  const paged=pageItems(visible,page);
  const currentDeliveryAt = task?.output && !delivery.updating ? task.deliveries?.at(-1)?.at || task.completedAt || task.updatedAt : undefined;
  const renderMessage = (message: (typeof messages)[number]) => <div key={message.id} className={`km-chat-message ${message.author === 'you' ? 'km-chat-user' : 'km-chat-agent'}`}>
        <Text size="xs" fw={600} mb="xs">{message.author === 'you' ? tr('You', 'Você') : message.author === 'reply' ? speaker?.name || tr('Your team', 'Seu time') : `${speaker?.name || tr('Your team', 'Seu time')} · ${tr('Version', 'Versão')} ${message.version}`}</Text>
        {message.author === 'you' || message.author === 'reply' ? <Text size="sm" style={{ whiteSpace: 'pre-wrap' }}>{message.text}</Text> : <details><summary>{tr('Previous delivery · version', 'Entrega anterior · versão')} {message.version}</summary><Deliverable content={message.text} /><Button size="xs" variant="default" onClick={() => setMaterial({ title: `${task?.project} · ${tr('Version', 'Versão')} ${message.version}`, content: message.text })}>{tr('Preview material', 'Visualizar material')}</Button></details>}
      </div>;
  const taskCard = (t: WorkTask) => <button key={t.id} className="km-task" aria-current={selected === t.id ? 'true' : undefined} onClick={() => {setSelected(t.id);setProjectId(t.projectId||null);}}>
    <Group justify="space-between"><Text size="xs" c="dimmed">{t.project}</Text><Badge color={color(t.status)} variant="light" size="sm">{t.conversation?.decision ? tr('Waiting for you', 'Aguarda você') : labels[t.status]}</Badge></Group>
    <Text className="km-task-title" fw={600} my="xs">{t.title}</Text>
    <Group justify="space-between"><Group gap={8}><span aria-hidden="true"><BotAvatar definition={avatarForAgent(agents.find(a => a.id === t.agentId) ?? { id: t.agentId })} name={agents.find(a => a.id === t.agentId)?.name} mood={t.status === 'running' ? 'thinking' : t.status === 'done' ? 'happy' : 'idle'} size={28} showBadge={false} /></span><Text size="xs" c="dimmed">{agents.find(a => a.id === t.agentId)?.name ?? tr('Agent', 'Agente')}</Text></Group><Text size="xs" c="dimmed">{t.conversation?.decision ? tr('Continue conversation →', 'Continuar conversa →') : approvals.some(a => a.context.workTaskId === t.id) ? tr('Approval needed', 'Aguarda aprovação') : t.status === 'review' ? tr('Review deliverable →', 'Revisar entrega →') : t.status === 'blocked' ? tr('Resolve blocker →', 'Resolver bloqueio →') : t.status === 'backlog' ? tr('Review plan →', 'Conferir plano →') : new Date(t.updatedAt).toLocaleDateString(lang === 'pt' ? 'pt-BR' : 'en')}</Text></Group>
  </button>;
  const exportWork = () => perform(async () => {
    const json = await window.electronAPI.workExport(); const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = 'keepmind-work.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  return <div className={`km-workbench km-conversations ${task ? 'km-has-conversation' : ''} ${material ? 'km-has-material' : ''} ${connectionOpen ? 'km-has-connection' : ''}`}>
    <aside className="km-conversation-list" aria-label={tr('Conversations', 'Conversas')}>
      <Group justify="space-between"><Title order={1} size="h3">{tr('Projects', 'Projetos')}</Title><Button size="sm" className="km-primary-action" onClick={() => { setConfiguration(null);setSelected(null); setConnectionOpen(false); setShowGuide(false); setDirectRequest(true); }}>{activeProject ? tr('Talk to the team','Conversar com o time') : tr('New request','Novo pedido')}</Button></Group>
      <Select label={tr('Current project','Projeto atual')} value={projectId || 'legacy'} onChange={value=>{setProjectId(value==='legacy'?null:value);setSelected(null);setGoal('');setDependencies([]);setAgentId(null);setConfiguration(null);}} data={[{value:'legacy',label:tr('Previous workspace','Espaço anterior')},...projects.map(p=>({value:p.id,label:p.name}))]} searchable/>
      {connection.mode==='local' && connection.role!=='member' && <Button variant="default" onClick={()=>setProjectSetup(true)}>{tr('New project','Novo projeto')}</Button>}
      <TextInput aria-label={tr('Search work', 'Buscar trabalho')} placeholder={tr('Search conversations…', 'Buscar conversas…')} value={query} onChange={e => setQuery(e.currentTarget.value)} />
      <Select aria-label={tr('Filter conversations', 'Filtrar conversas')} value={scope} onChange={v => setScope(v || 'all')} data={[{value:'all',label:tr('All conversations','Todas as conversas')},{value:'attention',label:tr('Need your decision','Precisam de você')},{value:'running',label:tr('In progress','Em andamento')},{value:'done',label:tr('Delivered','Entregues')}]} />
      <details className="km-conversation-items" open><summary>{tr('Conversations','Conversas')} · {visible.length}</summary>{!loaded ? <Text role="status">{tr('Loading conversations…','Carregando conversas…')}</Text> : !visible.length ? <Text size="sm" c="dimmed">{query || scope !== 'all' ? tr('No conversations match this filter.', 'Nenhuma conversa corresponde ao filtro.') : tr('Your requests and deliveries will stay here.', 'Seus pedidos e entregas ficarão aqui.')}</Text> : paged.items.map(taskCard)}</details>
      {paged.pages>1 && <Pagination total={paged.pages} value={paged.page} onChange={setPage} size="sm" siblings={0} boundaries={1} aria-label={tr('Conversation pages','Páginas de conversas')}/> }
      <Button variant="subtle" size="sm" onClick={() => setOptionsOpen(true)}>{tr('Workspace options','Opções do espaço')}</Button>
      {connection.mode==='local' && connection.role!=='member' && <Button variant="subtle" onClick={()=>setConfiguration({})}>{tr('Configure in chat','Configurar pelo chat')}</Button>}
    </aside>
    <section className="km-conversation-stage" aria-label={tr('Conversation','Conversa')}>
      {activeProject && <Card withBorder className="km-project-heading"><Group justify="space-between"><Text fw={700}>{activeProject.name}</Text><Button size="xs" variant="default" onClick={()=>setAccessOpen(true)}>{tr('Team access and rules','Acessos e regras do time')}</Button></Group><Text size="sm">{activeProject.objective}</Text><details><summary>{tr('Objective, rules and updates','Objetivo, regras e atualizações')}</summary><Text size="sm">{activeProject.metric || tr('Success metric not defined yet','Indicador de sucesso ainda não definido')}</Text><Text size="sm">{activeProject.voice}</Text><Text size="sm">{activeProject.guardrails}</Text><Text size="xs" c="dimmed">{activeProject.reportDaily ? tr('Daily update at ','Atualização diária às ')+activeProject.reportTime : tr('Daily updates are off','Atualizações diárias desativadas')}</Text></details></Card>}

      <div className="km-work-content">
      {(connectionError || error) && <Alert color={error || connectionError ? 'red' : 'gray'} role="alert" title={tr('We could not update your workspace', 'Não conseguimos atualizar seu espaço')}><Text size="sm">{tr('Your text stays here. Try again to reconnect before sending.', 'Seu texto continua aqui. Tente novamente para reconectar antes de enviar.')}</Text><Button mt="sm" variant="default" onClick={() => { setError(''); setConnectionError(''); void refresh().catch(e => setConnectionError(String(e))); }}>{tr('Try again','Tentar novamente')}</Button>{(error || connectionError) && <details><summary>{tr('Technical details','Detalhes técnicos')}</summary><Text size="xs">{error || connectionError}</Text></details>}</Alert>}
{connectionOpen && connection.mode === 'local' && <section className="km-context-connection" aria-label={tr('AI connection', 'Conexão de IA')}><Group justify="space-between"><Text fw={600}>{tr('Connect without leaving your request', 'Conecte sem sair do pedido')}</Text><Button variant="subtle" onClick={() => setConnectionOpen(false)}>{tr('Back to conversation', 'Voltar à conversa')}</Button></Group><ProviderConnections provider={(speaker || selectedAgent)?.config.model?.startsWith('claude') ? 'anthropic' : (speaker || selectedAgent)?.config.model?.startsWith('compatible/') ? undefined : 'openai'} onChange={() => setConnectionEpoch(n => n + 1)} />{providerConnected && <Text role="status">{tr('Connected. Return to your request and start when you are ready.', 'Conectado. Volte ao pedido e inicie quando estiver pronto.')}</Text>}<Button variant="subtle" onClick={() => onNavigate('advanced')}>{tr('Other connections', 'Outras conexões')}</Button></section>}
      {connection.mode === 'local' && connection.role !== 'member' && <div hidden={!!configuration || !!task || connectionOpen || !needsGuide} className={needsGuide && !task && !connectionOpen ? 'km-new-conversation' : undefined}><BusinessGuide key={guideGeneration} onCreated={async result => { await refresh(); setAgentId(result.coordinatorId); setSelected(result.taskId); setShowGuide(false); setGuideGeneration(n => n + 1); }} onSkip={() => { setDirectRequest(true); setShowGuide(false); }} /></div>}
      {!task && !connectionOpen && !needsGuide && !configuration && <div className="km-new-conversation">
    <Card withBorder padding="lg" className="km-command">
      <Title order={2} mb="sm">{activeProject ? tr('How can we move this project forward?','Como vamos fazer este projeto avançar?') : tr('What can we help you with?','Como podemos ajudar você?')}</Title>
      <Textarea ref={goalRef} aria-label={tr('Your request', 'Seu pedido')} placeholder={tr('Describe the result you need and add any useful context…', 'Descreva o resultado que você precisa e inclua o contexto…')} value={goal} onChange={e => setGoal(e.currentTarget.value)} minRows={2} autosize variant="default" styles={{ input: { fontSize: 18, lineHeight: 1.6 } }} />
      {!goal && <Group gap="xs" mt="xs">{WORK_TEMPLATES.map(template => <Button key={template.id} size="xs" variant="subtle" color="gray" onClick={() => { setGoal(lang === 'pt' ? template.goalPt : template.goal); setCriteria(lang === 'pt' ? template.criteriaPt : template.criteria); goalRef.current?.focus(); }}>{lang === 'pt' ? template.titlePt : template.title}</Button>)}</Group>}
      <Group mt="md" justify="space-between" align="center">
        {agents.length > 1 ? <Select aria-label={tr('Team or assistant', 'Time ou assistente')} data={agents.filter(a => !a.managerId).map(a => ({ value: a.id, label: teams.find(t => t.agentIds[0] === a.id)?.name || a.name }))} value={agentId} onChange={setAgentId} searchable /> : <Text size="sm" c="dimmed">{selectedAgent?.name || tr('No agent yet', 'Nenhum agente ainda')}</Text>}
        <Button onClick={create} loading={busy} disabled={!goal.trim() || (!agentId && !isConfigurationRequest(goal)) || !online}>{(isConfigurationRequest(goal)||startImmediately && providerConnected !== false) ? tr('Send request', 'Enviar pedido') : tr('Save request', 'Salvar pedido')}</Button>
      </Group>
      <details className="km-details"><summary>{tr('Customize this request', 'Personalizar pedido')}</summary><Stack mt="md">
        <TextInput disabled={!!projectId} label={tr('Project', 'Projeto')} placeholder={tr('Optional project name', 'Nome do projeto (opcional)')} value={project} onChange={e => setProject(e.currentTarget.value)} />
        <Textarea label={tr('What does a good delivery look like?', 'O que define uma boa entrega?')} value={criteria} onChange={e => setCriteria(e.currentTarget.value)} />
        <MultiSelect label={tr('Wait for completed tasks', 'Aguardar tarefas concluídas')} data={data.tasks.filter(t=>t.projectId===(projectId||undefined)).map(t => ({ value: t.id, label: t.title }))} value={dependencies} onChange={setDependencies} searchable />
        <Checkbox checked={startImmediately} onChange={e => setStartImmediately(e.currentTarget.checked)} label={tr('Prepare the request in conversation', 'Preparar o pedido na conversa')} />
        <Checkbox checked={reviewRequired} onChange={e => setReviewRequired(e.currentTarget.checked)} label={tr('Ask me to accept the final delivery', 'Pedir meu aceite na entrega final')} />
      </Stack></details>
      <Text size="xs" c="dimmed" mt="sm">{tr('Provider usage may incur charges. Sensitive actions still require your approval.', 'O uso do provedor pode gerar custos. Ações sensíveis continuam exigindo sua aprovação.')}{selectedAgent?.config.monthlyBudgetUsd != null && ` ${tr('Agent monthly budget', 'Orçamento mensal do agente')}: US$ ${selectedAgent.config.monthlyBudgetUsd}.`}</Text>
      {loaded && !agents.length && <Button mt="sm" variant="default" onClick={() => onNavigate('new-agent')}>{tr('Create your first agent', 'Criar seu primeiro agente')}</Button>}
      {providerConnected === false && <Alert color="gray" title={tr('One step before starting', 'Falta uma etapa para começar')}><Text size="sm">{tr('Your request will be saved. Connect your AI account to let the team begin.', 'Seu pedido será salvo. Conecte sua conta de IA para o time começar.')}</Text><Button mt="sm" variant="default" onClick={() => setConnectionOpen(true)}>{tr('Connect my AI', 'Conectar minha IA')}</Button></Alert>}
    </Card>

      {connection.mode === 'local' && connection.role !== 'member' && <Button variant="subtle" onClick={() => setShowGuide(true)}>{tr('Build a team for a new challenge', 'Montar um time para outro desafio')}</Button>}</div>}
      {!task&&configuration&&<ConfigurationChat key={projectId||'legacy'} inline initialText={configuration.text} context={projectId?{projectId}:undefined} onBack={()=>setConfiguration(null)}/> }
      {task && !connectionOpen && <div className="km-conversation-content"><Group className="km-chat-heading"><Button className="km-back-conversations" variant="subtle" onClick={() => {setSelected(null);setConfiguration(null);}}>{tr("All conversations", "Todas as conversas")}</Button><BotAvatar definition={avatarForAgent(speaker ?? { id: task.agentId })} name={speaker?.name} mood={task.status === 'running' ? 'thinking' : 'happy'} size={44} showBadge={false} /><div className="km-chat-title"><Title order={2} size="h4">{task.title}</Title><Text size="sm" fw={600}>{speaker?.name || tr('Your team', 'Seu time')}</Text><Text size="xs" c="dimmed">{task.status === 'running' ? delivery.updating ? tr(`Preparing version ${delivery.nextVersion}…`, `Preparando a versão ${delivery.nextVersion}…`) : tr('Your team is preparing the first delivery…', 'O time está preparando sua primeira entrega…') : task.conversation?.decision ? tr('Your answer is the next step', 'O próximo passo é sua resposta') : labels[task.status]}</Text></div><Badge ml="auto" color={color(task.status)}>{task.conversation?.decision ? tr('Waiting for you', 'Aguarda você') : labels[task.status]}</Badge></Group><div className="km-chat-history">
      {task.source && <details className="km-source-details"><summary>{tr('Received from an automation', 'Recebido por uma rotina')} · {new Date(task.source.receivedAt).toLocaleString(lang === 'pt' ? 'pt-BR' : 'en-US')}</summary><Text size="xs" c="dimmed">{tr('Incoming content is context, not permission to act.', 'O conteúdo recebido é contexto, não uma permissão para agir.')}</Text><pre>{JSON.stringify(task.source, null, 2)}</pre></details>}
      <div className="km-chat-message km-chat-user"><Text size="xs" fw={600} mb="xs">{tr('You · Initial request', 'Você · Pedido inicial')}</Text><Text size="sm" style={{ whiteSpace: 'pre-wrap' }}>{task.goal}</Text></div>
      {messages.filter(message => !currentDeliveryAt || message.at < currentDeliveryAt).map(renderMessage)}
      {task.status === 'running' && <div className="km-chat-message km-chat-agent" role="status"><div className="km-typing" aria-hidden="true"><i /><i /><i /></div><Text fw={600}>{delivery.updating ? tr(`Preparing version ${delivery.nextVersion}`, `Preparando a versão ${delivery.nextVersion}`) : tr('Preparing your first delivery', 'Preparando sua primeira entrega')}</Text><Text size="sm" c="dimmed">{delivery.updating ? tr('Your change is underway. Earlier versions stay in this conversation.', 'Seu ajuste está em andamento. As versões anteriores ficam nesta conversa.') : tr('Your team is working on the request. The delivery will appear here.', 'Seu time está trabalhando no pedido. A entrega vai aparecer aqui.')}</Text></div>}
      {approvals.filter(a => a.context.workTaskId === task.id).map(approval => <DecisionCard key={approval.id} title={tr('Authorize an action', 'Autorizar uma ação')} actions={null}><Text fw={600}>{tr('Allow this action?', 'Permitir esta ação?')} {describeApproval(approval, lang).action}</Text><Text size="sm">{describeApproval(approval, lang).target}</Text><Text size="sm" style={{whiteSpace:'pre-wrap'}}>{describeApproval(approval, lang).payload}</Text><details><summary>{tr('Action details', 'Detalhes da ação')}</summary><pre className="km-output">{JSON.stringify(approval.context.args, null, 2)}</pre></details><Group mt="sm"><Button disabled={busy} onClick={() => perform(() => window.electronAPI.approveAction(approval.id))}>{tr('Approve action', 'Aprovar ação')}</Button><Button variant="default" disabled={busy} onClick={() => perform(() => window.electronAPI.rejectAction(approval.id, note || 'Rejected from task review'))}>{tr('Reject', 'Rejeitar')}</Button></Group></DecisionCard>)}
      {task.status === 'backlog' && (!task.conversation?.turns.length || providerConnected === false) && <Alert color="gray" title={delivery.updating ? tr(`Version ${delivery.nextVersion} is ready to start`, `Versão ${delivery.nextVersion} pronta para iniciar`) : tr('Your request is saved', 'Seu pedido está salvo')}>
        <Text size="sm">{tr('Review the request above. When you start, your team will prepare a delivery for you to review.', 'Confira o pedido acima. Ao iniciar, seu time vai preparar uma entrega para você revisar.')}</Text>
        {providerConnected === false && <><Text size="sm" mt="sm">{tr('Connect an AI service so your team can begin.', 'Conecte o serviço de IA para o time começar.')}</Text><Button mt="sm" variant="default" onClick={() => setConnectionOpen(true)}>{tr('Connect my AI', 'Conectar minha IA')}</Button></>}
        <Text size="xs" mt="sm">{tr('Provider usage may incur costs. You can request changes after delivery.', 'O uso do provedor pode gerar custos. Você pode pedir ajustes depois da entrega.')}</Text>
      </Alert>}
      {task.criteria && task.status === 'backlog' && !task.conversation?.turns.length && <Text size="sm">{tr('Expected result: ', 'Resultado esperado: ')}{task.criteria}</Text>}
      {task.status === 'done' && <Text size="sm" c="dimmed">{task.acceptedAt ? tr('Accepted by a reviewer', 'Aceita por um revisor') : tr('Delivered automatically. You can request a correction at any time.', 'Entregue automaticamente. Você pode pedir uma correção a qualquer momento.')}</Text>}
      {task.output && !delivery.updating && <section ref={deliveryRef} className="km-chat-message km-chat-agent" aria-label={tr('Deliverable', 'Entrega')}>
        <Group justify="space-between" mb="md"><div><Text size="xs" c="dimmed">{speaker?.name || tr('Your team', 'Seu time')}</Text><Title order={2} size="h4">{tr('Delivery · Version', 'Entrega · Versão')} {delivery.version}</Title></div><Group gap="xs">
          <Button size="xs" variant="default" onClick={async () => { try { await navigator.clipboard.writeText(task.output!); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { setError(tr('Could not copy. Download the delivery instead.', 'Não foi possível copiar. Baixe a entrega.')); } }}>{copied ? tr('Copied', 'Copiado') : tr('Copy', 'Copiar')}</Button>
        </Group></Group><div className={expandedDelivery ? '' : 'km-chat-excerpt'}><Deliverable content={task.output} /></div>
        <Button size="xs" variant="subtle" mt="sm" onClick={() => setExpandedDelivery(!expandedDelivery)}>{expandedDelivery ? tr('Collapse', 'Recolher resposta') : tr('Read full response', 'Ler resposta completa')}</Button>
        <Button mt="md" variant="default" onClick={() => setMaterial({ title: `${task.title} · ${tr('Version', 'Versão')} ${delivery.version}`, content: task.output! })}>{tr('Open material', 'Abrir material')}</Button>
        {task.status === 'review' && <DecisionCard title={tr('Review this delivery', 'Revisar esta entrega')} status={`v${delivery.version}`} actions={<><Button className="km-approve-action" leftSection={<svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12 4 4L19 6" /></svg>} disabled={busy || !!task.conversation?.pending} onClick={() => action(task.id, 'accept')}>{tr('Approve delivery', 'Aprovar entrega')} · v{delivery.version}</Button><Button variant="default" onClick={() => noteRef.current?.focus()}>{tr('Request a change', 'Pedir ajuste')}</Button></>}><Text size="sm" c="dimmed">{tr('Approve this version when it is ready. Approval does not send or publish it.', 'Aprove esta versão quando estiver pronta. Aprovar não envia nem publica o material.')}</Text></DecisionCard>}
      </section>}
      {currentDeliveryAt && messages.filter(message => message.at >= currentDeliveryAt).map(renderMessage)}
      {task.conversation?.pending && <Text role="status" className="km-conversation-status">{tr('Understanding your message… Your delivery stays unchanged.', 'Entendendo sua mensagem… A entrega continua como está.')}</Text>}
      {!configuration && task.conversation?.decision && <ConversationDecision onConfigure={connection.mode==='local' && connection.role!=='member' ? ()=>setConfiguration({text:task.conversation!.decision!.sourceText||task.conversation!.turns.filter(t=>t.role==='user').at(-1)?.text||task.goal}) : undefined} decision={task.conversation.decision} busy={busy || !!task.conversation.pending} canRevise={canReviseWork(task)} hasDelivery={!!task.output} onAnswer={(choice, text) => sendMessage(choice, text ?? '')} onFocus={() => noteRef.current?.focus()} />}
      {task.conversation?.error && <Alert color="red" title={tr('Could not finish this reply', 'Não foi possível concluir a resposta')}><Text size="sm">{tr('Your message is saved. Check the connection and send again; the delivery has not been replaced by this reply.', 'Sua mensagem está salva. Confira a conexão e envie novamente; esta resposta não substituiu a entrega.')}</Text><details><summary>{tr('Technical details','Detalhes técnicos')}</summary>{task.conversation.error}</details></Alert>}
      {!!artifacts.length && <Stack gap="xs"><Text fw={600}>{tr('Files', 'Arquivos')}</Text><Text size="xs" c="dimmed">{tr('Proposed files. Downloading does not apply or execute them.', 'Arquivos propostos. Baixar não aplica nem executa alterações.')}</Text>{artifacts.map(file => <Card withBorder key={file.id}><Group justify="space-between"><Text size="sm">{file.name} · v{file.version}</Text><Button size="xs" variant="light" onClick={() => setMaterial({ title: file.name, content: file.content })}>{tr('Preview', 'Visualizar')}</Button><Button size="xs" variant="default" onClick={() => downloadText(file.name, file.content)}>{tr('Download', 'Baixar')}</Button></Group><details className="km-details"><summary>{tr('View contents', 'Ver conteúdo')}</summary>{/\.md$/i.test(file.name) ? <Deliverable content={file.content} /> : <pre className="km-output">{file.content}</pre>}<Text size="xs" c="dimmed">SHA-256: {file.sha256}</Text></details></Card>)}</Stack>}
      {preview && <details className="km-details" ><summary>{tr('Execution details', 'Detalhes da execução')}</summary><Card withBorder className="km-plan" mt="sm"><Text size="xs" c="dimmed">{task.executionId}</Text>
        <Text size="sm" mt="xs">{task.criteria}</Text><Text size="sm" mt="xs">{preview.agentName} · {preview.model}</Text>
        <Text size="xs" c="dimmed">{tr('Configured model; routing may choose another model. Routine deliveries complete automatically unless review was requested.', 'Modelo configurado; o roteamento pode escolher outro modelo. Entregas rotineiras são concluídas automaticamente, salvo revisão solicitada.')}</Text>
        {preview.monthlyBudgetUsd != null && <Text size="sm" mt="sm">{tr('Agent monthly budget', 'Orçamento mensal do agente')}: US$ {preview.monthlyBudgetUsd}</Text>}
        <details className="km-details"><summary>{tr('Available tools', 'Ferramentas disponíveis')} ({preview.tools.length})</summary><Text size="sm" mt="xs">{preview.tools.join(', ') || tr('No tools', 'Sem ferramentas')}</Text><Text size="xs" c="dimmed">{tr('Current permissions and action approvals are checked when execution starts.', 'Permissões e aprovações de ações são verificadas na execução.')}</Text></details>
        {!!preview.dependencies.length && <Stack gap="xs" mt="sm">{preview.dependencies.map(dep => <Button key={dep.id} variant="subtle" justify="flex-start" onClick={() => setSelected(dep.id)}>{dep.accepted ? '✓' : '○'} {dep.title}</Button>)}</Stack>}
        {preview.dependencies.some(dep => !dep.accepted) && <Text size="sm" c="orange">{tr('Waiting for dependent deliveries to be accepted.', 'Aguardando o aceite das entregas anteriores.')}</Text>}
      </Card></details>}
      {task.error && <Alert color="red" title={tr('Next step', 'Próximo passo')}>
        {/API key not configured|OAuth token not configured/.test(task.error) ? <><Text size="sm">{tr('Connect the provider, then return to resume this task.', 'Conecte o provedor e volte para retomar esta tarefa.')}</Text><Button mt="sm" size="xs" variant="default" onClick={() => setConnectionOpen(true)}>{tr('Open connections', 'Abrir conexões')}</Button></> : <Text size="sm">{tr('The team could not finish this request. Review the connection and try resuming below.', 'O time não conseguiu concluir o pedido. Confira a conexão e tente retomar abaixo.')}</Text>}
        <details className="km-details"><summary>{tr('Technical details', 'Detalhes técnicos')}</summary><Text size="xs">{task.error}</Text></details>
      </Alert>}
      {task.status === 'blocked' && checkpoint.steps.filter(step => step.state === 'started').map(step => <Alert color="orange" key={step.key} title={tr('Verify before resuming', 'Confira antes de retomar')}>
        <Text size="sm">{tr('This action may have completed. Check its external effect and record the actual result. It will not be executed again.', 'Esta ação pode ter terminado. Confira o efeito externo e registre o resultado real. Ela não será executada novamente.')}</Text>
        <Text fw={600} mt="sm">{step.name}</Text><pre className="km-output">{JSON.stringify(step.args, null, 2)}</pre>
        <Textarea label={tr('Verified result', 'Resultado conferido')} value={verifiedResult} onChange={e => setVerifiedResult(e.currentTarget.value)} />
        <Button mt="sm" disabled={busy || !verifiedResult.trim()} onClick={() => perform(async () => { await window.electronAPI.workReconcile(task.id, step.key, verifiedResult, task.revision); setVerifiedResult(''); })}>{tr('Record verified result', 'Registrar resultado conferido')}</Button>
      </Alert>)}
      <Group>{['backlog','blocked'].includes(task.status) && !task.conversation?.decision && <Button disabled={busy || !online || (connection.mode === 'local' && providerConnected !== true) || !preview || preview.dependencies.some(dep => !dep.accepted) || checkpoint.steps.some(step => step.state === 'started')} onClick={() => task.status === 'backlog' && !task.output ? sendMessage(undefined, '', true) : action(task.id, task.status === 'blocked' && checkpoint.available ? 'resume' : 'run')}>{task.status === 'blocked' && checkpoint.available ? tr('Resume checkpoint', 'Retomar etapa salva') : task.status === 'backlog' && !task.output ? tr('Prepare this request', 'Preparar este pedido') : tr('Start this request', 'Iniciar este pedido')}</Button>}{!['done','cancelled'].includes(task.status) && <details className="km-details"><summary>{tr('Request options', 'Opções do pedido')}</summary><Button variant="default" disabled={busy && !task.conversation?.pending} onClick={() => { if (confirm(tr('Cancel this request? Existing deliveries will stay in the conversation.', 'Cancelar este pedido? As entregas existentes continuarão na conversa.'))) void cancelRequest(); }}>{tr('Cancel request', 'Cancelar pedido')}</Button></details>}</Group>

      <details className="km-details"><summary>{tr('Activity', 'Atividade')} · {task.events.length}</summary>{[...task.events].reverse().map(event => <div className="km-event" key={event.id}><Text size="xs" c="dimmed">{new Date(event.at).toLocaleString(lang === 'pt' ? 'pt-BR' : 'en')} · {workEventLabel(event, lang).label}{event.actorId ? ` · ${event.actorId}` : ''}</Text><Text size="sm" style={{ whiteSpace: 'pre-wrap' }}>{workEventLabel(event, lang).text}</Text></div>)}</details>
      {configuration&&<ConfigurationChat key={task.id} inline initialText={configuration.text} context={{taskId:task.id,...(projectId?{projectId}:{})}} onBack={()=>{setConfiguration(null);setNote('');if(task.conversation?.decision?.kind==='configure')sendMessage('dismiss','');}}/>}
      <div ref={chatEndRef} /></div>
      <div className="km-chat-composer" hidden={!!configuration}><Textarea ref={noteRef} maxLength={4000} aria-label={tr('Message your team', 'Mensagem para o time')} placeholder={task.conversation?.decision ? tr('Write your answer or adjust the brief…', 'Escreva sua resposta ou ajuste o pedido…') : tr('Ask a question, leave a comment or request a change…', 'Faça uma pergunta, comente ou peça um ajuste…')} value={note} onChange={e => setNote(e.currentTarget.value)} minRows={2} maxRows={5} autosize />
        <Group justify="space-between" mt="sm"><Text size="xs" c="dimmed">{!task.output && task.status === 'backlog' ? tr('We will clarify the request together before starting. AI usage may incur costs.', 'Vamos esclarecer o pedido juntos antes de começar. O uso de IA pode gerar custos.') : task.status === 'running' ? tr('Messages are saved for the next revision.', 'Mensagens ficam guardadas para a próxima revisão.') : tr('Questions keep this version. Requested changes create a new one. AI usage may incur costs.', 'Perguntas mantêm esta versão. Ajustes criam uma nova. O uso de IA pode gerar custos.')}</Text><Button className="km-primary-action" loading={busy} disabled={busy || !!task.conversation?.pending || !online || !note.trim()} onClick={() => sendMessage()}>{tr('Send message', 'Enviar mensagem')}</Button></Group>
      </div>
</div>}

    </div></section>
    {material && <MaterialPreview title={material.title} content={material.content} onClose={() => setMaterial(null)} />}
    <Modal opened={optionsOpen} onClose={() => setOptionsOpen(false)} title={tr('Workspace options', 'Opções do espaço')}><Stack>
      <Text size="sm">{connection.mode === 'remote' ? `${connection.actor} · ${connection.role}` : tr('Local workspace', 'Espaço local')} · {tr('Updated', 'Atualizado')} {syncedAt}</Text>
      <WorkspaceConnections />
      <Button variant="default" onClick={() => { setOptionsOpen(false); setRulesOpen(true); }}>{tr('Project rules', 'Regras do projeto')} · {data.rules.filter(r => r.status === 'proposed').length}</Button>
      <Button variant="default" onClick={exportWork} disabled={busy}>{tr('Export work', 'Exportar trabalho')}</Button>
    </Stack></Modal>
    <Modal opened={accessOpen&&!!activeProject} onClose={()=>setAccessOpen(false)} title={tr('Your team','Seu time')} size="lg">{activeProject&&<ProjectAccess key={activeProject.id} project={activeProject} onSaved={()=>void refresh()}/>}</Modal>
    <Modal opened={projectSetup} onClose={()=>setProjectSetup(false)} title={tr('New project','Novo projeto')} size="lg"><ProjectSetup teams={teams} onCreated={p=>{setProjectSetup(false);setProjectId(p.id);setSelected(null);setAgentId(p.agentIds[0]);void refresh();}}/></Modal>
    <Modal opened={rulesOpen} onClose={() => setRulesOpen(false)} size="lg" title={tr('Project rules', 'Regras do projeto')}><Stack><Text c="dimmed">{tr('Corrections become proposed rules. Only approved rules inform future work in the same project and owner scope.', 'Correções viram propostas de regras. Apenas regras aprovadas orientam novos trabalhos do mesmo projeto e responsável.')}</Text>{data.rules.map(rule => <Card key={rule.id} withBorder><Group justify="space-between"><Text fw={600}>{rule.project} · v{rule.version}</Text><Badge>{{ proposed: tr('Proposed', 'Proposta'), active: tr('Active', 'Ativa'), retired: tr('Retired', 'Desativada') }[rule.status]}</Badge></Group><Text my="md" style={{ whiteSpace: 'pre-wrap' }}>{rule.text}</Text><Group>{rule.status !== 'active' && <Button disabled={busy} size="xs" onClick={() => perform(() => window.electronAPI.workReviewRule(rule.id, true, rule.version))}>{tr('Activate', 'Ativar')}</Button>}{rule.status !== 'retired' && <Button disabled={busy} size="xs" variant="default" onClick={() => perform(() => window.electronAPI.workReviewRule(rule.id, false, rule.version))}>{tr('Retire', 'Desativar')}</Button>}</Group></Card>)}</Stack></Modal>

  </div>;
}
