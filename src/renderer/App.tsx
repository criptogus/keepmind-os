import LanguagePicker from './components/common/LanguagePicker';
import CommandMenu from './components/navigation/CommandMenu';
import React, { Suspense, lazy, useState, useEffect } from 'react';

const WorkBench = lazy(() => import('./components/work/WorkBench'));
const AgentList = lazy(() => import('./components/agents/AgentList'));
const TeamList = lazy(() => import('./components/teams/TeamList'));
const GovernanceOverview = lazy(() => import('./components/governance/GovernanceOverview'));
const ApprovalQueue = lazy(() => import('./components/governance/ApprovalQueue'));
const GovernanceRules = lazy(() => import('./components/governance/GovernanceRules'));
const AuditLogs = lazy(() => import('./components/logs/AuditLogs'));
const SettingsPanel = lazy(() => import('./components/settings/SettingsPanel'));
const AdvancedSettings = lazy(() => import('./components/settings/AdvancedSettings'));
const SkillsPanel = lazy(() => import('./components/skills/SkillsPanel'));
const AutomationPanel = lazy(() => import('./components/automation/AutomationPanel'));
const OnboardingWizard = lazy(() => import('./components/onboarding/OnboardingWizard'));
const LoginScreen = lazy(() => import('./components/auth/LoginScreen'));

