import { useLang } from '../../lib/i18n';
import React, { useEffect, useRef, useState } from 'react';
import { Alert, Anchor, Badge, Button, Card, Group, Modal, Select, Stack, Text, TextInput, Title } from '@mantine/core';
import type { Agent } from '../../../shared/types';
import type { SakStatus, SakHit, SakPreview } from '../../../shared/superAgentSkill';
import Deliverable from '../work/Deliverable';
export default function SuperAgentSkillPanel({ onInstalled }: { onInstalled: () => Promise<void> }) {
  const { t, lang } = useLang();
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
    <Group justify="space-between"><div><Text className="km-eyebrow">{t('flow.skill-catalog')}</Text><Title order={3}>Super Agent Skill</Title></div><Badge className={status.connected?'km-lime-badge':''} color="gray">{status.connected?t('flow.account-connected'):status.pending?t('flow.waiting-for-sign-in'):t('flow.not-connected')}</Badge></Group>
    <Text size="sm" c="dimmed">{t('flow.find-skills-review-their-instructions-and-choose-which-agent')}</Text>
    {error && <Alert color="red" role="alert">{lang === 'pt' ? 'Não foi possível concluir. Tente novamente.' : 'Could not complete this action. Please try again.'}<details><summary>{lang === 'pt' ? 'Detalhes técnicos' : 'Technical details'}</summary>{error}</details></Alert>}
    {status.error && <Alert color="red" role="alert">{lang === 'pt' ? 'A conexão precisa de atenção.' : 'The connection needs attention.'}<details><summary>{lang === 'pt' ? 'Detalhes técnicos' : 'Technical details'}</summary>{status.error}</details></Alert>}
    {(notice || status.notice) && <Text size="sm" role="status">{notice || (lang === 'pt' ? 'Continue a conexão no navegador.' : 'Continue connecting in your browser.')}</Text>}
    {!status.connected && !status.pending && <Group><Button className="km-primary-action" loading={busy} onClick={()=>void perform(async()=>{setNotice('');setStatus(await window.electronAPI.sakConnect());})}>{t('flow.connect-my-account')}</Button><Text size="xs" c="dimmed">{t('flow.sign-in-through-your-browser-read-only-catalog-access')}</Text></Group>}
    {status.pending && <Alert color="gray" title={t('flow.complete-sign-in-in-your-browser')}><Text size="sm">{t('flow.authorize-the-connection-on-super-agent-skill-if-the')}</Text><Group mt="sm">
      {status.authUrl && <Anchor href={status.authUrl} target="_blank" rel="noreferrer">{t('flow.open-sign-in-page')}</Anchor>}
      {status.authUrl && window.electronAPI.platform === 'darwin' && <Button size="xs" variant="default" onClick={()=>void perform(async()=>{await window.electronAPI.loginOpenInSafari('superagentskill');setNotice(t('flow.safari-requested-complete-sign-in-in-the-browser-window'));})}>{t('flow.did-not-open-use-safari')}</Button>}
      {status.authUrl && <Button size="xs" variant="default" onClick={()=>void navigator.clipboard.writeText(status.authUrl!).then(()=>setNotice(t('flow.link-copied-paste-it-in-your-browser'))).catch(()=>setError(t('flow.could-not-copy-use-the-link-above')))}>{t('flow.copy-link')}</Button>}
      <Button size="xs" variant="default" onClick={()=>void perform(async()=>{setStatus(await window.electronAPI.sakCancel());})}>{t('flow.cancel-sign-in')}</Button>
    </Group></Alert>}
    {status.connected && <>
      <form onSubmit={e=>{e.preventDefault();void search();}}><Group align="flex-end"><TextInput style={{flex:1}} label={t('flow.what-skill-does-your-agent-need')} placeholder={t('flow.e-g-planning-customer-service-marketing')} maxLength={200} value={query} onChange={e=>setQuery(e.currentTarget.value)} /><Button className="km-primary-action" type="submit" loading={busy} disabled={query.trim().length<2}>{t('flow.find-skills')}</Button></Group></form>
      <Text size="xs" c="dimmed">{t('flow.only-the-search-term-is-sent-to-the-catalog')}</Text>
      {searched && !hits.length && <Text>{t('flow.no-skills-found-try-another-term-such-as-marketing')}</Text>}
      {hits.map(hit=><Card withBorder key={hit.slug} padding="md"><Group justify="space-between" align="flex-start"><div style={{flex:1}}><Text fw={600}>{hit.name}</Text><Text size="sm" c="dimmed">{hit.description}</Text><Text size="xs" c="dimmed" mt="xs">{lang === 'pt' ? 'Versão' : 'Version'} {hit.version || t('flow.not-provided')}</Text></div><Button variant="default" disabled={busy} onClick={()=>void inspect(hit.slug)}>{t('flow.view-skill')}</Button></Group></Card>)}
      <Group justify="flex-end"><Button variant="subtle" color="gray" disabled={busy} onClick={()=>void perform(async()=>{++request.current;setStatus(await window.electronAPI.sakDisconnect());setHits([]);setPreview(null);setNotice('');})}>{t('flow.disconnect-account')}</Button></Group>
    </>}
    <Modal opened={!!preview} onClose={()=>{if(!busy)setPreview(null);}} title={t('flow.review-skill')} size="lg">
      {preview && <Stack><Title order={3}>{preview.name}</Title><Text size="sm">{preview.description}</Text><Text size="xs" c="dimmed">Super Agent Skill · {lang === 'pt' ? 'versão' : 'version'} {preview.version}</Text><Alert color="gray">{t('flow.you-are-adding-third-party-instructions-review-the-content')}</Alert><div className="km-skill-preview"><Deliverable content={preview.prompt} /></div>
      <Select label={t('flow.which-agent-on-this-computer-will-use-this-skill')} placeholder={t('flow.choose-an-agent')} searchable data={agents.map(a=>({value:a.id,label:a.name}))} value={agentId} onChange={setAgentId} />
      {!agents.length && <Text size="sm">{t('flow.create-an-agent-or-team-before-adding-a-skill')}</Text>}
      <Button className="km-primary-action" loading={busy} disabled={!agentId} onClick={()=>void perform(async()=>{const result=await window.electronAPI.sakInstall(preview.digest,agentId!);await onInstalled();setPreview(null);setNotice(lang === 'pt' ? `Habilidade “${result.name}” adicionada ao agente.` : `Skill “${result.name}” added to the agent.`);})}>{t('flow.add-to-agent')}</Button></Stack>}
    </Modal>
  </Stack></Card>;
}
