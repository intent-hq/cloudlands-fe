// Native SVG geometry and scalar motion. GIFs are test references, never runtime assets.
export const intentMarkVariants = ['bloom', 'pulse', 'twist'] as const;
export type IntentMarkVariant = (typeof intentMarkVariants)[number];
export const intentMarkMotionTiming = {
  settleMs: 160,
  bloomMs: 61_000 / 30,
  pulseMs: 61_000 / 30,
  twistMs: 110_000 / 30,
} as const;
export const intentMarkViewBox = '0 -27 256 256';
export const intentMarkStrokeWidth = 18.45088;
export const intentMarkPaths = [
  'M92.148293 3.803071L112.21 58.92178C117.575582 73.663539 101.604204 87.065138 88.018096 79.221207L37.220352 49.893204',
  'M221.41417 49.978045L170.616426 79.306048C157.030318 87.149979 141.05894 73.74838 146.424522 59.006621L166.486229 3.887912',
  'M24.769303 119.698155L82.534231 109.51261C97.983713 106.788469 108.40846 124.844303 98.324395 136.861921L60.621011 181.795086',
  'M195.378989 181.795086L157.675605 136.861921C147.59154 124.844303 158.016287 106.788469 173.465769 109.51261L231.230697 119.698155',
  'M128 135.5954L128 208.081',
] as const;

interface ScalarKey {
  frame: number;
  value: number;
  incoming?: readonly [number, number];
  outgoing?: readonly [number, number];
}
const controllerRotation: readonly ScalarKey[] = [
  { frame: 0, value: -40, incoming: [0.085, 1], outgoing: [0.01, 0.405] },
  { frame: 25, value: -0.5, incoming: [0.659, 1], outgoing: [0.326, 0.221] },
  { frame: 35, value: 0, incoming: [0, 1], outgoing: [0.167, 0] },
  { frame: 65, value: 20 },
];
const armRotations: readonly (readonly ScalarKey[])[] = [
  [
    { frame: 0, value: -1, incoming: [0, 1], outgoing: [0.01, 0.336] },
    { frame: 25, value: 0 },
  ],
  [
    { frame: 0, value: -40, incoming: [0.094, 1], outgoing: [0.006, 0.435] },
    { frame: 25, value: -0.5, incoming: [0.659, 1], outgoing: [0.326, 0.211] },
    { frame: 35, value: 0, incoming: [0, 1], outgoing: [0.599, 0] },
    { frame: 65, value: 340 },
  ],
  [
    { frame: 0, value: -120, incoming: [0.094, 1], outgoing: [0.006, 0.144] },
    { frame: 25, value: -0.5, incoming: [0.659, 1], outgoing: [0.326, 1.034] },
    { frame: 35, value: 0, incoming: [0, 1], outgoing: [0.549, 0] },
    { frame: 65, value: 260 },
  ],
  [
    { frame: 0, value: -200, incoming: [0.094, 1], outgoing: [0.006, 0.086] },
    { frame: 25, value: -0.5, incoming: [0.659, 1], outgoing: [0.326, 1.857] },
    { frame: 35, value: 0, incoming: [0, 1], outgoing: [0.5, 0] },
    { frame: 65, value: 180 },
  ],
  [
    { frame: 0, value: -280, incoming: [0.085, 1], outgoing: [0.005, 0.205] },
    { frame: 25, value: -0.5, incoming: [0.659, 1], outgoing: [0.326, 2.172] },
    { frame: 35, value: 0, incoming: [0, 1], outgoing: [0.45, 0] },
    { frame: 65, value: 100 },
  ],
];
const bottomTrim: readonly ScalarKey[] = [
  { frame: 0, value: 100, incoming: [0, 1], outgoing: [0.013, 0.332] },
  { frame: 25, value: 0, incoming: [0.833, 1], outgoing: [0.167, 0] },
  { frame: 35, value: 0, incoming: [0, 1], outgoing: [0.17, 0] },
  { frame: 54, value: 100 },
];
const armTrimStart: readonly ScalarKey[] = [
  { frame: 0, value: 50, incoming: [0.028, 0.901], outgoing: [0.015, 0.187] },
  { frame: 19, value: 1.208, incoming: [0.629, 1], outgoing: [0.298, 1.547] },
  { frame: 43, value: 0, incoming: [0, 1], outgoing: [0.001, 0.141] },
  { frame: 65, value: 50 },
];
const armTrimEnd: readonly ScalarKey[] = [
  { frame: 0, value: 50, incoming: [0.028, 0.901], outgoing: [0.013, 0.118] },
  { frame: 19, value: 98.792, incoming: [0.629, 1], outgoing: [0.298, 1.547] },
  { frame: 43, value: 100, incoming: [0, 1], outgoing: [0.001, 0.141] },
  { frame: 65, value: 50 },
];

