/**
 * Ensure cross-architecture native module prebuilds are present.
 *
 * npm/pnpm only install optional dependencies matching the host CPU.
 * When building for multiple architectures (e.g., arm64 on Apple Silicon),
 * the non-host prebuilds must be downloaded manually so electron-builder includes
 * them in the asar archive.
 *
 * Run this BEFORE electron-builder: node scripts/ensure-native-deps.cjs
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.resolve(__dirname, '..');

/**
 * Read the installed version of a package from its package.json.
 * Falls back to the provided default if not found.
 */
function getInstalledVersion(pkgName, fallback) {
  try {
    const pkgJson = path.join(ROOT, 'node_modules', ...pkgName.split('/'), 'package.json');
    return JSON.parse(fs.readFileSync(pkgJson, 'utf8')).version;
  } catch {
    return fallback;
  }
}

// Packages that ship per-platform prebuilds as separate npm packages.
// The version is read from the installed package to stay in sync automatically.
const PLATFORM_PACKAGES = [
  {
    // @parcel/watcher requires @parcel/watcher-{platform}-{arch}
    parentPkg: '@parcel/watcher',
    nameTemplate: '@parcel/watcher-{platform}-{arch}',
    platforms: ['darwin'],
    arches: ['arm64'],
  },
];

function main() {
  console.log('🔍 Ensuring cross-architecture native dependencies...\n');

  const hostArch = process.arch;   // e.g. 'arm64'
  const hostPlatform = process.platform; // e.g. 'darwin'

  let installed = 0;

  for (const spec of PLATFORM_PACKAGES) {
    const version = getInstalledVersion(spec.parentPkg, null);
    if (!version) {
      console.log(`  ⚠️  ${spec.parentPkg} not found in node_modules — skipping`);
      continue;
    }
    console.log(`  ${spec.parentPkg} version: ${version}`);

    for (const platform of spec.platforms) {
      if (platform !== hostPlatform) continue; // only install for current OS

      for (const arch of spec.arches) {
        const pkgName = spec.nameTemplate
          .replace('{platform}', platform)
          .replace('{arch}', arch);

        // Check if it already exists in node_modules
        const pkgDir = path.join(ROOT, 'node_modules', ...pkgName.split('/'));
        if (fs.existsSync(pkgDir) && fs.readdirSync(pkgDir).length > 0) {
          console.log(`  ✅ ${pkgName} — already present`);
          continue;
        }

        // Also check pnpm's .pnpm store (it may be there but not hoisted)
        const pnpmName = pkgName.replace('/', '+');
        const pnpmDir = path.join(
          ROOT, 'node_modules', '.pnpm',
          `${pnpmName}@${version}`,
          'node_modules', ...pkgName.split('/')
        );
        if (fs.existsSync(pnpmDir)) {
          // Create a symlink/directory so electron-builder can find it
          console.log(`  📎 ${pkgName} — linking from pnpm store`);
          const parentDir = path.dirname(pkgDir);
          fs.mkdirSync(parentDir, { recursive: true });
          // Copy instead of symlink (electron-builder follows symlinks inconsistently)
          copyDirSync(pnpmDir, pkgDir);
          installed++;
          continue;
        }

        // Download and extract the package
        console.log(`  📦 ${pkgName}@${version} — downloading...`);
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'native-dep-'));
        try {
          execSync(
            `npm pack ${pkgName}@${version} --pack-destination="${tmpDir}"`,
            { stdio: 'pipe', timeout: 60000 }
          );

          const tarballs = fs.readdirSync(tmpDir).filter(f => f.endsWith('.tgz'));
          if (tarballs.length === 0) {
            throw new Error(`npm pack produced no tarball for ${pkgName}`);
          }

          const parentDir = path.dirname(pkgDir);
          fs.mkdirSync(parentDir, { recursive: true });
          fs.mkdirSync(pkgDir, { recursive: true });

          execSync(
            `tar -xzf "${path.join(tmpDir, tarballs[0])}" --strip-components=1 -C "${pkgDir}"`,
            { stdio: 'pipe', timeout: 30000 }
          );

          // Verify the .node file exists
          const nodeFiles = fs.readdirSync(pkgDir).filter(f => f.endsWith('.node'));
          if (nodeFiles.length > 0) {
            console.log(`  ✅ ${pkgName} — installed (${nodeFiles.join(', ')})`);
          } else {
            console.warn(`  ⚠️  ${pkgName} — installed but no .node file found`);
          }
          installed++;
        } catch (err) {
          console.error(`  ❌ ${pkgName} — failed: ${err.message}`);
          throw err;
        } finally {
          fs.rmSync(tmpDir, { recursive: true, force: true });
        }
      }
    }
  }

  console.log(`\n✅ Done. ${installed} package(s) installed.\n`);

  // Rebuild native modules for Electron.
  // npmRebuild is disabled in electron-builder.yml (it hangs on cpu-features),
  // so we must rebuild native modules explicitly here. Without this, the
  // packaged app ships .node binaries compiled for Node.js (wrong ABI) and
  // fails to load (node-pty).
  console.log('🔨 Rebuilding node-pty for Electron...');
  try {
    execSync('npx @electron/rebuild -f -o node-pty', {
      cwd: ROOT,
      stdio: 'inherit',
      timeout: 300000,
    });
    console.log('✅ node-pty rebuilt for Electron');
  } catch (err) {
    console.error(`❌ Failed to rebuild native modules: ${err.message}`);
    process.exit(1);
  }
}

function copyDirSync(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

main();

