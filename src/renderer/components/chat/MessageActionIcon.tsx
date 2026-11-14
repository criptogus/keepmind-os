import React from 'react';

/** Keep persisted emoji keys compatible while rendering the product's outline icons. */
export default function MessageActionIcon({ name }: { name: string }) {
  const paths: Record<string, React.ReactNode> = {
    '👍': <><path d="M7 10v11H3V10h4Zm0 0 4-7a2 2 0 0 1 2 2v4h5a3 3 0 0 1 3 3l-2 7a3 3 0 0 1-3 2H7" /></>,
    '✅': <><rect x="3" y="3" width="18" height="18" rx="4" /><path d="m7 12 3 3 7-7" /></>,
    '🎉': <><path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3ZM20 2v4m-2-2h4" /></>,
    '👀': <><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /></>,
    reply: <><path d="m9 5-6 6 6 6M3 11h11a7 7 0 0 1 7 7v2" /></>,
    thread: <><path d="M21 11a8 8 0 0 1-8 8H7l-4 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4v4Z" /><path d="M7 8h10M7 12h7" /></>,
  };
  if (!paths[name]) return <span aria-hidden="true">{name}</span>;
  return <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{paths[name]}</svg>;
}
