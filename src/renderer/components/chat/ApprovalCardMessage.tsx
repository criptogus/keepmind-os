import React, { useState } from 'react';
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
  const [done, setDone] = useState<string | null>(null);

  const decide = async (decision: 'approve' | 'reject') => {
    if (!approvalId || busy) return;
    setBusy(true);
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
      console.error('approval decision failed', e);
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
          {String(meta.agentName ?? '')} · {String(meta.action ?? '')} — {done === 'approved' ? t('chat.approve').toLowerCase() : t('chat.reject').toLowerCase()} ✓
        </Text>
      </div>
    );
  }

  return (
    <div className="km-enter" style={{
      border: '1px solid #111', borderRadius: 10, padding: '12px 14px',
      maxWidth: 520, backgroundColor: 'var(--mantine-color-body)',
    }}>
      <Text size="sm" fw={700} mb={4}>{t('chat.approvalNeeded')}</Text>
      <Text size="sm" mb={10} style={{ whiteSpace: 'pre-wrap' }}>{message.body}</Text>
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