function coordinate(t: number, a: number, b: number): number {
  return 3 * (1 - t) ** 2 * t * a + 3 * (1 - t) * t ** 2 * b + t ** 3;
}
function sample(track: readonly ScalarKey[], frame: number): number {
  if (frame <= track[0].frame) return track[0].value;
  for (let i = 1; i < track.length; i++) {
    const before = track[i - 1],
      after = track[i];
    if (frame > after.frame) continue;
    const progress = (frame - before.frame) / (after.frame - before.frame);
    const out = before.outgoing ?? [0, 0],
      into = before.incoming ?? [1, 1];
    let low = 0,
      high = 1;
    for (let step = 0; step < 20; step++) {
      const t = (low + high) / 2;
      if (coordinate(t, out[0], into[0]) < progress) low = t;
      else high = t;
    }
    return (
      before.value + (after.value - before.value) * coordinate((low + high) / 2, out[1], into[1])
    );
  }
  return track.at(-1)!.value;
}
const clamp = (n: number) => Math.max(0, Math.min(100, n));
const rounded = (n: number) => Number(n.toFixed(6));

function createPulseKeyframes(index: number): Keyframe[] {
  const [x, y] = [
    [-15.856, -18.903],
    [15.8795, -18.9409],
    [-21.4098, 12.4218],
    [21.3538, 12.359],
    [0, 0],
  ][index];
  const [dx, dy] = [
    [0.03, -0.16],
    [-0.03, 0.04],
    [-0.43, -0.91],
    [-0.03, 0.01],
    [0, 0],
  ][index];
  const neutral = `translate(${dx}px, ${dy}px)`;
  return [
    { transform: neutral, offset: 0, easing: 'cubic-bezier(0.667, 0, 0.333, 1)' },
    {
      transform: `translate(${x + dx}px, ${y + dy}px)`,
      offset: 30 / 61,
      easing: 'cubic-bezier(0.667, 0, 0.25, 1)',
    },
    { transform: neutral, offset: 60 / 61 },
    { transform: neutral, offset: 1 },
  ];
}

function bloomPose(index: number, frame: number): Keyframe {
  const sourceIndex = [2, 3, 1, 4, 0][index];
  const start = clamp(sample(index === 4 ? bottomTrim : armTrimStart, frame));
  const end = index === 4 ? 100 : clamp(sample(armTrimEnd, frame));
  const rotation = sample(controllerRotation, frame) + sample(armRotations[sourceIndex], frame);
  return {
    strokeDasharray: `${rounded(Math.max(0, end - start))} 200`,
    strokeDashoffset: index === 4 ? 0 : rounded(-start),
    transform: `translate(128px, 98px) rotate(${rounded(rotation)}deg) translate(-128px, -101px)`,
    opacity: frame < 56 ? 1 : 0,
  };
}

