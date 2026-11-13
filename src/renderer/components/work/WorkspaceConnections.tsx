import { useEffect, useState } from 'react';
import { Alert, Badge, Button, Group, Modal, PasswordInput, Stack, Tabs, Text, Textarea, TextInput } from '@mantine/core';
import { useLang } from '../../lib/i18n';
export default function WorkspaceConnections(){
  const {lang}=useLang();const tr=(en:string,pt:string)=>lang==='pt'?pt:en;
  const [opened,setOpened]=useState(false);const [url,setUrl]=useState('');const [token,setToken]=useState('');const [connected,setConnected]=useState(false);
  const [config,setConfig]=useState('[]');const [statuses,setStatuses]=useState<Array<{id:string;connected:boolean;tools:string[];error?:string}>>([]);
  const [error,setError]=useState('');const [mcpError,setMcpError]=useState('');const [busy,setBusy]=useState(false);
  useEffect(()=>{if(!opened)return;let active=true;setError('');setMcpError('');
    window.electronAPI.workspaceConnection().then(c=>{if(active){setUrl(c.url);setConnected(c.connected);}}).catch(e=>{if(active)setError(String(e));});
    window.electronAPI.mcpList().then(c=>{if(active){setConfig(JSON.stringify(c.configs,null,2));setStatuses(c.statuses);}}).catch(e=>{if(active)setMcpError(String(e));});
    return()=>{active=false;};
  },[opened]);
  const perform=async(fn:()=>Promise<void>)=>{setBusy(true);setError('');try{await fn();}catch(e){setError(String(e));}finally{setBusy(false);}};
  return <><Button variant="default" size="xs" onClick={()=>setOpened(true)}>{tr('Connections','Conexões')}</Button>
    <Modal opened={opened} onClose={()=>{if(!busy){setOpened(false);setToken('');}}} size="lg" title={tr('Workspace connections','Conexões do workspace')}>
      <Stack>{error&&<Alert color="red" role="alert">{error}</Alert>}
      <Tabs defaultValue="workspace"><Tabs.List><Tabs.Tab value="workspace">{tr('Shared workspace','Workspace compartilhado')}</Tabs.Tab><Tabs.Tab value="mcp">MCP</Tabs.Tab></Tabs.List>
      <Tabs.Panel value="workspace" pt="md"><Stack>
        <Text size="sm">{tr('Connect to your own KeepMind server. Tasks, reviews and project rules stay on the server and are refreshed across devices. Local tasks remain separate. Switching reloads the app; finish unsaved drafts first.','Conecte ao seu servidor KeepMind. Tarefas, revisões e regras ficam no servidor e são atualizadas entre dispositivos. Tarefas locais ficam separadas. A troca recarrega o aplicativo; conclua rascunhos antes.')}</Text>
        <TextInput label={tr('Server URL','URL do servidor')} placeholder="https://keepmind.example.com" value={url} onChange={e=>setUrl(e.currentTarget.value)} />
        <PasswordInput label={tr('Your scoped access token','Seu token de acesso limitado')} value={token} onChange={e=>setToken(e.currentTarget.value)} autoComplete="off" />
        <Group><Button disabled={busy||!url||!token} onClick={()=>perform(async()=>{await window.electronAPI.workspaceConnect(url,token);setToken('');window.location.reload();})}>{tr('Connect and open','Conectar e abrir')}</Button>
        {(connected||url)&&<Button variant="default" disabled={busy} onClick={()=>perform(async()=>{await window.electronAPI.workspaceDisconnect();window.location.reload();})}>{tr('Use local workspace','Usar workspace local')}</Button>}</Group>
      </Stack></Tabs.Panel>
      <Tabs.Panel value="mcp" pt="md"><Stack>
        <Text size="sm">{tr('Local desktop MCP connections. For a shared workspace, configure MCP on the server. Enabled stdio entries launch the executable you specify. Secrets are referenced by environment-variable name.','Conexões MCP do desktop local. Para workspace compartilhado, configure MCP no servidor. Entradas stdio habilitadas iniciam o executável informado. Segredos são referenciados pelo nome da variável de ambiente.')}</Text>
        {mcpError?<Alert color="orange">{mcpError}</Alert>:<><Textarea label={tr('Server configuration (JSON)','Configuração dos servidores (JSON)')} minRows={10} autosize value={config} onChange={e=>setConfig(e.currentTarget.value)} placeholder={'[{"id":"docs","transport":"http","url":"https://example.com/mcp","enabled":true}]'} />
        <Button disabled={busy} onClick={()=>perform(async()=>{setStatuses(await window.electronAPI.mcpConfigure(JSON.parse(config)));})}>{tr('Save and connect','Salvar e conectar')}</Button>
        <Text size="xs" c="dimmed">{tr('After connecting, assign the generated MCP skill to an agent. Owner-authorized read tools run automatically; other actions require approval.','Após conectar, atribua a skill MCP criada a um agente. Consultas autorizadas pelo administrador executam automaticamente; outras ações exigem aprovação.')}</Text>
        {statuses.map(s=><div key={s.id}><Group><Text fw={600}>{s.id}</Text><Badge color={s.connected?'teal':'gray'}>{s.connected?tr('Connected','Conectado'):tr('Offline','Desconectado')}</Badge><Text size="xs">{s.tools.length} tools</Text></Group>{s.error&&<Text size="sm" c="red">{s.error}</Text>}<details><summary>{tr('Tool names','Nomes das ferramentas')}</summary><Text size="xs">{s.tools.join(', ')}</Text></details></div>)}</>}
      </Stack></Tabs.Panel></Tabs></Stack>
    </Modal></>;
}
