'use strict';

// Every setting azure mode reads. The manual-build preflight checks these before a
// Windows runner is allocated, and its test asserts the workflow wires each one.
const WINDOWS_SIGNING_VARIABLES = Object.freeze([
  'INTENT_WINDOWS_AZURE_ENDPOINT',
  'INTENT_WINDOWS_AZURE_ACCOUNT_NAME',
  'INTENT_WINDOWS_AZURE_CERTIFICATE_PROFILE_NAME',
  'INTENT_WINDOWS_PUBLISHER_NAME',
  'INTENT_WINDOWS_PUBLISHER_SUBJECT',
  'AZURE_TENANT_ID',
  'AZURE_CLIENT_ID',
]);
const WINDOWS_SIGNING_SECRETS = Object.freeze(['AZURE_CLIENT_SECRET']);

function nonblank(value) {
  return typeof value === 'string' && !!value.trim() && !/[\r\n\0]/.test(value);
}

function required(env, name) {
  const value = env[name];
  if (!nonblank(value)) {
    throw new Error(`Windows signing requires a nonblank ${name}`);
  }
  return value.trim();
}

// Credentials belong only in the signing process environment, never in the
// builder config, verification report, or an error containing their value.
function resolveWindowsSigning(mode = 'unsigned', env = process.env, { credentials = true } = {}) {
  if (mode === 'unsigned') return { mode };
  if (mode !== 'azure') throw new Error('Windows signing mode must be unsigned or azure');
  const endpoint = required(env, 'INTENT_WINDOWS_AZURE_ENDPOINT');
  if (!/^https:\/\/[a-z0-9-]+\.codesigning\.azure\.net\/?$/.test(endpoint)) {
    throw new Error('Invalid INTENT_WINDOWS_AZURE_ENDPOINT (expected regional HTTPS endpoint)');
  }
  const codeSigningAccountName = required(env, 'INTENT_WINDOWS_AZURE_ACCOUNT_NAME');
  const certificateProfileName = required(env, 'INTENT_WINDOWS_AZURE_CERTIFICATE_PROFILE_NAME');
  for (const [name, value] of [
    ['INTENT_WINDOWS_AZURE_ACCOUNT_NAME', codeSigningAccountName],
    ['INTENT_WINDOWS_AZURE_CERTIFICATE_PROFILE_NAME', certificateProfileName],
  ]) {
    if (!/^[a-zA-Z0-9-]+$/.test(value)) throw new Error(`Invalid ${name}`);
  }
  const publisherName = required(env, 'INTENT_WINDOWS_PUBLISHER_NAME');
  // A separately confirmed complete certificate subject prevents accepting a
  // different organization merely because its certificate has a matching CN.
  const subject = required(env, 'INTENT_WINDOWS_PUBLISHER_SUBJECT');
  if (!subject.startsWith('CN=') || !subject.includes(', ')) {
    throw new Error('Invalid INTENT_WINDOWS_PUBLISHER_SUBJECT (expected full certificate subject)');
  }
  if (credentials) {
    for (const name of ['AZURE_TENANT_ID', 'AZURE_CLIENT_ID']) {
      if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(required(env, name))) {
        throw new Error(`Invalid ${name}`);
      }
    }
    required(env, 'AZURE_CLIENT_SECRET');
  }
  return {
    mode,
    identity: { publisherName, subject },
    azureSignOptions: {
      publisherName,
      endpoint,
      codeSigningAccountName,
      certificateProfileName,
      fileDigest: 'SHA256',
      timestampDigest: 'SHA256',
      timestampRfc3161: 'http://timestamp.acs.microsoft.com',
    },
  };
}

function manualWindowsConfig(base, signing) {
  const config = structuredClone(base);
  config.win.verifyUpdateCodeSignature = true;
  delete config.win.azureSignOptions;
  if (signing.mode === 'azure') {
    delete config.win.signtoolOptions;
    config.win.azureSignOptions = signing.azureSignOptions;
    config.win.signExecutable = true;
    config.forceCodeSigning = true;
  } else {
    config.win.signExecutable = false;
    config.forceCodeSigning = false;
  }
  return config;
}

// Reports every absent setting at once (resolveWindowsSigning stops at the first),
// then any format error. Secrets are judged by presence alone so their values never
// need to reach the preflight job.
function windowsSigningPreflight(env, { secretsPresent = {} } = {}) {
  const missing = [
    ...WINDOWS_SIGNING_VARIABLES.filter((name) => !nonblank(env[name])).map(
      (name) => `repository variable ${name}`,
    ),
    ...WINDOWS_SIGNING_SECRETS.filter((name) => secretsPresent[name] !== true).map(
      (name) => `repository secret ${name}`,
    ),
  ];
  if (missing.length) return { missing, invalid: null };
  const placeholders = Object.fromEntries(WINDOWS_SIGNING_SECRETS.map((name) => [name, 'present']));
  try {
    resolveWindowsSigning('azure', { ...env, ...placeholders });
  } catch (error) {
    return { missing, invalid: error.message };
  }
  return { missing, invalid: null };
}

module.exports = {
  WINDOWS_SIGNING_VARIABLES,
  WINDOWS_SIGNING_SECRETS,
  resolveWindowsSigning,
  manualWindowsConfig,
  windowsSigningPreflight,
};
