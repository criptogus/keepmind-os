// Captures the renderer window to a PNG for visual inspection.
// Usage: env -u ELECTRON_RUN_AS_NODE npx electron scripts/capture-window.mjs [out.png]
import { app, BrowserWindow } from 'electron';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const out = process.argv[2] || '/tmp/km-capture.png';

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
  const indexHtml = path.join(__dirname, '../dist/renderer/index.html');
  await win.loadFile(indexHtml);
  await new Promise((r) => setTimeout(r, 4000));
  const img = await win.webContents.capturePage();
  fs.writeFileSync(out, img.toPNG());
  console.log('captured', out);
  app.quit();
});
