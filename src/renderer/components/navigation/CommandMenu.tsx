import { useEffect, useId, useRef, useState } from 'react';
import { Modal, TextInput, Button, Text, Loader } from '@mantine/core';
import type { WorkTask } from '../../../shared/work';
import { searchRank } from '../../lib/search';

export default function CommandMenu({ opened, onClose, items, actions, onNavigate, onTask, pt }: {
  opened: boolean; onClose: () => void; items: Array<{ id: string; label: string }>;
  actions: Array<{ id: string; label: string; run: () => void }>;
  onNavigate: (id: string) => void; onTask: (id: string) => void; pt: boolean;
}) {
  const tr = (en: string, br: string) => pt ? br : en;
  const [query, setQuery] = useState(''); const [tasks, setTasks] = useState<WorkTask[]>([]);
  const [error, setError] = useState(false); const [loading, setLoading] = useState(false);
  const [attempt, setAttempt] = useState(0); const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null); const list = useRef<HTMLDivElement>(null);
  const id = useId(); const hasQuery = !!query.trim();
  useEffect(() => { if (opened) { setQuery(''); setSelectedKey(null); } }, [opened]);
  useEffect(() => {
    if (!opened) return;
    let active = true; setTasks([]); setError(false); setLoading(true);
    window.electronAPI.workList().then(data => { if (active) setTasks(data.tasks); })
      .catch(() => { if (active) setError(true); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [opened, attempt]);
  const choose = (run: () => void) => { onClose(); run(); };
  const rank = <T extends { label: string }>(rows: T[]) => rows.map(row => ({row, score:searchRank(query,row.label)})).filter(x => x.score).sort((a,b)=>b.score-a.score).map(x=>x.row);
  const taskMatches = tasks.map(task=>({task,score:searchRank(query,task.title,`${task.project} ${task.goal}`)})).filter(x=>x.score)
    .sort((a,b)=>b.score-a.score || b.task.updatedAt.localeCompare(a.task.updatedAt));
  const statuses: Record<WorkTask['status'],string> = {backlog:tr('Ready','Pronto'),running:tr('In progress','Em andamento'),review:tr('To review','Para revisar'),done:tr('Delivered','Entregue'),blocked:tr('Needs attention','Precisa de atenção'),cancelled:tr('Cancelled','Cancelado')};
  const conversations = taskMatches.slice(0, hasQuery ? 20 : 5).map(({task})=>({key:`task-${task.id}`,label:task.title,detail:`${task.project} · ${task.conversation?.decision ? tr('Waiting for you','Aguarda você') : statuses[task.status]}`,group:hasQuery?tr('Conversations','Conversas'):tr('Recent conversations','Conversas recentes'),run:()=>onTask(task.id)}));
  const shortcuts = rank(actions).map(a=>({key:`action-${a.id}`,label:a.label,detail:'',group:tr('Quick actions','Ações rápidas'),run:a.run}));
  const pages = rank(items).slice(0,hasQuery?20:4).map(p=>({key:`page-${p.id}`,label:p.label,detail:'',group:tr('Go to','Ir para'),run:()=>onNavigate(p.id)}));
  const results = hasQuery ? [...conversations,...shortcuts,...pages] : [...shortcuts,...conversations,...pages];
  const selected = Math.max(0, results.findIndex(result => result.key === selectedKey));
  useEffect(()=>{ list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({block:'nearest'}); },[selected,query]);
  return <Modal opened={opened} onClose={onClose} title={tr('Search KeepMind','Buscar no KeepMind')} size="lg" yOffset="10vh" padding={0} classNames={{content:'km-search-modal',header:'km-search-header',body:'km-search-body'}}>
    <div className="km-search-input"><TextInput ref={input} data-autofocus size="md" variant="unstyled" role="combobox" aria-autocomplete="list" aria-expanded={opened} aria-controls={`${id}-results`} aria-activedescendant={results.length?`${id}-${selected}`:undefined} aria-label={tr('Search','Buscar')} placeholder={tr('Find a conversation, project or page…','Encontre uma conversa, projeto ou página…')} value={query} onChange={e=>{setQuery(e.currentTarget.value);setSelectedKey(null);}} onKeyDown={e=>{
      if(e.nativeEvent.isComposing || e.keyCode===229)return;
      if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();if(results.length)setSelectedKey(results[(selected+(e.key==='ArrowDown'?1:-1)+results.length)%results.length].key);}
      if(e.key==='Enter'&&!e.repeat&&results[selected]){e.preventDefault();choose(results[selected].run);}
    }} rightSectionPointerEvents="auto" rightSectionWidth={query?65:36} rightSection={query?<Button variant="subtle" size="compact-xs" onClick={()=>{setQuery('');setSelectedKey(null);input.current?.focus();}}>{tr('Clear','Limpar')}</Button>:loading?<Loader size="xs" color="gray"/>:null}/></div>
    <div className="km-search-feedback" role="status" aria-atomic="true">{loading?tr('Loading conversations…','Carregando conversas…'):error?tr('Conversations unavailable. Pages and actions still work.','Conversas indisponíveis. Páginas e ações continuam disponíveis.'):hasQuery?tr(`${results.length} results`,`${results.length} resultados`):tr('Recent work and shortcuts in one place.','Seu trabalho recente e atalhos em um só lugar.')}{error&&<Button size="compact-xs" variant="subtle" onClick={()=>setAttempt(n=>n+1)}>{tr('Try again','Tentar novamente')}</Button>}</div>
    <div ref={list} className="km-search-results" role="listbox" id={`${id}-results`} aria-label={tr('Search results','Resultados da busca')}>
      {results.map((result,i)=><div key={result.key} role="presentation">
        {(i===0||results[i-1].group!==result.group)&&<Text className="km-search-group" size="xs" fw={600} c="dimmed" role="presentation">{result.group}</Text>}
        <div role="option" aria-selected={i===selected} id={`${id}-${i}`} data-command-result data-command-label={result.label} className="km-search-result" onMouseDown={e=>e.preventDefault()} onClick={()=>choose(result.run)} onMouseMove={()=>setSelectedKey(result.key)}>
          <div><Text className="km-search-title" size="sm" fw={500}>{result.label}</Text>{result.detail&&<Text className="km-search-detail" size="xs" c="dimmed">{result.detail}</Text>}</div><span className="km-search-enter" aria-hidden="true">↵</span>
        </div>
      </div>)}
      {!results.length&&!loading&&<div className="km-search-empty"><Text fw={600}>{tr('No results for this search','Nenhum resultado para esta busca')}</Text><Text size="sm" c="dimmed">{tr('Try part of a title, a project name or another word.','Tente parte do título, o nome do projeto ou outra palavra.')}</Text></div>}
      {taskMatches.length>conversations.length&&hasQuery&&<Text size="xs" c="dimmed" p="sm">{tr('Showing the first 20 conversations. Refine your search to find more.','Mostrando as primeiras 20 conversas. Refine a busca para encontrar outras.')}</Text>}
    </div>
    <div className="km-search-footer"><span>{tr('↑ ↓ Navigate · Enter Open','↑ ↓ Navegar · Enter Abrir')}</span><span>{tr('Esc Close','Esc Fechar')}</span></div>
  </Modal>;
}
