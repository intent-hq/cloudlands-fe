const EQUAL_CAMERA_REFRAME_SCALE = 0.985;

function matrixValues(transform: string): number[] | null {
  const values = transform.match(/-?(?:\d+(?:\.\d*)?|\.\d+)/g)?.map(Number);
  return values?.every(Number.isFinite) ? values : null;
}

function cameraTransformsMatch(previous: string, next: string): boolean {
  if (previous === next) return true;
  const previousValues = matrixValues(previous);
  const nextValues = matrixValues(next);
  return (
    previousValues !== null &&
    nextValues !== null &&
    previousValues.length === nextValues.length &&
    previousValues.every((value, index) => Math.abs(value - nextValues[index]) < 0.001)
  );
}

export function cameraMotionKeyframes(previous: string, next: string): Keyframe[] {
  if (!cameraTransformsMatch(previous, next)) {
    return [{ transform: previous }, { transform: next }];
  }
  return [
    { transform: previous, transformOrigin: '50% 50%' },
    {
      transform: `${next} scale(${EQUAL_CAMERA_REFRAME_SCALE})`,
      transformOrigin: '50% 50%',
      offset: 0.5,
    },
    { transform: next, transformOrigin: '50% 50%' },
  ];
}
