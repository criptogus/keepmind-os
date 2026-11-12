import React, { Suspense, lazy, useState, useEffect } from 'react';

const AgentList = lazy(() => import('./components/agents/AgentList'));
const TeamList = lazy(() => import('./components/teams/TeamList'));
const ApprovalQueue = lazy(() => import('./components/governance/ApprovalQueue'));
const GovernanceRules = lazy(() => import('./components/governance/GovernanceRules'));
const AuditLogs = lazy(() => import('./components/logs/AuditLogs'));
const SettingsPanel = lazy(() => import('./components/settings/SettingsPanel'));
const AdvancedSettings = lazy(() => import('./components/settings/AdvancedSettings'));
const SkillsPanel = lazy(() => import('./components/skills/SkillsPanel'));
const AnalyticsDashboard = lazy(() => import('./components/dashboard/AnalyticsDashboard'));
const OnboardingWizard = lazy(() => import('./components/onboarding/OnboardingWizard'));
const LoginScreen = lazy(() => import('./components/auth/LoginScreen'));

import type { LocalUser } from '../shared/types.js';
import { Badge, Button, Text } from '@mantine/core';
import { useThemeStore } from './store/themeStore';
import { useLang } from './lib/i18n';

const sectionLabel: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  textTransform: 'uppercase',
  color: 'var(--mantine-color-dimmed)',
  marginBottom: 12,
  letterSpacing: '0.04em',
};

