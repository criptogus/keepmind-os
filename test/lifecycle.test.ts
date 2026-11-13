import { EventEmitter } from 'node:events';
import { expect, it, vi } from 'vitest';
import { installLifecycle } from '../src/main/lifecycle';
it('keeps services alive on macOS window closure and stops once on actual quit', async () => {
  const app = Object.assign(new EventEmitter(), { quit: vi.fn() });
  let finish!: () => void;
  const stop = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
  installLifecycle(app, 'darwin', stop);
  app.emit('window-all-closed'); app.emit('activate');
  expect(stop).not.toHaveBeenCalled(); expect(app.quit).not.toHaveBeenCalled();
  const event = { preventDefault: vi.fn() };
  app.emit('before-quit', event); app.emit('before-quit', event);
  await Promise.resolve(); expect(stop).toHaveBeenCalledTimes(1); expect(event.preventDefault).toHaveBeenCalledTimes(2);
  finish(); await new Promise(resolve => setTimeout(resolve, 0));
  expect(app.quit).toHaveBeenCalledTimes(1);
  app.emit('before-quit', event); expect(event.preventDefault).toHaveBeenCalledTimes(2);
});
it('quits when the final window closes on other platforms', () => {
  const app = Object.assign(new EventEmitter(), { quit: vi.fn() });
  installLifecycle(app, 'win32', async () => {}); app.emit('window-all-closed');
  expect(app.quit).toHaveBeenCalledOnce();
});
