import { useLang } from '../../lib/i18n';
import { materialFilename } from '../../../shared/materials';
import React, { useState } from 'react';
import { Alert, Button, Group, SegmentedControl, Stack, Text, Title } from '@mantine/core';
import Deliverable from './Deliverable';
import { materialSlides } from '../../../shared/materials';
export default function MaterialPreview({ title, content, onClose }: { title: string; content: string; onClose: () => void }) {
  const { lang } = useLang();
  const tr = (en: string, pt: string) => lang === 'pt' ? pt : en;
  const [notice, setNotice] = useState('');
  const [format, setFormat] = useState('pdf'); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const download = async () => {
    setBusy(true); setError('');
    try {
      const data = await window.electronAPI.exportMaterial(format as 'pdf' | 'pptx', title.slice(0,200), content);
      const blob = new Blob([new Uint8Array(data)], { type: format === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.presentationml.presentation' });
      const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = materialFilename(title, format as 'pdf' | 'pptx'); a.click(); setNotice(tr('Download requested.', 'Download solicitado.')); setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (e) { setError(String(e)); } finally { setBusy(false); }
  };
  return <aside className="km-material-panel" aria-label={tr('Material preview', 'Prévia do material')}><Stack><Group justify="space-between"><Title order={2} size="h4">{title}</Title><Button variant="subtle" onClick={onClose}>{tr('Close material', 'Fechar material')}</Button></Group>
    <Group justify="space-between"><SegmentedControl value={format} onChange={setFormat} data={[{ value: 'pdf', label: tr('PDF document', 'Documento PDF') }, { value: 'pptx', label: tr('PowerPoint', 'PowerPoint') }]} /><Button loading={busy} onClick={() => void download()}>{tr('Download', 'Baixar')} {format.toUpperCase()}</Button></Group>
    <Text size="xs" c="dimmed">{tr('Content preview. PDF pagination is finalized on export; PowerPoint remains editable.', 'Prévia do conteúdo. A paginação do PDF é ajustada na exportação; o PowerPoint continua editável.')}</Text>
    {notice && <Text role="status" size="sm">{notice}</Text>}{error && <Alert color="red">{error}</Alert>}
    {format === 'pdf' ? <article className="km-paper-preview"><h1>{title}</h1><Deliverable content={content} /></article> : materialSlides(title, content).map((slide, i) => <article className="km-slide-preview" key={i}><h2>{slide.title}</h2><p>{slide.body}</p><small>KeepMind OS · {i + 1}</small></article>)}
  </Stack></aside>;
}
