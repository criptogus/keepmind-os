import React, { useState } from 'react';
import {
  Button, Card, Group, Modal, Stack, Stepper, Switch, Text, TextInput, Title,
} from '@mantine/core';
import { DEFAULT_MODEL } from '../../../shared/models.js';

const STEPS = ['Company', 'LLM Provider', 'Second Brain', 'First Agent'];

type Provider = 'openai' | 'anthropic';

export default function OnboardingWizard({ onComplete }: { onComplete: () => void }) {
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');

  const [company, setCompany] = useState({ name: '', industry: '', website: '', description: '' });
  const [provider, setProvider] = useState<Provider>('openai');
  const [apiKey, setApiKey] = useState('');
  const [oauthDone, setOauthDone] = useState<Record<Provider, boolean>>({ openai: false, anthropic: false });
  const [oauthConfigured, setOauthConfigured] = useState<Record<Provider, boolean>>({ openai: false, anthropic: true });
  const [brainEnabled, setBrainEnabled] = useState(false);
  const [brainUrl, setBrainUrl] = useState('http://127.0.0.1:8787');
  const [brainToken, setBrainToken] = useState('');
  const [agentName, setAgentName] = useState('');
  const [agentRole, setAgentRole] = useState('');

  React.useEffect(() => {
    window.electronAPI.oauthIsConfigured('openai').then((c) => setOauthConfigured((s) => ({ ...s, openai: c }))).catch(() => {});
    window.electronAPI.oauthIsConfigured('anthropic').then((c) => setOauthConfigured((s) => ({ ...s, anthropic: c }))).catch(() => {});
  }, []);

  const canNext = (): boolean => {
    switch (step) {
      case 0: return company.name.trim().length > 0;
      case 1: return oauthDone[provider] || apiKey.trim().length > 0;
      case 2: return !brainEnabled || brainUrl.trim().length > 0;
      case 3: return agentName.trim().length > 0 && agentRole.trim().length > 0;
      default: return true;
    }
  };

  const connectOauth = async (p: Provider) => {
    setBusy(true);
    setStatus(`Opening ${p === 'openai' ? 'OpenAI' : 'Anthropic'} sign-in…`);
    try {
      const res = await window.electronAPI.oauthAuthenticate(p);
      if (res.success) {
        setOauthDone((s) => ({ ...s, [p]: true }));
        setStatus(`${p === 'openai' ? 'OpenAI' : 'Anthropic'} connected.`);
      } else {
        setStatus(res.error || 'Authentication failed.');
      }
    } catch {
      setStatus('Authentication failed.');
    } finally {
      setBusy(false);
    }
  };

  const testBrain = async () => {
    setBusy(true);
    setStatus('Testing connection…');
    try {
      await window.electronAPI.secondBrainSetConfig({
        enabled: true,
        url: brainUrl.trim(),
        token: brainToken.trim() || undefined,
      });
      const res = await window.electronAPI.secondBrainTest();
      setStatus(res.ok ? 'Connected to KeepMind Corp.' : `Connection failed: ${res.error || 'unknown error'}`);
    } catch (e) {
      setStatus(`Connection failed: ${e instanceof Error ? e.message : 'unknown error'}`);
    } finally {
      setBusy(false);
    }
  };

  const finish = async () => {
    setBusy(true);
    setStatus('Saving configuration…');
    try {
      await window.electronAPI.updateCompany(company);
      if (apiKey.trim()) {
        await window.electronAPI.setApiKey(provider, apiKey.trim());
      }
      await window.electronAPI.secondBrainSetConfig({
        enabled: brainEnabled,
        url: brainUrl.trim() || undefined,
        token: brainToken.trim() || undefined,
      });

      const systemPrompt = [
        `You are ${agentName.trim()}, ${agentRole.trim()} at ${company.name}.`,
        company.description ? `Company description: ${company.description}` : '',
        company.industry ? `Industry: ${company.industry}` : '',
        company.website ? `Website: ${company.website}` : '',
        'Answer concisely and help the team reach its goals.',
      ].filter(Boolean).join('\n');

      await window.electronAPI.createAgent({
        model: DEFAULT_MODEL[provider],
        temperature: 0.7,
        maxTokens: 2048,
        systemPrompt,
        tools: [],
      });

      await window.electronAPI.updateSettings({ 'onboarding.completed': 'true' } as unknown as Parameters<typeof window.electronAPI.updateSettings>[0]);
      onComplete();
    } catch (e) {
      setStatus(`Setup failed: ${e instanceof Error ? e.message : 'unknown error'}`);
      setBusy(false);
    }
  };

  const next = () => {
    if (step === STEPS.length - 1) {
      finish();
    } else {
      setStep(step + 1);
    }
  };

  return (
    <Modal
      opened
      onClose={() => {}}
      centered
      size="lg"
      withCloseButton={false}
      closeOnClickOutside={false}
      closeOnEscape={false}
    >
      <Stack gap="lg">
        <div>
          <Title order={2}>Welcome to KeepMind OS</Title>
          <Text c="dimmed" size="sm">Set up your workspace in a few steps.</Text>
        </div>

        <Stepper active={step} size="sm">
          {STEPS.map((label) => (
            <Stepper.Step key={label} label={label} />
          ))}
        </Stepper>

        {step === 0 && (
          <Stack gap="sm">
            <TextInput label="Company name" required value={company.name} onChange={(e) => setCompany({ ...company, name: e.currentTarget.value })} />
            <TextInput label="Industry" value={company.industry} onChange={(e) => setCompany({ ...company, industry: e.currentTarget.value })} />
            <TextInput label="Website" value={company.website} onChange={(e) => setCompany({ ...company, website: e.currentTarget.value })} />
            <TextInput label="What does your company do?" value={company.description} onChange={(e) => setCompany({ ...company, description: e.currentTarget.value })} />
          </Stack>
        )}

        {step === 1 && (
          <Stack gap="sm">
            <Group>
              <Button
                variant={provider === 'openai' ? 'filled' : 'light'}
                color={provider === 'openai' ? 'dark' : 'gray'}
                onClick={() => setProvider('openai')}
              >
                OpenAI
              </Button>
              <Button
                variant={provider === 'anthropic' ? 'filled' : 'light'}
                color={provider === 'anthropic' ? 'dark' : 'gray'}
                onClick={() => setProvider('anthropic')}
              >
                Anthropic
              </Button>
            </Group>
            <TextInput
              label={`${provider === 'openai' ? 'OpenAI' : 'Anthropic'} API key`}
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.currentTarget.value)}
              description="Or sign in with OAuth below."
            />
            <Button
              variant="light"
              color="dark"
              disabled={oauthDone[provider] || busy || !oauthConfigured[provider]}
              onClick={() => connectOauth(provider)}
            >
              {oauthDone[provider] ? 'Connected via OAuth' : `Sign in with ${provider === 'openai' ? 'OpenAI' : 'Anthropic'}`}
            </Button>
            {!oauthConfigured[provider] && (
              <Text size="xs" c="dimmed">
                OAuth sign-in requires a provider-approved client ID and is currently unavailable for {provider === 'openai' ? 'OpenAI' : 'Anthropic'}. Use an API key instead.
              </Text>
            )}
          </Stack>
        )}

        {step === 2 && (
          <Stack gap="sm">
            <Switch
              label="Connect KeepMind Corp (second brain)"
              description="Optional. Lets agents read and write shared company knowledge via your local KeepMind Corp server."
              checked={brainEnabled}
              onChange={(e) => setBrainEnabled(e.currentTarget.checked)}
            />
            {brainEnabled ? (
              <>
                <TextInput label="Server URL" value={brainUrl} onChange={(e) => setBrainUrl(e.currentTarget.value)} />
                <TextInput label="Access token" type="password" value={brainToken} onChange={(e) => setBrainToken(e.currentTarget.value)} description="KEEPMIND_CORP_TOKEN from your corp server." />
                <div>
                  <Button variant="light" disabled={busy} onClick={testBrain}>Test connection</Button>
                </div>
              </>
            ) : (
              <Text size="sm" c="dimmed">You can skip this and connect later in Settings.</Text>
            )}
          </Stack>
        )}

        {step === 3 && (
          <Stack gap="sm">
            <TextInput label="Agent name" required value={agentName} onChange={(e) => setAgentName(e.currentTarget.value)} />
            <TextInput
              label="Role / responsibilities"
              required
              value={agentRole}
              onChange={(e) => setAgentRole(e.currentTarget.value)}
              description="e.g. 'Content strategist', 'Customer support lead'"
            />
            <Text size="sm" c="dimmed">
              This agent will use your {provider === 'openai' ? 'OpenAI' : 'Anthropic'} connection
              {brainEnabled ? ' and the KeepMind Corp second brain' : ''}.
            </Text>
          </Stack>
        )}

        <Group justify="space-between" align="center">
          <Text size="xs" c="dimmed" mih={18}>{status}</Text>
          <Group gap="xs">
            {step > 0 && (
              <Button variant="default" disabled={busy} onClick={() => setStep(step - 1)}>Back</Button>
            )}
            <Button disabled={!canNext() || busy} loading={busy} onClick={next}>
              {step === STEPS.length - 1 ? 'Finish setup' : 'Continue'}
            </Button>
          </Group>
        </Group>
      </Stack>
    </Modal>
  );
}
