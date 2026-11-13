import CommandMenu from './components/navigation/CommandMenu';
import React, { Suspense, lazy, useState, useEffect } from 'react';

const WorkBench = lazy(() => import('./components/work/WorkBench'));
const AgentList = lazy(() => import('./components/agents/AgentList'));
const TeamList = lazy(() => import('./components/teams/TeamList'));
const ApprovalQueue = lazy(() => import('./components/governance/ApprovalQueue'));
const GovernanceRules = lazy(() => import('./components/governance/GovernanceRules'));
const AuditLogs = lazy(() => import('./components/logs/AuditLogs'));
const SettingsPanel = lazy(() => import('./components/settings/SettingsPanel'));
const AdvancedSettings = lazy(() => import('./components/settings/AdvancedSettings'));
const SkillsPanel = lazy(() => import('./components/skills/SkillsPanel'));
const AutomationPanel = lazy(() => import('./components/automation/AutomationPanel'));
const AnalyticsDashboard = lazy(() => import('./components/dashboard/AnalyticsDashboard'));
const OnboardingWizard = lazy(() => import('./components/onboarding/OnboardingWizard'));
const LoginScreen = lazy(() => import('./components/auth/LoginScreen'));

import type { LocalUser } from '../shared/types.js';
import { Badge, Button, Group, Text, ActionIcon } from '@mantine/core';
import { useThemeStore } from './store/themeStore';
import { useLang } from './lib/i18n';
import { useAppMode } from './lib/useAppMode';
import TourOverlay, { type TourStep } from './components/tour/TourOverlay';

const TOUR_DONE_KEY = 'km-tour-done';

const sectionLabel: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  textTransform: 'uppercase',
  color: 'var(--mantine-color-dimmed)',
  marginBottom: 12,
  letterSpacing: '0.04em',
};

