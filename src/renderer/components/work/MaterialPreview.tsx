import React, { useState } from 'react';
import { Alert, Button, Group, Modal, SegmentedControl, Stack, Text } from '@mantine/core';
import Deliverable from './Deliverable';
import { materialSlides } from '../../../shared/materials';
export default function MaterialPreview({ title, content, onClose }: { title: string; content: string; onClose: () => void }) {
  const [format, setFormat] = useState('pdf'); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const download = async () => {
    setBusy(true); setError('');
    try {
      const data = await window.electronAPI.exportMaterial(format as 'pdf' | 'pptx', title.slice(0,200), content);
      const blob = new Blob([new Uint8Array(data)], { type: format === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.presentationml.presentation' });
      const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `entrega.${format}`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (e) { setError(String(e)); } finally { setBusy(false); }
  };
  return <Modal opened onClose={onClose} title="Visualizar material" size="xl"><Stack>
    <Group justify="space-between"><SegmentedControl value={format} onChange={setFormat} data={[{ value: 'pdf', label: 'Documento PDF' }, { value: 'pptx', label: 'Apresentação PowerPoint' }]} /><Button loading={busy} onClick={() => void download()}>Baixar {format.toUpperCase()}</Button></Group>
    <Text size="xs" c="dimmed">Prévia do conteúdo em um modelo simples. O PowerPoint pode ser editado; a paginação do PDF é ajustada na exportação.</Text>
    {error && <Alert color="red">{error}</Alert>}
    {format === 'pdf' ? <article className="km-paper-preview"><h1>{title}</h1><Deliverable content={content} /></article> : materialSlides(title, content).map((slide, i) => <article className="km-slide-preview" key={i}><h2>{slide.title}</h2><p>{slide.body}</p><small>KeepMind OS · {i + 1}</small></article>)}
  </Stack></Modal>;
}
