import React,{useState} from 'react';
import {Alert,Button,Checkbox,Select,Stack,Text,Textarea,TextInput} from '@mantine/core';
import type {Team} from '../../../shared/types';
import type {Project} from '../../../shared/projects';
import {useLang} from '../../lib/i18n';
export default function ProjectSetup({teams,onCreated}:{teams:Team[];onCreated:(p:Project)=>void}) {
  const {lang}=useLang();const tr=(en:string,pt:string)=>lang==='pt'?pt:en;
  const [name,setName]=useState(''),[objective,setObjective]=useState(''),[metric,setMetric]=useState(''),[voice,setVoice]=useState(''),[guardrails,setGuardrails]=useState('');
  const [teamId,setTeamId]=useState<string|null>(null),[reportDaily,setDaily]=useState(false),[reportTime,setTime]=useState('09:00');
  const [busy,setBusy]=useState(false),[error,setError]=useState(false);
  return <Stack>
    <Text c="dimmed">{tr('Give your team a lasting objective. Requests and deliveries stay inside this project.','Dê ao time um objetivo contínuo. Conversas e entregas ficam dentro deste projeto.')}</Text>
    <TextInput label={tr('Project name','Nome do projeto')} value={name} onChange={e=>setName(e.currentTarget.value)} required maxLength={100}/>
    <Textarea label={tr('What should the team achieve?','O que o time deve alcançar?')} placeholder={tr('Generate more qualified leads while reducing acquisition cost','Gerar mais leads qualificados e reduzir o custo de aquisição')} value={objective} onChange={e=>setObjective(e.currentTarget.value)} required/>
    <TextInput label={tr('How will we measure progress?','Como vamos medir o avanço?')} placeholder={tr('Metric, baseline, target and deadline — if known','Indicador, valor atual, meta e prazo — se souber')} value={metric} onChange={e=>setMetric(e.currentTarget.value)}/>
    <Select label={tr('Start from a team','Começar a partir de um time')} data={teams.map(t=>({value:t.id,label:t.name}))} value={teamId} onChange={setTeamId} required searchable/>
    <Text size="xs" c="dimmed">{tr('Creates independent copies of agents and skills. Connections and memory are not copied.','Cria cópias independentes dos agentes e habilidades. Conexões e memória não são copiadas.')}</Text>
    <details className="km-details"><summary>{tr('Voice and boundaries','Tom de voz e limites')}</summary><Stack mt="sm">
      <Textarea label={tr('Tone of voice','Tom de voz')} value={voice} onChange={e=>setVoice(e.currentTarget.value)}/>
      <Textarea label={tr('Project rules','Regras do projeto')} placeholder={tr('What must the team respect?','O que o time precisa respeitar?')} value={guardrails} onChange={e=>setGuardrails(e.currentTarget.value)}/>
    </Stack></details>
    <Checkbox label={tr('Send me a daily progress update','Preparar uma atualização diária de progresso')} checked={reportDaily} onChange={e=>setDaily(e.currentTarget.checked)}/>
    {reportDaily && <><TextInput type="time" label={tr('Local time','Horário local')} value={reportTime} onChange={e=>setTime(e.currentTarget.value)}/><Text size="xs" c="dimmed">{tr('Runs while the app is open, using the agent budget. Missing data becomes a question, never an invented result.','Executa com o app aberto, dentro do orçamento do agente. Dados ausentes viram perguntas, nunca resultados inventados.')}</Text></>}
    {error&&<Alert color="red">{tr('Could not create this project. Check the fields and try again.','Não foi possível criar o projeto. Confira os campos e tente novamente.')}</Alert>}
    <Button loading={busy} disabled={!name.trim()||!objective.trim()||!teamId} onClick={async()=>{setBusy(true);setError(false);try{onCreated(await window.electronAPI.projectCreate({name,objective,metric,voice,guardrails,teamId:teamId!,reportDaily,reportTime,language:lang}));}catch{setError(true);}finally{setBusy(false);}}}>{tr('Create project','Criar projeto')}</Button>
  </Stack>;
}
