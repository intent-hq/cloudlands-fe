/** @vitest-environment jsdom */
import { describe, expect, it } from 'vitest';
import { prepareTabOutros, workspaceTabLifecycleMotion } from './workspace-tab-lifecycle-motion';

function rect(left: number, width: number): DOMRect {
  return { left, right: left + width, width } as DOMRect;
}

describe('workspace tab lifecycle motion', () => {
  it('prepares one shared right-edge reservation for a bulk removal', () => {
    const controls = document.createElement('div');
    const strip = document.createElement('div');
    const launcher = document.createElement('div');
    launcher.dataset.previewLauncher = '';
    controls.append(strip, launcher);
    strip.style.columnGap = '2px';
    strip.style.paddingRight = '12px';
    Object.defineProperties(strip, {
      scrollWidth: { value: 500 },
      clientWidth: { value: 300 },
      scrollLeft: { value: 200, writable: true },
    });
    ['ws-1', 'ws-2', 'ws-3'].forEach((workspaceId, index) => {
      const slot = document.createElement('div');
      slot.dataset.workspaceTabMotion = workspaceId;
      slot.getBoundingClientRect = () => rect(index * 162, 160);
      strip.append(slot);
    });
    launcher.getBoundingClientRect = () => rect(490, 20);

    expect(prepareTabOutros(strip, ['ws-2', 'ws-3'])).toBe(true);

    expect(strip.style.paddingRight).toBe('332px');
    expect((strip.children[0] as HTMLElement).style.marginRight).toBe('');
    expect((strip.children[1] as HTMLElement).style.marginRight).toBe('-160px');
    expect((strip.children[2] as HTMLElement).style.marginRight).toBe('-160px');

    const leaderMotion = workspaceTabLifecycleMotion(strip.children[1] as HTMLElement, {
      duration: 200,
      easing: (value) => value,
      phase: 'outro',
      onFrame: () => {},
    });
    const followerMotion = workspaceTabLifecycleMotion(strip.children[2] as HTMLElement, {
      duration: 200,
      easing: (value) => value,
      phase: 'outro',
      onFrame: () => {},
    });
    leaderMotion.tick?.(0.5, 0.5);
    const launcherOffset = controls.style.getPropertyValue('--workspace-tab-launcher-offset');
    followerMotion.tick?.(0.5, 0.5);
    expect(controls.style.getPropertyValue('--workspace-tab-launcher-offset')).toBe(launcherOffset);
  });
});
