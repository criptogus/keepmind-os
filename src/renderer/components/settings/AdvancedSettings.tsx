import React, { useEffect, useState } from 'react';
import { Badge, Button, Card, Group, Image, PasswordInput, Select, Stack, Switch, Text, TextInput, Title, NumberInput } from '@mantine/core';
import { useThemeStore } from '../../store/themeStore';
import { useSettingsStore } from '../../store/settingsStore';
import type { Agent, AgentTrigger, LocalUser, UserRole, ComputerAccessLevel } from '../../../shared/types.js';




export default function AdvancedSettings() {
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
  const [waStatus, setWaStatus] = useState<'disconnected' | 'connecting' | 'qr' | 'connected' | 'error'>('disconnected');
  const [waPhone, setWaPhone] = useState('');
  const [waQr, setWaQr] = useState('');
  const [waError, setWaError] = useState('');
  const [waMessages, setWaMessages] = useState<Array<{ from: string; text: string; timestamp: number; direction?: string }>>([]);
  const [waSendTo, setWaSendTo] = useState('');
  const [waSendText, setWaSendText] = useState('');
  const [updateState, setUpdateState] = useState<string>('');
  const [updateVersion, setUpdateVersion] = useState<string>('');
  const [triggers, setTriggers] = useState<AgentTrigger[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [waAgentId, setWaAgentId] = useState('');
  const [newTrigger, setNewTrigger] = useState({ name: '', agentId: '', kind: 'interval' as 'interval' | 'daily', intervalMinutes: 60, timeOfDay: '09:00', prompt: '' });
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
    void window.electronAPI.triggersList().then(setTriggers).catch(() => {});
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
    const unsubUpdate = window.electronAPI.onUpdateEvent((event) => {
      if (event.type === 'available') setUpdateState(`Update available: v${event.version}`);
      else if (event.type === 'not-available') setUpdateState('You are on the latest version.');
      else if (event.type === 'progress') setUpdateState(`Downloading… ${event.percent}%`);
      else if (event.type === 'downloaded') { setUpdateState(`Update v${event.version} downloaded`); setUpdateVersion(event.version || ''); }
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
    try {
      const result = await window.electronAPI.oauthAuthenticate(provider);
      if (result.success) {
        alert(`${provider === 'openai' ? 'OpenAI' : 'Anthropic'} authentication successful!`);
        checkAuthStatus();
      } else {
        alert(`Authentication failed: ${result.error}`);
      }
    } catch (error) {
      alert('Authentication failed');
    }
  };

  const handleOAuthLogout = async (provider: 'openai' | 'anthropic') => {
    if (confirm(`Logout from ${provider === 'openai' ? 'OpenAI' : 'Anthropic'}?`)) {
      await window.electronAPI.oauthLogout(provider);
      checkAuthStatus();
    }
  };

  const handleApiKeySave = async (provider: 'openai' | 'anthropic', key: string) => {
    if (!key) return;
    try {
      await window.electronAPI.setApiKey(provider, key);
      alert(`${provider === 'openai' ? 'OpenAI' : 'Anthropic'} API key saved`);
      if (provider === 'openai') { setOpenaiKey(''); setOpenaiHasKey(true); }
      else { setAnthropicKey(''); setAnthropicHasKey(true); }
    } catch (error) {
      alert('Failed to save API key');
    }
  };

  return (
    <Stack gap="lg">
      <Title order={2} size="h3">Advanced Settings</Title>

      <Card withBorder padding="md" radius="md">
        <Title order={2} size="h4">AI Provider Authentication</Title>
        <Text size="sm" c="dimmed">
          Connect to AI providers using OAuth or API keys. API keys are the most reliable option.
        </Text>

        <Stack gap="md">
          {([
            { provider: 'openai' as const, label: 'OpenAI', auth: openaiAuth, configured: openaiConfigured, hasKey: openaiHasKey, setHasKey: setOpenaiHasKey, key: openaiKey, setKey: setOpenaiKey, placeholder: 'sk-...' },
            { provider: 'anthropic' as const, label: 'Anthropic', auth: anthropicAuth, configured: anthropicConfigured, hasKey: anthropicHasKey, setHasKey: setAnthropicHasKey, key: anthropicKey, setKey: setAnthropicKey, placeholder: 'sk-ant-...' },
          ]).map((p) => (
            <Card key={p.provider} withBorder padding="md" radius="md">
              <Stack gap="sm">
                <Group justify="space-between">
                  <Text fw={600}>{p.label}</Text>
                  <Badge color={p.auth || p.hasKey ? 'dark' : 'gray'} variant="light">
                    {p.auth ? 'OAuth connected' : p.hasKey ? 'API key saved' : 'Not connected'}
                  </Badge>
                </Group>
                <Group gap="xs">
                  <Button
                    size="xs"
                    variant="default"
                    disabled={p.auth || !p.configured}
                    onClick={() => handleOAuthLogin(p.provider)}
                  >
                    Login with OAuth
                  </Button>
                  {p.auth && (
                    <Button size="xs" variant="subtle" color="gray" onClick={() => handleOAuthLogout(p.provider)}>
                      Logout
                    </Button>
                  )}
                </Group>
                {!p.configured && (
                  <Text size="xs" c="dimmed">
                    OAuth unavailable — requires a provider-approved client ID. Use an API key instead.
                  </Text>
                )}
                <Group gap="xs" align="flex-end">
                  <TextInput
                    style={{ flex: 1 }}
                    size="xs"
                    type="password"
                    placeholder={p.hasKey ? 'API key saved — enter a new one to replace' : `API key (${p.placeholder})`}
                    value={p.key}
                    onChange={(e) => p.setKey(e.currentTarget.value)}
                  />
                  <Button
                    size="xs"
                    variant="light"
                    disabled={!p.key}
                    onClick={() => handleApiKeySave(p.provider, p.key)}
                  >
                    Save
                  </Button>
                  {p.hasKey && (
                    <Button
                      size="xs"
                      variant="subtle"
                      color="gray"
                      onClick={async () => {
                        if (confirm(`Remove the saved ${p.label} API key?`)) {
                          await window.electronAPI.clearApiKey(p.provider);
                          p.setHasKey(false);
                        }
                      }}
                    >
                      Remove
                    </Button>
                  )}
                </Group>
              </Stack>
            </Card>
          ))}
        </Stack>
      </Card>

      <Card withBorder padding="md" radius="md">
        <Title order={2} size="h4">Second Brain (KeepMind Corp)</Title>
        <Text size="sm" c="dimmed">
          Optional integration with your local KeepMind Corp server. Agents can search and store shared company knowledge.
        </Text>
        <Card withBorder padding="md" radius="md">
          <Stack gap="sm">
            <Group justify="space-between">
              <Text fw={600}>Status</Text>
              <Badge color={secondBrain?.enabled && secondBrain.hasToken ? 'dark' : 'gray'} variant="light">
                {secondBrain?.enabled && secondBrain.hasToken ? 'Connected' : 'Not connected'}
              </Badge>
            </Group>
            <TextInput
              size="xs"
              label="Server URL"
              value={brainUrl}
              onChange={(e) => setBrainUrl(e.currentTarget.value)}
              placeholder="http://127.0.0.1:8787"
            />
            <TextInput
              size="xs"
              label="Access token"
              type="password"
              value={brainToken}
              onChange={(e) => setBrainToken(e.currentTarget.value)}
              description="Leave empty to keep the existing token."
            />
            <Select
              size="xs"
              label="Brain access"
              description="Read-only blocks all writes to the corporate brain, even if the token allows them."
              value={secondBrain?.access === 'read' ? 'read' : 'write'}
              onChange={(v) => {
                const access = (v || 'write') as 'read' | 'write';
                void window.electronAPI.secondBrainSetConfig({ access }).then(setSecondBrain).catch(() => {});
              }}
              data={[{ value: 'read', label: 'Read-only' }, { value: 'write', label: 'Read & write' }]}
              allowDeselect={false}
            />
            <Switch
              size="xs"
              label="Block personal data (PII guard)"
              description="Rejects writes that look like CPF, phone or card numbers — personal info belongs in the personal brain."
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
                  setBrainStatus('Saving…');
                  try {
                    await window.electronAPI.secondBrainSetConfig({
                      enabled: true,
                      url: brainUrl.trim() || undefined,
                      token: brainToken.trim() || undefined,
                    });
                    const res = await window.electronAPI.secondBrainTest();
                    setBrainStatus(res.ok ? 'Connected successfully.' : `Failed: ${res.error || 'unknown error'}`);
                    setSecondBrain(await window.electronAPI.secondBrainGetConfig());
                    setBrainToken('');
                  } catch (e) {
                    setBrainStatus(`Failed: ${e instanceof Error ? e.message : 'unknown error'}`);
                  }
                }}
              >
                Save &amp; test
              </Button>
              {secondBrain?.enabled && (
                <Button
                  size="xs"
                  variant="subtle"
                  color="gray"
                  onClick={async () => {
                    await window.electronAPI.secondBrainSetConfig({ enabled: false });
                    setSecondBrain(await window.electronAPI.secondBrainGetConfig());
                    setBrainStatus('Disabled.');
                  }}
                >
                  Disconnect
                </Button>
              )}
            </Group>
            {brainStatus && <Text size="xs" c="dimmed">{brainStatus}</Text>}
          </Stack>
        </Card>
      </Card>

      <Card withBorder padding="md" radius="md">
        <Title order={2} size="h4">WhatsApp</Title>
        <Text size="sm" c="dimmed">
          Connect WhatsApp by scanning a QR code with your phone (WhatsApp → Settings → Linked devices). Uses the unofficial Baileys client.
        </Text>
        <Card withBorder padding="md" radius="md">
          <Stack gap="sm">
            <Group justify="space-between">
              <Text fw={600}>Connection</Text>
              <Badge color={waStatus === 'connected' ? 'dark' : 'gray'} variant="light">
                {waStatus === 'connected' ? `Connected${waPhone ? ` · +${waPhone}` : ''}` : waStatus}
              </Badge>
            </Group>
            {waStatus === 'qr' && waQr && (
              <div style={{ display: 'flex', justifyContent: 'center', padding: '8px 0' }}>
                <Image src={waQr} w={240} h={240} radius="md" alt="WhatsApp QR code" />
              </div>
            )}
            {waStatus === 'connecting' && <Text size="xs" c="dimmed">Connecting…</Text>}
            {waError && <Text size="xs" c="dimmed">Error: {waError}</Text>}
            <Group gap="xs">
              {waStatus !== 'connected' && waStatus !== 'connecting' && (
                <Button size="xs" variant="default" onClick={() => { setWaQr(''); setWaError(''); void window.electronAPI.whatsappStart(); }}>
                  Connect
                </Button>
              )}
              {(waStatus === 'connected' || waStatus === 'connecting' || waStatus === 'qr') && (
                <Button size="xs" variant="subtle" color="gray" onClick={() => void window.electronAPI.whatsappStop()}>
                  Disconnect
                </Button>
              )}
            </Group>
            {waStatus === 'connected' && (
              <>
                <TextInput
                  size="xs"
                  label="Send message to (phone with country code)"
                  placeholder="5511999999999"
                  value={waSendTo}
                  onChange={(e) => setWaSendTo(e.currentTarget.value)}
                />
                <Group gap="xs" align="flex-end">
                  <TextInput
                    style={{ flex: 1 }}
                    size="xs"
                    label="Message"
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
                        setWaError(e instanceof Error ? e.message : 'send failed');
                      }
                    }}
                  >
                    Send
                  </Button>
                </Group>
              </>
            )}
            {waMessages.length > 0 && (
              <div>
                <Group justify="space-between" mb={4}>
                  <Text size="xs" fw={600}>Message history (stored locally)</Text>
                  <Button size="compact-xs" variant="subtle" color="gray" onClick={() => {
                    void window.electronAPI.whatsappClearMessages().then(() => setWaMessages([]));
                  }}>Clear</Button>
                </Group>
                <Text size="xs" c="dimmed" mb={4}>
                  Incoming WhatsApp messages are saved to the local database and indexed into the second brain when the auto-responder agent has second-brain tools.
                </Text>
                {waMessages.slice(0, 20).map((m, i) => (
                  <Text key={i} size="xs" c="dimmed">
                    {m.direction === 'out' ? 'You' : `+${m.from}`}: {m.text}
                  </Text>
                ))}
              </div>
            )}
          </Stack>
        </Card>
      </Card>

      <Card withBorder padding="md" radius="md">
        <Group justify="space-between" mb={4}>
          <Title order={2} size="h4">Agent Reach</Title>
          {arStatus && (
            <Badge color={arStatus.installed ? 'dark' : 'gray'} variant="light">
              {arStatus.installed ? 'Installed' : 'Not installed'}
            </Badge>
          )}
        </Group>
        <Text size="sm" c="dimmed" mb="sm">
          Multi-platform read/search for agents (X, Reddit, YouTube, GitHub, LinkedIn, web…) via the local agent-reach CLI and real session credentials — content is fetched as the user, not as a bot.
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
            Install: <Text span ff="monospace">pip install agent-reach</Text> then run <Text span ff="monospace">agent-reach doctor</Text>. The "Agent Reach — Internet Access" skill teaches agents the per-platform commands.
          </Text>
        )}
        <Button size="xs" variant="default" onClick={() => void window.electronAPI.agentReachStatus().then(setArStatus)}>
          Re-check status
        </Button>
      </Card>

      {authInfo && !authInfo.hasUsers && (
        <Card withBorder padding="md" radius="md">
          <Title order={3} size="h5" mb="md">Users &amp; Roles</Title>
          <Text size="sm" c="dimmed" mb="md">
            Enable multi-user mode: create the owner account, then invite members and admins. Once enabled, everyone must sign in.
          </Text>
          <Stack gap="xs" maw={420}>
            <TextInput size="xs" label="Your name" value={ownerForm.name} onChange={(e) => setOwnerForm({ ...ownerForm, name: e.currentTarget.value })} />
            <TextInput size="xs" label="Email" type="email" value={ownerForm.email} onChange={(e) => setOwnerForm({ ...ownerForm, email: e.currentTarget.value })} />
            <PasswordInput size="xs" label="Password (min 6 chars)" value={ownerForm.password} onChange={(e) => setOwnerForm({ ...ownerForm, password: e.currentTarget.value })} />
            <Group justify="flex-end">
              <Button size="xs" disabled={!ownerForm.name || !ownerForm.email || ownerForm.password.length < 6}
                onClick={async () => {
                  await window.electronAPI.authSetupOwner(ownerForm);
                  window.location.reload();
                }}>
                Create owner &amp; enable users
              </Button>
            </Group>
          </Stack>
        </Card>
      )}

      {authInfo?.hasUsers && authInfo.currentUser && authInfo.currentUser.role !== 'member' && (
        <Card withBorder padding="md" radius="md">
          <Title order={3} size="h5" mb="md">Users &amp; Roles</Title>
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
                    if (!confirm(`Remove ${u.email}?`)) return;
                    await window.electronAPI.authDeleteUser(u.id).catch((e) => alert(e.message));
                    setUsers(await window.electronAPI.authListUsers());
                  }}>Remove</Button>
              </Group>
            ))}
            <Card withBorder padding="sm" radius="sm" mt="xs" style={{ backgroundColor: 'var(--mantine-color-gray-0)' }}>
              <Text size="xs" fw={600} mb={6}>Invite user</Text>
              <Stack gap={6}>
                <Group gap={6} grow>
                  <TextInput size="xs" placeholder="Name" value={newUser.name} onChange={(e) => setNewUser({ ...newUser, name: e.currentTarget.value })} />
                  <TextInput size="xs" placeholder="Email" value={newUser.email} onChange={(e) => setNewUser({ ...newUser, email: e.currentTarget.value })} />
                </Group>
                <Group gap={6} grow>
                  <Select size="xs" data={['member', 'admin']} value={newUser.role} allowDeselect={false}
                    onChange={(v) => setNewUser({ ...newUser, role: (v || 'member') as UserRole })} />
                  <PasswordInput size="xs" placeholder="Password" value={newUser.password} onChange={(e) => setNewUser({ ...newUser, password: e.currentTarget.value })} />
                </Group>
                <Group justify="flex-end">
                  <Button size="xs" disabled={!newUser.name || !newUser.email || newUser.password.length < 6}
                    onClick={async () => {
                      await window.electronAPI.authCreateUser(newUser).catch((e) => alert(e.message));
                      setNewUser({ name: '', email: '', role: 'member', password: '' });
                      setUsers(await window.electronAPI.authListUsers());
                    }}>Add user</Button>
                </Group>
              </Stack>
            </Card>
          </Stack>
        </Card>
      )}

      {computer && authInfo?.currentUser && authInfo.currentUser.role !== 'member' && (
        <Card withBorder padding="md" radius="md">
          <Title order={3} size="h5" mb="md">Computer Access</Title>
          <Text size="sm" c="dimmed" mb="md">
            Maximum access agents get on this machine. Agents can only reduce it via their own computer access setting; members are always capped at workspace.
          </Text>
          <Stack gap="xs" maw={520}>
            <Select
              size="xs" label="Access level" allowDeselect={false}
              data={[
                { value: 'workspace', label: 'Workspace only — files inside the app workspace, no shell' },
                { value: 'authorized', label: 'Authorized — approved folders + shell allowlist' },
                { value: 'full', label: 'Full — whole disk + unrestricted shell' },
              ]}
              value={computer.level}
              onChange={(v) => setComputer({ ...computer, level: (v || 'workspace') as ComputerAccessLevel })}
            />
            <TextInput size="xs" label="Allowed roots (comma-separated paths)" description="Used by 'Authorized' level."
              value={computer.allowedRoots} onChange={(e) => setComputer({ ...computer, allowedRoots: e.currentTarget.value })} />
            <TextInput size="xs" label="Shell allowlist (command prefixes)" description="Used by 'Authorized' level; empty = no shell commands."
              value={computer.shellAllow} onChange={(e) => setComputer({ ...computer, shellAllow: e.currentTarget.value })} />
            <TextInput size="xs" label="Shell denylist (patterns)" description="Always blocked regardless of level."
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
              }}>Save</Button>
            </Group>
          </Stack>
        </Card>
      )}

      <Card withBorder padding="md" radius="md">
        <Title order={3} size="h5" mb="md">Brains &amp; GitHub Access</Title>
        <Text size="sm" c="dimmed" mb="md">
          The <b>corporate brain</b> (KeepMind Corp) holds shared company knowledge. Your <b>personal brain</b> is a local vault on this machine — personal data never goes to the corporate brain.
        </Text>
        <Stack gap="md">
          <Card withBorder padding="sm" radius="sm">
            <Text size="xs" fw={600} mb={6}>Corporate brain — request GitHub access</Text>
            <Text size="xs" c="dimmed" mb={8}>
              Requests access to <Text span ff="monospace">criptogus/keepmind-corp</Text>. An admin approves here; the actual GitHub invite is granted by the repo owner.
            </Text>
            <Group gap={6} align="flex-end">
              <Select size="xs" w={130} label="Scope" value={brainAccess} allowDeselect={false}
                onChange={(v) => setBrainAccess((v || 'read') as 'read' | 'write')}
                data={[{ value: 'read', label: 'Read' }, { value: 'write', label: 'Read & write' }]} />
              <TextInput size="xs" style={{ flex: 1 }} placeholder="Reason (optional)" value={brainReason}
                onChange={(e) => setBrainReason(e.currentTarget.value)} />
              <Button size="xs" variant="default"
                onClick={async () => {
                  await window.electronAPI.brainRequestCorporateAccess({ scope: brainAccess, reason: brainReason || undefined }).catch((e) => alert(e.message));
                  setBrainRequests(await window.electronAPI.brainListRequests());
                  setBrainReason('');
                }}>Request access</Button>
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
                          }}>Approve</Button>
                        <Button size="compact-xs" variant="subtle" color="gray"
                          onClick={async () => {
                            await window.electronAPI.brainDecideRequest(String(r.id), 'rejected').catch((e) => alert(e.message));
                            setBrainRequests(await window.electronAPI.brainListRequests());
                          }}>Reject</Button>
                      </Group>
                    )}
                  </Group>
                ))}
              </Stack>
            )}
          </Card>

          <Card withBorder padding="sm" radius="sm">
            <Text size="xs" fw={600} mb={6}>Personal brain — private GitHub repo</Text>
            <Text size="xs" c="dimmed" mb={8}>
              {personalBrain ? <>Local vault: <Text span ff="monospace">{personalBrain.dir}</Text> ({personalBrain.files.length} files)</> : 'Local vault on this machine.'}
            </Text>
            <Group gap={6}>
              <Button size="xs" variant="default" onClick={() => void window.electronAPI.personalBrainOpenFolder()}>Open folder</Button>
              <Button size="xs" variant="default"
                onClick={async () => {
                  setBrainMsg('Creating private repo via gh…');
                  const res = await window.electronAPI.brainCreatePersonalRepo().catch((e): { ok: boolean; repo?: string; url?: string; error?: string } => ({ ok: false, error: e instanceof Error ? e.message : String(e) }));
                  setBrainMsg(res.ok ? `Created ${res.repo} → ${res.url}` : `Failed: ${res.error || 'unknown'}`);
                  setPersonalBrain(await window.electronAPI.personalBrainStatus().catch(() => personalBrain));
                }}>Create private GitHub repo</Button>
            </Group>
            {brainMsg && <Text size="xs" c="dimmed" mt={6}>{brainMsg}</Text>}
          </Card>
        </Stack>
      </Card>

      <Card withBorder padding="md" radius="md">
        <Title order={3} size="h5" mb="md">Appearance</Title>
        <Select
          label="Theme"
          value={theme}
          onChange={(v) => setTheme((v || 'light') as typeof theme)}
          data={[
            { value: 'light', label: 'Light' },
            { value: 'dark', label: 'Dark' },
            { value: 'auto', label: 'Auto (System)' },
          ]}
          allowDeselect={false}
          style={{ maxWidth: 280 }}
        />
      </Card>

      <Card withBorder padding="md" radius="md">
        <Title order={3} size="h5" mb="md">Execution</Title>
        <Switch
          label="Auto-approve actions"
          checked={settings.autoApprove}
          onChange={(e) => updateSettings({ autoApprove: e.currentTarget.checked })}
        />
        <Text size="xs" c="dimmed" mt={4}>
          Warning: Disabling manual approval reduces security oversight
        </Text>
      </Card>

      <Card withBorder padding="md" radius="md">
        <Title order={3} size="h5" mb="md">Automation</Title>
        <Text size="sm" c="dimmed" mb="md">
          Scheduled triggers run agents autonomously. WhatsApp auto-responder answers incoming messages with a chosen agent.
        </Text>
        <Stack gap={4} mb="md">
          <Switch
            size="xs"
            label="Auto-route skills"
            description="Automatically activates relevant skills based on each task."
            checked={settings.skillsAutoRoute !== false}
            onChange={(e) => updateSettings({ skillsAutoRoute: e.currentTarget.checked })}
          />
          <Switch
            size="xs"
            label="Auto-route LLM model"
            description="Picks a cheaper or stronger model per task within the same provider."
            checked={settings.llmAutoRoute !== false}
            onChange={(e) => updateSettings({ llmAutoRoute: e.currentTarget.checked })}
          />
          <Switch
            size="xs"
            label="Require approval for sensitive tools"
            description="Shell commands, file writes, URL opens, WhatsApp messages and agent delegation wait for human approval."
            checked={settings.toolApprovalRequired !== false}
            onChange={(e) => updateSettings({ toolApprovalRequired: e.currentTarget.checked })}
          />
        </Stack>
        <Stack gap="sm">
          <Select
            size="xs"
            label="WhatsApp auto-responder agent"
            description="When connected, incoming WhatsApp messages are answered by this agent."
            placeholder="Disabled"
            clearable
            data={agents.map((a) => ({ value: a.id, label: a.name }))}
            value={waAgentId || null}
            onChange={(v) => {
              const id = v || '';
              setWaAgentId(id);
              void window.electronAPI.triggersSetWhatsAppAgent(id);
            }}
          />
          {triggers.map((t) => (
            <Group key={t.id} justify="space-between" wrap="nowrap">
              <div style={{ flex: 1, minWidth: 0 }}>
                <Text size="sm" fw={500}>{t.name}</Text>
                <Text size="xs" c="dimmed">
                  {t.kind === 'interval' ? `every ${t.intervalMinutes}min` : `daily at ${t.timeOfDay}`}
                  {t.lastRunAt ? ` · last run ${new Date(t.lastRunAt).toLocaleString()}` : ''}
                </Text>
              </div>
              <Switch
                size="xs"
                checked={t.enabled}
                onChange={(e) => {
                  void window.electronAPI.triggersUpdate(t.id, { enabled: e.currentTarget.checked }).then(() =>
                    window.electronAPI.triggersList().then(setTriggers)
                  );
                }}
              />
              <Button size="compact-xs" variant="subtle" color="gray" onClick={async () => {
                await window.electronAPI.triggersDelete(t.id);
                setTriggers(await window.electronAPI.triggersList());
              }}>Delete</Button>
            </Group>
          ))}
          <Card withBorder padding="sm" radius="sm" style={{ backgroundColor: 'var(--mantine-color-gray-0)' }}>
            <Stack gap="xs">
              <Text size="xs" fw={600}>New trigger</Text>
              <TextInput size="xs" placeholder="Name" value={newTrigger.name} onChange={(e) => setNewTrigger({ ...newTrigger, name: e.currentTarget.value })} />
              <Select
                size="xs"
                placeholder="Agent"
                data={agents.map((a) => ({ value: a.id, label: a.name }))}
                value={newTrigger.agentId || null}
                onChange={(v) => setNewTrigger({ ...newTrigger, agentId: v || '' })}
              />
              <Group gap="xs">
                <Select
                  size="xs"
                  value={newTrigger.kind}
                  onChange={(v) => setNewTrigger({ ...newTrigger, kind: (v || 'interval') as 'interval' | 'daily' })}
                  data={[{ value: 'interval', label: 'Every N minutes' }, { value: 'daily', label: 'Daily at time' }]}
                  allowDeselect={false}
                  style={{ width: 160 }}
                />
                {newTrigger.kind === 'interval' ? (
                  <NumberInput size="xs" min={1} max={10080} value={newTrigger.intervalMinutes} onChange={(v) => setNewTrigger({ ...newTrigger, intervalMinutes: Number(v) || 60 })} style={{ width: 110 }} />
                ) : (
                  <TextInput size="xs" type="time" value={newTrigger.timeOfDay} onChange={(e) => setNewTrigger({ ...newTrigger, timeOfDay: e.currentTarget.value })} style={{ width: 110 }} />
                )}
              </Group>
              <TextInput size="xs" placeholder="Task prompt (what the agent should do each run)" value={newTrigger.prompt} onChange={(e) => setNewTrigger({ ...newTrigger, prompt: e.currentTarget.value })} />
              <Group justify="flex-end">
                <Button
                  size="xs"
                  disabled={!newTrigger.name || !newTrigger.agentId || !newTrigger.prompt}
                  onClick={async () => {
                    await window.electronAPI.triggersCreate({
                      agentId: newTrigger.agentId,
                      name: newTrigger.name,
                      kind: newTrigger.kind,
                      intervalMinutes: newTrigger.kind === 'interval' ? newTrigger.intervalMinutes : undefined,
                      timeOfDay: newTrigger.kind === 'daily' ? newTrigger.timeOfDay : undefined,
                      prompt: newTrigger.prompt,
                      enabled: true,
                    });
                    setTriggers(await window.electronAPI.triggersList());
                    setNewTrigger({ name: '', agentId: '', kind: 'interval', intervalMinutes: 60, timeOfDay: '09:00', prompt: '' });
                  }}
                >
                  Add trigger
                </Button>
              </Group>
            </Stack>
          </Card>
        </Stack>
      </Card>

      <Card withBorder padding="md" radius="md">
        <Title order={3} size="h5" mb="md">Updates</Title>
        <Group gap="xs">
          <Button
            size="xs"
            variant="default"
            onClick={async () => {
              setUpdateState('Checking…');
              const res = await window.electronAPI.updateCheck();
              if (!res.ok) setUpdateState(`Update check failed: ${res.error || 'no update feed configured'}`);
            }}
          >
            Check for updates
          </Button>
          {updateVersion && (
            <Button size="xs" onClick={() => void window.electronAPI.updateInstall()}>
              Restart &amp; install
            </Button>
          )}
        </Group>
        {updateState && <Text size="xs" c="dimmed" mt={8}>{updateState}</Text>}
      </Card>

      <Card withBorder padding="md" radius="md">
        <Title order={3} size="h5" mb="md">Data Management</Title>
        <Group gap="xs">
          <Button
            size="xs"
            variant="default"
            onClick={async () => {
              const res = await window.electronAPI.dataExport();
              if (res.ok && res.path) alert(`Backup saved to:\n${res.path}`);
              else if (res.error) alert(`Export failed: ${res.error}`);
            }}
          >
            Export Data
          </Button>
          <Button
            size="xs"
            variant="default"
            onClick={async () => {
              if (!confirm('Import will REPLACE all current data with the backup file. Continue?')) return;
              const res = await window.electronAPI.dataImport();
              if (res.ok) alert('Data imported. Restart the app to see changes.');
              else if (res.error) alert(`Import failed: ${res.error}`);
            }}
          >
            Import Data
          </Button>
        </Group>
      </Card>
    </Stack>
  );
}
