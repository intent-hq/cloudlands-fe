import type { HardwareConsoleEncoderBehavior } from '$store/renderer/slices/hardware-console/hardware-console-types';
import {
  readHardwareConsoleSettingsBag,
  persistHardwareConsoleSettingsPatch,
} from '../settings-bag';

/** Missing preferences, including existing installations, opt into effort adjustment. */
export async function loadHardwareConsoleEncoderBehavior(): Promise<HardwareConsoleEncoderBehavior> {
  const bag = await readHardwareConsoleSettingsBag();
  if (bag === null) throw new Error('hardwareConsole.state read failed');
  return bag.encoderBehavior === 'workspace-switch' ? 'workspace-switch' : 'agent-effort';
}

export async function persistHardwareConsoleEncoderBehavior(
  encoderBehavior: HardwareConsoleEncoderBehavior,
): Promise<void> {
  await persistHardwareConsoleSettingsPatch({ encoderBehavior });
}
