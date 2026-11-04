/**
 * What the experimental notice lists as unavailable when Intent runs in a
 * browser. The list derives from `capabilitiesForPlatform('web')`, the single
 * source of truth for desktop-only capabilities; related capabilities share
 * one friendly line so the list stays short.
 */
import {
  capabilitiesForPlatform,
  type PlatformCapabilities,
} from '$lib/utils/platform-capabilities';
import { m } from '$shared/paraglide/messages.js';

export type WebUnavailableFeature =
  | 'browserPanel'
  | 'openInEditor'
  | 'filePickers'
  | 'notifications'
  | 'updates'
  | 'desktopIntegration'
  | 'mobileAndSync';

/**
 * Every capability maps to the line that covers it. A capability added to
 * `PlatformCapabilities` must be given a line here (the type and a test
 * enforce it).
 */
export const CAPABILITY_FEATURES: Record<keyof PlatformCapabilities, WebUnavailableFeature> = {
  browserPanel: 'browserPanel',
  shellIntegration: 'openInEditor',
  externalEditors: 'openInEditor',
  nativeDialogs: 'filePickers',
  ssh: 'filePickers',
  nativeNotifications: 'notifications',
  autoUpdate: 'updates',
  deeplinks: 'desktopIntegration',
  windowChrome: 'desktopIntegration',
};

/**
 * The unavailable lines, in display order. A host that manages connections
 * itself (intent-web) also has no Mobile tab and no iCloud sync of saved
 * machines; the desktop's Browser access keeps both on the desktop.
 */
export function webUnavailableFeatures(hostManagesConnections: boolean): WebUnavailableFeature[] {
  const web = capabilitiesForPlatform('web');
  const features: WebUnavailableFeature[] = [];
  for (const [capability, feature] of Object.entries(CAPABILITY_FEATURES) as [
    keyof PlatformCapabilities,
    WebUnavailableFeature,
  ][]) {
    if (!web[capability] && !features.includes(feature)) features.push(feature);
  }
  if (hostManagesConnections) features.push('mobileAndSync');
  return features;
}

export const WEB_UNAVAILABLE_FEATURE_LABELS: Record<WebUnavailableFeature, () => string> = {
  browserPanel: () => m.intentWeb_experimentalNotice_browserPanel_label(),
  openInEditor: () => m.intentWeb_experimentalNotice_openInEditor_label(),
  filePickers: () => m.intentWeb_experimentalNotice_filePickers_label(),
  notifications: () => m.intentWeb_experimentalNotice_notifications_label(),
  updates: () => m.intentWeb_experimentalNotice_updates_label(),
  desktopIntegration: () => m.intentWeb_experimentalNotice_desktopIntegration_label(),
  mobileAndSync: () => m.intentWeb_experimentalNotice_mobileAndSync_label(),
};
