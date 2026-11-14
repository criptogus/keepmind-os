import { approvalCopy } from '../../../shared/approvalCopy';
import React, { useEffect, useState } from 'react';
import { Button, Group, Text, TextInput } from '@mantine/core';
import type { ChannelMessage } from '../../../shared/types.js';
import { useLang } from '../../lib/i18n.js';

interface ApprovalCardMessageProps {
  message: ChannelMessage;
  onResolved: () => void;
}

/**
 * Renders a system message carrying meta.kind==='approval' as an actionable
 * card wired to the existing governance approve/reject IPC.
 */
export default function ApprovalCardMessage({ message, onResolved }: ApprovalCardMessageProps) {
  const { t } = useLang();
  const meta = (message.meta ?? {}) as Record<string, unknown>;
  const approvalId = String(meta.approvalId ?? '');
  const [busy, setBusy] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const copy = meta.approvalCopy as ReturnType<typeof approvalCopy> | undefined ?? approvalCopy(String(meta.action ?? ''));
  const [error, setError] = useState('');
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void window.electronAPI.getPendingApprovals().then(items => {
      if (live && !items.some(item => item.id === approvalId)) setDone('closed');
    }).catch(() => {});
    return () => { live = false; };
  }, [approvalId]);

  const decide = async (decision: 'approve' | 'reject') => {
    if (!approvalId || busy) return;
    setBusy(true); setError('');
    try {
      if (decision === 'approve') {
        await window.electronAPI.approveAction(approvalId);
        setDone('approved');
      } else {
        await window.electronAPI.rejectAction(approvalId, reason);
        setDone('rejected');
      }
      onResolved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível registrar sua decisão. Tente novamente.');
    } finally {
      setBusy(false);
      setRejecting(false);
    }
  };

  if (done) {
    return (
      <div className="km-enter" style={{
        border: '1px solid var(--mantine-color-default-border)', borderRadius: 10,
        padding: '10px 14px', maxWidth: 520, opacity: 0.75,
      }}>
        <Text size="sm" c="dimmed">
          {copy.title} — {done === 'closed' ? 'Solicitação encerrada' : done === 'approved' ? 'Autorizado' : 'Recusado'}
        </Text>
      </div>
    );
  }

  return (
    <div className="km-enter" style={{
      border: '1px solid var(--mantine-color-default-border)', borderRadius: 10, padding: '12px 14px',
      maxWidth: 520, backgroundColor: 'var(--mantine-color-body)',
    }}>
      <Text size="sm" fw={700} mb={4}>{copy.title}</Text>
      <Text size="sm" mb={10} style={{ whiteSpace: 'pre-wrap' }}>{copy.description}</Text>
      {copy.detail && <Text size="sm" mb={10} style={{ whiteSpace: 'pre-wrap' }}>{copy.detail}</Text>}
      {error && <Text role="alert" c="red" size="sm" mb={10}>{error}</Text>}
      {!rejecting ? (
        <Group gap={8}>
          <Button size="xs" onClick={() => void decide('approve')} loading={busy}>{t('chat.approve')}</Button>
          <Button size="xs" variant="light" color="red" onClick={() => setRejecting(true)} disabled={busy}>{t('chat.reject')}</Button>
        </Group>
      ) : (
        <div>
          <TextInput
            size="xs"
            placeholder={t('chat.rejectReason')}
            value={reason}
            onChange={(e) => setReason(e.currentTarget.value)}
            mb={8}
          />
          <Group gap={8}>
            <Button size="xs" color="red" onClick={() => void decide('reject')} loading={busy}>{t('chat.confirmReject')}</Button>
            <Button size="xs" variant="subtle" onClick={() => setRejecting(false)}>{t('chat.cancel')}</Button>
          </Group>
        </div>
      )}
    </div>
  );
}
