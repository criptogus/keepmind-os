import React, { useState } from 'react';
import {
  Button, Card, Group, Modal, Stack, Stepper, Switch, Text, TextInput, Title,
} from '@mantine/core';
import { DEFAULT_MODEL } from '../../../shared/models.js';
import { useLang } from '../../lib/i18n';

const STEP_KEYS = ['ob.step.company', 'ob.step.llm', 'ob.step.brain', 'ob.step.agent'];

type Provider = 'openai' | 'anthropic';

export default function OnboardingWizard({ onComplete }: { onComplete: () => void }) {
  const { t } = useLang();
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
    setStatus(`${t('ob.signinWith')} ${p === 'openai' ? 'OpenAI' : 'Anthropic'}…`);
    try {
      const res = await window.electronAPI.oauthAuthenticate(p);
      if (res.success) {
        setOauthDone((s) => ({ ...s, [p]: true }));
        setStatus(`${p === 'openai' ? 'OpenAI' : 'Anthropic'} ${t('ob.connected')}`);
      } else {
        setStatus(res.error || `${t('ob.failed')} ${t('login.failed')}`);
      }
    } catch {
      setStatus(t('login.failed'));
    } finally {
      setBusy(false);
    }
  };

  const testBrain = async () => {
    setBusy(true);
    setStatus(t('ob.testing'));
    try {
      await window.electronAPI.secondBrainSetConfig({
        enabled: true,
        url: brainUrl.trim(),
        token: brainToken.trim() || undefined,
      });
      const res = await window.electronAPI.secondBrainTest();
      setStatus(res.ok ? t('ob.connectedCorp') : `Connection failed: ${res.error || 'unknown error'}`);
    } catch (e) {
      setStatus(`Connection failed: ${e instanceof Error ? e.message : 'unknown error'}`);
    } finally {
      setBusy(false);
    }
  };

  const finish = async () => {
    setBusy(true);
    setStatus(t('ob.saving'));
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
    if (step === STEP_KEYS.length - 1) {
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
          <Title order={2}>{t('ob.welcome')}</Title>
          <Text c="dimmed" size="sm">{t('ob.subtitle')}</Text>
        </div>

        <Stepper active={step} size="sm">
          {STEP_KEYS.map((key) => (
            <Stepper.Step key={key} label={t(key)} />
          ))}
        </Stepper>

        {step === 0 && (
          <Stack gap="sm">
            <TextInput label={t('ob.companyName')} required value={company.name} onChange={(e) => setCompany({ ...company, name: e.currentTarget.value })} />
            <TextInput label={t('ob.industry')} value={company.industry} onChange={(e) => setCompany({ ...company, industry: e.currentTarget.value })} />
            <TextInput label={t('ob.website')} value={company.website} onChange={(e) => setCompany({ ...company, website: e.currentTarget.value })} />
            <TextInput label={t('ob.companyDoes')} value={company.description} onChange={(e) => setCompany({ ...company, description: e.currentTarget.value })} />
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
              description={t('ob.apiKeyDesc')}
            />
            <Button
              variant="light"
              color="dark"
              disabled={oauthDone[provider] || busy || !oauthConfigured[provider]}
              onClick={() => connectOauth(provider)}
            >
              {oauthDone[provider] ? t('ob.connected') : `${t('ob.signinWith')} ${provider === 'openai' ? 'OpenAI' : 'Anthropic'}`}
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
              label={t('ob.connectBrain')}
              description={t('ob.connectBrainDesc')}
              checked={brainEnabled}
              onChange={(e) => setBrainEnabled(e.currentTarget.checked)}
            />
            {brainEnabled ? (
              <>
                <TextInput label={t('ob.serverUrl')} value={brainUrl} onChange={(e) => setBrainUrl(e.currentTarget.value)} />
                <TextInput label={t('ob.accessToken')} type="password" value={brainToken} onChange={(e) => setBrainToken(e.currentTarget.value)} description={t('ob.tokenDesc')} />
                <div>
                  <Button variant="light" disabled={busy} onClick={testBrain}>{t('ob.testConnection')}</Button>
                </div>
              </>
            ) : (
              <Text size="sm" c="dimmed">{t('ob.skipLater')}</Text>
            )}
          </Stack>
        )}

        {step === 3 && (
          <Stack gap="sm">
            <TextInput label={t('ob.agentName')} required value={agentName} onChange={(e) => setAgentName(e.currentTarget.value)} />
            <TextInput
              label={t('ob.agentRole')}
              required
              value={agentRole}
              onChange={(e) => setAgentRole(e.currentTarget.value)}
              description={t('ob.agentRoleDesc')}
            />
            <Text size="sm" c="dimmed">
              {t('ob.agentUses')} {provider === 'openai' ? 'OpenAI' : 'Anthropic'}
              {brainEnabled ? ` ${t('ob.andBrain')}` : ''}.
            </Text>
          </Stack>
        )}

        <Group justify="space-between" align="center">
          <Text size="xs" c="dimmed" mih={18}>{status}</Text>
          <Group gap="xs">
            {step > 0 && (
              <Button variant="default" disabled={busy} onClick={() => setStep(step - 1)}>{t('ob.back')}</Button>
            )}
            <Button disabled={!canNext() || busy} loading={busy} onClick={next}>
              {step === STEP_KEYS.length - 1 ? 'Finish setup' : 'Continue'}
            </Button>
          </Group>
        </Group>
      </Stack>
    </Modal>
  );
}
