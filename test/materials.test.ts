import { it, expect } from 'vitest';
import JSZip from 'jszip';
import { exportPresentation } from '../src/main/materials/exportPresentation';
import { materialHtml, materialSlides } from '../src/shared/materials';
import { deliveryState, type WorkTask } from '../src/shared/work';
it('exports a real editable presentation with Portuguese content and multiple slides', async () => {
  const content = 'Proposta de colaboração: ação e revisão. '.repeat(50);
  const bytes = await exportPresentation('Plano de negócio', content);
  const zip = await JSZip.loadAsync(bytes);
  expect(zip.file('ppt/presentation.xml')).toBeTruthy();
  const slides = Object.keys(zip.files).filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n));
  expect(slides.length).toBe(materialSlides('Plano de negócio', content).length);
  expect(slides.length).toBeGreaterThan(1);
  expect(await zip.file(slides[0])!.async('text')).toContain('ação e revisão');
});
it('escapes active content in the PDF document and includes no remote resources', () => {
  const html = materialHtml('<img src=x onerror=alert(1)>', '<script>alert(1)</script>');
  expect(html).not.toContain('<script>'); expect(html).not.toContain('<img'); expect(html).toContain('&lt;script&gt;'); expect(html).toContain("default-src 'none'");
});
it('labels old deliveries as prior versions while a replacement is being prepared', () => {
  const task = { output: 'old', events: [{kind:'delivered'}, {kind:'revision'}, {kind:'started'}] } as WorkTask;
  expect(deliveryState(task)).toEqual({ version: 1, updating: true, nextVersion: 2 });
});
