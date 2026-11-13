import { formatConfigurationValue } from '../../lib/configurationPresentation';
import React, { useEffect, useRef, useState } from 'react';
import { Alert, Button, Group, PasswordInput, Stack, Text, Textarea, Title } from '@mantine/core';
import { oauthActions, credentialActions, configurationLabels, type ConfigurationContext, type ConfigurationState } from '../../../shared/configuration';
import { useLang } from '../../lib/i18n';
import { useSettingsStore } from '../../store/settingsStore';
import { useThemeStore } from '../../store/themeStore';
import DecisionCard from './DecisionCard';
import ProviderConnections from '../settings/ProviderConnections';
import LoadFeedback from '../common/LoadFeedback';

export default function ConfigurationChat({ initialText, onBack, context, inline=false }: { initialText?:string; onBack:()=>void; context?:ConfigurationContext; inline?:boolean }) {
 const {lang,setLang}=useLang(); const tr=(pt:string,en:string)=>lang==='pt'?pt:en;
 const [credentials,setCredentials]=useState<Record<string,string>>({});
 const [state,setState]=useState<ConfigurationState>({turns:[]}); const [text,setText]=useState(initialText||'');
 const [busy,setBusy]=useState(false); const [error,setError]=useState(''); const [providers,setProviders]=useState(false);
 const [names,setNames]=useState<Record<string,string>>({});
 useEffect(()=>{void Promise.all([window.electronAPI.getAgents(),window.electronAPI.getSkills(),window.electronAPI.triggersList(),window.electronAPI.getTeams(),window.electronAPI.projectList(),window.electronAPI.projectConnections(),window.electronAPI.projectStandards()]).then(groups=>setNames(Object.fromEntries(groups.flat().map(item=>[item.id,item.name])))).catch(()=>{});},[state.turns.length]);
 const guard=useRef(false); const end=useRef<HTMLDivElement>(null);
 const refresh=async()=>setState(await window.electronAPI.configurationState(context));
 useEffect(()=>{void refresh().catch(()=>setError(tr('Não foi possível carregar esta conversa.','Could not load this conversation.')));const timer=setInterval(()=>void refresh().catch(()=>{}),1500);return()=>clearInterval(timer);},[]);
 useEffect(()=>{end.current?.scrollIntoView({block:'nearest'});},[state.turns.length]);
 const execute=async(id:string)=>{
   setState(await window.electronAPI.configurationExecute(id,lang,credentials[id]||undefined,context));
   setCredentials(current=>{const next={...current};delete next[id];return next;});
   await Promise.all([useSettingsStore.getState().fetchSettings(),useThemeStore.getState().initTheme()]);
   const nextLanguage=useSettingsStore.getState().settings.language; if((nextLanguage==='pt'||nextLanguage==='en')&&nextLanguage!==lang)setLang(nextLanguage);
 };
 const perform=async(action:()=>Promise<void>)=>{if(guard.current)return;guard.current=true;setBusy(true);setError('');try{await action();}catch{setError(tr('Não foi possível concluir. Sua mensagem foi mantida. Confira a conexão e tente novamente.','Could not complete. Your message was kept. Check your connection and try again.'));await refresh().catch(()=>{});}finally{guard.current=false;setBusy(false);}};
 const send=()=>perform(async()=>{const sent=text;const result=await window.electronAPI.configurationMessage(sent,lang,context);setState(result.state);setText(current=>current===sent?'':current);if(result.autoStart)await execute(result.autoStart);});
 const initialSent=useRef(false);
 useEffect(()=>{if(initialText&&!initialSent.current){initialSent.current=true;void send();}},[]);
 const active=busy||state.pending||state.turns.some(t=>t.plan?.status==='running');
 return <section className={`km-configuration-chat ${inline?'km-configuration-inline':'km-new-conversation'}`} aria-label={tr('Configurar pela conversa','Configure in conversation')}>
  {!inline&&<Group justify="space-between"><Title order={2} size="h4">{tr('Configurar pela conversa','Configure in conversation')}</Title><Button variant="subtle" onClick={onBack}>{tr('Voltar ao pedido','Back to request')}</Button></Group>}
  {!initialText&&!state.turns.length&&<Text size="sm" c="dimmed">{tr('O que vamos ajustar?','What shall we adjust?')}</Text>}
  {initialText&&!state.turns.length&&<><div className="km-chat-message km-chat-user"><Text size="sm">{initialText}</Text></div>{busy&&<LoadFeedback loading label={tr('Preparando a configuração…','Preparing configuration…')}/>}</>}
  <Stack gap="md" mt="md">{state.turns.map(turn=><React.Fragment key={turn.id}>
   <div className={`km-chat-message ${turn.role==='user'?'km-chat-user':'km-chat-agent'}`}><Text size="sm" style={{whiteSpace:'pre-wrap'}}>{turn.text}</Text></div>
   {turn.plan&&<DecisionCard title={configurationLabels[turn.plan.action][lang==='pt'?0:1]} status={turn.plan.status==='done'?tr('Concluído','Completed'):turn.plan.status==='running'?tr('Em andamento','In progress'):turn.plan.status==='failed'?tr('Precisa de atenção','Needs attention'):turn.plan.status==='dismissed'?tr('Não aplicado','Not applied'):tr('Confira antes de aplicar','Review before applying')} actions={turn.plan.status==='ready'?<><Button disabled={!!active || (credentialActions.has(turn.plan.action)&&!credentials[turn.plan.id])} color={/\.(delete|remove)$/.test(turn.plan.action)?'red':undefined} variant={/\.(delete|remove)$/.test(turn.plan.action)?'light':'filled'} className={/\.(delete|remove)$/.test(turn.plan.action)?undefined:'km-primary-action'} onClick={()=>void perform(()=>execute(turn.plan!.id))}>{/\.(delete|remove)$/.test(turn.plan.action)?tr('Confirmar exclusão','Confirm deletion'):oauthActions.has(turn.plan.action)?tr('Conectar conta','Connect account'):tr('Aplicar configuração','Apply configuration')}</Button><Button variant="default" disabled={!!active} onClick={()=>void perform(async()=>setState(await window.electronAPI.configurationDismiss(turn.plan!.id,context)))}>{tr('Agora não','Not now')}</Button></>:null}>
    {turn.plan.action==='project.brainConnect'&&<Text size="sm" mb="sm">{tr('Cria uma conexão exclusiva, somente para leitura. Substitui apenas o Second Brain deste projeto. As outras contas atuais são mantidas; a seleção de contas passa a ser própria do projeto, sem acompanhar futuras mudanças nas contas da empresa.','Creates a separate read-only connection. Replaces only this project’s Second Brain. Other current accounts stay selected; account selection becomes project-specific and will not follow future company account changes.')}</Text>}
    {credentialActions.has(turn.plan.action)&&turn.plan.status==='ready'&&<PasswordInput autoComplete="off" label={tr('Credencial de acesso — campo seguro','Access credential — secure field')} description={tr('Não será enviada à IA nem salva nas mensagens.','Not sent to AI or stored in messages.')} value={credentials[turn.plan.id]||''} onChange={e=>{const value=e.currentTarget.value;setCredentials(current=>({...current,[turn.plan!.id]:value}));}}/> }
    {Object.keys(turn.plan.args).length>0&&<dl className="km-config-values">{Object.entries(turn.plan.args).map(([key,value])=><React.Fragment key={key}><dt>{parameterLabels[key]?.[lang==='pt'?0:1] || key}</dt><dd>{formatConfigurationValue(key,value,lang,names)}</dd></React.Fragment>)}</dl>}
    {turn.plan.status==='running'&&<><LoadFeedback loading label={tr('Preparando a configuração…','Preparing configuration…')}/><Text size="sm">{oauthActions.has(turn.plan.action)?tr('Conclua o login no navegador. Só confirmaremos a conexão após a autorização.','Complete sign-in in your browser. Connection is confirmed only after authorization.'):tr('Aplicando a configuração…','Applying configuration…')}</Text></>}
    {oauthActions.has(turn.plan.action)&&turn.plan.status==='running'&&<ConnectionRecovery action={turn.plan.action} provider={String(turn.plan.args.provider||'')} />}
   </DecisionCard>}
  </React.Fragment>)}</Stack>
  {error&&<Alert role="alert" color="red" mt="md">{error}</Alert>}
  {providers&&<ProviderConnections onChange={()=>void refresh()}/>}
  <div ref={end}/>
  {inline&&<Button size="xs" variant="subtle" onClick={onBack}>{tr('Continuar a conversa com o time','Continue conversation with team')}</Button>}
  <Textarea mt="md" aria-label={tr('Pedido de configuração','Configuration request')} value={text} onChange={e=>setText(e.currentTarget.value)} placeholder={tr('Ex.: conectar Granola, mudar o idioma, criar uma rotina…','E.g. connect Granola, change language, create a routine…')} minRows={2} maxRows={6} autosize />
  <Text size="xs" c="dimmed" mt="sm">{tr('A interpretação usa sua conta de IA. Sem agente configurado, o assistente temporário tem limite de proteção de US$ 5/mês.','Interpretation uses your AI account. Without a configured agent, the temporary assistant has a US$5/month safety cap.')}</Text>
  <Group mt="sm" justify="space-between"><Button variant="subtle" onClick={()=>setProviders(v=>!v)}>{tr('Conectar minha IA','Connect my AI')}</Button><Button className="km-primary-action" loading={busy} disabled={!!active||!text.trim()} onClick={()=>void send()}>{tr('Enviar','Send')}</Button></Group>
 </section>;
}
function ConnectionRecovery({action,provider}:{action:string;provider:string}){
 const {lang}=useLang();const [error,setError]=useState('');
 const perform=async(cancel=false)=>{setError('');try{
   if(action==='granola.connect'){if(cancel)await window.electronAPI.granolaCancel();else await window.electronAPI.granolaOpenLogin();}
   else if(action==='skills.connect'){if(cancel)await window.electronAPI.sakCancel();else await window.electronAPI.loginOpenInSafari('superagentskill');}
   else if(provider==='openai'||provider==='anthropic'){if(cancel)await window.electronAPI.oauthCancel(provider);else await window.electronAPI.loginOpenInSafari(provider);}
 }catch{setError(lang==='pt'?'Não foi possível abrir ou cancelar o login. Aguarde a preparação da conexão e tente novamente.':'Could not open or cancel sign-in. Wait for the connection to be prepared and try again.');}};
 return <><Group mt="sm"><Button variant="default" onClick={()=>void perform()}>{lang==='pt'?'Abrir página de login':'Open sign-in page'}</Button><Button variant="subtle" onClick={()=>void perform(true)}>{lang==='pt'?'Cancelar login':'Cancel sign-in'}</Button></Group>{error&&<Text role="alert" size="sm" c="red">{error}</Text>}</>;
}

