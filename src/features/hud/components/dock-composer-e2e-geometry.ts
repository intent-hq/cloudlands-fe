/** Element rects inside the synthetic screen (pixels of the capture). No runtime deps: the CT spec imports it. */
export const SYNTHETIC_ELEMENTS = {
  card: { x: 360, y: 220, w: 720, h: 420 },
  save: { x: 860, y: 560, w: 180, h: 52 },
  cancel: { x: 660, y: 560, w: 180, h: 52 },
} as const;
