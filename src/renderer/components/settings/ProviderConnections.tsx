import React, { useEffect, useState } from 'react';
import { Alert, Anchor, Badge, Button, Card, Group, Stack, Text, TextInput, Title } from '@mantine/core';
import { useLang } from '../../lib/i18n';

export default function ProviderConnections({ onChange, provider }: { onChange?: () => void; provider?: 'openai' | 'anthropic' }) {
  const { t, lang } = useLang();
  const tr = (en: string, pt: string) => lang === 'pt' ? pt : en;
  const [pendingProvider, setPendingProvider] = useState<'openai' | 'anthropic' | null>(null);
  const [loginUrl, setLoginUrl] = useState<string | null>(null);
  const [loginNotice, setLoginNotice] = useState('');
  useEffect(() => {
    if (!pendingProvider) return;
    let live = true;
    const poll = () => window.electronAPI.oauthPendingUrl(pendingProvider).then(url => { if (live) setLoginUrl(url); }).catch(() => {});
    void poll();
    const timer = setInterval(poll, 500);
    return () => { live = false; clearInterval(timer); };
  }, [pendingProvider]);
  const [openaiKey, setOpenaiKey] = useState('');
  const [anthropicKey, setAnthropicKey] = useState('');
  const [openaiAuth, setOpenaiAuth] = useState(false);
  const [anthropicAuth, setAnthropicAuth] = useState(false);
  const [openaiHasKey, setOpenaiHasKey] = useState(false);
  const [anthropicHasKey, setAnthropicHasKey] = useState(false);
  const [openaiConfigured, setOpenaiConfigured] = useState(true);
  const [anthropicConfigured, setAnthropicConfigured] = useState(true);
  useEffect(() => { void checkAuthStatus(); }, []);
  const checkAuthStatus = async () => {
    try {
      const [openai, anthropic, oc, ac, ok, ak] = await Promise.all([
        window.electronAPI.oauthIsAuthenticated('openai'),
        window.electronAPI.oauthIsAuthenticated('anthropic'),
        window.electronAPI.oauthIsConfigured('openai'),
        window.electronAPI.oauthIsConfigured('anthropic'),
        window.electronAPI.hasApiKey('openai'),
        window.electronAPI.hasApiKey('anthropic'),
      ]);
      setOpenaiAuth(openai);
      setAnthropicAuth(anthropic);
      setOpenaiConfigured(oc);
      setAnthropicConfigured(ac);
      setOpenaiHasKey(ok);
      setAnthropicHasKey(ak);
    } catch (error) {
      console.error('Failed to check auth status:', error);
    }
  };

  const handleOAuthLogin = async (provider: 'openai' | 'anthropic') => {
    setPendingProvider(provider); setLoginUrl(null); setLoginNotice('');
    try {
      const result = await window.electronAPI.oauthAuthenticate(provider);
      if (result.success) {
        setLoginNotice(tr('Connected successfully.', 'Conectado com sucesso.'));
        void checkAuthStatus(); onChange?.();
      } else {
        setLoginNotice(result.error === 'Authentication cancelled'
          ? tr('Login cancelled. You can try again.', 'Login cancelado. Você pode tentar novamente.')
          : `${t('adv2.authFailed')}: ${result.error}`);
      }
    } catch {
      setLoginNotice(t('adv2.authFailed'));
    } finally { setPendingProvider(null); setLoginUrl(null); }
  };

  const handleOAuthLogout = async (provider: 'openai' | 'anthropic') => {
    if (confirm(`${t('adv2.logout')} ${provider === 'openai' ? 'OpenAI' : 'Anthropic'}?`)) {
      await window.electronAPI.oauthLogout(provider);
      checkAuthStatus();
    }
  };

  const handleApiKeySave = async (provider: 'openai' | 'anthropic', key: string) => {
    if (!key) return;
    try {
      await window.electronAPI.setApiKey(provider, key);
      setLoginNotice(tr('Key saved. Your request is ready to start.', 'Chave salva. Seu pedido está pronto para começar.')); onChange?.();
      if (provider === 'openai') { setOpenaiKey(''); setOpenaiHasKey(true); }
      else { setAnthropicKey(''); setAnthropicHasKey(true); }
    } catch (error) {
      setLoginNotice(t('adv2.keySaveFailed'));
    }
  };

  return (
      <Card withBorder padding="md" radius="md">
        <Title order={2} size="h4">{t('adv2.providerTitle')}</Title>
        <Text size="sm" c="dimmed">
          {t('adv2.providerDesc')}
        </Text>

        <Stack gap="md">
          {loginNotice && <Text role="status" size="sm">{loginNotice}</Text>}
          {([
            { provider: 'openai' as const, label: 'OpenAI', auth: openaiAuth, configured: openaiConfigured, hasKey: openaiHasKey, setHasKey: setOpenaiHasKey, key: openaiKey, setKey: setOpenaiKey, placeholder: 'sk-...' },
            { provider: 'anthropic' as const, label: 'Anthropic', auth: anthropicAuth, configured: anthropicConfigured, hasKey: anthropicHasKey, setHasKey: setAnthropicHasKey, key: anthropicKey, setKey: setAnthropicKey, placeholder: 'sk-ant-...' },
          ]).filter(p => !provider || p.provider === provider).map((p) => (
            <Card key={p.provider} withBorder padding="md" radius="md">
              <Stack gap="sm">
                <Group justify="space-between">
                  <Text fw={600}>{p.label}</Text>
                  <Badge color={p.auth || p.hasKey ? 'dark' : 'gray'} variant="light">
                    {p.auth ? t('adv2.oauthConnected') : p.hasKey ? t('adv2.keySaved') : t('adv2.notConnected')}
                  </Badge>
                </Group>
                <Group gap="xs">
                  <Button
                    size="xs"
                    variant="default"
                    disabled={p.auth || !p.configured || !!pendingProvider}
                    onClick={() => handleOAuthLogin(p.provider)}
                  >
                    {p.provider === 'openai' ? tr('Sign in with ChatGPT / Codex', 'Entrar com ChatGPT / Codex') : tr('Sign in with Claude (experimental)', 'Entrar com Claude (experimental)')}
                  </Button>
                  {p.auth && (
                    <Button size="xs" variant="subtle" color="gray" onClick={() => handleOAuthLogout(p.provider)}>
                      {t('adv2.logout')}
                    </Button>
                  )}
                </Group>
                {pendingProvider === p.provider && <Alert title={tr('Complete login in your browser', 'Conclua o login no navegador')} role="status">
                  <Text size="sm">{tr('If no page opened, open or copy the login link below.', 'Se nenhuma página abriu, abra ou copie o link de login abaixo.')}</Text>
                  <Group mt="sm">
                    {loginUrl && <Anchor href={loginUrl} target="_blank" rel="noreferrer">{tr('Open login page', 'Abrir página de login')}</Anchor>}
                    {loginUrl && window.electronAPI.platform === 'darwin' && <Button size="xs" variant="default" onClick={() => window.electronAPI.loginOpenInSafari(p.provider).then(() => setLoginNotice(tr('Safari requested. Complete login in the browser.', 'Abertura solicitada ao Safari. Conclua o login no navegador.'))).catch(e => setLoginNotice(e.message))}>{tr('Did not open? Use Safari', 'Não abriu? Usar Safari')}</Button>}
                    {loginUrl && <Button size="xs" variant="default" onClick={() => navigator.clipboard.writeText(loginUrl).then(() => setLoginNotice(tr('Link copied. Paste it in your browser.', 'Link copiado. Cole no navegador.'))).catch(() => setLoginNotice(tr('Could not copy the link.', 'Não foi possível copiar o link.')))}>{tr('Copy login link', 'Copiar link de login')}</Button>}
                    <Button size="xs" variant="subtle" onClick={() => window.electronAPI.oauthCancel(p.provider).catch(() => setLoginNotice(tr('Could not cancel login.', 'Não foi possível cancelar o login.')))}>{tr('Cancel login', 'Cancelar login')}</Button>
                  </Group>
                </Alert>}
                {!p.configured && (
                  <Text size="xs" c="dimmed">
                    {t('adv2.oauthUnavailable')}
                  </Text>
                )}
                <Group gap="xs" align="flex-end">
                  <TextInput
                    style={{ flex: 1 }}
                    size="xs"
                    type="password"
                    aria-label={`${p.label} API key`}
                    placeholder={p.hasKey ? t('adv2.keyReplace') : `${t('adv2.apiKey')} (${p.placeholder})`}
                    value={p.key}
                    onChange={(e) => p.setKey(e.currentTarget.value)}
                  />
                  <Button
                    size="xs"
                    variant="light"
                    disabled={!p.key}
                    onClick={() => handleApiKeySave(p.provider, p.key)}
                  >
                    {t('common.save')}
                  </Button>
                  {p.hasKey && (
                    <Button
                      size="xs"
                      variant="subtle"
                      color="gray"
                      onClick={async () => {
                        if (confirm(`${t('adv2.removeKeyConfirm')} (${p.label})`)) {
                          await window.electronAPI.clearApiKey(p.provider);
                          p.setHasKey(false);
                        }
                      }}
                    >
                      {t('common.remove')}
                    </Button>
                  )}
                </Group>
              </Stack>
            </Card>
          ))}
        </Stack>
      </Card>

  );
}