// Measured folding controls, not traced outlines: source time, bend position,
// opening angle, length, width, outer/inner bend handles, alignment and end shear.
// Two mirrored cubic bends keep the arm ends square even when the fold closes.
const twistControls = [
  [12, 85.773, -0.009, 1.543, 47.06, 17.073, -0.343, 2.044, -0.505, -0.072, 0.287],
  [13, 76.008, 0.299, 3.583, 53.67, 19.019, -17.476, 0.226, -0.365, -0.156, 0.753],
  [14, 80.485, 2.242, 6.728, 45.34, 22.515, 15.179, -9.706, -0.287, -0.2, 1.575],
  [15, 71.482, 5.724, 12.354, 50.357, 21.813, 10.784, -11.881, -0.71, 0.027, 1.07],
  [16, 71.996, 11.607, 18.13, 46.138, 23.116, 19.59, 1.973, -0.61, -0.016, 2.705],
  [18, 62.531, 15.807, 22.3, 48.508, 20.354, 21.515, 9.905, -0.634, -0.006, 1.936],
  [19, 58.95, 12.89, 17.682, 48.307, 23.248, 23.322, 4.272, -0.594, -0.032, 1.288],
  [20, 59.829, 9.449, 11, 44.444, 22.254, 31.886, 6.841, -0.505, -0.085, -0.01],
  [21, 46.002, 3.795, 5.314, 57.67, 17.95, 15.399, -1.162, -0.65, 0.01, -0.321],
  [22, 34.095, -0.003, 0.035, 70.166, 15.289, -0.024, -0.075, -0.661, 0.006, 0.022],
  [24, 44.493, 4.785, 8.136, 60.077, 20.892, 14.391, 1.078, -0.701, 0.045, -0.228],
  [25, 46.735, 6.974, 11.095, 57.886, 22.359, 17.75, -7.54, -0.417, -0.176, -0.357],
  [26, 46.413, 8.526, 13.29, 58.419, 22.97, 17.118, -9.762, -0.357, -0.236, -2.045],
  [27, 45.355, 9.5, 15.116, 59.652, 23.339, 15.886, -12.41, -0.608, -0.035, -0.562],
  [28, 51.145, 12.539, 16.014, 53.671, 23.458, 25.447, 4.866, -0.647, -0.008, -0.494],
  [30, 48.795, 13.589, 17.93, 55.836, 22.994, 23.003, 6.009, -0.876, 0.166, -0.085],
  [31, 48.537, 14.181, 18.501, 55.768, 22.491, 23.507, 6.413, -0.828, 0.119, 0.225],
  [32, 48.421, 14.722, 18.925, 55.632, 22.076, 24.235, 7.745, -0.674, 0.02, 0.135],
  [33, 48.229, 15.146, 19.265, 55.429, 21.632, 24.776, 8.463, -0.66, 0.005, 0.274],
  [34, 48.072, 15.511, 19.471, 55.208, 21.166, 25.343, 9.15, -0.63, -0.011, 0.508],
  [36, 47.733, 16.05, 19.744, 54.724, 20.293, 26.439, 10.37, -0.665, 0.009, 0.179],
  [37, 46.174, 15.729, 19.819, 55.943, 19.879, 24.746, 8.526, -0.563, -0.066, 0.128],
  [38, 45.613, 15.727, 19.913, 56.143, 19.501, 24.589, 8.4, -0.615, -0.028, 0.059],
  [40, 45.186, 15.934, 19.945, 55.774, 18.876, 25.232, 8.874, -0.604, -0.034, 0.13],
  [42, 44.891, 16.109, 19.959, 55.33, 18.398, 25.872, 9.382, -0.661, 0.006, 0.019],
  [44, 43.124, 15.618, 20.038, 56.615, 18.065, 24.035, 7.491, -0.682, 0.024, 0.023],
  [46, 42.869, 15.698, 20.021, 56.405, 17.898, 24.364, 7.793, -0.619, -0.026, 0.003],
  [48, 42.573, 15.723, 20.007, 56.347, 17.867, 24.473, 7.812, -0.635, -0.012, 0.029],
  [60, 42.057, 15.875, 19.971, 55.968, 17.878, 25.069, 8.431, -0.643, -0.005, -0.031],
  [66, 42.225, 15.849, 19.958, 56.047, 17.859, 24.937, 8.258, -0.65, 0.001, 0.011],
  [67, 42.385, 15.836, 19.979, 56.092, 17.858, 24.912, 8.232, -0.665, 0.012, -0.026],
  [68, 42.616, 15.819, 19.987, 56.105, 17.869, 24.879, 8.215, -0.648, 0, 0.033],
  [69, 42.546, 15.662, 20.004, 56.537, 17.855, 24.255, 7.569, -0.618, -0.023, -0.015],
  [70, 42.973, 15.647, 20.02, 56.559, 17.858, 24.226, 7.578, -0.64, -0.007, 0.043],
  [72, 44.868, 15.808, 19.978, 56.174, 17.859, 24.773, 8.137, -0.648, -0.005, -0.028],
  [73, 45.907, 15.496, 20.035, 56.925, 18.777, 23.638, 7.212, -0.6, -0.036, 0.07],
  [74, 48.913, 13.878, 18.97, 58.435, 21.984, 20.967, 4.024, -0.528, -0.082, -0.019],
  [75, 47.15, 4.714, 8.165, 63.54, 21.114, 13.99, 7.525, -0.565, -0.052, -0.755],
  [76, 55.85, 7.138, 10.886, 58.774, 22.375, 18.553, -2.165, -0.53, -0.067, -0.828],
  [78, 71.983, 17.165, 21.545, 48.668, 18.571, 27.375, 13.96, 0.888, -0.859, 1.594],
  [79, 71.594, 14.729, 20.944, 50.505, 21.733, 20.914, 7.802, -0.622, -0.01, 1.424],
  [80, 72.708, 12.334, 19.304, 49.045, 22.994, 18.176, 3.694, -0.734, 0.052, 1.835],
  [81, 74.127, 10.243, 17.16, 45.831, 23.048, 17.277, 7.799, -1.09, 0.262, 3.203],
  [82, 72.061, 7.429, 15.192, 44.799, 22.238, 11.993, 11.997, -0.664, 0.018, 2.027],
  [
    84, 70.68485, 4.40412, 11.15342, 35.68944, 20.0137, 8.46479, -6.97977, -2.09194, 0.90993,
    1.86313,
  ],
  [85, 73.453, 5.178, 8.626, 25.753, 16.955, 13.511, -9.491, -0.791, 0.105, 1.407],
  [86, 66.577, 2.206, 9.181, 24.868, 17.406, 3.343, -5.847, 0.704, -0.973, 2.038],
  [87, 64.905, 0.927, 9.572, 18.52, 17.249, 1.609, 1.174, -1.836, 0.923, 2.535],
  [88, 63.705, 0.073, 7.634, 12.386, 17.7, 1.078, -0.984, -1.244, 0.487, 2.296],
  [90, 60.92039, 0, 0, 4.84968, 16.21532, 0, 0, -0.22882, -0.33918, 0],
  [91, 60.582363, 0, 0, 2.384669, 15.532246, 0, 0, -0.421006, -0.198817, 0],
  [92, 60.373467, 0, 0, 1.026554, 15.249202, 0, 0, -0.706338, 0.077535, 0],
  [93, 60.17416, 0, 0, 0.44325, 15.11063, 0, 0, -0.78638, 0.12906, 0],
  [94, 60.16147, 0, 0, 0.04755, 18.05442, 0, 0, -1.07724, 0.21978, 0],
] as const;

