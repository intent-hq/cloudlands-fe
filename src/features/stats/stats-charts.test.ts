import { describe, expect, it } from 'vitest';
import type { UsageHourStats, UsageMonthStats } from '$lib/client/app-client';
import { gridLines, hourAmPm, hourCardModel, monthCardModel } from './stats-charts';

function hourCell(
  hour: number,
  input = 0,
  output = 0,
  cacheRead = 0,
  cacheCreation = 0,
): UsageHourStats {
  return {
    hour,
    inputTokens: input,
    outputTokens: output,
    cacheReadTokens: cacheRead,
    cacheCreationTokens: cacheCreation,
  };
}

function monthCell(month: number, input = 0, output = 0): UsageMonthStats {
  return {
    month,
    inputTokens: input,
    outputTokens: output,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
  };
}

describe('gridLines', () => {
  it('picks the largest 1/2/2.5/5×10^k step whose double fits under max', () => {
    // max 866: 2.5 base is excluded below 25M, so step 200 → lines at 200 and 400.
    expect(gridLines(866)).toEqual([
      { label: '200', bottomPct: 23.1 },
      { label: '400', bottomPct: 46.2 },
    ]);
    // max 2.41B: step 1B → lines at 1B and 2B.
    expect(gridLines(2_410_000_000)).toEqual([
      { label: '1.00B', bottomPct: 41.5 },
      { label: '2.00B', bottomPct: 83.0 },
    ]);
    // max 600M: step 250M → the 2.5 base formats exactly at this magnitude.
    expect(gridLines(600_000_000)).toEqual([
      { label: '250M', bottomPct: 41.7 },
      { label: '500M', bottomPct: 83.3 },
    ]);
  });

  it('drops lines that would land above the chart and never yields NaN', () => {
    expect(gridLines(1)).toEqual([{ label: '1', bottomPct: 100 }]);
    expect(gridLines(0)).toEqual([]);
    expect(gridLines(Number.NaN)).toEqual([]);
  });
});

describe('hourAmPm', () => {
  it('maps hours to am/pm labels', () => {
    expect(hourAmPm(0)).toBe('12am');
    expect(hourAmPm(9)).toBe('9am');
    expect(hourAmPm(12)).toBe('12pm');
    expect(hourAmPm(14)).toBe('2pm');
    expect(hourAmPm(23)).toBe('11pm');
  });
});

describe('hourCardModel (hour-of-day)', () => {
  const byHour = Array.from({ length: 24 }, (_, h) => {
    if (h === 14) return hourCell(14, 600, 200, 150, 50); // peak: 1000
    if (h === 10) return hourCell(10, 300, 100, 80, 20); // working hours: 500
    if (h === 2) return hourCell(2, 150, 50, 40, 10); // overnight: 250
    return hourCell(h);
  });

  it('derives peak hero, bar geometry, and working/overnight percentages', () => {
    const m = hourCardModel(byHour, 'hour-of-day');
    expect(m.peakLabel).toBe('14:00');
    expect(m.peakSub).toBe('1K tokens in the 2pm hour');
    expect(m.bars[14]).toEqual({ heightPct: 100, outPct: 20, peak: true });
    expect(m.bars[10]).toEqual({ heightPct: 50, outPct: 20, peak: false });
    expect(m.bars[0]).toEqual({ heightPct: 0, outPct: 0, peak: false });
    // total 1750; hours 09–18 hold 1500 (86%), hours 00–06 hold 250 (14%).
    expect(m.workingHours).toBe('09–18 · 86%');
    expect(m.overnight).toBe('14%');
    expect(m.axis).toEqual(['00', '06', '12', '18', '23']);
  });

  it('renders an empty-but-valid chart for a zero-data period', () => {
    const m = hourCardModel([], 'hour-of-day');
    expect(m.peakLabel).toBe('—');
    expect(m.peakSub).toBe('no activity in this period');
    expect(m.grid).toEqual([]);
    expect(m.bars).toHaveLength(24);
    for (const b of m.bars) expect(b).toEqual({ heightPct: 0, outPct: 0, peak: false });
    expect(m.workingHours).toBe('09–18 · 0%');
    expect(m.overnight).toBe('0%');
  });
});

describe('hourCardModel (trailing-24h)', () => {
  // Chronological buckets starting at local hour 15 yesterday → 14 today.
  const byHour = Array.from({ length: 24 }, (_, i) => {
    const hour = (15 + i) % 24;
    return hourCell(hour, i === 23 ? 900 : 10, i === 23 ? 100 : 0);
  });

  it('keeps buckets chronological and labels peak/axis with local hours', () => {
    const m = hourCardModel(byHour, 'trailing-24h');
    // Peak is the newest bucket (index 23), local hour 14.
    expect(m.bars[23].peak).toBe(true);
    expect(m.peakLabel).toBe('14:00');
    expect(m.peakSub).toBe('1K tokens in the 2pm hour');
    expect(m.axis).toEqual(['15', '21', '03', '09', '14']);
  });

  it('computes working-hours/overnight stats by local hour of each bucket', () => {
    const m = hourCardModel(byHour, 'trailing-24h');
    // Total 1230. Local hours 9–17: buckets for 15,16,17 (30) + 9..14 (with
    // the 1000-token 14h bucket) → 1080 → 88%. Hours 0–5: 60 → 5%.
    expect(m.workingHours).toBe('09–18 · 88%');
    expect(m.overnight).toBe('5%');
  });
});

describe('monthCardModel', () => {
  const byMonth = [
    monthCell(1, 80, 20), // 100
    monthCell(2, 150, 50), // 200
    monthCell(3, 320, 80), // 400 ← best
    monthCell(4, 240, 60), // 300
    ...Array.from({ length: 8 }, (_, i) => monthCell(i + 5)),
  ];

  it('derives YTD hero, avg, best month, and delta vs prior month', () => {
    const m = monthCardModel(byMonth, 4);
    expect(m.heroLabel).toBe('YEAR TO DATE');
    expect(m.heroValue).toBe('1K');
    expect(m.avgSub).toBe('avg 250 / month');
    expect(m.bestLabel).toBe('Mar · 400');
    expect(m.deltaLabel).toBe('VS FEB');
    expect(m.deltaValue).toBe('+100%');
  });

  it('marks elapsed months as bars and future months as stubs', () => {
    const m = monthCardModel(byMonth, 4);
    expect(m.bars[2]).toEqual({
      heightPct: 100,
      outPct: 20,
      letter: 'M',
      active: true,
      best: true,
    });
    expect(m.bars[3]).toEqual({
      heightPct: 75,
      outPct: 20,
      letter: 'A',
      active: true,
      best: false,
    });
    expect(m.bars[11]).toEqual({
      heightPct: 2,
      outPct: 0,
      letter: 'D',
      active: false,
      best: false,
    });
    expect(m.bars.map((b) => b.letter).join('')).toBe('JFMAMJJASOND');
  });
});
