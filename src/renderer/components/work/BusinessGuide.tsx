import React, { useEffect, useRef, useState } from 'react';
import { Alert, Button, Card, Group, Select, Stack, Text, Textarea, TextInput, Title } from '@mantine/core';
import { TEAM_STARTERS, type BusinessTeamResult } from '../../../shared/businessTeams';
import { providerForModel } from '../../../shared/models';

/** A ready-to-use team, with optional customization instead of a setup wizard. */
export default function BusinessGuide({ onCreated, onSkip }: { onCreated: (result: BusinessTeamResult) => Promise<void>; onSkip?: () => void }) {
  const [problem, setProblem] = useState('');
  const [priority, setPriority] = useState('general');
  const starter = TEAM_STARTERS.find(t => t.id === priority)!;
  const [name, setName] = useState<string | null>(null);
  const [roles, setRoles] = useState<Array<{ name: string; purpose: string }> | null>(null);
  const [firstRequest, setFirstRequest] = useState<string | null>(null);
  const [provider, setProvider] = useState<'openai' | 'anthropic'>('openai');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const requestId = useRef(crypto.randomUUID());
  const saved = useRef<BusinessTeamResult | null>(null);
  const pending = useRef(false);
  useEffect(() => { let live = true; void window.electronAPI.getSettings().then(s => {
    if (live) setProvider(providerForModel(s.defaultModel || '') || 'openai');
  }).catch(() => {}); return () => { live = false; }; }, []);
  const choose = (id: string) => { setPriority(id); setName(null); setRoles(null); setFirstRequest(null); };
  const teamRoles = roles ?? starter.roles.map(r => ({ ...r }));
  const create = async () => {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError('');
    try {
      saved.current ??= await window.electronAPI.createBusinessTeam({ requestId: requestId.current, problem, priority,
        name: (name ?? starter.name).trim(), roles: teamRoles, firstRequest: (firstRequest ?? starter.first).trim(), provider });
      await onCreated(saved.current);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { pending.current = false; setBusy(false); }
  };
  return <Card withBorder padding="xl" radius="lg" className="km-business-guide"><Stack gap="lg">
    <div><Title order={2}>O que seu time vai resolver?</Title><Text c="dimmed" mt="xs">Conte o objetivo. A coordenação e os especialistas já vêm prontos.</Text></div>
    {error && <Alert color="red" role="alert">{error}</Alert>}
    <fieldset disabled={busy || !!saved.current} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}><Stack gap="md">
      <Group gap="xs" aria-label="Objetivo do time">{TEAM_STARTERS.map(t => <Button key={t.id} variant={priority === t.id ? 'filled' : 'default'} aria-pressed={priority === t.id} onClick={() => choose(t.id)}>{t.id === 'marketing' ? 'Vender mais' : t.id === 'consulting' ? 'Atender clientes' : t.id === 'operations' ? 'Organizar a rotina' : 'Outro objetivo'}</Button>)}</Group>
      <Textarea label="Seu objetivo" placeholder="Vender minhas palestras sobre inovação para diretores de RH pelo LinkedIn." minRows={3} autosize maxLength={6000} value={problem} onChange={e => setProblem(e.currentTarget.value)} />
      <div><Text fw={600}>{(name ?? starter.name).trim()}</Text><Text size="sm" c="dimmed">Coordenação + {teamRoles.map(r => r.name).join(' + ')}</Text></div>
      <Textarea label="Primeira entrega" description="Pode usar esta sugestão ou escrever o que precisa." value={firstRequest ?? starter.first} onChange={e => setFirstRequest(e.currentTarget.value)} minRows={2} autosize maxLength={6000} />
      <details className="km-details"><summary>Personalizar time e conexão de IA</summary><Stack gap="md" mt="md">
        <TextInput label="Nome do time" maxLength={100} value={name ?? starter.name} onChange={e => setName(e.currentTarget.value)} />
        {teamRoles.map((role, i) => <Stack key={i} gap="xs"><TextInput label={`Especialista ${i + 1}`} maxLength={100} value={role.name} onChange={e => setRoles(teamRoles.map((r,j) => j === i ? { ...r, name: e.currentTarget.value } : r))} /><Textarea label="Responsabilidade" maxLength={1000} value={role.purpose} onChange={e => setRoles(teamRoles.map((r,j) => j === i ? { ...r, purpose: e.currentTarget.value } : r))} /></Stack>)}
        <Select label="Conexão de IA" allowDeselect={false} data={[{ value: 'openai', label: 'ChatGPT / OpenAI' }, { value: 'anthropic', label: 'Claude / Anthropic' }]} value={provider} onChange={v => setProvider(v as typeof provider)} />
      </Stack></details>
    </Stack></fieldset>
    <Text size="sm" c="dimmed">Cria 3 agentes e salva o primeiro pedido. Você inicia quando quiser; nada é publicado ou enviado. A execução usa sua conexão de IA e pode consumir créditos.</Text>
    <Group justify="space-between">{onSkip ? <Button variant="subtle" color="gray" disabled={busy} onClick={onSkip}>Voltar</Button> : <span />}<Button loading={busy} disabled={!problem.trim() || !(name ?? starter.name).trim() || !(firstRequest ?? starter.first).trim() || teamRoles.some(r => !r.name.trim() || !r.purpose.trim())} onClick={() => void create()}>{saved.current ? 'Abrir time criado' : 'Criar meu time'}</Button></Group>
  </Stack></Card>;
}
