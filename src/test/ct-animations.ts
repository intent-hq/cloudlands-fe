// `expect` comes from the shared CT module, which re-exports these helpers; the cycle is
// safe because `expect` is only read when a helper runs.
import { expect, type test } from './ct-test';

/**
 * Shared "is anything still animating?" checks for Playwright component tests.
 *
 * A one-time `expect(await el.evaluate((n) => n.getAnimations().length)).toBe(0)`
 * fails at random when a child component is mid-way through a short, normal fade
 * at the instant of the read: cloudlands-fe#3651 was ejected from the merge queue
 * (merge_group run 40096632126, intent-hq/intent#7749) because the
 * IntentMarkLoader's 160 ms crossfade was caught mid-flight. Use one of:
 *
 * - `expectAnimationsToSettle(locator)` when the test means "the motion has
 *   finished / cleaned up". It polls; finite animations end, infinite ones never
 *   do and fail with a report.
 * - `expectNoAnimations(locator, { ignore })` when the test means "this subtree
 *   must not animate at all". It checks once, but skips finished animations,
 *   instant (reduced-motion blanket) transitions, and the short finite fades of
 *   the components named in `ignore`.
 *
 * Both failures list every animation still counted (target, type, name, play
 * state, duration, iterations, current time). The `intent/no-one-shot-animation-count`
 * lint rule rejects the raw one-time count in `*.ct.spec.ts` files.
 */

// ct-svelte bundles its own Playwright, so derive Locator from its fixtures (see menu-geometry.ts).
type CtPage = Parameters<Parameters<typeof test.beforeEach>[1]>[0]['page'];
type Locator = ReturnType<CtPage['locator']>;

/** Finite animations no longer than this (ms, including delay) are instant, not motion. */
const INSTANT_ANIMATION_MS = 1;

/** Default ceiling for a "short" fade that `ignore` may skip. */
const DEFAULT_IGNORED_FADE_MS = 400;

interface IgnoredAnimations {
  /**
   * Selector for the component that owns the fades, e.g. `'[data-slot="intent-mark-loader"]'`.
   * Matches an animation whose target is that element or inside it.
   */
  within: string;
  /**
   * Longest finite animation to skip, in ms including delay (default 400). Infinite or
   * longer animations of the named component still count.
   */
  maxDurationMs?: number;
}

interface AnimationQueryOptions {
  /** Short finite fades to skip, each scoped to a named component. */
  ignore?: readonly IgnoredAnimations[];
  /** Include descendants' animations (default true). */
  subtree?: boolean;
  /**
   * Also count finished animations that are still attached (e.g. `fill: 'forwards'`
   * leftovers). Use with `expectAnimationsToSettle` when the test means "the motion was
   * cleaned up", not just "it stopped moving". Default false.
   */
  includeFinished?: boolean;
}

interface ActiveAnimation {
  /** Short selector-like description of the animated element (plus pseudo-element). */
  target: string;
  /** `CSSTransition`, `CSSAnimation` or `Animation` (Web Animations API). */
  type: string;
  /** Transition property, CSS animation name, or the animated keyframe properties. */
  name: string;
  playState: string;
  pending: boolean;
  /** Effect end time in ms (delay + active duration); `null` when infinite. */
  durationMs: number | null;
  iterations: number | null;
  currentTimeMs: number | null;
}

interface SerializedOptions {
  ignore: { within: string; maxDurationMs: number }[];
  subtree: boolean;
  includeFinished: boolean;
  instantMs: number;
}

/**
 * Animations under `locator` that are still running, paused or pending. Finished
 * animations (unless `includeFinished`), instant (≤ 1 ms) transitions and the `ignore`d
 * fades are left out.
 * Accepts locators that match several elements; shared descendants are reported once.
 */
