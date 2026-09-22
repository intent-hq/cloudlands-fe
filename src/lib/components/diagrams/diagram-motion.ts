export function partitionSceneIds(previous: string[], next: string[]) {
  const previousIds = new Set(previous);
  const nextIds = new Set(next);
  return {
    shared: next.filter((id) => previousIds.has(id)),
    departing: previous.filter((id) => !nextIds.has(id)),
    entering: next.filter((id) => !previousIds.has(id)),
  };
}

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
  return cameraTransformsMatch(previous, next)
    ? []
    : [{ transform: previous }, { transform: next }];
}