import type { LocalUser } from '../shared/types.js';
import { Badge, Button, Group, Text, ActionIcon } from '@mantine/core';
import { useThemeStore } from './store/themeStore';
import { useLang } from './lib/i18n';

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
  const [requestComposer, setRequestComposer] = useState(0);
  const [newAgentRequest, setNewAgentRequest] = useState(0);
  const navigate = (id: string) => {
    setMobileNav(false);
    if (id === 'new-agent') { setNewAgentRequest(n => n + 1); setActiveSection('agents'); }
    else if (id === 'new-request') { setSelectedWorkId(null); setRequestComposer(n => n + 1); setActiveSection('work'); }
    else setActiveSection(id === 'dashboard' ? 'work' : id);
  };
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
    { target: '[data-tour="content"]', section: 'work', title: tt('tour.home.title'), text: tt('tour.home.text') },
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
        setActiveSection(section === 'dashboard' ? 'work' : section);
      }
    });
    return () => { clearInterval(interval); unsubDeepLink?.(); };
  }, [initTheme]);

  const allSidebarItems = [
    { id: 'work', label: lang === 'pt' ? 'Conversas' : 'Conversations' },
    { id: 'agents', label: t('nav.agents') },
    { id: 'teams', label: lang === 'pt' ? 'Meu time' : 'My team' },
    { id: 'automations', label: t('nav.automations') },
    { id: 'skills', label: t('nav.skills') },
    { id: 'governance', label: t('nav.governance') },
    { id: 'logs', label: t('nav.logs') },
    { id: 'settings', label: t('nav.settings') },
    { id: 'advanced', label: t('nav.advanced') },
  ];
  const sidebarItems = allSidebarItems;

  const governanceTabs = [
    { id: 'overview', label: t('govsum.title') },
    { id: 'approvals', label: t('gov.pending') },
    { id: 'rules', label: t('gov.rules') },
  ];
  const [governanceTab, setGovernanceTab] = useState('approvals');

  const TeamTabs = () => <Group mb="lg" aria-label={lang === 'pt' ? 'Seu time' : 'Your team'}>{['teams','agents','skills'].map(id => <Button key={id} variant={activeSection === id ? 'filled' : 'subtle'} color={activeSection === id ? 'lime' : 'gray'} aria-current={activeSection === id ? 'page' : undefined} onClick={() => navigate(id)}>{id === 'teams' ? (lang === 'pt' ? 'Times' : 'Teams') : id === 'agents' ? (lang === 'pt' ? 'Integrantes' : 'Members') : (lang === 'pt' ? 'Habilidades' : 'Skills')}</Button>)}</Group>;
  const SettingsTabs = () => <Group mb="lg">{['settings','advanced'].map(id => <Button key={id} variant={activeSection === id ? 'filled' : 'subtle'} color={activeSection === id ? 'lime' : 'gray'} onClick={() => navigate(id)}>{id === 'settings' ? (lang === 'pt' ? 'Preferências' : 'Preferences') : (lang === 'pt' ? 'Conexões e permissões' : 'Connections and permissions')}</Button>)}</Group>;
  const renderContent = () => {
    switch (activeSection) {
      case 'work': return null;
      case 'agents':
        return <><TeamTabs /><AgentList newAgentRequest={newAgentRequest} onCreateOpened={() => setNewAgentRequest(0)} /></>;
      case 'teams':
        return <><TeamTabs /><TeamList /></>;
      case 'automations':
        return <AutomationPanel />;
      case 'skills':
        return <><TeamTabs /><SkillsPanel /></>;
      case 'governance':
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'flex', gap: 8, borderBottom: '1px solid var(--mantine-color-default-border)', paddingBottom: 12 }}>
              {governanceTabs.map(tab => (
                <button
                  key={tab.id}
                  onClick={() => setGovernanceTab(tab.id)}
                  style={{
                    padding: '8px 16px',
                    border: 'none',
                    backgroundColor: governanceTab === tab.id ? 'var(--mantine-color-text)' : 'transparent',
                    color: governanceTab === tab.id ? 'var(--mantine-color-body)' : 'var(--mantine-color-dimmed)',
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
            {governanceTab === 'overview' ? <GovernanceOverview /> : governanceTab === 'approvals' ? <ApprovalQueue /> : <GovernanceRules />}
          </div>
        );
      case 'logs':
        return <AuditLogs />;
      case 'settings':
        return <><SettingsTabs /><SettingsPanel /></>;
      case 'advanced':
        return <><SettingsTabs /><AdvancedSettings /></>;
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
        <OnboardingWizard onComplete={taskId => { setNeedsOnboarding(false); if (taskId) setSelectedWorkId(taskId); }} />
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
          borderBottom: '1px solid var(--mantine-color-default-border)',
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
          <LanguagePicker />
          <Button className="km-nav-toggle" variant="default" size="xs" aria-expanded={mobileNav} onClick={() => setMobileNav(v => !v)}>{lang === 'pt' ? 'Menu' : 'Menu'}</Button>
          <Button variant="default" size="xs" onClick={() => setCommandsOpen(true)}>{lang === 'pt' ? 'Buscar' : 'Search'} <span className="km-keycap">⌘ / Ctrl K</span></Button>
        </Group>
      </header>

      <main style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        <aside className={`km-sidebar ${mobileNav ? "km-sidebar-open" : ""}`} data-tour="sidebar" style={{
          width: 220,
          backgroundColor: 'var(--mantine-color-default-hover)',
          borderRight: '1px solid var(--mantine-color-default-border)',
          padding: 16,
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
        }}>
          <div style={{ marginBottom: 24 }}>
            
            <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 2 }}>
              {sidebarItems.filter(item => ['work','teams','governance','settings'].includes(item.id)).map((item) => (
                <Button
                  key={item.id}
                  data-tour={`nav-${item.id}`}
                  variant="subtle"
                  color="gray"
                  size="sm"
                  fullWidth
                  justify="flex-start"
                  aria-current={(activeSection === item.id || (item.id === 'teams' && ['agents','skills'].includes(activeSection)) || (item.id === 'settings' && activeSection === 'advanced')) ? 'page' : undefined}
                  onClick={() => { setActiveSection(item.id); setMobileNav(false); }}
                  rightSection={item.id === 'governance' && pendingApprovals > 0
                    ? <Badge size="sm" variant="filled" color="dark">{pendingApprovals}</Badge>
                    : undefined}
                >
                  {item.label}
                </Button>
              ))}
              <details className="km-nav-more">
                <summary>{lang === 'pt' ? 'Organizar' : 'Organize'}</summary>
                {sidebarItems.filter(item => ['automations','logs'].includes(item.id)).map(item => <Button key={item.id} fullWidth justify="flex-start" variant="subtle" aria-current={(activeSection === item.id || (item.id === 'teams' && ['agents','skills'].includes(activeSection)) || (item.id === 'settings' && activeSection === 'advanced')) ? 'page' : undefined} onClick={() => { setActiveSection(item.id); setMobileNav(false); }}>{item.label}</Button>)}
              </details>
            </div>
          </div>

          <div style={{ marginBottom: 24 }}>

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

          <div style={{ marginTop: 'auto', paddingTop: 24, borderTop: '1px solid var(--mantine-color-default-border)' }}>
            <Button variant="subtle" size="sm" color="gray" onClick={() => setTourActive(true)}>{lang === 'pt' ? 'Ajuda e primeiros passos' : 'Help and getting started'}</Button>
            <details className="km-about"><summary>{lang === 'pt' ? 'Sobre o KeepMind' : 'About KeepMind'}</summary><Text size="xs" c="dimmed">KeepMind {version} · MIT</Text><Text size="xs" c="dimmed">{t('nav.poweredBy')} <a href="https://zeroagency.ai" target="_blank" rel="noreferrer">ZeroAgency.ai</a></Text></details>
          </div>
        </aside>

        <div data-tour="content" className={activeSection === 'work' ? 'km-main-conversations' : undefined} style={{ minWidth: 0, flex: 1, padding: activeSection === 'work' ? 0 : 24, overflowY: 'auto' }}>
          <Suspense fallback={<Text size="sm" c="dimmed" ta="center" py="xl">{t('nav.loading')}</Text>}>
            <div hidden={activeSection !== 'work'} className="km-workspace-host"><WorkBench onComposerOpened={() => setRequestComposer(0)} requestComposer={requestComposer} onNavigate={navigate} selectedTaskId={selectedWorkId} onTaskOpened={() => setSelectedWorkId(null)} /></div>
            {renderContent()}
          </Suspense>
        </div>
      </main>

      <CommandMenu opened={commandsOpen} onClose={() => setCommandsOpen(false)} items={allSidebarItems} actions={[{ id: 'new-request', label: lang === 'pt' ? 'Novo pedido' : 'New request', run: () => navigate('new-request') }, { id: 'new-agent', label: lang === 'pt' ? 'Criar agente' : 'Create agent', run: () => navigate('new-agent') }]} pt={lang === 'pt'} onNavigate={navigate} onTask={id => { setSelectedWorkId(id); setActiveSection('work'); setMobileNav(false); }} />
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