export default function App() {
  const [activeSection, setActiveSection] = useState('work');
  const [version, setVersion] = useState<string>('');
  const [pendingApprovals, setPendingApprovals] = useState(0);
  const { initTheme } = useThemeStore();
  const { t, lang } = useLang();
  const [commandsOpen, setCommandsOpen] = useState(false);
  const [selectedWorkId, setSelectedWorkId] = useState<string | null>(null);
  const [mobileNav, setMobileNav] = useState(false);
  useEffect(() => {
    const key = (event: KeyboardEvent) => { if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); setCommandsOpen(open => !open); } };
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  }, []);
  const [needsOnboarding, setNeedsOnboarding] = useState<boolean | null>(null);
  const [authState, setAuthState] = useState<{ hasUsers: boolean; currentUser: LocalUser | null } | null>(null);
  const [tourActive, setTourActive] = useState(false);

  const tourSteps = (tt: (k: string) => string): TourStep[] => [
    { title: tt('tour.welcome.title'), text: tt('tour.welcome.text') },
    { target: '[data-tour="sidebar"]', title: tt('tour.nav.title'), text: tt('tour.nav.text') },
    { target: '[data-tour="content"]', section: 'dashboard', title: tt('tour.home.title'), text: tt('tour.home.text') },
    { target: '[data-tour="agents-new"]', section: 'agents', title: tt('tour.agents.title'), text: tt('tour.agents.text') },
    { target: '[data-tour="content"]', section: 'governance', title: tt('tour.approvals.title'), text: tt('tour.approvals.text') },
    { target: '[data-tour="content"]', section: 'advanced', title: tt('tour.settings.title'), text: tt('tour.settings.text') },
  ];

  const finishTour = () => {
    localStorage.setItem(TOUR_DONE_KEY, '1');
    setTourActive(false);
  };

  useEffect(() => {
    window.electronAPI.authGetState()
      .then(setAuthState)
      .catch(() => setAuthState({ hasUsers: false, currentUser: null }));
  }, []);

  useEffect(() => {
    window.electronAPI.getVersion().then(setVersion);
    initTheme();
    window.electronAPI.getSettings()
      .then((s) => {
        setNeedsOnboarding(!s.onboardingCompleted);
        // Auto-start the guided tour once, after onboarding is done.
        if (s.onboardingCompleted && localStorage.getItem(TOUR_DONE_KEY) !== '1') {
          setTimeout(() => setTourActive(true), 800);
        }
      })
      .catch(() => setNeedsOnboarding(false));

    const fetchApprovals = async () => {
      const state = await window.electronAPI.getGovernanceState();
      setPendingApprovals(state.pendingApprovals.length);
    };
    void fetchApprovals().catch(() => {});
    const interval = setInterval(() => void fetchApprovals().catch(() => {}), 5000);
    const unsubDeepLink = window.electronAPI.onDeepLink?.(({ section }) => {
      if (['work', 'dashboard', 'agents', 'teams', 'automations', 'skills', 'governance', 'logs', 'settings', 'advanced'].includes(section)) {
        setActiveSection(section);
      }
    });
    return () => { clearInterval(interval); unsubDeepLink?.(); };
  }, [initTheme]);

  const { mode: appMode } = useAppMode();
  // 'unset' keeps every section visible (status quo) until the user picks a mode.
  const allSidebarItems = [
    { id: 'work', label: t('nav.work') },
    { id: 'dashboard', label: t('nav.dashboard') },
    { id: 'agents', label: t('nav.agents') },
    { id: 'teams', label: t('nav.teams') },
    { id: 'automations', label: t('nav.automations') },
    { id: 'skills', label: t('nav.skills') },
    { id: 'governance', label: t('nav.governance') },
    { id: 'logs', label: t('nav.logs') },
    { id: 'settings', label: t('nav.settings') },
    { id: 'advanced', label: t('nav.advanced') },
  ];
  const CORPORATE_ONLY = new Set<string>([]);
  const sidebarItems = appMode === 'personal'
    ? allSidebarItems.filter((i) => !CORPORATE_ONLY.has(i.id))
    : allSidebarItems;

  const governanceTabs = [
    { id: 'approvals', label: t('gov.pending') },
    { id: 'rules', label: t('gov.rules') },
  ];
  const [governanceTab, setGovernanceTab] = useState('approvals');

  const renderContent = () => {
    if (appMode === 'personal' && CORPORATE_ONLY.has(activeSection)) {
      return <AnalyticsDashboard onNavigate={setActiveSection} />;
    }
    switch (activeSection) {
      case 'work': return <WorkBench onNavigate={setActiveSection} selectedTaskId={selectedWorkId} onTaskOpened={() => setSelectedWorkId(null)} />;
      case 'dashboard':
        return <AnalyticsDashboard onNavigate={setActiveSection} />;
      case 'agents':
        return <AgentList />;
      case 'teams':
        return <TeamList />;
      case 'automations':
        return <AutomationPanel />;
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
          <h1 style={{ fontSize: 18, fontWeight: 600, color: 'var(--mantine-color-text)', margin: 0 }}>KeepMind OS</h1>
        </div>
        <Group style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties} gap="xs">
          <Button className="km-nav-toggle" variant="default" size="xs" aria-expanded={mobileNav} onClick={() => setMobileNav(v => !v)}>{lang === 'pt' ? 'Menu' : 'Menu'}</Button>
          <Button variant="default" size="xs" onClick={() => setCommandsOpen(true)}>{lang === 'pt' ? 'Buscar' : 'Search'} <span className="km-keycap">⌘ / Ctrl K</span></Button>
        </Group>
      </header>

      <main style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        <aside className={`km-sidebar ${mobileNav ? "km-sidebar-open" : ""}`} data-tour="sidebar" style={{
          width: 220,
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
              {sidebarItems.filter(item => ['work','agents','automations','governance'].includes(item.id)).map((item) => (
                <Button
                  key={item.id}
                  data-tour={`nav-${item.id}`}
                  variant={activeSection === item.id ? 'light' : 'subtle'}
                  color="dark"
                  size="sm"
                  fullWidth
                  justify="flex-start"
                  aria-current={activeSection === item.id ? 'page' : undefined}
                  onClick={() => { setActiveSection(item.id); setMobileNav(false); }}
                  rightSection={item.id === 'governance' && pendingApprovals > 0
                    ? <Badge size="sm" variant="filled" color="dark">{pendingApprovals}</Badge>
                    : undefined}
                >
                  {item.label}
                </Button>
              ))}
              <details className="km-nav-more" open={!['work','agents','automations','governance'].includes(activeSection) || undefined}>
                <summary>{lang === 'pt' ? 'Mais ferramentas' : 'More tools'}</summary>
                {sidebarItems.filter(item => !['work','agents','automations','governance'].includes(item.id)).map(item => <Button key={item.id} fullWidth justify="flex-start" variant={activeSection === item.id ? 'light' : 'subtle'} aria-current={activeSection === item.id ? 'page' : undefined} onClick={() => { setActiveSection(item.id); setMobileNav(false); }}>{item.label}</Button>)}
              </details>
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
            <Group gap={6} mb={8}>
              <ActionIcon
                size="sm"
                variant="subtle"
                color="gray"
                radius="xl"
                aria-label={t('tour.replay')}
                onClick={() => setTourActive(true)}
              >
                ?
              </ActionIcon>
              <Text size="xs" c="dimmed">{t('tour.replay')}</Text>
            </Group>
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

        <div data-tour="content" style={{ minWidth: 0, flex: 1, padding: 24, overflowY: 'auto' }}>
          <Suspense fallback={<Text size="sm" c="dimmed" ta="center" py="xl">{t('nav.loading')}</Text>}>
            {renderContent()}
          </Suspense>
        </div>
      </main>

      <CommandMenu opened={commandsOpen} onClose={() => setCommandsOpen(false)} items={allSidebarItems} pt={lang === 'pt'} onNavigate={id => { setActiveSection(id); setMobileNav(false); }} onTask={id => { setSelectedWorkId(id); setActiveSection('work'); setMobileNav(false); }} />
      {tourActive && (
        <TourOverlay
          steps={tourSteps(t)}
          onDone={finishTour}
          onNavigate={setActiveSection}
        />
      )}
    </div>
  );
}

