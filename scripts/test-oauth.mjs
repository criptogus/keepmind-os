// Tests the OAuth flow up to the provider's authorize URL.
// The flow now opens the system browser and serves the callback on localhost.
// Usage: env -u ELECTRON_RUN_AS_NODE npx electron scripts/test-oauth.mjs [provider]
import { app } from 'electron';
import { OAuthManager } from './.tmp-OAuthManager.mjs';

const provider = process.argv[2] || 'anthropic';

const fakeAgentManager = {
  setOAuthToken() {}, setOAuthBetaHeader() {},
  hasOAuthToken: () => false, getOAuthToken: () => null,
  getOAuthBetaHeader: () => null, clearOAuthToken() {},
};

app.whenReady().then(async () => {
  let openedUrl = null;
  const mgr = new OAuthManager(
    fakeAgentManager,
    undefined,
    async (url) => { openedUrl = url; }, // stub: don't open a real browser
  );
  const p = mgr.authenticate(provider);
  p.then(() => { console.log('RESULT: success'); app.quit(); })
   .catch((e) => { console.log('RESULT: error -', e.message); app.quit(); });

  setTimeout(() => {
    console.log('AUTH URL:', openedUrl || mgr.getAuthUrl(provider) || '(none)');
  }, 2000);
  setTimeout(() => { console.log('TIMEOUT - still pending'); app.quit(); }, 15000);
});
