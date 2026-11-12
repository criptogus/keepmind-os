import React, { useState } from 'react';
import { Button, Card, PasswordInput, Text, TextInput, Title } from '@mantine/core';
import type { LocalUser } from '../../../shared/types.js';
import { useLang } from '../../lib/i18n';

/**
 * Phase-1 local auth gate. Shown when user accounts exist but nobody is
 * logged in. The first-run owner setup lives in Advanced Settings instead,
 * so fresh installs keep working without an account.
 */
export default function LoginScreen({ onAuthed }: { onAuthed: (user: LocalUser) => void }) {
  const { t } = useLang();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      const user = await window.electronAPI.authLogin(email.trim(), password);
      onAuthed(user);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('login.failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{
      height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      backgroundColor: 'var(--mantine-color-body)',
    }}>
      <Card shadow="sm" padding="xl" radius="md" withBorder style={{ width: 380 }}>
        <Title order={3} mb={4}>KeepMind OS</Title>
        <Text size="sm" c="dimmed" mb="lg">{t('login.subtitle')}</Text>
        <form
          onSubmit={(e) => { e.preventDefault(); void submit(); }}
          style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
        >
          <TextInput
            label={t('login.email')} type="email" required autoFocus
            value={email} onChange={(e) => setEmail(e.currentTarget.value)}
          />
          <PasswordInput
            label={t('login.password')} required
            value={password} onChange={(e) => setPassword(e.currentTarget.value)}
          />
          {error && <Text size="sm" c="red">{error}</Text>}
          <Button type="submit" loading={busy} fullWidth>{t('login.submit')}</Button>
        </form>
      </Card>
    </div>
  );
}
