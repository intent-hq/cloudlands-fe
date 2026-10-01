'use strict';

// Manual builds select this complete config explicitly; production still uses
// electron-builder.yml. Do not use an extends overlay: merging could retain
// signtoolOptions alongside Azure or drop the installed publisher in unsigned mode.
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { load } = require('js-yaml');
const { resolveWindowsSigning, manualWindowsConfig } = require('./windows-signing.cjs');

module.exports = () =>
  manualWindowsConfig(
    load(readFileSync(resolve(__dirname, '../electron-builder.yml'), 'utf8')),
    resolveWindowsSigning(process.env.INTENT_WINDOWS_SIGNING_MODE),
  );