type Point = readonly [number, number];
function foldedArm(index: number, controls: readonly number[]): string {
  const [q, s, degrees, length, width, outerHandle, innerHandle, shift, rotation, shear] = controls;
  const theta = (degrees * Math.PI) / 180;
  const c = Math.cos(theta),
    n = Math.sin(theta);
  const angle = (((index < 2 ? -130 : 150) + rotation) * Math.PI) / 180;
  const ux = Math.cos(angle),
    uy = Math.sin(angle);
  const outer: Point = [q - (n * width) / 2, s + (c * width) / 2];
  const inner: Point = [q + (n * width) / 2, s - (c * width) / 2];
  const half = ([r, t]: Point, h: number): Point[] => [
    [r, t],
    [r - 0.5 * h * c, t - 0.5 * h * n],
    [r - 0.75 * h * c, 0.5 * t - 0.25 * h * n],
    [r - 0.75 * h * c, 0],
  ];
  const end = ([r, t]: Point, side: number): Point => [
    r + (length + (side * shear) / 2) * c,
    t + (length + (side * shear) / 2) * n,
  ];
  const points = [
    end(outer, 1),
    ...half(outer, outerHandle),
    ...half(inner, innerHandle).reverse(),
    end(inner, -1),
  ];
  const point = ([r, t]: Point, mirror: number) => {
    const x = 127.5 + r * ux - (mirror * t + shift) * uy - (index < 2 ? 0 : 1.14);
    const y = 98 + r * uy + (mirror * t + shift) * ux + (index < 2 ? 0 : 0.1);
    return `${rounded(index % 2 ? 256 - x : x)} ${rounded(y)}`;
  };
  const [a, b, c1, c2, d, e, f, g, h, j] = points;
  return (
    `M${point(a, 1)}L${point(b, 1)}C${point(c1, 1)} ${point(c2, 1)} ${point(d, 1)}L${point(e, 1)}C${point(f, 1)} ${point(g, 1)} ${point(h, 1)}L${point(j, 1)}Z` +
    `M${point(j, -1)}L${point(h, -1)}C${point(g, -1)} ${point(f, -1)} ${point(e, -1)}L${point(d, -1)}C${point(c2, -1)} ${point(c1, -1)} ${point(b, -1)}L${point(a, -1)}Z`
  );
}

