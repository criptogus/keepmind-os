import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { listPackage } from '@electron/asar';
import { assertConfig, checkStagedPaths, walkFiles } from './bundle-license-policy.mjs';
export default async function afterPack(context) {
  assertConfig(context.packager.config);
  const resources = context.electronPlatformName === 'darwin'
    ? join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, 'Contents', 'Resources')
    : join(context.appOutDir, 'resources');
  const unpacked = join(resources, 'app.asar.unpacked');
  const paths = [...listPackage(join(resources, 'app.asar')), ...(existsSync(unpacked) ? walkFiles(unpacked) : [])];
  const checked = checkStagedPaths(paths);
  console.log(`Bundle policy: checked ${checked} dependency entries; no restricted SDKs.`);
}
