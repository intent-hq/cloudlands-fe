import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export function buildDesktopHelper(platform = process.platform, arch = process.arch) {
  if (!['darwin', 'win32'].includes(platform)) return;
  if (platform !== process.platform || !['x64', 'arm64'].includes(arch))
    throw new Error('Desktop helpers require a native platform runner and supported architecture');
  const output = resolve(root, 'resources/desktop-helper', `${platform}-${arch}`);
  mkdirSync(output, { recursive: true });
  if (platform === 'darwin') {
    execFileSync(
      'xcrun',
      [
        'swiftc',
        '-O',
        '-target',
        `${arch === 'arm64' ? 'arm64' : 'x86_64'}-apple-macosx14.0`,
        resolve(root, 'native/desktop/macos/main.swift'),
        resolve(root, 'native/desktop/macos/PermissionPrompts.swift'),
        '-o',
        resolve(output, 'intent-desktop-helper'),
        '-framework',
        'AppKit',
        '-framework',
        'ScreenCaptureKit',
        '-framework',
        'Carbon',
        '-framework',
        'IOKit',
      ],
      { stdio: 'inherit' },
    );
  } else {
    execFileSync(
      'dotnet',
      [
        'publish',
        resolve(root, 'native/desktop/windows/IntentDesktop.csproj'),
        '-c',
        'Release',
        '-r',
        `win-${arch}`,
        '--self-contained',
        'true',
        '-p:PublishSingleFile=true',
        '-p:DebugType=None',
        '-o',
        output,
      ],
      { stdio: 'inherit' },
    );
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  buildDesktopHelper();
