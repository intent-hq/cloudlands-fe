import buildMacIcon from './build-macos-icon.js';
import { buildDesktopHelper } from './build-desktop-helper.mjs';

export default async function beforePack(context) {
  const arch = { 0: 'ia32', 1: 'x64', 3: 'arm64' }[context.arch];
  buildDesktopHelper(context.electronPlatformName, arch);
  await buildMacIcon(context);
}
