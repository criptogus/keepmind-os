import { spawnSync } from 'node:child_process';
const platform = process.platform;
if (!['darwin','win32'].includes(platform)) throw new Error('Signed builds require macOS or Windows');
const required = platform === 'darwin'
  ? ['CSC_LINK','CSC_KEY_PASSWORD','CSC_NAME','APPLE_ID','APPLE_APP_SPECIFIC_PASSWORD','APPLE_TEAM_ID']
  : ['CSC_LINK','CSC_KEY_PASSWORD'];
const missing = required.filter(name => !process.env[name]);
if (missing.length) throw new Error(`Signing credentials missing: ${missing.join(', ')}. No unsigned fallback.`);
const args = ['node_modules/electron-builder/cli.js', '--publish', 'never', '--config.forceCodeSigning=true'];
if (platform === 'darwin') args.push('--mac','--arm64','--x64',`--config.mac.identity=${process.env.CSC_NAME}`,'--config.mac.hardenedRuntime=true','--config.mac.notarize=true','--config.mac.entitlements=build/entitlements.mac.plist','--config.mac.entitlementsInherit=build/entitlements.mac.plist');
else args.push('--win','--x64');
const result = spawnSync(process.execPath, args, {stdio:'inherit',env:{...process.env,CSC_IDENTITY_AUTO_DISCOVERY:'true'}});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
