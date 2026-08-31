import { describe, it, expect } from 'vitest';
import {
  withToastCountdown,
  TOAST_COUNTDOWN_CLASS,
  TOAST_COUNTDOWN_NO_HOVER_PAUSE_CLASS,
} from './toast-countdown';

describe('withToastCountdown', () => {
  it('applies the opt-in class and derives the duration variable from the toast duration', () => {
    const shaped = withToastCountdown({ duration: 15000 });

    expect(shaped.duration).toBe(15000);
    expect(shaped.class).toBe(TOAST_COUNTDOWN_CLASS);
    expect(shaped.style).toBe('--toast-countdown-duration: 15000ms');
  });

  it('preserves unrelated options', () => {
    const onClick = () => {};
    const shaped = withToastCountdown({
      duration: 5000,
      action: { label: 'Undo', onClick },
    });

    expect(shaped.action).toEqual({ label: 'Undo', onClick });
  });

  it('appends to an existing class and style', () => {
    const shaped = withToastCountdown({
      duration: 5000,
      class: 'existing-class',
      style: 'color: red',
    });

    expect(shaped.class).toBe(`existing-class ${TOAST_COUNTDOWN_CLASS}`);
    expect(shaped.style).toBe('color: red; --toast-countdown-duration: 5000ms');
  });

  it('returns options unchanged when no duration is set', () => {
    const options = { class: 'existing-class' };

    expect(withToastCountdown(options)).toBe(options);
  });

  it('returns options unchanged for an infinite duration', () => {
    const options = { duration: Number.POSITIVE_INFINITY };

    expect(withToastCountdown(options)).toBe(options);
  });

  it('returns options unchanged for a non-positive duration', () => {
    const options = { duration: 0 };

    expect(withToastCountdown(options)).toBe(options);
  });

  it('does not mutate the input options', () => {
    const options = { duration: 5000, class: 'existing-class' };

    withToastCountdown(options);

    expect(options).toEqual({ duration: 5000, class: 'existing-class' });
  });

  it('adds the no-hover-pause class when pauseOnHover is false', () => {
    const shaped = withToastCountdown({ duration: 15000 }, { pauseOnHover: false });

    expect(shaped.class).toBe(`${TOAST_COUNTDOWN_CLASS} ${TOAST_COUNTDOWN_NO_HOVER_PAUSE_CLASS}`);
    expect(shaped.style).toBe('--toast-countdown-duration: 15000ms');
  });

  it('appends both countdown classes after an existing class when pauseOnHover is false', () => {
    const shaped = withToastCountdown(
      { duration: 5000, class: 'existing-class' },
      { pauseOnHover: false },
    );

    expect(shaped.class).toBe(
      `existing-class ${TOAST_COUNTDOWN_CLASS} ${TOAST_COUNTDOWN_NO_HOVER_PAUSE_CLASS}`,
    );
  });

  it('omits the no-hover-pause class when pauseOnHover is true or defaulted', () => {
    expect(withToastCountdown({ duration: 5000 }, { pauseOnHover: true }).class).toBe(
      TOAST_COUNTDOWN_CLASS,
    );
    expect(withToastCountdown({ duration: 5000 }, {}).class).toBe(TOAST_COUNTDOWN_CLASS);
  });

  it('returns options unchanged without a duration even when pauseOnHover is false', () => {
    const options = { class: 'existing-class' };

    expect(withToastCountdown(options, { pauseOnHover: false })).toBe(options);
  });
});
