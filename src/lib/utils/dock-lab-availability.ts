import { isElectronPlatform } from './platform-capabilities';
import { isIntentOsRenderer } from './intent-os-renderer';

/** The dock is a desktop feature, and Intent OS has none (main refuses to turn it on). */
export function isDockLabAvailable(): boolean {
  return isElectronPlatform() && !isIntentOsRenderer();
}
