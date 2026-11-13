import React, { useEffect, useState } from 'react';
import { Alert, Button, Card, Group, Select, Stack, Text, TextInput } from '@mantine/core';
import { useLang } from '../../lib/i18n';
import type { CompanyBrainBinding } from '../../../shared/company-brain';
import type { Agent } from '../../../shared/types';
export default function CompanyBrainsPanel() {
  const { lang } = useLang(); const pt = lang === 'pt';
  const [agents, setAgents] = useState<Agent[]>([]);
  const [bindings, setBindings] = useState<CompanyBrainBinding[]>([]);
  const [form, setForm] = useState<CompanyBrainBinding>({ agentId: '', companyId: '', dataRoot: '', entry: '', node: '' });
  const [message, setMessage] = useState(''); const [busy, setBusy] = useState(false);
  const reload = () => window.electronAPI.listCompanyBrains().then(setBindings);
  useEffect(() => { void reload().catch(() => {}); void window.electronAPI.getAgents().then(setAgents).catch(() => {}); }, []);
  const run = async (action: () => Promise<void>) => { setBusy(true); setMessage(''); try { await action(); } catch (e) { setMessage(String(e)); } finally { setBusy(false); } };
  return <Card withBorder><Stack>
    <Text fw={600}>{pt ? 'Memória separada por empresa' : 'Separate company memory'}</Text>
    <Text size="sm" c="dimmed">{pt ? 'Vincule um agente ao Second Brain de uma empresa, somente para leitura. Se essa conexão falhar, o pedido será interrompido; os dados não serão buscados em outra empresa. A configuração técnica deve ser fornecida pelo administrador do seu Second Brain.' : 'Bind an agent to a read-only company Second Brain. If the connection fails, the request stops instead of using another company’s data. Your Second Brain administrator supplies the connection details.'}</Text>
    {bindings.map(binding => <Group key={binding.agentId} justify="space-between"><Text size="sm">{agents.find(a => a.id === binding.agentId)?.name || binding.agentId} · {binding.companyId}</Text><Group gap="xs"><Button size="xs" variant="subtle" onClick={() => setForm(binding)}>{pt ? 'Editar' : 'Edit'}</Button><Button size="xs" variant="default" disabled={busy} onClick={() => void run(async () => { const ok = await window.electronAPI.testCompanyBrain(binding.agentId); setMessage(ok ? (pt ? 'Conexão confirmada' : 'Connected') : (pt ? 'Sem conexão configurada' : 'Not configured')); })}>{pt ? 'Testar' : 'Test'}</Button><Button size="xs" variant="subtle" onClick={() => void run(async () => { await window.electronAPI.removeCompanyBrain(binding.agentId); await reload(); })}>{pt ? 'Desvincular' : 'Unbind'}</Button></Group></Group>)}
    <Select searchable label={pt ? 'Agente' : 'Agent'} data={agents.map(a => ({ value: a.id, label: a.name }))} value={form.agentId} onChange={v => setForm({ ...form, agentId: v || '' })} />
    {(['companyId', 'dataRoot', 'entry', 'node'] as const).map((field, i) => <TextInput key={field} label={(pt ? ['Identificador da empresa', 'Pasta raiz dos dados', 'Arquivo do servidor MCP', 'Executável Node.js'] : ['Company ID', 'Data root folder', 'MCP server file', 'Node.js executable'])[i]} value={form[field]} onChange={e => setForm({ ...form, [field]: e.currentTarget.value })} />)}
    <Text size="xs" c="dimmed">{pt ? 'O servidor precisa estar desbloqueado pelo administrador. As chaves e os dados pessoais não são herdados do ambiente do app.' : 'The administrator must unlock the server. Keys and personal data are not inherited from the app environment.'}</Text>
    <Button loading={busy} onClick={() => void run(async () => { await window.electronAPI.saveCompanyBrain(form); await reload(); setMessage(pt ? 'Vínculo salvo. Teste a conexão antes do pedido.' : 'Binding saved. Test the connection before running work.'); })}>{pt ? 'Salvar vínculo' : 'Save binding'}</Button>
    {message && <Alert>{message}</Alert>}
  </Stack></Card>;
}
