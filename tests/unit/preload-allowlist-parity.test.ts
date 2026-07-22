/**
 * Preload Allowlist Parity Tests
 *
 * Regression tests to prevent silent IPC channel breakage.
 *
 * Root cause this prevents:
 *   If a channel is not whitelisted in the preload `isChannelAllowed()` gate,
 *   renderer `listenSync(...)` handlers register but never fire. This caused:
 *   - subscriptions not updating in ChatPanel (missed `agent:subscriptions-restored`)
 *   - UI lingering (missed delivery-failed/timeout retractions)
 *   - wake UI inconsistencies (missed `agent:woken-by-subscription`)
 *
 * Pre-fix, `src/preload/index.ts` was missing these channels while
 * `src/preload/index.template.ts` had them, causing silent failures
 * only in production builds (which use index.ts, not the template).
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// Channels that AgentSubscriptions.svelte relies on for correct behavior.
// If any of these are missing from either preload allowlist, the renderer
// will silently fail to receive events.
const REQUIRED_SUBSCRIPTION_CHANNELS = [
  'agent:woken-by-subscription',
  'agent:subscriptions-restored',
  'agent:subscriptions-changed',
  'agent:event-delivery-failed',
  'agent:event-delivery-timeout',
  'watcher:file-changed',
] as const;

/**
 * Extract all string literals from a named array constant in a TypeScript file.
 * Handles both single-quoted and double-quoted strings.
 */
function extractArrayEntries(fileContent: string, arrayName: string): string[] {
  // Find the array declaration and extract its content
  const regex = new RegExp(
    `(?:const|let|var)\\s+${arrayName}\\s*(?::\\s*[^=]+)?\\s*=\\s*\\[([\\s\\S]*?)\\];`,
    'm',
  );
  const match = fileContent.match(regex);
  if (!match) {
    throw new Error(`Could not find array "${arrayName}" in file content`);
  }

  const arrayContent = match[1];
  // Extract all string literals (single or double quoted)
  const stringLiterals: string[] = [];
  const stringRegex = /['"]([^'"]+)['"]/g;
  let stringMatch;
  while ((stringMatch = stringRegex.exec(arrayContent)) !== null) {
    stringLiterals.push(stringMatch[1]);
  }
  return stringLiterals;
}

function getAgentChannels(channels: string[]): string[] {
  return channels.filter((ch) => ch.startsWith('agent:')).sort();
}

