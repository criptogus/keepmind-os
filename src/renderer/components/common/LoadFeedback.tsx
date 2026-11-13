import React from 'react';
import { Button, Group, Stack, Text } from '@mantine/core';
import { useLang } from '../../lib/i18n';

export default function LoadFeedback({ loading, error, retry, label }: { label?:string; loading?: boolean; error?: string | null; retry?: () => void }) {
  const { lang, t } = useLang();
  if (error) return <Stack gap="xs" className="km-enter" role="alert">
    <Text size="sm">{lang === 'pt' ? 'Não foi possível concluir. Verifique o estado atual antes de tentar novamente.' : 'Could not complete this action. Check the current state before trying again.'}</Text>
    <Group>{retry && <Button size="xs" variant="default" onClick={retry}>{t('common.refresh')}</Button>}</Group>
    <details className="km-error-details"><summary>{lang === 'pt' ? 'Detalhes técnicos' : 'Technical details'}</summary><pre>{error}</pre></details>
  </Stack>;
  if (!loading) return null;
  return <Group gap="sm" role="status" aria-live="polite"><span className="km-typing" aria-hidden="true"><i/><i/><i/></span><Text size="sm" c="dimmed">{label || t('logs.loading')}</Text></Group>;
}
