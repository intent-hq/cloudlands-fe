// Production Windows signing remains disabled. Manual Azure builds select
// scripts/windows-builder.cjs explicitly and never load this retired hook.
'use strict';

exports.default = async function sign() {
  if (
    ['1', 'true'].includes(
      (process.env.INTENT_WINDOWS_ENABLE_INTEGRATED_SIGNING || '').trim().toLowerCase(),
    )
  ) {
    throw new Error(
      'DigiCert signing is retired; use the explicit manual Azure build configuration.',
    );
  }
};
