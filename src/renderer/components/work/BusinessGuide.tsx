import { useLang } from '../../lib/i18n';
import React, { useRef, useState } from 'react';
import { Alert, Button, Card, Group, Select, SimpleGrid, Stack, Stepper, Text, Textarea, TextInput, Title } from '@mantine/core';
import { businessStarters, type BusinessTeamResult } from '../../../shared/businessTeams';

/** Setup uses explicit customer priorities and editable curated suggestions, without paid calls. */
export default function BusinessGuide({ onCreated, onSkip }: { onCreated: (result: BusinessTeamResult) => Promise<void>; onSkip?: () => void }) {
  const { t, lang } = useLang();
  const starters = businessStarters(lang);
  const [step, setStep] = useState(0);
  const [customizing, setCustomizing] = useState(false);
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
    const starter = starters.find(t => t.id === priority)!;
    setName(starter.name); setRoles(starter.roles.map(r => ({ ...r }))); setFirstRequest(`${starter.first}\n\n${lang === 'pt' ? 'Meu contexto' : 'My context'}: ${problem.trim()}`.slice(0, 6000)); setStep(1);
  };
  const create = async () => {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError('');
    try {
      saved.current ??= await window.electronAPI.createBusinessTeam({ requestId: requestId.current, problem, priority, name, roles, firstRequest, provider, language: lang });
      await onCreated(saved.current);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { pending.current = false; setBusy(false); }
  };
  return <Card withBorder padding="xl" radius="lg" className="km-business-guide"><Stack gap="lg">
    <Stepper active={step} size="sm" aria-label={t('flow.build-my-team')}><Stepper.Step label={t('flow.your-challenge')} /><Stepper.Step label={t('flow.your-team')} /><Stepper.Step label={t('flow.first-delivery')} /></Stepper>
    {error && <Alert color="red" role="alert">{error}</Alert>}
    {step === 0 && <>
      <div><Title order={2}>{t('flow.what-problem-do-you-want-to-solve')}</Title><Text c="dimmed" mt="xs">{t('flow.tell-us-about-your-business-and-what-is-difficult')}</Text></div>
      <Textarea label={t('flow.tell-us-what-you-need')} description={t('flow.you-do-not-need-to-know-which-agents-to')} placeholder={t('flow.i-run-a-business-that-and-need-help-with')} minRows={3} autosize maxLength={6000} value={problem} onChange={e => setProblem(e.currentTarget.value)} />
      <div><Text size="sm" c="dimmed" mb="xs">{t('flow.need-an-example-to-get-started')}</Text><SimpleGrid cols={{ base: 1, sm: 3 }}>{starters.filter(starter => starter.example).map(starter => <Button key={starter.id} variant="light" color="gray" h="auto" py="md" styles={{ label: { whiteSpace: 'normal', textAlign: 'left' } }} onClick={() => { setProblem(starter.example); setPriority(starter.id); }}>{starter.id === 'consulting' ? t('flow.serve-my-customers-better') : starter.id === 'marketing' ? t('flow.promote-my-business') : t('flow.organize-my-business')}</Button>)}</SimpleGrid></div>
      <Select label={t('flow.what-is-your-priority-right-now')} description={t('flow.this-helps-us-suggest-useful-roles-to-start-with')} data={starters.map(t => ({ value: t.id, label: t.priority }))} value={priority} onChange={v => setPriority(v || 'general')} />
      <Group justify="space-between">{onSkip ? <Button variant="subtle" color="gray" onClick={onSkip}>{t('flow.explore-first')}</Button> : <span />}<Button disabled={!problem.trim()} onClick={suggest}>{t('flow.suggest-my-team')}</Button></Group>
      <Text size="xs" c="dimmed">{t('flow.you-review-the-suggestion-before-creating-the-team-no')}</Text>
    </>}
    {step === 1 && <>
      <div><Title order={2}>{t('flow.a-team-to-help-you')}</Title><Text c="dimmed" mt="xs">{t('flow.this-is-a-starter-team-for-your-selected-priority')}</Text></div>
      <Text size="sm" style={{ whiteSpace: 'pre-wrap' }}>{problem}</Text>
      {!customizing && <Text fw={600}>{name}</Text>}
      {customizing && <TextInput label={t('flow.team-name')} maxLength={100} value={name} onChange={e => setName(e.currentTarget.value)} />}
      <Card withBorder padding="md"><Text fw={600}>{t('flow.coordinator-your-point-of-contact')}</Text><Text size="sm" c="dimmed">{t('flow.talks-with-you-organizes-the-request-involves-specialists-and')}</Text></Card>
      <SimpleGrid cols={{ base: 1, sm: 2 }}>{roles.map((role, i) => <Card withBorder key={i} padding="md"><Stack gap="sm">
        <Text fw={600}>{role.name}</Text><Text size="sm" c="dimmed">{role.purpose}</Text>{customizing && <><TextInput label={`${lang === 'pt' ? 'Nome do integrante' : 'Member name'} ${i + 1}`} value={role.name} maxLength={100} onChange={e => setRoles(roles.map((r, j) => j === i ? { ...r, name: e.currentTarget.value } : r))} />
        <Textarea label={t('flow.how-they-will-help')} value={role.purpose} maxLength={1000} minRows={3} autosize onChange={e => setRoles(roles.map((r, j) => j === i ? { ...r, purpose: e.currentTarget.value } : r))} /></>}
      </Stack></Card>)}</SimpleGrid>
      <Button variant="subtle" onClick={() => setCustomizing(v => !v)}>{customizing ? t('flow.finish-customizing') : t('flow.customize-team')}</Button>
      <Text size="sm">{t('flow.you-stay-in-control-provide-context-review-deliveries-and')}</Text>
      <Group justify="space-between"><Button variant="subtle" onClick={() => setStep(0)}>{t('flow.back-to-the-problem')}</Button><Button disabled={!name.trim() || roles.some(r => !r.name.trim() || !r.purpose.trim())} onClick={() => setStep(2)}>{t('flow.choose-the-first-delivery')}</Button></Group>
    </>}
    {step === 2 && <>
      <div><Title order={2}>{t('flow.where-shall-we-start')}</Title><Text c="dimmed" mt="xs">{t('flow.a-small-first-request-helps-you-get-to-know')}</Text></div>
      <Text size="sm" fw={600}>{name} · {lang === 'pt' ? 'Coordenação' : 'Coordinator'} + {roles.map(r => r.name).join(' + ')}</Text>
      <Textarea label={t('flow.your-first-request')} value={firstRequest} onChange={e => setFirstRequest(e.currentTarget.value)} minRows={4} autosize maxLength={6000} />
      <details className="km-details"><summary>{t('flow.ai-connection')}</summary><Select mt="sm" label={t('flow.service-you-will-use')} data={[{ value: 'openai', label: 'ChatGPT / OpenAI' }, { value: 'anthropic', label: 'Claude / Anthropic' }]} value={provider} onChange={v => setProvider(v as typeof provider)} /><Text size="xs" mt="xs" c="dimmed">{t('flow.you-can-connect-your-account-later-starting-requests-may')}</Text></details>
      <Alert color="gray">{t('flow.confirming-creates-the-team-and-saves-this-request-as')}</Alert>
      <Group justify="space-between"><Button variant="subtle" disabled={busy || !!saved.current} onClick={() => setStep(1)}>{t('flow.adjust-team')}</Button><Button loading={busy} disabled={!firstRequest.trim()} onClick={() => void create()}>{t('flow.create-team-and-save-first-request')}</Button></Group>
    </>}
  </Stack></Card>;
}
