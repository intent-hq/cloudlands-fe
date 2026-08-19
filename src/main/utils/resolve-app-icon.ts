import fs from 'fs';
import path, { dirname } from 'path';
import { fileURLToPath } from 'url';

const ICONS_DIRECTORY = path.join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../src/assets/icons',
);

const DEV_ICON_FILENAMES: Partial<Record<NodeJS.Platform, string>> = {
  darwin: 'dev-icon.icns',
  win32: 'dev-icon.ico',
};

export interface AppIconResolutionOptions {
  isPackaged: boolean;
  nodeEnv?: string;
  platform: NodeJS.Platform;
  iconsDirectory?: string;
  fileExists?: (filePath: string) => boolean;
}

export function resolveAppIconPath({
  isPackaged,
  nodeEnv,
  platform,
  iconsDirectory = ICONS_DIRECTORY,
  fileExists = fs.existsSync,
}: AppIconResolutionOptions): string | undefined {
  if (isPackaged || nodeEnv !== 'development') return undefined;

  const iconPath = path.join(iconsDirectory, DEV_ICON_FILENAMES[platform] ?? 'dev-icon.png');
  return fileExists(iconPath) ? iconPath : undefined;
}

export function resolveAppDockIconPath(options: AppIconResolutionOptions): string | undefined {
  if (options.platform !== 'darwin') return undefined;

  const {
    isPackaged,
    nodeEnv,
    iconsDirectory = ICONS_DIRECTORY,
    fileExists = fs.existsSync,
  } = options;
  if (isPackaged || nodeEnv !== 'development') return undefined;

  const iconPath = path.join(iconsDirectory, 'dev-icon.png');
  return fileExists(iconPath) ? iconPath : undefined;
}
