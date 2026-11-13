/** A closed macOS window is not an application shutdown. */
export function installLifecycle(app: {
  on(event: string, handler: (event: { preventDefault(): void }) => void): unknown;
  quit(): void;
}, platform: string, stop: () => Promise<unknown>) {
  let stopping = false;
  let stopped = false;
  app.on('window-all-closed', () => { if (platform !== 'darwin') app.quit(); });
  app.on('before-quit', event => {
    if (stopped) return;
    event.preventDefault();
    if (stopping) return;
    stopping = true;
    void Promise.resolve().then(stop).catch(() => undefined).finally(() => { stopped = true; app.quit(); });
  });
}
