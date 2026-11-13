import LanguagePicker from '../common/LanguagePicker';
import { useLang } from '../../lib/i18n';
import React, { useState } from 'react';
import { Alert, Stack, Text, Title } from '@mantine/core';
import BusinessGuide from '../work/BusinessGuide';

export default function OnboardingWizard({ onComplete }: { onComplete: (taskId?: string) => void }) {
  const { t, lang } = useLang();
  const [error, setError] = useState('');
  const finish = async (taskId?: string) => {
    await window.electronAPI.updateSettings({ onboardingCompleted: true });
    onComplete(taskId);
  };
  return <main className="km-welcome"><Stack gap="xl">
    <LanguagePicker /><div><Text size="sm" fw={700}>KEEPMIND OS</Text><Title order={1} mt="sm">{t('flow.your-business-with-a-team-by-your-side')}</Title><Text c="dimmed" mt="xs">{t('flow.start-with-the-challenge-we-will-help-you-plan')}</Text></div>
    {error && <Alert color="red">{error}</Alert>}
    <BusinessGuide onCreated={async result => finish(result.taskId)} onSkip={() => void finish().catch(e => setError(String(e)))} />
  </Stack></main>;
}
