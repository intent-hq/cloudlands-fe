// TEST ONLY compositor camera. This is not an artifact wire/profile contract.
const CAMERA_SIZE = 256;
const BAND_HEIGHT = 64;
export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}
export function nativeCamera(source: Box, label: Box, scale: number) {
  if (
    ![1, 2].includes(scale) ||
    ![...Object.values(source), ...Object.values(label)].every(Number.isFinite)
  )
    throw new Error('Invalid test camera');
  if (
    source.width <= 0 ||
    source.height <= 0 ||
    label.width <= 0 ||
    label.height <= 0 ||
    label.width * scale > CAMERA_SIZE - 50 ||
    label.height * scale > CAMERA_SIZE - 50
  )
    throw new Error('Native target does not fit test camera');
  return {
    x: Math.max(0, label.left - source.left - 50 / scale),
    y: Math.max(0, label.top - source.top - 50 / scale),
    scale,
  };
}
export function captureBands(camera: number) {
  if (!Number.isInteger(camera) || camera < 0 || camera > 1)
    throw new Error('Invalid test camera index');
  return Array.from({ length: CAMERA_SIZE / BAND_HEIGHT }, (_, band) => ({
    camera,
    band,
    clip: { x: 0, y: band * BAND_HEIGHT, width: CAMERA_SIZE, height: BAND_HEIGHT },
  }));
}
