import React, { useEffect, useState } from 'react';
import { Alert, Button, Card, Group, NumberInput, PasswordInput, Select, Stack, Text, TextInput } from '@mantine/core';
import { useLang } from '../../lib/i18n';
import type { CompatibleProviderKind, CompatibleProviderProfile, CompatibleModelDiscovery } from '../../../shared/connectors';
const fresh = (): CompatibleProviderProfile => ({ id: crypto.randomUUID(), name: '', kind: 'openrouter', baseUrl: 'https://openrouter.ai/api/v1', model: '', inputUsdPerMillion: 0, outputUsdPerMillion: 0, maxRunUsd: 1, maxOutputTokens: 2048 });
export default function CompatibleProvidersPanel() {
  const { lang } = useLang(); const pt = lang === 'pt';
  const [profiles, setProfiles] = useState<CompatibleProviderProfile[]>([]);
  const [form, setForm] = useState(fresh); const [key, setKey] = useState('');
  const [discovery, setDiscovery] = useState<{ id: string; result: CompatibleModelDiscovery } | null>(null);
  const [message, setMessage] = useState(''); const [busy, setBusy] = useState(false);
  const reload = () => window.electronAPI.listCompatibleProviders().then(setProfiles);
  useEffect(() => { void reload().catch(() => {}); }, []);
  const run = async (action: () => Promise<void>) => { setBusy(true); setMessage(''); try { await action(); } catch (e) { setMessage(String(e)); } finally { setBusy(false); } };
  const selectKind = (kind: CompatibleProviderKind) => setForm({ ...form, kind, name: kind === 'custom' ? '' : kind, baseUrl: kind === 'openrouter' ? 'https://openrouter.ai/api/v1' : kind === 'deepseek' ? 'https://api.deepseek.com' : kind === 'hermes' ? 'http://127.0.0.1:8000/v1' : '' });
  return <Card withBorder><Stack>
    <Text fw={600}>{pt ? 'Outros provedores de IA' : 'Other AI providers'}</Text>
    <Text size="sm" c="dimmed">{pt ? 'Conecte OpenRouter, DeepSeek ou um serviço compatível. Depois escolha o modelo na configuração do agente. Informe os preços do seu contrato para controlar os gastos.' : 'Connect OpenRouter, DeepSeek or a compatible service, then select its model in the agent settings. Enter your contracted prices for spending controls.'}</Text>
    {profiles.map(p => <Group key={p.id} justify="space-between"><Text size="sm">{p.name} · {p.model}</Text><Group gap="xs">
      <Button size="xs" variant="subtle" onClick={() => { setForm(p); setKey(''); }}>{pt ? 'Editar' : 'Edit'}</Button>
      <Button size="xs" variant="default" disabled={busy} onClick={() => void run(async () => { const result = await window.electronAPI.testCompatibleProvider(p.id); setDiscovery({ id: p.id, result }); setForm(p); setKey(''); setMessage(`${pt ? 'Conexão confirmada. Modelos' : 'Connected. Models'}: ${result.models.join(', ')}`); })}>{pt ? 'Testar conexão' : 'Test connection'}</Button>
      <Button size="xs" variant="subtle" disabled={busy} onClick={() => void run(async () => { await window.electronAPI.removeCompatibleProvider(p.id); await reload(); })}>{pt ? 'Desconectar' : 'Disconnect'}</Button>
    </Group></Group>)}
    <Select label={pt ? 'Provedor' : 'Provider'} value={form.kind} data={['openrouter', 'deepseek', 'hermes', 'custom']} onChange={v => selectKind(v as CompatibleProviderKind)} />
    <TextInput label={pt ? 'Nome da conexão' : 'Connection name'} value={form.name} onChange={e => setForm({ ...form, name: e.currentTarget.value })} />
    <TextInput label={pt ? 'Endereço da API' : 'API endpoint'} value={form.baseUrl} onChange={e => setForm({ ...form, baseUrl: e.currentTarget.value })} />
    <PasswordInput label={pt ? 'Chave da API (vazio mantém a atual)' : 'API key (leave empty to keep current)'} value={key} onChange={e => setKey(e.currentTarget.value)} />
    {discovery?.id === form.id && <Select searchable label={pt ? 'Modelos disponíveis na conta' : 'Available account models'} data={discovery.result.models} value={form.model} onChange={model => model && setForm({ ...form, model })} />}
    {discovery?.id === form.id && discovery.result.prices.some(p => p.model === form.model) && <Button variant="default" onClick={() => { const price = discovery.result.prices.find(p => p.model === form.model)!; setForm({ ...form, inputUsdPerMillion: price.inputUsdPerMillion, outputUsdPerMillion: price.outputUsdPerMillion }); }}>{pt ? 'Preencher preços do catálogo — revise e salve' : 'Fill catalog prices — review and save'}</Button>}
    <TextInput label={pt ? 'Identificador do modelo' : 'Model ID'} value={form.model} onChange={e => setForm({ ...form, model: e.currentTarget.value })} />
    <Group grow>{(['inputUsdPerMillion', 'outputUsdPerMillion', 'maxRunUsd', 'maxOutputTokens'] as const).map((field, i) => <NumberInput key={field} label={(pt ? ['US$/milhão de tokens de entrada', 'US$/milhão de tokens de saída', 'Limite US$ por pedido', 'Limite de tokens de saída'] : ['Input US$/million tokens', 'Output US$/million tokens', 'US$ limit per request', 'Output token limit'])[i]} min={0} value={form[field]} onChange={v => setForm({ ...form, [field]: Number(v) })} />)}</Group>
    <Group><Button loading={busy} onClick={() => void run(async () => { await window.electronAPI.saveCompatibleProvider(form, key || undefined); setKey(''); setForm(fresh()); await reload(); setMessage(pt ? 'Conexão salva. Teste a conexão e escolha o modelo no agente.' : 'Saved. Test the connection and select the model in your agent.'); })}>{pt ? 'Salvar conexão' : 'Save connection'}</Button><Button variant="subtle" onClick={() => { setForm(fresh()); setKey(''); }}>{pt ? 'Nova conexão' : 'New connection'}</Button></Group>
    {message && <Alert>{message}</Alert>}
  </Stack></Card>;
}
