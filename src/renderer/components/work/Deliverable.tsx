import React from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export function deliverableUrl(url: string): string {
  try { const parsed = new URL(url); return ['https:', 'http:'].includes(parsed.protocol) ? parsed.href : ''; }
  catch { return ''; }
}

export default function Deliverable({ content }: { content: string }) {
  return <article className="km-document"><Markdown remarkPlugins={[remarkGfm]} skipHtml urlTransform={deliverableUrl} components={{
    a: ({ href, children }) => href ? <a href={href} target="_blank" rel="noopener noreferrer">{children}</a> : <span>{children}</span>,
    img: ({ alt }) => <span>{alt}</span>,
  }}>{content}</Markdown></article>;
}

export function downloadText(name: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: 'text/plain;charset=utf-8' }));
  const link = document.createElement('a'); link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
