import React, { useRef, useState } from 'react';
import { Alert, Button, Card, Group, Select, SimpleGrid, Stack, Stepper, Text, Textarea, TextInput, Title } from '@mantine/core';
import { TEAM_STARTERS, type BusinessTeamResult } from '../../../shared/businessTeams';

/** Setup uses explicit customer priorities and editable curated suggestions, without paid calls. */
export default function BusinessGuide({ onCreated, onSkip }: { onCreated: (result: BusinessTeamResult) => Promise<void>; onSkip?: () => void }) {
  const [step, setStep] = useState(0);
  const [problem, setProblem] = useState('');
  const [priority, setPriority] = useState('general');
  const [name, setName] = useState('');
  const [roles, setRoles] = useState<Array<{ name: string; purpose: string }>>([]);
  const [firstRequest, setFirstRequest] = useState('');
  const [provider, setProvider] = useState<'openai' | 'anthropic'>('openai');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const requestId = useRef(crypto.randomUUID());
  const saved = useRef<BusinessTeamResult | null>(null);
  const pending = useRef(false);
  const suggest = () => {
    const starter = TEAM_STARTERS.find(t => t.id === priority)!;
    setName(starter.name); setRoles(starter.roles.map(r => ({ ...r }))); setFirstRequest(starter.first); setStep(1);
  };
  const create = async () => {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError('');
    try {
      saved.current ??= await window.electronAPI.createBusinessTeam({ requestId: requestId.current, problem, priority, name, roles, firstRequest, provider });
      await onCreated(saved.current);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { pending.current = false; setBusy(false); }
  };
  return <Card withBorder padding="xl" radius="lg" className="km-business-guide"><Stack gap="lg">
    <Stepper active={step} size="sm" aria-label="Montar meu time"><Stepper.Step label="Seu desafio" /><Stepper.Step label="Seu time" /><Stepper.Step label="Primeira entrega" /></Stepper>
    {error && <Alert color="red" role="alert">{error}</Alert>}
    {step === 0 && <>
      <div><Title order={2}>Qual problema você quer resolver?</Title><Text c="dimmed" mt="xs">Conte um pouco sobre seu negócio e o que está difícil hoje. Vamos ajudar você a montar um time de IA para trabalhar ao seu lado.</Text></div>
      <Textarea label="Conte o que você precisa" description="Não precisa saber quais agentes usar. Comece com suas próprias palavras." placeholder="Tenho uma empresa de… e preciso de ajuda para…" minRows={3} autosize maxLength={6000} value={problem} onChange={e => setProblem(e.currentTarget.value)} />
      <div><Text size="sm" c="dimmed" mb="xs">Quer um exemplo para começar?</Text><SimpleGrid cols={{ base: 1, sm: 3 }}>{TEAM_STARTERS.filter(t => t.example).map(t => <Button key={t.id} variant="light" color="gray" h="auto" py="md" styles={{ label: { whiteSpace: 'normal', textAlign: 'left' } }} onClick={() => { setProblem(t.example); setPriority(t.id); }}>{t.id === 'consulting' ? 'Atender melhor meus clientes' : t.id === 'marketing' ? 'Divulgar meu negócio' : 'Organizar meu negócio'}</Button>)}</SimpleGrid></div>
      <Select label="Qual é sua prioridade agora?" description="Isso nos ajuda a sugerir os papéis mais úteis para começar." data={TEAM_STARTERS.map(t => ({ value: t.id, label: t.priority }))} value={priority} onChange={v => setPriority(v || 'general')} />
      <Group justify="space-between">{onSkip ? <Button variant="subtle" color="gray" onClick={onSkip}>Explorar primeiro</Button> : <span />}<Button disabled={!problem.trim()} onClick={suggest}>Sugerir meu time</Button></Group>
      <Text size="xs" c="dimmed">Você revisa a sugestão antes de criar o time. Nenhum trabalho começa nesta etapa.</Text>
    </>}
    {step === 1 && <>
      <div><Title order={2}>Um time para ajudar você</Title><Text c="dimmed" mt="xs">Sugestão inicial para a prioridade que você escolheu. Ajuste os nomes e responsabilidades para combinar com seu negócio.</Text></div>
      <Text size="sm" style={{ whiteSpace: 'pre-wrap' }}>{problem}</Text>
      <TextInput label="Nome do seu time" maxLength={100} value={name} onChange={e => setName(e.currentTarget.value)} />
      <Card withBorder padding="md"><Text fw={600}>Coordenação — seu ponto de contato</Text><Text size="sm" c="dimmed">Conversa com você, organiza o pedido, envolve os especialistas e reúne tudo em uma entrega.</Text></Card>
      <SimpleGrid cols={{ base: 1, sm: 2 }}>{roles.map((role, i) => <Card withBorder key={i} padding="md"><Stack gap="sm">
        <TextInput label={`Papel ${i + 1}`} value={role.name} maxLength={100} onChange={e => setRoles(roles.map((r, j) => j === i ? { ...r, name: e.currentTarget.value } : r))} />
        <Textarea label="Como vai ajudar" value={role.purpose} maxLength={1000} minRows={3} autosize onChange={e => setRoles(roles.map((r, j) => j === i ? { ...r, purpose: e.currentTarget.value } : r))} />
      </Stack></Card>)}</SimpleGrid>
      <Text size="sm">Você continua no comando: traz o contexto, avalia as entregas e pede os ajustes. Os integrantes são assistentes de IA.</Text>
      <Group justify="space-between"><Button variant="subtle" onClick={() => setStep(0)}>Voltar ao problema</Button><Button disabled={!name.trim() || roles.some(r => !r.name.trim() || !r.purpose.trim())} onClick={() => setStep(2)}>Definir a primeira entrega</Button></Group>
    </>}
    {step === 2 && <>
      <div><Title order={2}>Por onde vamos começar?</Title><Text c="dimmed" mt="xs">Um primeiro pedido pequeno ajuda você a conhecer o time. Revise a sugestão abaixo e acrescente o contexto que já tem.</Text></div>
      <Text size="sm" fw={600}>{name} · Coordenação + {roles.map(r => r.name).join(' + ')}</Text>
      <Textarea label="Seu primeiro pedido" value={firstRequest} onChange={e => setFirstRequest(e.currentTarget.value)} minRows={4} autosize maxLength={6000} />
      <details className="km-details"><summary>Conexão de IA</summary><Select mt="sm" label="Serviço que você vai usar" data={[{ value: 'openai', label: 'ChatGPT / OpenAI' }, { value: 'anthropic', label: 'Claude / Anthropic' }]} value={provider} onChange={v => setProvider(v as typeof provider)} /><Text size="xs" mt="xs" c="dimmed">Você pode conectar sua conta depois. O uso do serviço ao iniciar pedidos pode gerar custos.</Text></details>
      <Alert color="gray">Ao confirmar, vamos criar o time e salvar este pedido como rascunho. Você poderá conferir tudo e conectar a IA antes de iniciar.</Alert>
      <Group justify="space-between"><Button variant="subtle" disabled={busy || !!saved.current} onClick={() => setStep(1)}>Ajustar o time</Button><Button loading={busy} disabled={!firstRequest.trim()} onClick={() => void create()}>Criar time e salvar primeiro pedido</Button></Group>
    </>}
  </Stack></Card>;
}