export default function App() {
  const [activeSection, setActiveSection] = useState('dashboard');
  const [version, setVersion] = useState<string>('');
  const [pendingApprovals, setPendingApprovals] = useState(0);
  const { initTheme } = useThemeStore();
  const { t } = useLang();
  const [needsOnboarding, setNeedsOnboarding] = useState<boolean | null>(null);
  const [authState, setAuthState] = useState<{ hasUsers: boolean; currentUser: LocalUser | null } | null>(null);

  useEffect(() => {
    window.electronAPI.authGetState()
      .then(setAuthState)
      .catch(() => setAuthState({ hasUsers: false, currentUser: null }));
  }, []);

  useEffect(() => {
    window.electronAPI.getVersion().then(setVersion);
    initTheme();
    window.electronAPI.getSettings()
      .then((s) => setNeedsOnboarding(!s.onboardingCompleted))
      .catch(() => setNeedsOnboarding(false));

    const fetchApprovals = async () => {
      const state = await window.electronAPI.getGovernanceState();
      setPendingApprovals(state.pendingApprovals.length);
    };
    fetchApprovals();
    const interval = setInterval(fetchApprovals, 5000);
    const unsubDeepLink = window.electronAPI.onDeepLink?.(({ section }) => {
      if (['dashboard', 'agents', 'teams', 'skills', 'governance', 'logs', 'settings', 'advanced'].includes(section)) {
        setActiveSection(section);
      }
    });
    return () => { clearInterval(interval); unsubDeepLink?.(); };
  }, [initTheme]);

  const sidebarItems = [
    { id: 'dashboard', label: t('nav.dashboard') },
    { id: 'agents', label: t('nav.agents') },
    { id: 'teams', label: t('nav.teams') },
    { id: 'skills', label: t('nav.skills') },
    { id: 'governance', label: t('nav.governance') },
    { id: 'logs', label: t('nav.logs') },
    { id: 'settings', label: t('nav.settings') },
    { id: 'advanced', label: t('nav.advanced') },
  ];

  const governanceTabs = [
    { id: 'approvals', label: t('gov.pending') },
    { id: 'rules', label: t('gov.rules') },
  ];
  const [governanceTab, setGovernanceTab] = useState('approvals');

  const renderContent = () => {
    switch (activeSection) {
      case 'dashboard':
        return <AnalyticsDashboard onNavigate={setActiveSection} />;
      case 'agents':
        return <AgentList />;
      case 'teams':
        return <TeamList />;
      case 'skills':
        return <SkillsPanel />;
      case 'governance':
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'flex', gap: 8, borderBottom: '1px solid var(--mantine-color-gray-3)', paddingBottom: 12 }}>
              {governanceTabs.map(tab => (
                <button
                  key={tab.id}
                  onClick={() => setGovernanceTab(tab.id)}
                  style={{
                    padding: '8px 16px',
                    border: 'none',
                    backgroundColor: governanceTab === tab.id ? '#111111' : 'transparent',
                    color: governanceTab === tab.id ? '#ffffff' : 'var(--mantine-color-dimmed)',
                    cursor: 'pointer',
                    fontSize: 14,
                    fontWeight: 500,
                    borderRadius: 6,
                    fontFamily: 'inherit',
                  }}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            {governanceTab === 'approvals' ? <ApprovalQueue /> : <GovernanceRules />}
          </div>
        );
      case 'logs':
        return <AuditLogs />;
      case 'settings':
        return <SettingsPanel />;
      case 'advanced':
        return <AdvancedSettings />;
      default:
        return null;
    }
  };

  if (needsOnboarding === null || authState === null) {
    return null;
  }

  // Multi-user mode: once accounts exist, a login is required.
  if (authState.hasUsers && !authState.currentUser) {
    return (
      <Suspense fallback={null}>
        <LoginScreen onAuthed={(user) => setAuthState({ hasUsers: true, currentUser: user })} />
      </Suspense>
    );
  }

  if (needsOnboarding) {
    return (
      <Suspense fallback={null}>
        <OnboardingWizard onComplete={() => setNeedsOnboarding(false)} />
      </Suspense>
    );
  }

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100vh',
      backgroundColor: 'var(--mantine-color-body)',
      fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, sans-serif',
    }}>
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '6px 24px 6px 84px',
          borderBottom: '1px solid var(--mantine-color-gray-3)',
          backgroundColor: 'var(--mantine-color-body)',
          WebkitAppRegion: 'drag',
        } as React.CSSProperties}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 28, height: 28, borderRadius: 7, backgroundColor: '#111111',
            color: '#ffffff', fontSize: 15, fontWeight: 700,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>K</div>
          <h1 style={{ fontSize: 18, fontWeight: 600, color: 'var(--mantine-color-dark-8)', margin: 0 }}>KeepMind OS</h1>
        </div>
      </header>

      <main style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        <aside style={{
          width: 260,
          backgroundColor: 'var(--mantine-color-gray-0)',
          borderRight: '1px solid var(--mantine-color-gray-3)',
          padding: 16,
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
        }}>
          <div style={{ marginBottom: 24 }}>
            <h2 style={{ ...sectionLabel, margin: 0 }}>{t('nav.navigation')}</h2>
            <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 2 }}>
              {sidebarItems.map((item) => (
                <Button
                  key={item.id}
                  variant={activeSection === item.id ? 'light' : 'subtle'}
                  color="dark"
                  size="sm"
                  fullWidth
                  justify="flex-start"
                  onClick={() => setActiveSection(item.id)}
                  rightSection={item.id === 'governance' && pendingApprovals > 0
                    ? <Badge size="sm" variant="filled" color="dark">{pendingApprovals}</Badge>
                    : undefined}
                >
                  {item.label}
                </Button>
              ))}
            </div>
          </div>

          <div style={{ marginBottom: 24 }}>
            <div style={sectionLabel}>{t('nav.system')}</div>
            <Text size="sm" c="dimmed">{t('nav.version')}: {version || t('nav.loading')}</Text>
            {authState.currentUser && (
              <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
                <Badge size="sm" variant="light" color="dark">
                  {authState.currentUser.name} · {authState.currentUser.role}
                </Badge>
                <Button
                  size="compact-xs" variant="subtle" color="dark"
                  onClick={async () => {
                    await window.electronAPI.authLogout();
                    const s = await window.electronAPI.authGetState();
                    setAuthState(s);
                  }}
                >
                  {t('nav.signout')}
                </Button>
              </div>
            )}
          </div>

          <div style={{ marginTop: 'auto', paddingTop: 24, borderTop: '1px solid var(--mantine-color-gray-3)' }}>
            <Text size="xs" c="dimmed">
              {t('nav.poweredBy')}{' '}
              <a
                href="https://zeroagency.ai"
                target="_blank"
                rel="noreferrer"
                style={{ color: 'inherit', textDecoration: 'underline' }}
              >
                ZeroAgency.ai
              </a>
            </Text>
          </div>
        </aside>

        <div style={{ flex: 1, padding: 24, overflowY: 'auto' }}>
          <Suspense fallback={<Text size="sm" c="dimmed" ta="center" py="xl">{t('nav.loading')}</Text>}>
            {renderContent()}
          </Suspense>
        </div>
      </main>
    </div>
  );
}
