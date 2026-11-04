import { describe, expect, it } from 'vitest';
import { capabilitiesForPlatform } from '$lib/utils/platform-capabilities';
import {
  CAPABILITY_FEATURES,
  WEB_UNAVAILABLE_FEATURE_LABELS,
  webUnavailableFeatures,
} from './web-unavailable-features';

describe('webUnavailableFeatures', () => {
  it('gives every capability the web build lacks a listed, labelled line', () => {
    const web = capabilitiesForPlatform('web');
    const listed = webUnavailableFeatures(false);
    for (const [capability, available] of Object.entries(web)) {
      if (available) continue;
      const feature = CAPABILITY_FEATURES[capability as keyof typeof web];
      expect(feature, `capability ${capability} has no line`).toBeDefined();
      expect(listed).toContain(feature);
      expect(WEB_UNAVAILABLE_FEATURE_LABELS[feature]().trim()).not.toBe('');
    }
  });

  it('keeps the list short and free of duplicates', () => {
    for (const managed of [false, true]) {
      const listed = webUnavailableFeatures(managed);
      expect(new Set(listed).size).toBe(listed.length);
      expect(listed.length).toBeGreaterThanOrEqual(5);
      expect(listed.length).toBeLessThanOrEqual(7);
    }
  });

  it('lists the Mobile tab and iCloud sync only when the host manages connections', () => {
    expect(webUnavailableFeatures(false)).not.toContain('mobileAndSync');
    expect(webUnavailableFeatures(true)).toContain('mobileAndSync');
    expect(WEB_UNAVAILABLE_FEATURE_LABELS.mobileAndSync().trim()).not.toBe('');
  });
});
