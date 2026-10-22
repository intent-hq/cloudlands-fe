#!/usr/bin/env bash
set -euo pipefail

arch="${1:?Expected x64 or arm64}"
signed="${2:?Expected true or false}"
case "$arch" in x64|arm64) ;; *) exit 1 ;; esac
case "$signed" in true|false) ;; *) exit 1 ;; esac
shopt -s nullglob
apps=(dist-electron/mac*/Intent.app)
dmgs=(dist-electron/*-"$arch".dmg)
zips=(dist-electron/*-"$arch"-mac.zip)
if [ "${#apps[@]}" -ne 1 ] || [ "${#dmgs[@]}" -ne 1 ] || [ "${#zips[@]}" -ne 1 ]; then
  echo "Expected one native app, DMG and ZIP for $arch" >&2
  exit 1
fi
node - "${apps[0]}" "$arch" <<'NODE'
const native = require('./scripts/macos-native.cjs');
native.validatePackagedMacBinaries(process.argv[2], process.argv[3]);
console.log(`Validated packaged executables for ${process.argv[3]}.`);
NODE
if [ "$signed" = true ]; then
  codesign --verify --deep --strict --verbose=2 "${apps[0]}"
  codesign --display --verbose=2 "${apps[0]}"
  spctl --assess --type execute --verbose=2 "${apps[0]}"
  xcrun stapler validate "${apps[0]}"
fi
