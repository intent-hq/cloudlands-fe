/**
 * Sector layout for the radial prompt picker: N prompts plus a dedicated
 * Cancel slot, as N+1 equal slices. The Cancel slice is centered exactly at
 * 6 o'clock (screen turn 0.5); prompt i is centered at screen turn
 * `(i - (N-1)/2) / (N+1)`, so the prompts are evenly redistributed over the
 * remaining arc — clockwise from just after Cancel, around 12 o'clock, back
 * to just before it. Screen turns are clockwise from 12 o'clock; raw device
 * angles are converted via {@link deviceAngleToScreenTurn} (device 0 = 3
 * o'clock, clockwise).
 */

import { angleToSector, deviceAngleToScreenTurn } from '../input/sector';

/** Total sector count: one slice per prompt plus the Cancel slice. */
export function radialSectorCount(promptCount: number): number {
  return promptCount + 1;
}

/** Sector index of the Cancel slice (prompts occupy 0..promptCount-1). */
export function radialCancelSector(promptCount: number): number {
  return promptCount;
}

/**
 * Rotation offset (in turns) for {@link angleToSector} so the Cancel slice
 * is centered at screen turn 0.5 and prompt i at
 * `(i - (promptCount-1)/2) / (promptCount+1)`.
 */
export function radialSectorOffset(promptCount: number): number {
  return -promptCount / (2 * (promptCount + 1));
}

/** Screen turn (clockwise from 12 o'clock) of prompt i's sector center. */
export function radialPromptTurn(index: number, promptCount: number): number {
  return (index - (promptCount - 1) / 2) / (promptCount + 1);
}

/** Map a raw device joystick angle to the highlighted sector index. */
export function radialSectorForAngle(angle: number, promptCount: number): number {
  return angleToSector(
    deviceAngleToScreenTurn(angle),
    radialSectorCount(promptCount),
    radialSectorOffset(promptCount),
  );
}
