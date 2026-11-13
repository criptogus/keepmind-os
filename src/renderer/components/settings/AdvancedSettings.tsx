import CompanyBrainsPanel from './CompanyBrainsPanel';
import CompatibleProvidersPanel from './CompatibleProvidersPanel';
import React, { useEffect, useState } from 'react';
import { Accordion, Alert, Anchor, Badge, Button, Card, Group, Image, PasswordInput, Select, Stack, Switch, Text, TextInput, Title } from '@mantine/core';
import { useThemeStore } from '../../store/themeStore';
import { useSettingsStore } from '../../store/settingsStore';
import { useLang } from '../../lib/i18n';
import type { Agent, LocalUser, UserRole, ComputerAccessLevel } from '../../../shared/types.js';
import AgentSelect from '../common/AgentSelect';
import { useAppMode } from '../../lib/useAppMode';




export default function AdvancedSettings() {
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
  const { settings, updateSettings } = useSettingsStore();
  const { theme, setTheme } = useThemeStore();
  const [openaiKey, setOpenaiKey] = useState('');
  const [anthropicKey, setAnthropicKey] = useState('');
  const [openaiAuth, setOpenaiAuth] = useState(false);
  const [anthropicAuth, setAnthropicAuth] = useState(false);
  const [openaiHasKey, setOpenaiHasKey] = useState(false);
  const [anthropicHasKey, setAnthropicHasKey] = useState(false);
  const [openaiConfigured, setOpenaiConfigured] = useState(true);
  const [anthropicConfigured, setAnthropicConfigured] = useState(true);
  const [secondBrain, setSecondBrain] = useState<{ enabled: boolean; url: string; hasToken: boolean; access?: string; blockPii?: boolean } | null>(null);
  const [brainUrl, setBrainUrl] = useState('');
  const [brainToken, setBrainToken] = useState('');
  const [brainStatus, setBrainStatus] = useState('');
  const [installingBrain, setInstallingBrain] = useState(false);
  const { mode: appMode } = useAppMode();
  const [waStatus, setWaStatus] = useState<'disconnected' | 'connecting' | 'qr' | 'connected' | 'error'>('disconnected');
  const [waPhone, setWaPhone] = useState('');
  const [waQr, setWaQr] = useState('');
  const [waError, setWaError] = useState('');
  const [waMessages, setWaMessages] = useState<Array<{ from: string; text: string; timestamp: number; direction?: string }>>([]);
  const [waSendTo, setWaSendTo] = useState('');
  const [waSendText, setWaSendText] = useState('');
  const [updateState, setUpdateState] = useState<string>('');
  const [updateVersion, setUpdateVersion] = useState<string>('');
  const [agents, setAgents] = useState<Agent[]>([]);
  const [waAgentId, setWaAgentId] = useState('');
  const [arStatus, setArStatus] = useState<{ ok: boolean; installed: boolean; channels: Array<{ name: string; status: string; backend: string | null }>; error?: string } | null>(null);
  const [authInfo, setAuthInfo] = useState<{ hasUsers: boolean; currentUser: LocalUser | null } | null>(null);
  const [users, setUsers] = useState<LocalUser[]>([]);
  const [ownerForm, setOwnerForm] = useState({ name: '', email: '', password: '' });
  const [newUser, setNewUser] = useState({ name: '', email: '', role: 'member' as UserRole, password: '' });
  const [computer, setComputer] = useState<{ level: ComputerAccessLevel; allowedRoots: string; shellAllow: string; shellDeny: string } | null>(null);
  const [brainAccess, setBrainAccess] = useState<'read' | 'write'>('read');
  const [brainReason, setBrainReason] = useState('');
  const [brainRequests, setBrainRequests] = useState<Array<Record<string, unknown>>>([]);
  const [personalBrain, setPersonalBrain] = useState<{ dir: string; files: string[] } | null>(null);
  const [brainMsg, setBrainMsg] = useState('');
  const [composio, setComposio] = useState<{ configured: boolean; keyHint: string | null } | null>(null);
  const [composioKey, setComposioKey] = useState('');
  const [composioMsg, setComposioMsg] = useState('');
  const [composioToolkits, setComposioToolkits] = useState<Array<{ slug: string; name: string }>>([]);
  const [composioConnections, setComposioConnections] = useState<Array<{ toolkit: string; connectedAccountId: string; status: string }>>([]);
  const [composioToolkit, setComposioToolkit] = useState('');
  const [granola, setGranola] = useState<{ enabled: boolean; connected: boolean; account?: string; lastSync?: string; lastSyncError?: string; syncedCount: number; syncMinutes: number } | null>(null);
  const [granolaBusy, setGranolaBusy] = useState(false);
  const [granolaMsg, setGranolaMsg] = useState('');

  useEffect(() => {
    checkAuthStatus();
    window.electronAPI.secondBrainGetConfig().then((c) => {
      setSecondBrain(c);
      setBrainUrl(c.url);
    }).catch(() => {});
    window.electronAPI.whatsappGetStatus().then((s) => {
      setWaStatus(s.status as typeof waStatus);
      setWaPhone(s.phone);
    }).catch(() => {});
    // Hydrate message history from the local database (persists across restarts).
    window.electronAPI.whatsappGetMessages(30).then((msgs) => {
      setWaMessages(msgs.map((m) => ({
        from: m.remote,
        text: m.direction === 'out' ? `→ ${m.text}` : m.text,
        timestamp: m.timestamp,
        direction: m.direction,
      })));
    }).catch(() => {});
    const loadArStatus = () => window.electronAPI.agentReachStatus().then(setArStatus).catch(() => {});
    void loadArStatus();
    const unsubscribe = window.electronAPI.onWhatsAppEvent((event) => {
      if (event.type === 'status') {
        setWaStatus((event.status as typeof waStatus) || 'disconnected');
        if (event.phone) setWaPhone(event.phone);
        if (event.status === 'connected') setWaQr('');
      } else if (event.type === 'qr' && event.qrDataUrl) {
        setWaQr(event.qrDataUrl);
      } else if (event.type === 'message' && event.message) {
        setWaMessages((prev) => [event.message!, ...prev].slice(0, 10));
      } else if (event.type === 'error' && event.error) {
        setWaError(event.error);
      }
    });
    void window.electronAPI.getAgents().then(setAgents).catch(() => {});
    void window.electronAPI.triggersGetWhatsAppAgent().then((r) => setWaAgentId(r.agentId)).catch(() => {});
    window.electronAPI.authGetState().then(async (s) => {
      setAuthInfo(s);
      if (s.currentUser && s.currentUser.role !== 'member') {
        window.electronAPI.authListUsers().then(setUsers).catch(() => {});
      }
    }).catch(() => {});
    window.electronAPI.computerGetSettings().then((c) => setComputer({
      level: c.level,
      allowedRoots: c.allowedRoots.join(', '),
      shellAllow: c.shellAllow.join(', '),
      shellDeny: c.shellDeny.join(', '),
    })).catch(() => {});
    window.electronAPI.brainListRequests().then(setBrainRequests).catch(() => {});
    window.electronAPI.personalBrainStatus().then(setPersonalBrain).catch(() => {});
    window.electronAPI.composioGetStatus().then(setComposio).catch(() => {});
    window.electronAPI.composioListConnections().then(setComposioConnections).catch(() => {});
    window.electronAPI.granolaGetStatus().then(setGranola).catch(() => {});
    const unsubUpdate = window.electronAPI.onUpdateEvent((event) => {
      if (event.type === 'available') setUpdateState(`${t('adv2.updateAvail')}: v${event.version}`);
      else if (event.type === 'not-available') setUpdateState(t('adv2.latestVersion'));
      else if (event.type === 'progress') setUpdateState(`${t('adv2.downloading')} ${event.percent}%`);
      else if (event.type === 'downloaded') { setUpdateState(`v${event.version} ${t('adv2.updateDownloaded').toLowerCase()}`); setUpdateVersion(event.version || ''); }
    });
    return () => { unsubscribe(); unsubUpdate(); };
  }, []);

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
        void checkAuthStatus();
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
      alert(`${provider === 'openai' ? 'OpenAI' : 'Anthropic'} ${t('adv2.keySavedAlert').toLowerCase()}`);
      if (provider === 'openai') { setOpenaiKey(''); setOpenaiHasKey(true); }
      else { setAnthropicKey(''); setAnthropicHasKey(true); }
    } catch (error) {
      alert(t('adv2.keySaveFailed'));
    }
  };

  return (
    <Stack gap="lg">
      <Title order={2} size="h3">{t('adv.title')}</Title>

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
          ]).map((p) => (
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

      <Accordion variant="separated">
        <Accordion.Item value="providers"><Accordion.Control data-compatible-settings>{tr('Other AI providers', 'Outros provedores de IA')}</Accordion.Control><Accordion.Panel><CompatibleProvidersPanel /></Accordion.Panel></Accordion.Item>
        <Accordion.Item value="company"><Accordion.Control data-company-settings>{tr('Separate company memory', 'Memória separada por empresa')}</Accordion.Control><Accordion.Panel><CompanyBrainsPanel /></Accordion.Panel></Accordion.Item>
      </Accordion>

      <Card withBorder padding="md" radius="md">
        <Title order={2} size="h4">{t('adv.secondBrain')}</Title>
        <Text size="sm" c="dimmed">
          {t('adv2.sbDesc')}
        </Text>
        <Card withBorder padding="md" radius="md">
          <Stack gap="sm">
            <Group justify="space-between">
              <Text fw={600}>{t('adv2.status')}</Text>
              <Badge color={secondBrain?.enabled && secondBrain.hasToken ? 'dark' : 'gray'} variant="light">
                {secondBrain?.enabled && secondBrain.hasToken ? t('adv2.connected') : t('adv2.notConnected')}
              </Badge>
            </Group>
            <TextInput
              size="xs"
              label={t('adv2.serverUrl')}
              value={brainUrl}
              onChange={(e) => setBrainUrl(e.currentTarget.value)}
              placeholder="http://127.0.0.1:8787"
            />
            <TextInput
              size="xs"
              label={t('adv2.accessToken')}
              type="password"
              value={brainToken}
              onChange={(e) => setBrainToken(e.currentTarget.value)}
              description={t('adv2.tokenKeepDesc')}
            />
            <Select
              size="xs"
              label={t('adv2.brainAccess')}
              description={t('adv2.brainAccessDesc')}
              value={secondBrain?.access === 'read' ? 'read' : 'write'}
              onChange={(v) => {
                const access = (v || 'write') as 'read' | 'write';
                void window.electronAPI.secondBrainSetConfig({ access }).then(setSecondBrain).catch(() => {});
              }}
              data={[{ value: 'read', label: t('adv2.readOnly') }, { value: 'write', label: t('adv2.readWrite') }]}
              allowDeselect={false}
            />
            <Switch
              size="xs"
              label={t('adv2.piiGuard')}
              description={t('adv2.piiGuardDesc')}
              checked={secondBrain?.blockPii !== false}
              onChange={(e) => {
                void window.electronAPI.secondBrainSetConfig({ blockPii: e.currentTarget.checked }).then(setSecondBrain).catch(() => {});
              }}
            />
            <Group gap="xs">
              <Button
                size="xs"
                variant="default"
                onClick={async () => {
                  setBrainStatus(t('adv2.saving'));
                  try {
                    await window.electronAPI.secondBrainSetConfig({
                      enabled: true,
                      url: brainUrl.trim() || undefined,
                      token: brainToken.trim() || undefined,
                    });
                    const res = await window.electronAPI.secondBrainTest();
                    setBrainStatus(res.ok ? t('adv2.connectedOk') : `${t('adv2.failed')}: ${res.error || t('adv2.unknownErr')}`);
                    setSecondBrain(await window.electronAPI.secondBrainGetConfig());
                    setBrainToken('');
                  } catch (e) {
                    setBrainStatus(`${t('adv2.failed')}: ${e instanceof Error ? e.message : t('adv2.unknownErr')}`);
                  }
                }}
              >
                {t('adv2.saveTest')}
              </Button>
              <Button
                size="xs"
                variant="light"
                color="dark"
                disabled={installingBrain}
                onClick={async () => {
                  setInstallingBrain(true);
                  setBrainStatus(t('ob.installing'));
                  try {
                    const res = await window.electronAPI.brainInstallProduct(appMode === 'corporate' ? 'corporate' : 'personal');
                    setBrainStatus(res.ok ? t('ob.installerOpened') : `${t('adv2.failed')}: ${res.error || t('adv2.unknownErr')}`);
                  } catch (e) {
                    setBrainStatus(`${t('adv2.failed')}: ${e instanceof Error ? e.message : t('adv2.unknownErr')}`);
                  } finally {
                    setInstallingBrain(false);
                  }
                }}
              >
                {installingBrain ? t('ob.installing') : appMode === 'corporate' ? t('ob.installCorp') : t('ob.installPersonal')}
              </Button>
              {secondBrain?.enabled && (
                <Button
                  size="xs"
                  variant="subtle"
                  color="gray"
                  onClick={async () => {
                    await window.electronAPI.secondBrainSetConfig({ enabled: false });
                    setSecondBrain(await window.electronAPI.secondBrainGetConfig());
                    setBrainStatus(t('adv2.disabled'));
                  }}
                >
                  {t('adv2.disconnect')}
                </Button>
              )}
            </Group>
            {brainStatus && <Text size="xs" c="dimmed">{brainStatus}</Text>}
          </Stack>
        </Card>
      </Card>

      <Card withBorder padding="md" radius="md">
        <Title order={2} size="h4">Granola</Title>
        <Text size="sm" c="dimmed">
          {t('granola.desc')}
        </Text>
        <Card withBorder padding="md" radius="md">
          <Stack gap="sm">
            <Group justify="space-between">
              <Text fw={600}>{t('adv2.status')}</Text>
              <Badge color={granola?.connected ? 'dark' : 'gray'} variant="light">
                {granola?.connected
                  ? `${t('adv2.connected')}${granola.account ? ` · ${granola.account}` : ''}`
                  : t('adv2.notConnected')}
              </Badge>
            </Group>
            {granola?.connected && (
              <Text size="xs" c="dimmed">
                {granola.syncedCount > 0
                  ? `${t('granola.synced')}: ${granola.syncedCount}${granola.lastSync ? ` · ${t('granola.lastSync')} ${new Date(granola.lastSync).toLocaleString()}` : ''}`
                  : t('granola.neverSynced')}
                {granola.lastSyncError && (
                  <Text span c="red"> · {t('granola.lastError')}: {granola.lastSyncError}</Text>
                )}
              </Text>
            )}
            <Group gap="xs">
              {!granola?.connected ? (
                <Button
                  size="xs"
                  variant="default"
                  loading={granolaBusy}
                  onClick={async () => {
                    setGranolaBusy(true);
                    setGranolaMsg('');
                    try {
                      const res = await window.electronAPI.granolaConnect();
                      if (res.ok) {
                        setGranola(await window.electronAPI.granolaGetStatus());
                        setGranolaMsg(`${t('granola.connectedOk')}${res.account ? ` (${res.account})` : ''}`);
                      } else {
                        setGranolaMsg(`${t('adv2.failed')}: ${res.error || t('adv2.unknownErr')}`);
                      }
                    } catch (e) {
                      setGranolaMsg(`${t('adv2.failed')}: ${e instanceof Error ? e.message : t('adv2.unknownErr')}`);
                    } finally {
                      setGranolaBusy(false);
                    }
                  }}
                >
                  {t('granola.connect')}
                </Button>
              ) : (
                <>
                  <Button
                    size="xs"
                    variant="light"
                    color="dark"
                    loading={granolaBusy}
                    onClick={async () => {
                      setGranolaBusy(true);
                      setGranolaMsg('');
                      try {
                        const res = await window.electronAPI.granolaSyncNow();
                        setGranolaMsg(res.error
                          ? `${t('adv2.failed')}: ${res.error}`
                          : `${t('granola.syncDone')}: ${res.synced} ${t('granola.newMeetings')}, ${res.skipped} ${t('granola.unchanged')}${res.removed ? `, ${res.removed} ${t('granola.removed')}` : ''}`);
                        setGranola(await window.electronAPI.granolaGetStatus());
                      } catch (e) {
                        setGranolaMsg(`${t('adv2.failed')}: ${e instanceof Error ? e.message : t('adv2.unknownErr')}`);
                      } finally {
                        setGranolaBusy(false);
                      }
                    }}
                  >
                    {t('granola.syncNow')}
                  </Button>
                  <Button
                    size="xs"
                    variant="subtle"
                    color="gray"
                    onClick={async () => {
                      if (confirm(t('granola.disconnectConfirm'))) {
                        await window.electronAPI.granolaDisconnect();
                        setGranola(await window.electronAPI.granolaGetStatus());
                        setGranolaMsg(t('granola.disconnected'));
                      }
                    }}
                  >
                    {t('adv2.disconnect')}
                  </Button>
                </>
              )}
            </Group>
            {granola?.connected && (
              <Group gap="xs" align="flex-end">
                <TextInput
                  size="xs"
                  style={{ width: 140 }}
                  label={t('granola.syncEvery')}
                  type="number"
                  min={15}
                  value={String(granola.syncMinutes)}
                  onChange={(e) => {
                    const v = Math.max(15, Math.floor(Number(e.currentTarget.value) || 60));
                    void window.electronAPI.granolaSetSyncMinutes(v).then(() =>
                      window.electronAPI.granolaGetStatus().then(setGranola).catch(() => {})
                    ).catch(() => {});
                  }}
                />
                <Text size="xs" c="dimmed" pb={6}>{t('granola.minutes')}</Text>
              </Group>
            )}
            {granolaMsg && <Text size="xs" c="dimmed">{granolaMsg}</Text>}
          </Stack>
        </Card>
      </Card>

      <Card withBorder padding="md" radius="md">
        <Title order={2} size="h4">{t('adv.whatsapp')}</Title>
        <Text size="sm" c="dimmed">
          {t('adv2.waDesc')}
        </Text>
        <Card withBorder padding="md" radius="md">
          <Stack gap="sm">
            <Group justify="space-between">
              <Text fw={600}>{t('adv2.connection')}</Text>
              <Badge color={waStatus === 'connected' ? 'dark' : 'gray'} variant="light">
                {waStatus === 'connected' ? `${t('adv2.connected')}${waPhone ? ` · +${waPhone}` : ''}` : waStatus}
              </Badge>
            </Group>
            {waStatus === 'qr' && waQr && (
              <div style={{ display: 'flex', justifyContent: 'center', padding: '8px 0' }}>
                <Image src={waQr} w={240} h={240} radius="md" alt="WhatsApp QR code" />
              </div>
            )}
            {waStatus === 'connecting' && <Text size="xs" c="dimmed">{t('adv2.connecting')}</Text>}
            {waError && <Text size="xs" c="dimmed">Error: {waError}</Text>}
            <Group gap="xs">
              {waStatus !== 'connected' && waStatus !== 'connecting' && (
                <Button size="xs" variant="default" onClick={() => { setWaQr(''); setWaError(''); void window.electronAPI.whatsappStart(); }}>
                  {t('adv2.connect')}
                </Button>
              )}
              {(waStatus === 'connected' || waStatus === 'connecting' || waStatus === 'qr') && (
                <Button size="xs" variant="subtle" color="gray" onClick={() => void window.electronAPI.whatsappStop()}>
                  {t('adv2.disconnect')}
                </Button>
              )}
            </Group>
            {waStatus === 'connected' && (
              <>
                <TextInput
                  size="xs"
                  label={t('adv2.sendTo')}
                  placeholder="5511999999999"
                  value={waSendTo}
                  onChange={(e) => setWaSendTo(e.currentTarget.value)}
                />
                <Group gap="xs" align="flex-end">
                  <TextInput
                    style={{ flex: 1 }}
                    size="xs"
                    label={t('adv2.message')}
                    value={waSendText}
                    onChange={(e) => setWaSendText(e.currentTarget.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && waSendTo && waSendText) {
                        void window.electronAPI.whatsappSendMessage(waSendTo, waSendText).then(() => setWaSendText(''));
                      }
                    }}
                  />
                  <Button
                    size="xs"
                    variant="light"
                    disabled={!waSendTo || !waSendText}
                    onClick={async () => {
                      try {
                        await window.electronAPI.whatsappSendMessage(waSendTo, waSendText);
                        setWaSendText('');
                      } catch (e) {
                        setWaError(e instanceof Error ? e.message : t('adv2.sendFailed'));
                      }
                    }}
                  >
                    {t('adv2.send')}
                  </Button>
                </Group>
              </>
            )}
            {waMessages.length > 0 && (
              <div>
                <Group justify="space-between" mb={4}>
                  <Text size="xs" fw={600}>{t('adv2.history')}</Text>
                  <Button size="compact-xs" variant="subtle" color="gray" onClick={() => {
                    void window.electronAPI.whatsappClearMessages().then(() => setWaMessages([]));
                  }}>{t('adv2.clear')}</Button>
                </Group>
                <Text size="xs" c="dimmed" mb={4}>
                  {t('adv2.historyDesc')}
                </Text>
                {waMessages.slice(0, 20).map((m, i) => (
                  <Text key={i} size="xs" c="dimmed">
                    {m.direction === 'out' ? t('adv2.you') : `+${m.from}`}: {m.text}
                  </Text>
                ))}
              </div>
            )}
          </Stack>
        </Card>
      </Card>

      <Card withBorder padding="md" radius="md">
        <Title order={2} size="h4">{t('adv2.composioTitle')}</Title>
        <Text size="sm" c="dimmed">
          {t('adv2.composioDesc')}
        </Text>
        <Card withBorder padding="md" radius="md">
          <Stack gap="sm">
            <Group justify="space-between">
              <Text fw={600}>{t('adv2.apiKey')}</Text>
              {composio && (
                <Badge color={composio.configured ? 'dark' : 'gray'} variant="light">
                  {composio.configured ? `${t('adv2.configured')} ${composio.keyHint || ''}` : t('adv2.notConfigured')}
                </Badge>
              )}
            </Group>
            <Group gap="xs" align="flex-end">
              <PasswordInput
                style={{ flex: 1 }}
                size="xs"
                label={t('adv2.composioKeyLabel')}
                placeholder="ak_…"
                value={composioKey}
                onChange={(e) => setComposioKey(e.currentTarget.value)}
              />
              <Button
                size="xs"
                disabled={!composioKey.trim()}
                onClick={async () => {
                  setComposioMsg('');
                  try {
                    const r = await window.electronAPI.composioSetApiKey(composioKey);
                    setComposio(r);
                    setComposioKey('');
                    setComposioMsg(t('adv2.keySavedMsg'));
                  } catch (e) {
                    setComposioMsg(e instanceof Error ? e.message : t('adv2.saveKeyFailed'));
                  }
                }}
              >
                {t('common.save')}
              </Button>
              {composio?.configured && (
                <Button
                  size="xs"
                  variant="subtle"
                  color="gray"
                  onClick={async () => {
                    const r = await window.electronAPI.composioClearApiKey();
                    setComposio(r);
                    setComposioConnections([]);
                  }}
                >
                  {t('common.remove')}
                </Button>
              )}
            </Group>
            {composio?.configured && (
              <Group gap="xs">
                <Button
                  size="compact-xs"
                  variant="default"
                  onClick={async () => {
                    setComposioMsg('');
                    const r = await window.electronAPI.composioTest();
                    setComposioMsg(r.ok ? t('adv2.connOk') : `${t('adv2.failed')}: ${r.error || t('adv2.unknownErr')}`);
                  }}
                >
                  {t('adv2.testConn')}
                </Button>
              </Group>
            )}
            {composioMsg && <Text size="xs" c="dimmed">{composioMsg}</Text>}

            {composio?.configured && (
              <>
                <Group gap="xs" align="flex-end">
                  <Select
                    style={{ flex: 1 }}
                    size="xs"
                    label={t('adv2.connectApp')}
                    placeholder={composioToolkits.length ? t('adv2.chooseApp') : t('adv2.typeSlug')}
                    data={composioToolkits.map((t) => ({ value: t.slug, label: t.name }))}
                    value={composioToolkit || null}
                    onChange={(v) => setComposioToolkit(v || '')}
                    searchable
                    onFocus={async () => {
                      if (!composioToolkits.length) {
                        const list = await window.electronAPI.composioListToolkits().catch(() => []);
                        setComposioToolkits(list);
                      }
                    }}
                  />
                  <Button
                    size="xs"
                    variant="light"
                    disabled={!composioToolkit}
                    onClick={async () => {
                      setComposioMsg('');
                      try {
                        await window.electronAPI.composioConnect(composioToolkit);
                        setComposioMsg(t('adv2.authOpened'));
                        const conns = await window.electronAPI.composioListConnections();
                        setComposioConnections(conns);
                      } catch (e) {
                        setComposioMsg(e instanceof Error ? e.message : t('adv2.connectFailed'));
                      }
                    }}
                  >
                    {t('adv2.connect')}
                  </Button>
                  <Button
                    size="compact-xs"
                    variant="subtle"
                    color="gray"
                    onClick={async () => setComposioConnections(await window.electronAPI.composioListConnections())}
                  >
                    {t('common.refresh')}
                  </Button>
                </Group>
                {composioConnections.length > 0 && (
                  <Stack gap={4}>
                    {composioConnections.map((c) => (
                      <Group key={c.connectedAccountId} justify="space-between">
                        <Group gap={6}>
                          <Text size="xs" fw={500}>{c.toolkit}</Text>
                          <Badge size="xs" color={c.status === 'ACTIVE' ? 'dark' : 'gray'} variant="light">{c.status}</Badge>
                        </Group>
                        <Button
                          size="compact-xs"
                          variant="subtle"
                          color="gray"
                          onClick={async () => {
                            await window.electronAPI.composioDisconnect(c.connectedAccountId);
                            setComposioConnections(await window.electronAPI.composioListConnections());
                          }}
                        >
                          {t('adv2.disconnect')}
                        </Button>
                      </Group>
                    ))}
                  </Stack>
                )}
                <Text size="xs" c="dimmed">
                  {t('adv2.composioHint')}
                </Text>
              </>
            )}
          </Stack>
        </Card>
      </Card>

      <Card withBorder padding="md" radius="md">
        <Group justify="space-between" mb={4}>
          <Title order={2} size="h4">{t('adv2.arTitle')}</Title>
          {arStatus && (
            <Badge color={arStatus.installed ? 'dark' : 'gray'} variant="light">
              {arStatus.installed ? t('adv2.installed') : t('adv2.notInstalled')}
            </Badge>
          )}
        </Group>
        <Text size="sm" c="dimmed" mb="sm">
          {t('adv2.arDesc')}
        </Text>
        {arStatus?.installed && arStatus.channels.length > 0 && (
          <Group gap={6} mb="sm">
            {arStatus.channels.map((c) => (
              <Badge key={c.name} size="sm" variant="light" color={c.status === 'ok' ? 'dark' : c.status === 'warn' ? 'gray' : 'red'}>
                {c.name}: {c.status}
              </Badge>
            ))}
          </Group>
        )}
        {!arStatus?.installed && (
          <Text size="xs" c="dimmed">
            {t('adv2.arInstall')} <Text span ff="monospace">pip install agent-reach</Text> {t('adv2.arThen')} <Text span ff="monospace">agent-reach doctor</Text>. {t('adv2.arSkillHint')}
          </Text>
        )}
        <Button size="xs" variant="default" onClick={() => void window.electronAPI.agentReachStatus().then(setArStatus)}>
          {t('adv2.recheck')}
        </Button>
      </Card>

      {authInfo && !authInfo.hasUsers && (
        <Card withBorder padding="md" radius="md">
          <Title order={3} size="h5" mb="md">{t('adv.users')}</Title>
          <Text size="sm" c="dimmed" mb="md">
            {t('adv2.ownerDesc')}
          </Text>
          <Stack gap="xs" maw={420}>
            <TextInput size="xs" label={t('adv2.yourName')} value={ownerForm.name} onChange={(e) => setOwnerForm({ ...ownerForm, name: e.currentTarget.value })} />
            <TextInput size="xs" label={t('login.email')} type="email" value={ownerForm.email} onChange={(e) => setOwnerForm({ ...ownerForm, email: e.currentTarget.value })} />
            <PasswordInput size="xs" label={t('adv2.passwordMin')} value={ownerForm.password} onChange={(e) => setOwnerForm({ ...ownerForm, password: e.currentTarget.value })} />
            <Group justify="flex-end">
              <Button size="xs" disabled={!ownerForm.name || !ownerForm.email || ownerForm.password.length < 6}
                onClick={async () => {
                  await window.electronAPI.authSetupOwner(ownerForm);
                  window.location.reload();
                }}>
                {t('adv2.createOwner')}
              </Button>
            </Group>
          </Stack>
        </Card>
      )}

      {authInfo?.hasUsers && authInfo.currentUser && authInfo.currentUser.role !== 'member' && (
        <Card withBorder padding="md" radius="md">
          <Title order={3} size="h5" mb="md">{t('adv.users')}</Title>
          <Stack gap="xs">
            {users.map((u) => (
              <Group key={u.id} justify="space-between" wrap="nowrap">
                <div style={{ flex: 1, minWidth: 0 }}>
                  <Text size="sm" fw={500}>{u.name}</Text>
                  <Text size="xs" c="dimmed">{u.email}</Text>
                </div>
                <Select
                  size="xs" w={110} data={['member', 'admin', 'owner']}
                  value={u.role}
                  disabled={u.id === authInfo.currentUser?.id}
                  onChange={(v) => {
                    if (v) void window.electronAPI.authUpdateRole(u.id, v as UserRole)
                      .then(() => window.electronAPI.authListUsers().then(setUsers)).catch((e) => alert(e.message));
                  }}
                />
                <Button size="compact-xs" variant="subtle" color="gray"
                  disabled={u.id === authInfo.currentUser?.id}
                  onClick={async () => {
                    if (!confirm(`${t('adv2.removeUserConfirm')}: ${u.email}?`)) return;
                    await window.electronAPI.authDeleteUser(u.id).catch((e) => alert(e.message));
                    setUsers(await window.electronAPI.authListUsers());
                  }}>{t('common.remove')}</Button>
              </Group>
            ))}
            <Card withBorder padding="sm" radius="sm" mt="xs" style={{ backgroundColor: 'var(--mantine-color-default-hover)' }}>
              <Text size="xs" fw={600} mb={6}>{t('adv2.inviteUser')}</Text>
              <Stack gap={6}>
                <Group gap={6} grow>
                  <TextInput size="xs" placeholder={t('common.name')} value={newUser.name} onChange={(e) => setNewUser({ ...newUser, name: e.currentTarget.value })} />
                  <TextInput size="xs" placeholder={t('login.email')} value={newUser.email} onChange={(e) => setNewUser({ ...newUser, email: e.currentTarget.value })} />
                </Group>
                <Group gap={6} grow>
                  <Select size="xs" label={t('adv2.userRole')} data={['member', 'admin']} value={newUser.role} allowDeselect={false}
                    onChange={(v) => setNewUser({ ...newUser, role: (v || 'member') as UserRole })} />
                  <PasswordInput size="xs" placeholder={t('login.password')} value={newUser.password} onChange={(e) => setNewUser({ ...newUser, password: e.currentTarget.value })} />
                </Group>
                <Text size="xs" c="dimmed">
                  {newUser.role === 'admin' ? t('role.admin') : t('role.member')}
                </Text>
                <Group justify="flex-end">
                  <Button size="xs" disabled={!newUser.name || !newUser.email || newUser.password.length < 6}
                    onClick={async () => {
                      await window.electronAPI.authCreateUser(newUser).catch((e) => alert(e.message));
                      setNewUser({ name: '', email: '', role: 'member', password: '' });
                      setUsers(await window.electronAPI.authListUsers());
                    }}>{t('adv2.addUser')}</Button>
                </Group>
              </Stack>
            </Card>
          </Stack>
        </Card>
      )}

      {computer && authInfo?.currentUser && authInfo.currentUser.role !== 'member' && (
        <Card withBorder padding="md" radius="md">
          <Title order={3} size="h5" mb="md">{t('adv.computerAccess')}</Title>
          <Text size="sm" c="dimmed" mb="md">
            {t('adv2.caDesc')}
          </Text>
          <Stack gap="xs" maw={520}>
            <Select
              size="xs" label={t('adv2.accessLevel')} allowDeselect={false}
              data={[
                { value: 'workspace', label: t('adv2.level.workspace') },
                { value: 'authorized', label: t('adv2.level.authorized') },
                { value: 'full', label: t('adv2.level.full') },
              ]}
              value={computer.level}
              onChange={(v) => setComputer({ ...computer, level: (v || 'workspace') as ComputerAccessLevel })}
            />
            <TextInput size="xs" label={t('adv2.allowedRoots')} description={t('adv2.allowedRootsDesc')}
              value={computer.allowedRoots} onChange={(e) => setComputer({ ...computer, allowedRoots: e.currentTarget.value })} />
            <TextInput size="xs" label={t('adv2.shellAllow')} description={t('adv2.shellAllowDesc')}
              value={computer.shellAllow} onChange={(e) => setComputer({ ...computer, shellAllow: e.currentTarget.value })} />
            <TextInput size="xs" label={t('adv2.shellDeny')} description={t('adv2.shellDenyDesc')}
              value={computer.shellDeny} onChange={(e) => setComputer({ ...computer, shellDeny: e.currentTarget.value })} />
            <Group justify="flex-end">
              <Button size="xs" onClick={async () => {
                const parse = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);
                const res = await window.electronAPI.computerUpdateSettings({
                  level: computer.level,
                  allowedRoots: parse(computer.allowedRoots),
                  shellAllow: parse(computer.shellAllow),
                  shellDeny: parse(computer.shellDeny),
                }).catch((e) => { alert(e.message); return null; });
                if (res) setBrainMsg('');
              }}>{t('common.save')}</Button>
            </Group>
          </Stack>
        </Card>
      )}

      <Card withBorder padding="md" radius="md">
        <Title order={3} size="h5" mb="md">{t('adv.brainsGithub')}</Title>
        <Text size="sm" c="dimmed" mb="md">
          {t('adv2.brainsDescPre')} <b>{t('adv2.corpBrain')}</b> {t('adv2.brainsDescMid')} <b>{t('adv2.personalBrain')}</b> {t('adv2.brainsDescPost')}
        </Text>
        <Stack gap="md">
          <Card withBorder padding="sm" radius="sm">
            <Text size="xs" fw={600} mb={6}>{t('adv2.corpBrainReq')}</Text>
            <Text size="xs" c="dimmed" mb={8}>
              {t('adv2.corpBrainDescPre')} <Text span ff="monospace">criptogus/keepmind-corp</Text>. {t('adv2.corpBrainDescPost')}
            </Text>
            <Group gap={6} align="flex-end">
              <Select size="xs" w={130} label={t('govr.scope')} value={brainAccess} allowDeselect={false}
                onChange={(v) => setBrainAccess((v || 'read') as 'read' | 'write')}
                data={[{ value: 'read', label: t('adv2.read') }, { value: 'write', label: t('adv2.readWrite') }]} />
              <TextInput size="xs" style={{ flex: 1 }} placeholder={t('adv2.reasonPh')} value={brainReason}
                onChange={(e) => setBrainReason(e.currentTarget.value)} />
              <Button size="xs" variant="default"
                onClick={async () => {
                  await window.electronAPI.brainRequestCorporateAccess({ scope: brainAccess, reason: brainReason || undefined }).catch((e) => alert(e.message));
                  setBrainRequests(await window.electronAPI.brainListRequests());
                  setBrainReason('');
                }}>{t('adv2.requestAccess')}</Button>
            </Group>
            {brainRequests.length > 0 && (
              <Stack gap={4} mt="xs">
                {brainRequests.map((r) => (
                  <Group key={String(r.id)} justify="space-between" wrap="nowrap">
                    <Text size="xs">
                      <Badge size="xs" variant="light" mr={6}>{String(r.status)}</Badge>
                      {String(r.userEmail)} · {String(r.kind)}{r.scope ? ` (${String(r.scope)})` : ''}
                      {r.repoUrl ? ` · ${String(r.repoUrl)}` : ''}
                    </Text>
                    {String(r.status) === 'pending' && authInfo?.currentUser && authInfo.currentUser.role !== 'member' && (
                      <Group gap={4}>
                        <Button size="compact-xs" variant="light" color="dark"
                          onClick={async () => {
                            await window.electronAPI.brainDecideRequest(String(r.id), 'approved').catch((e) => alert(e.message));
                            setBrainRequests(await window.electronAPI.brainListRequests());
                          }}>{t('common.approve')}</Button>
                        <Button size="compact-xs" variant="subtle" color="gray"
                          onClick={async () => {
                            await window.electronAPI.brainDecideRequest(String(r.id), 'rejected').catch((e) => alert(e.message));
                            setBrainRequests(await window.electronAPI.brainListRequests());
                          }}>{t('common.reject')}</Button>
                      </Group>
                    )}
                  </Group>
                ))}
              </Stack>
            )}
          </Card>

          <Card withBorder padding="sm" radius="sm">
            <Text size="xs" fw={600} mb={6}>{t('adv2.personalRepo')}</Text>
            <Text size="xs" c="dimmed" mb={8}>
              {personalBrain ? <>{t('adv2.localVault')}: <Text span ff="monospace">{personalBrain.dir}</Text> ({personalBrain.files.length} {t('adv2.files')})</> : t('adv2.vaultLocal')}
            </Text>
            <Group gap={6}>
              <Button size="xs" variant="default" onClick={() => void window.electronAPI.personalBrainOpenFolder()}>{t('adv2.openFolder')}</Button>
              <Button size="xs" variant="default"
                onClick={async () => {
                  setBrainMsg(t('adv2.creatingRepo'));
                  const res = await window.electronAPI.brainCreatePersonalRepo().catch((e): { ok: boolean; repo?: string; url?: string; error?: string } => ({ ok: false, error: e instanceof Error ? e.message : String(e) }));
                  setBrainMsg(res.ok ? `${t('adv2.created')} ${res.repo} → ${res.url}` : `${t('adv2.failed')}: ${res.error || t('adv2.unknownErr')}`);
                  setPersonalBrain(await window.electronAPI.personalBrainStatus().catch(() => personalBrain));
                }}>{t('adv2.createRepo')}</Button>
            </Group>
            {brainMsg && <Text size="xs" c="dimmed" mt={6}>{brainMsg}</Text>}
          </Card>
        </Stack>
      </Card>

      <Card withBorder padding="md" radius="md">
        <Title order={3} size="h5" mb="md">{t('adv.appearance')}</Title>
        <Select
          label={t('adv2.theme')}
          value={theme}
          onChange={(v) => setTheme((v || 'light') as typeof theme)}
          data={[
            { value: 'light', label: t('adv2.themeLight') },
            { value: 'dark', label: t('adv2.themeDark') },
            { value: 'auto', label: t('adv2.themeAuto') },
          ]}
          allowDeselect={false}
          style={{ maxWidth: 280 }}
        />
      </Card>

      <Card withBorder padding="md" radius="md">
        <Title order={3} size="h5" mb="md">{t('adv2.execution')}</Title>
        <Text size="sm">{t('settings.autonomyPolicy')}</Text>
      </Card>

      <Card withBorder padding="md" radius="md">
        <Title order={3} size="h5" mb="md">{t('adv.automation')}</Title>
        <Text size="sm" c="dimmed" mb="md">
          {t('adv2.automationDesc')}
        </Text>
        <Stack gap={4} mb="md">
          <Switch
            size="xs"
            label={t('adv2.autoSkills')}
            description={t('adv2.autoSkillsDesc')}
            checked={settings.skillsAutoRoute !== false}
            onChange={(e) => updateSettings({ skillsAutoRoute: e.currentTarget.checked })}
          />
          <Switch
            size="xs"
            label={t('adv2.autoModel')}
            description={t('adv2.autoModelDesc')}
            checked={settings.llmAutoRoute !== false}
            onChange={(e) => updateSettings({ llmAutoRoute: e.currentTarget.checked })}
          />

        </Stack>
        <Stack gap="sm">
          <AgentSelect
            size="xs"
            label={t('adv2.waAgent')}
            description={t('adv2.waAgentDesc')}
            placeholder={t('adv2.disabledPh')}
            clearable
            agents={agents}
            value={waAgentId || null}
            onChange={(v) => {
              const id = v || '';
              setWaAgentId(id);
              void window.electronAPI.triggersSetWhatsAppAgent(id);
            }}
          />
          <Text size="xs" c="dimmed">
            {t('adv2.triggersMoved')}
          </Text>
        </Stack>
      </Card>

      <Card withBorder padding="md" radius="md">
        <Title order={3} size="h5" mb="md">{t('adv.updates')}</Title>
        <Group gap="xs">
          <Button
            size="xs"
            variant="default"
            onClick={async () => {
              setUpdateState(t('adv2.checking'));
              const res = await window.electronAPI.updateCheck();
              if (!res.ok) setUpdateState(`${t('adv2.updateCheckFailed')}: ${res.error || t('adv2.noFeed')}`);
            }}
          >
            {t('adv2.checkUpdates')}
          </Button>
          {updateVersion && (
            <Button size="xs" onClick={async () => {
              setUpdateState(t('adv2.installing'));
              const res = await window.electronAPI.updateInstall();
              if (!res.ok && res.error) setUpdateState(`${t('adv2.installFailed')}: ${res.error}`);
            }}>
              {t('adv2.restartInstall')}
            </Button>
          )}
        </Group>
        {updateState && <Text size="xs" c="dimmed" mt={8}>{updateState}</Text>}
      </Card>

      <Card withBorder padding="md" radius="md">
        <Title order={3} size="h5" mb="md">{t('adv.data')}</Title>
        <Group gap="xs">
          <Button
            size="xs"
            variant="default"
            onClick={async () => {
              const res = await window.electronAPI.dataExport();
              if (res.ok && res.path) alert(`${t('adv2.backupSaved')}\n${res.path}`);
              else if (res.error) alert(`${t('adv2.exportFailed')}: ${res.error}`);
            }}
          >
            {t('adv2.exportData')}
          </Button>
          <Button
            size="xs"
            variant="default"
            onClick={async () => {
              if (!confirm(t('adv2.importConfirm'))) return;
              const res = await window.electronAPI.dataImport();
              if (res.ok) alert(t('adv2.imported'));
              else if (res.error) alert(`${t('adv2.importFailed')}: ${res.error}`);
            }}
          >
            {t('adv2.importData')}
          </Button>
        </Group>
      </Card>
    </Stack>
  );
}