const parameterLabels:Record<string,[string,string]>={projectId:['Projeto','Project'],objective:['Objetivo do projeto','Project objective'],metric:['Indicador de sucesso','Success metric'],voice:['Tom de voz','Tone of voice'],guardrails:['Regras e limites','Rules and boundaries'],reportDaily:['Atualização diária','Daily update'],reportTime:['Horário da atualização','Update time'],inheritConnections:['Usar conexões da empresa','Use company connections'],inheritSkills:['Usar habilidades da empresa','Use company skills'],policy:['Acessos e regras','Access and rules'],connectionIds:['Contas conectadas','Connected accounts'],baseUrl:['Endereço do provedor','Provider address'],inputUsdPerMillion:['Custo de entrada por milhão (US$)','Input cost per million (US$)'],outputUsdPerMillion:['Custo de saída por milhão (US$)','Output cost per million (US$)'],maxOutputTokens:['Limite de saída','Output limit'],maxRunUsd:['Limite por execução (US$)','Per-run limit (US$)'],teamId:['Time','Team'],shared:['Compartilhado','Shared'],problem:['Problema','Problem'],priority:['Objetivo','Goal'],roles:['Papéis no time','Team roles'],firstRequest:['Primeiro pedido','First request'],companyId:['Empresa','Company'],dataRoot:['Pasta de dados','Data folder'],entry:['Documento inicial','Entry document'],node:['Nó de memória','Memory node'],level:['Nível de acesso','Access level'],allowedRoots:['Pastas autorizadas','Authorized folders'],shellAllow:['Comandos permitidos','Allowed commands'],shellDeny:['Comandos bloqueados','Blocked commands'],toolApprovalRequired:['Exigir aprovação antes de agir','Require approval before acting'],transport:['Tipo de conexão','Connection type'],command:['Programa a executar','Program to execute'],args:['Argumentos','Arguments'],envNames:['Variáveis de ambiente','Environment variables'],tokenEnv:['Variável da credencial','Credential variable'],automaticReadTools:['Leituras sem nova aprovação','Reads without further approval'],minutes:['Intervalo em minutos','Interval in minutes'],theme:['Tema','Theme'],language:['Idioma','Language'],soundEffects:['Sons da interface','Interface sounds'],memorySemanticSearch:['Busca semântica','Semantic search'],skillsAutoRoute:['Seleção automática de habilidades','Automatic skill selection'],llmAutoRoute:['Seleção automática de modelo','Automatic model selection'],maxConcurrentExecutions:['Trabalhos simultâneos','Concurrent work'],agentId:['Agente','Agent'],systemPrompt:['Instruções','Instructions'],model:['Modelo','Model'],monthlyBudgetUsd:['Limite mensal em US$','Monthly limit in US$'],monthlyRunCap:['Limite mensal de execuções','Monthly run limit'],skillIds:['Habilidades','Skills'],name:['Nome','Name'],description:['Descrição','Description'],prompt:['Instruções','Instructions'],kind:['Tipo','Type'],intervalMinutes:['Intervalo em minutos','Interval in minutes'],timeOfDay:['Horário','Time'],autonomy:['Autonomia','Autonomy'],id:['Item','Item'],enabled:['Ativo','Enabled'],provider:['Serviço','Service'],url:['Endereço','Address'],access:['Permissão','Access'],blockPii:['Bloquear dados pessoais','Block personal data']};
