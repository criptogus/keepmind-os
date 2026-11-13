import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import Deliverable from '../src/renderer/components/work/Deliverable';

it('renders readable headings, lists, tables and source links', () => {
  const html = renderToStaticMarkup(<Deliverable content={'# Result\n\n- First\n- Second\n\n| Item | State |\n| --- | --- |\n| Draft | Done |\n\n[Source](https://example.com/docs)'} />);
  expect(html).toContain('<h1>Result</h1>');
  expect(html).toContain('<li>First</li>');
  expect(html).toContain('<table>');
  expect(html).toContain('href="https://example.com/docs"');
  expect(html).toContain('rel="noopener noreferrer"');
});

it('does not execute HTML, link executable/local URLs or load remote images', () => {
  const html = renderToStaticMarkup(<Deliverable content={'<script>alert(1)</script>\n\n[Run](javascript:alert%281%29) [File](file:///etc/passwd) [Protocol](keepmind://go) ![Tracking](https://example.com/pixel.png)\n\n<img src=x onerror=alert(1)>'} />);
  expect(html).not.toContain('<script');
  expect(html).not.toContain('<img');
  expect(html).not.toContain('href=');
  expect(html).not.toContain('onerror');
});
