// Dumps renderer diagnostics: DOM metrics, computed styles, theme attrs.
// Usage: env -u ELECTRON_RUN_AS_NODE npx electron scripts/inspect-window.mjs
import { app, BrowserWindow } from 'electron';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '../dist/main/preload.cjs'),
      contextIsolation: true,
      sandbox: true,
    },
  });
  await win.loadFile(path.join(__dirname, '../dist/renderer/index.html'));
  await new Promise((r) => setTimeout(r, 4000));

  const info = await win.webContents.executeJavaScript(`(() => {
    const root = document.getElementById('root');
    const all = [...document.querySelectorAll('*')];
    const body = getComputedStyle(document.body);
    const de = document.documentElement;
    const sample = (el) => el ? {
      tag: el.tagName, cls: (el.className||'').toString().slice(0,80),
      rect: el.getBoundingClientRect().toJSON(),
      bg: getComputedStyle(el).backgroundColor,
      color: getComputedStyle(el).color,
      font: getComputedStyle(el).fontFamily.slice(0,60),
      fs: getComputedStyle(el).fontSize,
    } : null;
    return {
      htmlAttrs: { theme: de.getAttribute('data-theme'), astryx: de.getAttribute('data-astryx-theme') },
      bodyBg: body.backgroundColor, bodyColor: body.color, bodyFont: body.fontFamily.slice(0,80),
      rootChildren: root ? root.children.length : -1,
      rootHTML: root ? root.innerHTML.slice(0, 1500) : 'NO ROOT',
      totalElements: all.length,
      zeroSize: all.filter(e => { const r = e.getBoundingClientRect(); return r.width === 0 && r.height === 0 && e.children.length === 0; }).length,
      first20: all.slice(0, 20).map(sample),
      scrollW: document.documentElement.scrollWidth, clientW: document.documentElement.clientWidth,
      scrollH: document.documentElement.scrollHeight, clientH: document.documentElement.clientHeight,
    };
  })()`);
  console.log(JSON.stringify(info, null, 1));
  app.quit();
});