export async function activeAnimations(
  locator: Locator,
  options: AnimationQueryOptions = {},
): Promise<ActiveAnimation[]> {
  const serialized: SerializedOptions = {
    ignore: (options.ignore ?? []).map(({ within, maxDurationMs }) => ({
      within,
      maxDurationMs: maxDurationMs ?? DEFAULT_IGNORED_FADE_MS,
    })),
    subtree: options.subtree ?? true,
    includeFinished: options.includeFinished ?? false,
    instantMs: INSTANT_ANIMATION_MS,
  };
  return locator.evaluateAll((elements, { ignore, subtree, includeFinished, instantMs }) => {
    const describeTarget = (target: Element | null, pseudo: string | null) => {
      if (!target) return '(no target)';
      let label = target.tagName.toLowerCase();
      if (target.id) label += `#${target.id}`;
      const attribute = ['data-slot', 'data-testid'].find((name) => target.hasAttribute(name));
      const dataAttribute =
        attribute ?? target.getAttributeNames().find((name) => name.startsWith('data-'));
      if (dataAttribute) {
        const value = target.getAttribute(dataAttribute);
        label += value ? `[${dataAttribute}="${value}"]` : `[${dataAttribute}]`;
      } else if (target.classList.length > 0) {
        label += `.${Array.from(target.classList).slice(0, 2).join('.')}`;
      }
      return pseudo ? `${label}${pseudo}` : label;
    };
    const numberOrNull = (value: unknown) =>
      typeof value === 'number' && Number.isFinite(value) ? value : null;

    const seen = new Set<Animation>();
    const report = [];
    for (const element of elements) {
      for (const animation of element.getAnimations({ subtree })) {
        if (seen.has(animation)) continue;
        seen.add(animation);
        if (animation.playState === 'idle') continue;
        if (animation.playState === 'finished' && !includeFinished) continue;
        const effect = animation.effect;
        const timing = effect?.getComputedTiming();
        const endTime = Number(timing?.endTime ?? Infinity);
        const finite = Number.isFinite(endTime);
        if (finite && endTime <= instantMs) continue;
        const target = effect instanceof KeyframeEffect ? effect.target : null;
        const ignored =
          finite &&
          target !== null &&
          ignore.some(
            ({ within, maxDurationMs }) => endTime <= maxDurationMs && target.closest(within),
          );
        if (ignored) continue;
        let type = 'Animation';
        let name = '';
        if (typeof CSSTransition !== 'undefined' && animation instanceof CSSTransition) {
          type = 'CSSTransition';
          name = animation.transitionProperty;
        } else if (typeof CSSAnimation !== 'undefined' && animation instanceof CSSAnimation) {
          type = 'CSSAnimation';
          name = animation.animationName;
        } else if (effect instanceof KeyframeEffect) {
          const properties = new Set<string>();
          for (const frame of effect.getKeyframes()) {
            for (const key of Object.keys(frame)) {
              if (!['offset', 'computedOffset', 'easing', 'composite'].includes(key)) {
                properties.add(key);
              }
            }
          }
          name = animation.id || Array.from(properties).join(',');
        }
        report.push({
          target: describeTarget(
            target,
            effect instanceof KeyframeEffect ? effect.pseudoElement : null,
          ),
          type,
          name,
          playState: animation.playState,
          pending: animation.pending,
          durationMs: finite ? endTime : null,
          iterations: numberOrNull(timing?.iterations),
          currentTimeMs: numberOrNull(
            typeof animation.currentTime === 'number'
              ? animation.currentTime
              : Number(animation.currentTime?.valueOf()),
          ),
        });
      }
    }
    return report;
  }, serialized);
}

/**
 * Wait until nothing under `locator` is animating (see `activeAnimations` for what counts).
 * Use for "the motion finished / cleaned up". Infinite animations never settle, so they
 * fail with the remaining animations listed.
 */
export async function expectAnimationsToSettle(
  locator: Locator,
  options: AnimationQueryOptions & { timeout?: number; message?: string } = {},
): Promise<void> {
  const { timeout, message, ...query } = options;
  await expect
    .poll(() => activeAnimations(locator, query), {
      message: message ?? `animations under ${String(locator)} should settle`,
      timeout,
    })
    .toEqual([]);
}

/**
 * Assert, without waiting, that nothing under `locator` is animating (see
 * `activeAnimations` for what counts). Use for "this subtree must not animate"; name any
 * child component whose own short fades are allowed in `ignore`.
 */
export async function expectNoAnimations(
  locator: Locator,
  options: AnimationQueryOptions & { message?: string } = {},
): Promise<void> {
  const { message, ...query } = options;
  expect(
    await activeAnimations(locator, query),
    message ?? `nothing under ${String(locator)} should animate`,
  ).toEqual([]);
}