function twistKeyframes(index: number): Keyframe[] {
  if (index === 4) {
    // The fifth stroke enters from below before the four arms start folding.
    return [
      [0, 270, 285],
      [1, 231.65, 270],
      [2, 209.42, 254.41],
      [3, 194.78, 247.43],
      [4, 184.32, 242.32],
      [6, 170.96, 235.59],
      [7, 166.9, 233.46],
      [9, 162.32, 230.75],
      [12, 160.32, 229.56],
      [16, 159.36, 229.05],
      [24, 158.91, 228.69],
      [67, 158.89, 228.68],
      [72, 160.42, 229.36],
      [73, 162.59, 230.68],
      [74, 172.46, 239.36],
      [76, 180.78, 242.62],
      [78, 220.52, 245.1],
      [79, 232.39, 246],
      [81, 241.06, 247.1],
      [84, 246.65, 248.29],
      [85, 247.64, 248.62],
      [86, 248.5, 248.5],
      [110, 248.5, 248.5],
    ].map(([frame, top, bottom]) => ({
      d: `path("M128 ${top - 27}L128 ${bottom - 27}")`,
      strokeWidth: 17.86,
      transform: 'none',
      offset: frame / 110,
    }));
  }
  const poses = twistControls.map(([frame, ...controls]) => ({
    d: `path("${foldedArm(index, controls)}")`,
    fill: 'currentColor',
    strokeWidth: 0,
    transform: 'none',
    opacity: 1,
    offset: frame / 110,
  }));
  return [
    { ...poses[0], opacity: 0, offset: 0 },
    { ...poses[0], opacity: 0, offset: 11 / 110 },
    ...poses,
    { ...poses[poses.length - 1], opacity: 0, offset: 95 / 110 },
    { ...poses[poses.length - 1], opacity: 0, offset: 1 },
  ];
}

function createKeyframes(variant: IntentMarkVariant, index: number): Keyframe[] {
  if (variant === 'pulse') return createPulseKeyframes(index);
  if (variant === 'twist') return twistKeyframes(index);
  // Sample the original scalar curves at 120Hz, then let the browser interpolate.
  // These are rotations and real length trims, not traced frame outlines.
  return Array.from({ length: 245 }, (_, i) => ({ ...bloomPose(index, i / 4), offset: i / 244 }));
}

type MotionFrames = readonly Readonly<Keyframe>[];
// At most three variants × five arms per renderer. Generate only on first use;
// never retain elements, animations, or resolved theme colors in this cache.
const keyframeCache: Record<IntentMarkVariant, (MotionFrames | undefined)[]> = {
  pulse: [],
  bloom: [],
  twist: [],
};

export function intentMarkKeyframes(variant: IntentMarkVariant, index: number): MotionFrames {
  if (!Number.isInteger(index) || index < 0 || index >= intentMarkPaths.length)
    throw new RangeError('Intent mark arm index is out of range');
  return (keyframeCache[variant][index] ??= Object.freeze(
    createKeyframes(variant, index).map((frame) => Object.freeze(frame)),
  ));
}

export function pulseKeyframes(index: number): MotionFrames {
  return intentMarkKeyframes('pulse', index);
}
