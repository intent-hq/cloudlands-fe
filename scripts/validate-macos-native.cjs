#!/usr/bin/env node
const path = require('node:path');
const { assertNativeMacArch, validateStagedMacBinaries } = require('./macos-native.cjs');

try {
  const arch = assertNativeMacArch(process.argv[2] || process.env.INTENT_MAC_ARCH || process.arch);
  validateStagedMacBinaries(path.resolve(__dirname, '..'), arch);
  console.log(`Validated all staged Mac executables for ${arch}.`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
