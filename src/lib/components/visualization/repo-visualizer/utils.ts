/**
 * Utility functions for the repo visualizer
 * Ported from githubocto/repo-visualizer
 */

export const truncateString = (string: string = '', length: number = 20): string =>
  string.length > length + 3 ? `${string.substring(0, length)}...` : string;

export const keepBetween = (min: number, value: number, max: number): number =>
  Math.max(min, Math.min(max, value));

export const getPositionFromAngleAndDistance = (
  angle: number,
  distance: number,
): [number, number] => {
  const radians = (angle / 180) * Math.PI;
  return [Math.cos(radians) * distance, Math.sin(radians) * distance];
};

export const getAngleFromPosition = (x: number, y: number): number =>
  (Math.atan2(y, x) * 180) / Math.PI;

export const keepCircleInsideCircle = (
  parentR: number,
  parentPosition: [number, number],
  childR: number,
  childPosition: [number, number],
  isParent: boolean = false,
): [number, number] => {
  const distance = Math.sqrt(
    Math.pow(parentPosition[0] - childPosition[0], 2) +
      Math.pow(parentPosition[1] - childPosition[1], 2),
  );
  const angle = getAngleFromPosition(
    childPosition[0] - parentPosition[0],
    childPosition[1] - parentPosition[1],
  );
  // Leave space for labels
  const padding = Math.min(angle < -20 && angle > -100 && isParent ? 13 : 3, parentR * 0.2);
  if (distance > parentR - childR - padding) {
    const diff = getPositionFromAngleAndDistance(angle, parentR - childR - padding);
    return [parentPosition[0] + diff[0], parentPosition[1] + diff[1]];
  }
  return childPosition;
};

/**
 * Generate a unique ID for SVG elements
 */
let idCounter = 0;
export const uniqueId = (prefix: string = 'id'): string => `${prefix}-${++idCounter}`;
