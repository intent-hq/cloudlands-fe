import {
  intentMarkKeyframes,
  intentMarkMotionTiming,
  type IntentMarkVariant,
} from './intent-mark-vector';

type Pose = Readonly<Record<string, string>>;
type Poses = readonly Pose[];
const cache: Record<IntentMarkVariant, (Poses | undefined)[]> = {
  pulse: [],
  bloom: [],
  twist: [],
};
const numberPattern = /-?(?:\d*\.)?\d+(?:e[+-]?\d+)?/gi;

function coordinate(t: number, a: number, b: number): number {
  return 3 * (1 - t) ** 2 * t * a + 3 * (1 - t) * t ** 2 * b + t ** 3;
}

function ease(progress: number, easing?: string): number {
  if (!easing || easing === 'linear') return progress;
  // The reference Pulse keys carry two distinct cubic Beziers. Invert x
  // before sampling y, just as CSS keyframe segment easing does.
  const coordinates = easing.match(numberPattern);
  if (!coordinates || coordinates.length !== 4 || !easing.startsWith('cubic-bezier('))
    throw new Error('Unsupported Intent mark easing');
  const [x1, y1, x2, y2] = coordinates.map(Number);
  let low = 0;
  let high = 1;
  for (let step = 0; step < 24; step++) {
    const t = (low + high) / 2;
    if (coordinate(t, x1, x2) < progress) low = t;
    else high = t;
  }
  return coordinate((low + high) / 2, y1, y2);
}

function interpolate(from: string, to: string, progress: number): string {
  if (from === to) return from;
  const start = from.match(numberPattern)?.map(Number) ?? [];
  const end = to.match(numberPattern)?.map(Number) ?? [];
  // Only interpolate matching SVG commands / CSS functions and units. All
  // reference keys are compatible; an incompatible value is CSS-discrete.
  if (
    start.length !== end.length ||
    from.replace(numberPattern, '#') !== to.replace(numberPattern, '#')
  )
    return progress < 0.5 ? from : to;
  let index = 0;
  return to.replace(numberPattern, () => {
    const value = start[index] + (end[index] - start[index]) * progress;
    index++;
    return String(Number(value.toFixed(6)));
  });
}

function poseAt(keys: readonly Readonly<Keyframe>[], phase: number): Pose {
  const afterIndex = keys.findIndex((key) => Number(key.offset) > phase + 1e-9);
  const before = keys[afterIndex < 0 ? keys.length - 1 : Math.max(0, afterIndex - 1)];
  const after = keys[afterIndex] ?? before;
  const progress =
    before === after
      ? 0
      : ease(
          Math.max(
            0,
            (phase - Number(before.offset)) / (Number(after.offset) - Number(before.offset)),
          ),
          before.easing,
        );
  return Object.freeze(
    Object.fromEntries(
      Object.entries(before)
        .filter(([property]) => !['offset', 'easing', 'composite'].includes(property))
        .map(([property, value]) => [
          property,
          interpolate(String(value), String(after[property] ?? value), progress),
        ]),
    ),
  );
}

/** Bounded, immutable 30fps samples of the reference vector keys, shared by all marks. */
export function intentMarkPoses(variant: IntentMarkVariant, index: number): Poses {
  // Validate before indexing the cache; arbitrary indices must not grow it.
  const keys = intentMarkKeyframes(variant, index);
  const count = Math.round((intentMarkMotionTiming[`${variant}Ms`] * 30) / 1000);
  return (cache[variant][index] ??= Object.freeze(
    Array.from({ length: count }, (_, frame) => poseAt(keys, frame / count)),
  ));
}
