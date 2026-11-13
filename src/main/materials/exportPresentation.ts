import PptxGenJS from 'pptxgenjs';
import { materialSlides } from '../../shared/materials.js';
export async function exportPresentation(title: string, content: string): Promise<Uint8Array> {
  const deck = new PptxGenJS(); deck.layout = 'LAYOUT_WIDE'; deck.author = 'KeepMind OS'; deck.subject = 'Entrega para revisão'; deck.title = title;
  for (const [i, page] of materialSlides(title, content).entries()) {
    const slide = deck.addSlide(); slide.background = { color: 'F8FAFC' };
    slide.addShape(deck.ShapeType.rect, { x: 0, y: 0, w: 0.18, h: 7.5, fill: { color: '39796B' }, line: { color: '39796B' } });
    slide.addText(page.title, { x: 0.7, y: 0.5, w: 11.7, h: 1.2, fontFace: 'Aptos', fontSize: 28, bold: true, color: '182338', breakLine: false, fit: 'shrink' });
    slide.addText(page.body, { x: 0.7, y: 2, w: 11.7, h: 4.4, fontFace: 'Aptos', fontSize: 22, color: '334155', valign: 'top', fit: 'shrink', paraSpaceAfter: 12 });
    slide.addText(`KeepMind OS · ${i + 1}`, { x: 0.7, y: 6.9, w: 11.7, h: 0.3, fontSize: 10, color: '64748B' });
  }
  return new Uint8Array(await deck.write({ outputType: 'uint8array' }) as Uint8Array);
}
