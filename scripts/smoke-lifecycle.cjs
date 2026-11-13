// macOS-specific production lifecycle regression. Uses a fresh profile, no live providers.
const { app, BrowserWindow } = require('electron');
const { mkdtempSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
if (process.platform !== 'darwin') throw new Error('This regression requires macOS');
process.env.KEEPMIND_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'keepmind-lifecycle-'));
process.env.KEEPMIND_DISABLE_CLI_AUTH = '1';
delete process.env.OPENAI_API_KEY; delete process.env.ANTHROPIC_API_KEY;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const reportPath = path.resolve(__dirname, '../evidence/lifecycle-report.json');
const timeout = setTimeout(() => { writeFileSync(reportPath, JSON.stringify({passed:false,error:'Timed out reopening workspace'})); app.exit(1); }, 30000);
require('../dist/main/main.cjs');
async function readyWindow() {
  for (let i=0; i<100; i++) {
    const win = BrowserWindow.getAllWindows()[0];
    if(win && !win.webContents.isLoading()) {
      try { if(await win.webContents.executeJavaScript('!!window.electronAPI')) return win; } catch {}
    }
    await wait(100);
  }
  throw new Error('Workspace did not become ready');
}
app.whenReady().then(async () => {
  const original = await readyWindow();
  const before = await original.webContents.executeJavaScript('window.electronAPI.workContext()');
  original.close(); await wait(150);
  if (BrowserWindow.getAllWindows().length) throw new Error('Window did not close');
  app.emit('activate');
  const reopened = await readyWindow();
  const after = await reopened.webContents.executeJavaScript('window.electronAPI.workContext()');
  if (!after.snapshot || after.snapshot.tasks.length !== before.snapshot.tasks.length) throw new Error('Workspace unavailable after reopening');
  clearTimeout(timeout);
  writeFileSync(reportPath, JSON.stringify({passed:true,checks:['native-window-close','activate-recreates-window','database-readable-after-reopen'],profile:'isolated'},null,2));
  console.log('LIFECYCLE PASS: closed and reopened production window; database readable');
  app.quit();
}).catch(error => { clearTimeout(timeout); writeFileSync(reportPath, JSON.stringify({passed:false,error:error.message})); console.error(error.message); app.exit(1); });