describe('Preload IPC Allowlist Parity', () => {
  const preloadIndexPath = path.resolve(__dirname, '../../src/preload/index.ts');
  const preloadTemplatePath = path.resolve(__dirname, '../../src/preload/index.template.ts');

  // Read files once
  const indexContent = fs.readFileSync(preloadIndexPath, 'utf-8');
  const templateContent = fs.readFileSync(preloadTemplatePath, 'utf-8');

  const indexAllowed = extractArrayEntries(indexContent, 'ALLOWED_CHANNELS');
  const templateAllowed = extractArrayEntries(templateContent, 'ALLOWED_CHANNELS');
  const indexEvents = extractArrayEntries(indexContent, 'EVENT_CHANNELS');
  const templateEvents = extractArrayEntries(templateContent, 'EVENT_CHANNELS');
  const indexDynamic = extractArrayEntries(indexContent, 'DYNAMIC_CHANNEL_PATTERNS');
  const templateDynamic = extractArrayEntries(templateContent, 'DYNAMIC_CHANNEL_PATTERNS');

  describe('Required subscription channels present in ALLOWED_CHANNELS', () => {
    for (const channel of REQUIRED_SUBSCRIPTION_CHANNELS) {
      it(`index.ts ALLOWED_CHANNELS includes "${channel}"`, () => {
        expect(indexAllowed).toContain(channel);
      });

      it(`index.template.ts ALLOWED_CHANNELS includes "${channel}"`, () => {
        expect(templateAllowed).toContain(channel);
      });
    }
  });

  describe('Required subscription channels present in EVENT_CHANNELS', () => {
    for (const channel of REQUIRED_SUBSCRIPTION_CHANNELS) {
      it(`index.ts EVENT_CHANNELS includes "${channel}"`, () => {
        expect(indexEvents).toContain(channel);
      });

      it(`index.template.ts EVENT_CHANNELS includes "${channel}"`, () => {
        expect(templateEvents).toContain(channel);
      });
    }
  });

  describe('Subscription-critical channel parity between index.ts and index.template.ts', () => {
    it('ALLOWED_CHANNELS should include all required subscription channels in both files', () => {
      for (const channel of REQUIRED_SUBSCRIPTION_CHANNELS) {
        // These channels MUST be in both files — the pre-fix bug was index.ts missing them
        expect(indexAllowed, `index.ts ALLOWED_CHANNELS missing ${channel}`).toContain(channel);
        expect(templateAllowed, `index.template.ts ALLOWED_CHANNELS missing ${channel}`).toContain(channel);
      }
    });

    it('EVENT_CHANNELS should include all required subscription channels in both files', () => {
      for (const channel of REQUIRED_SUBSCRIPTION_CHANNELS) {
        expect(indexEvents, `index.ts EVENT_CHANNELS missing ${channel}`).toContain(channel);
        expect(templateEvents, `index.template.ts EVENT_CHANNELS missing ${channel}`).toContain(channel);
      }
    });

    it('if a subscription channel is in one file, it must be in the other (no silent drift)', () => {
      // Specifically check that the subscription-related channels don't drift
      // between the two files. This is the exact class of bug that caused the original issue.
      const subscriptionChannelPattern = /^agent:(subscriptions?|event-delivery|woken-by)/;

      const indexSubChannels = getAgentChannels(indexAllowed).filter((ch) =>
        subscriptionChannelPattern.test(ch),
      );
      const templateSubChannels = getAgentChannels(templateAllowed).filter((ch) =>
        subscriptionChannelPattern.test(ch),
      );

      const missingFromIndex = templateSubChannels.filter(
        (ch) => !indexSubChannels.includes(ch),
      );
      const missingFromTemplate = indexSubChannels.filter(
        (ch) => !templateSubChannels.includes(ch),
      );

      expect(missingFromIndex).toEqual([]);
      expect(missingFromTemplate).toEqual([]);
    });
  });

  describe('isChannelAllowed() gate simulation (runtime behavior)', () => {
    // Simulate the actual isChannelAllowed() logic from the generated preload.
    // This catches the exact bug class: channels present in arrays but not
    // checked by the gate function.
    function simulateIsChannelAllowed(
      channel: string,
      allowedChannels = indexAllowed,
      dynamicPatterns = indexDynamic,
      eventChannels = indexEvents,
    ): boolean {
      return (
        allowedChannels.includes(channel) ||
        dynamicPatterns.some((pattern) => channel.startsWith(pattern)) ||
        eventChannels.includes(channel)
      );
    }

    for (const channel of REQUIRED_SUBSCRIPTION_CHANNELS) {
      it(`isChannelAllowed("${channel}") returns true in generated preload`, () => {
        expect(
          simulateIsChannelAllowed(channel),
          `isChannelAllowed() would block "${channel}" at runtime — ` +
          `channel must be in ALLOWED_CHANNELS, EVENT_CHANNELS, or match a DYNAMIC_CHANNEL_PATTERN`,
        ).toBe(true);
      });
    }

    it('isChannelAllowed() function body includes EVENT_CHANNELS check', () => {
      // Verify the generated isChannelAllowed function actually references EVENT_CHANNELS.
      // This prevents regression where the function is regenerated without the EVENT_CHANNELS check.
      const fnMatch = indexContent.match(
        /function isChannelAllowed\(channel:\s*string\):\s*boolean\s*\{([\s\S]*?)\}/,
      );
      expect(fnMatch, 'isChannelAllowed function not found in generated preload').toBeTruthy();
      expect(
        fnMatch![1],
        'isChannelAllowed() must reference EVENT_CHANNELS for defense-in-depth',
      ).toContain('EVENT_CHANNELS');
    });

    it('preserves current agent stream dynamic channels and blocks legacy hyphen channels', () => {
      for (const [allowedChannels, dynamicPatterns, eventChannels] of [
        [indexAllowed, indexDynamic, indexEvents],
        [templateAllowed, templateDynamic, templateEvents],
      ] as const) {
        const isAllowed = (channel: string) =>
          simulateIsChannelAllowed(channel, allowedChannels, dynamicPatterns, eventChannels);

        expect(isAllowed('agent:stream:123')).toBe(true);
        expect(isAllowed('agent:stream:ping:123')).toBe(true);
        expect(isAllowed('agent:stream:pong')).toBe(true);
        expect(isAllowed('auggie:stream:123')).toBe(true);
        expect(isAllowed('agent-stream-123')).toBe(false);
        expect(isAllowed('agent-stream-complete-123')).toBe(false);

        // Retired with the daemon IPC migration — producer-less surface.
        expect(isAllowed('agent:stream-starting')).toBe(false);
        expect(isAllowed('agent:backend:create')).toBe(false);
        expect(isAllowed('agent:backend:stop')).toBe(false);
        expect(isAllowed('agent:backend:get-status')).toBe(false);
        expect(isAllowed('agent:backend:cancel-stream')).toBe(false);
        expect(isAllowed('agent:backend:list')).toBe(false);

        // Still-live backend channels stay allowed.
        expect(isAllowed('agent:backend:stream-message')).toBe(true);
      }
    });
  });

  describe('dynamic channel pattern allowlists', () => {
    const registryPath = path.resolve(__dirname, '../../src/shared/ipc-registry.ts');
    const registryContent = fs.readFileSync(registryPath, 'utf-8');
    const registryDynamic = extractArrayEntries(registryContent, 'DYNAMIC_CHANNEL_PATTERNS');

    it('includes supported stream prefixes in generated preload and source files', () => {
      for (const dynamicPatterns of [indexDynamic, templateDynamic, registryDynamic]) {
        expect(dynamicPatterns).toContain('agent:stream:');
        expect(dynamicPatterns).toContain('auggie:stream:');
      }
    });

    it('does not include the legacy agent-stream- prefix in preload allowlists', () => {
      expect(indexDynamic).not.toContain('agent-stream-');
      expect(templateDynamic).not.toContain('agent-stream-');
      expect(registryDynamic).not.toContain('agent-stream-');
    });
  });

  describe('ipc-registry.ts EVENT_CHANNELS source of truth', () => {
    // Verify the source registry (which feeds the generator) has the channels.
    // This ensures regeneration won't drop them.
    const registryPath = path.resolve(__dirname, '../../src/shared/ipc-registry.ts');
    const registryContent = fs.readFileSync(registryPath, 'utf-8');
    const registryEvents = extractArrayEntries(registryContent, 'EVENT_CHANNELS');

    for (const channel of REQUIRED_SUBSCRIPTION_CHANNELS) {
      it(`ipc-registry.ts EVENT_CHANNELS includes "${channel}"`, () => {
        expect(
          registryEvents,
          `Source registry EVENT_CHANNELS missing "${channel}" — regeneration will drop it from preload`,
        ).toContain(channel);
      });
    }
  });

  // Notification channels that must be present for click-to-navigate behavior.
  // If notification:navigate is missing from preload allowlists, clicking an OS
  // notification will not navigate to the correct workspace.
  const REQUIRED_NOTIFICATION_CHANNELS = ['notification:navigate'] as const;

  describe('Required notification channels present in EVENT_CHANNELS', () => {
    for (const channel of REQUIRED_NOTIFICATION_CHANNELS) {
      it(`index.ts EVENT_CHANNELS includes "${channel}"`, () => {
        expect(indexEvents).toContain(channel);
      });

      it(`index.template.ts EVENT_CHANNELS includes "${channel}"`, () => {
        expect(templateEvents).toContain(channel);
      });
    }
  });

  describe('Required notification channels in ipc-registry.ts', () => {
    const registryPath = path.resolve(__dirname, '../../src/shared/ipc-registry.ts');
    const registryContent = fs.readFileSync(registryPath, 'utf-8');
    const registryEvents = extractArrayEntries(registryContent, 'EVENT_CHANNELS');

    for (const channel of REQUIRED_NOTIFICATION_CHANNELS) {
      it(`ipc-registry.ts EVENT_CHANNELS includes "${channel}"`, () => {
        expect(
          registryEvents,
          `Source registry EVENT_CHANNELS missing "${channel}" — notification click navigation will break`,
        ).toContain(channel);
      });
    }
  });
});

