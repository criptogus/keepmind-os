import React, { useEffect, useRef, useState } from 'react';
import { Alert, Anchor, Badge, Button, Card, Group, Modal, Select, Stack, Text, TextInput, Title } from '@mantine/core';
import type { Agent } from '../../../shared/types';
import type { SakStatus, SakHit, SakPreview } from '../../../shared/superAgentSkill';
import Deliverable from '../work/Deliverable';
export default function SuperAgentSkillPanel({ onInstalled }: { onInstalled: () => Promise<void> }) {
  const [status,setStatus] = useState<SakStatus>({connected:false,pending:false});
  const [query,setQuery] = useState(''); const [hits,setHits] = useState<SakHit[]>([]); const [searched,setSearched] = useState(false);
  const [preview,setPreview] = useState<SakPreview | null>(null); const [agents,setAgents] = useState<Agent[]>([]); const [agentId,setAgentId] = useState<string | null>(null);
  const [busy,setBusy] = useState(false); const [error,setError] = useState(''); const [notice,setNotice] = useState('');
  const locked = useRef(false); const request = useRef(0);
  useEffect(() => { if(status.connected)setNotice(''); },[status.connected]);
  useEffect(() => { let live = true; void window.electronAPI.sakStatus().then(s => { if(live)setStatus(s); }).catch(e => {if(live)setError(String(e));}); return () => {live=false;}; },[]);
  useEffect(() => { if(!status.pending)return; let live=true; const timer=setInterval(() => { void window.electronAPI.sakStatus().then(s=>{if(live)setStatus(s);}).catch(()=>{}); },700); return ()=>{live=false;clearInterval(timer);}; },[status.pending]);
  const perform = async (fn:()=>Promise<void>) => { if(locked.current)return;locked.current=true;setBusy(true);setError('');try{await fn();}catch(e){setError(e instanceof Error?e.message:String(e));void window.electronAPI.sakStatus().then(setStatus).catch(()=>{});}finally{locked.current=false;setBusy(false);} };
  const search = () => perform(async()=>{const id=++request.current;setPreview(null);setHits([]);setSearched(false);const results=await window.electronAPI.sakSearch(query);if(id===request.current){setHits(results);setSearched(true);}});
  const inspect = (slug:string) => perform(async()=>{const [p,a]=await Promise.all([window.electronAPI.sakPreview(slug),window.electronAPI.getAgents()]);setPreview(p);setAgents(a);setAgentId(null);});
  return <Card withBorder radius="lg" padding="lg" className="km-sak-panel"><Stack gap="md">
    <Group justify="space-between"><div><Text className="km-eyebrow">CATÁLOGO DE HABILIDADES</Text><Title order={3}>Super Agent Skill</Title></div><Badge className={status.connected?'km-lime-badge':''} color="gray">{status.connected?'Conta conectada':status.pending?'Aguardando login':'Não conectado'}</Badge></Group>
    <Text size="sm" c="dimmed">Encontre habilidades, confira as instruções e escolha qual agente vai usá-las.</Text>
    {error && <Alert color="red" role="alert">{error}</Alert>}
    {status.error && <Alert color="red" role="alert">{status.error}</Alert>}
    {(notice || status.notice) && <Text size="sm" role="status">{notice || status.notice}</Text>}
    {!status.connected && !status.pending && <Group><Button className="km-primary-action" loading={busy} onClick={()=>void perform(async()=>{setNotice('');setStatus(await window.electronAPI.sakConnect());})}>Conectar minha conta</Button><Text size="xs" c="dimmed">Login no navegador · acesso somente de leitura ao catálogo</Text></Group>}
    {status.pending && <Alert color="gray" title="Conclua o login no navegador"><Text size="sm">Autorize a conexão no site do Super Agent Skill. Se o site confirmar e esta tela continuar aguardando, use o link do site para retornar ao aplicativo. Não precisa colar chaves aqui.</Text><Group mt="sm">
      {status.authUrl && <Anchor href={status.authUrl} target="_blank" rel="noreferrer">Abrir página de login</Anchor>}
      {status.authUrl && window.electronAPI.platform === 'darwin' && <Button size="xs" variant="default" onClick={()=>void perform(async()=>{await window.electronAPI.loginOpenInSafari('superagentskill');setNotice('Abertura solicitada ao Safari. Conclua o login na janela do navegador.');})}>Não abriu? Usar Safari</Button>}
      {status.authUrl && <Button size="xs" variant="default" onClick={()=>void navigator.clipboard.writeText(status.authUrl!).then(()=>setNotice('Link copiado. Cole no navegador.')).catch(()=>setError('Não foi possível copiar. Use o link acima.'))}>Copiar link</Button>}
      <Button size="xs" variant="default" onClick={()=>void perform(async()=>{setStatus(await window.electronAPI.sakCancel());})}>Cancelar login</Button>
    </Group></Alert>}
    {status.connected && <>
      <form onSubmit={e=>{e.preventDefault();void search();}}><Group align="flex-end"><TextInput style={{flex:1}} label="Que habilidade seu agente precisa?" placeholder="Ex.: planejamento, atendimento, marketing" maxLength={200} value={query} onChange={e=>setQuery(e.currentTarget.value)} /><Button className="km-primary-action" type="submit" loading={busy} disabled={query.trim().length<2}>Buscar habilidades</Button></Group></form>
      <Text size="xs" c="dimmed">Apenas o termo da busca é enviado ao catálogo. Não enviamos seus arquivos ou conversas. O conteúdo encontrado pode estar em inglês.</Text>
      {searched && !hits.length && <Text>Nenhuma habilidade encontrada. Tente outro termo, como “marketing” ou “customer service”.</Text>}
      {hits.map(hit=><Card withBorder key={hit.slug} padding="md"><Group justify="space-between" align="flex-start"><div style={{flex:1}}><Text fw={600}>{hit.name}</Text><Text size="sm" c="dimmed">{hit.description}</Text><Text size="xs" c="dimmed" mt="xs">Versão {hit.version || 'não informada'}</Text></div><Button variant="default" disabled={busy} onClick={()=>void inspect(hit.slug)}>Ver habilidade</Button></Group></Card>)}
      <Group justify="flex-end"><Button variant="subtle" color="gray" disabled={busy} onClick={()=>void perform(async()=>{++request.current;setStatus(await window.electronAPI.sakDisconnect());setHits([]);setPreview(null);setNotice('');})}>Desconectar conta</Button></Group>
    </>}
    <Modal opened={!!preview} onClose={()=>{if(!busy)setPreview(null);}} title="Revisar habilidade" size="lg">
      {preview && <Stack><Title order={3}>{preview.name}</Title><Text size="sm">{preview.description}</Text><Text size="xs" c="dimmed">Super Agent Skill · versão {preview.version}</Text><Alert color="gray">Você está adicionando instruções de terceiros. Confira o conteúdo. Não importaremos scripts nem concederemos novas ferramentas.</Alert><div className="km-skill-preview"><Deliverable content={preview.prompt} /></div>
      <Select label="Qual agente deste computador vai usar esta habilidade?" placeholder="Escolha um agente" searchable data={agents.map(a=>({value:a.id,label:a.name}))} value={agentId} onChange={setAgentId} />
      {!agents.length && <Text size="sm">Crie um agente ou time antes de adicionar uma habilidade.</Text>}
      <Button className="km-primary-action" loading={busy} disabled={!agentId} onClick={()=>void perform(async()=>{const result=await window.electronAPI.sakInstall(preview.digest,agentId!);await onInstalled();setPreview(null);setNotice(`Habilidade “${result.name}” adicionada ao agente.`);})}>Adicionar ao agente</Button></Stack>}
    </Modal>
  </Stack></Card>;
}
