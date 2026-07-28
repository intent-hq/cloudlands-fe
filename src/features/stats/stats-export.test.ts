import { beforeEach, describe, expect, it, vi } from 'vitest';

const { toPngMock } = vi.hoisted(() => ({ toPngMock: vi.fn() }));

vi.mock('html-to-image', () => ({ toPng: toPngMock }));

import {
  EXPORT_OPTIONS,
  exportCardPng,
  exportFileName,
  exportPeriodKey,
} from './stats-export';

describe('exportPeriodKey', () => {
  it('uses 24h in 24H mode regardless of the stored key (Spec D11 addendum)', () => {
    expect(exportPeriodKey('24h', null)).toBe('24h');
    expect(exportPeriodKey('24h', '2026-07')).toBe('24h');
  });

  it('uses the period key in month/year modes', () => {
    expect(exportPeriodKey('month', '2026-07')).toBe('2026-07');
    expect(exportPeriodKey('year', '2026')).toBe('2026');
  });

  it('falls back to the mode when no key is selected yet', () => {
    expect(exportPeriodKey('month', null)).toBe('month');
  });
});

describe('exportFileName', () => {
  it('produces intent-<card>-<key>.png for every card', () => {
    expect(exportFileName('passport', '2026-07')).toBe('intent-passport-2026-07.png');
    expect(exportFileName('models', '2026')).toBe('intent-models-2026.png');
    expect(exportFileName('providers', '2026-07')).toBe('intent-providers-2026-07.png');
    expect(exportFileName('providers', '24h')).toBe('intent-providers-24h.png');
    expect(exportFileName('by-hour', '24h')).toBe('intent-by-hour-24h.png');
    expect(exportFileName('by-month', '2026-07')).toBe('intent-by-month-2026-07.png');
  });
});

describe('exportCardPng', () => {
  beforeEach(() => {
    toPngMock.mockReset();
  });

  it('renders at pixelRatio 3 over 360×640 (→ 1080×1920) and downloads', async () => {
    toPngMock.mockResolvedValue('data:image/png;base64,abc');
    const clicks: { download: string; href: string }[] = [];
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(function (this: HTMLAnchorElement) {
        clicks.push({ download: this.download, href: this.href });
      });

    const node = document.createElement('div');
    await exportCardPng(node, 'intent-passport-2026-07.png');

    expect(toPngMock).toHaveBeenCalledWith(node, { pixelRatio: 3, width: 360, height: 640 });
    expect(EXPORT_OPTIONS).toEqual({ pixelRatio: 3, width: 360, height: 640 });
    expect(clicks).toEqual([
      { download: 'intent-passport-2026-07.png', href: 'data:image/png;base64,abc' },
    ]);
    clickSpy.mockRestore();
  });

  it('rejects (does not download) when rendering fails', async () => {
    toPngMock.mockRejectedValue(new Error('render failed'));
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click');

    await expect(exportCardPng(document.createElement('div'), 'x.png')).rejects.toThrow(
      'render failed',
    );
    expect(clickSpy).not.toHaveBeenCalled();
    clickSpy.mockRestore();
  });
});
