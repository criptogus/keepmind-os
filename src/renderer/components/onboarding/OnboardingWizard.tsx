import React, { useState } from 'react';
import { Alert, Stack, Text, Title } from '@mantine/core';
import BusinessGuide from '../work/BusinessGuide';

export default function OnboardingWizard({ onComplete }: { onComplete: (taskId?: string) => void }) {
  const [error, setError] = useState('');
  const finish = async (taskId?: string) => {
    await window.electronAPI.updateSettings({ onboardingCompleted: true });
    onComplete(taskId);
  };
  return <main className="km-welcome"><Stack gap="xl">
    <div><Text size="sm" fw={700}>KEEPMIND OS</Text><Title order={1} mt="sm">Seu negócio, com um time ao seu lado.</Title><Text c="dimmed" mt="xs">Comece pelo desafio. Nós ajudamos você a organizar o caminho.</Text></div>
    {error && <Alert color="red">{error}</Alert>}
    <BusinessGuide onCreated={async result => finish(result.taskId)} onSkip={() => void finish().catch(e => setError(String(e)))} />
  </Stack></main>;
}
