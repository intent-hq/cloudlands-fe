/** @vitest-environment jsdom */
import { describe, expect, it } from 'vitest';
import { prepareTabOutros, workspaceTabLifecycleMotion } from './workspace-tab-lifecycle-motion';

function rect(left: number, width: number): DOMRect {
  return { left, right: left + width, width } as DOMRect;
}

describe('workspace tab lifecycle motion', () => {
  it('restores slot styles and the full strip reserve when an outro is interrupted', () => {
    const controls = document.createElement('div');
    const strip = document.createElement('div');
    const previous = document.createElement('div');
    const slot = document.createElement('div');
    const launcher = document.createElement('div');
    slot.dataset.workspaceTabMotion = 'ws-2';
    launcher.dataset.previewLauncher = '';
    controls.append(strip, launcher);
    strip.append(previous, slot);
    strip.style.columnGap = '2px';
    strip.style.paddingRight = '12px';
    Object.defineProperties(strip, {
      scrollWidth: { value: 500 },
      clientWidth: { value: 300 },
      scrollLeft: { value: 200, writable: true },
    });
    previous.getBoundingClientRect = () => rect(0, 160);
    slot.getBoundingClientRect = () => rect(162, 160);
    launcher.getBoundingClientRect = () => rect(490, 20);
    prepareTabOutros(strip, ['ws-2']);
    const outro = workspaceTabLifecycleMotion(slot, {
      duration: 200,
      easing: (value) => value,
      phase: 'outro',
      onFrame: () => {},
    });
    outro.tick?.(0.5, 0.5);
    expect(slot.style.marginRight).not.toBe('');
    expect(slot.style.translate).not.toBe('');
    expect(strip.style.paddingRight).not.toBe('12px');

    slot.dispatchEvent(new Event('introstart'));
    outro.tick?.(0.75, 0.25);
    slot.dispatchEvent(new Event('introend'));

    expect(slot.style.marginRight).toBe('');
    expect(slot.style.translate).toBe('');
    expect(slot.style.overflow).toBe('');
    expect(strip.style.paddingRight).toBe('12px');
  });

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
