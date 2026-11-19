#!/usr/bin/env node
// Scripted stand-in for `intent-passkey --stdio` (spec §11). Every request is
// appended to FAKE_PASSKEY_LOG. Hybrid ceremonies wait for the file
// `<FAKE_PASSKEY_LOG>.proceed` so the test can capture the QR step.
// PIN rules (USB): "0000" is wrong (3 tries left), "9999" locks the key,
// anything else is accepted. While `<FAKE_PASSKEY_LOG>.tamper` exists, the
// returned clientDataJSON names another origin.
const fs = require('node:fs');
const { createHash, randomBytes } = require('node:crypto');
const readline = require('node:readline');

const log = process.env.FAKE_PASSKEY_LOG;
const bluetooth = process.env.FAKE_PASSKEY_BLUETOOTH || 'on';
const ceremonies = new Map();

const write = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);
const b64 = (bytes) => Buffer.from(bytes).toString('base64url');
const record = (request) => {
  if (log) fs.appendFileSync(log, `${JSON.stringify(request)}\n`);
};

function authenticatorData(rpId) {
  const rpIdHash = createHash('sha256').update(rpId).digest();
  return Buffer.concat([rpIdHash, Buffer.from([0x05, 0, 0, 0, 1])]);
}

function clientDataJSON(method, params) {
  const tampered = log && fs.existsSync(`${log}.tamper`);
  return b64(
    JSON.stringify({
      type: method === 'create' ? 'webauthn.create' : 'webauthn.get',
      challenge: params.challenge,
      origin: tampered ? 'https://evil.example' : params.origin,
      crossOrigin: params.crossOrigin,
    }),
  );
}

function finish(ceremony) {
  const { id, method, params } = ceremony;
  ceremonies.delete(id);
  const credentialId = b64(Buffer.from(`cred-${params.transport}`));
  if (method === 'create') {
    write({
      id,
      result: {
        clientDataJSON: clientDataJSON(method, params),
        credentialId,
        attestationObject: b64(randomBytes(64)),
        authenticatorData: b64(authenticatorData(params.rpId)),
        publicKey: b64(randomBytes(91)),
        publicKeyAlgorithm: -7,
        transports: params.transport === 'usb' ? ['usb'] : ['hybrid', 'internal'],
        authenticatorAttachment: 'cross-platform',
        extensions: { credProps: { rk: true } },
      },
    });
  } else {
    write({
      id,
      result: {
        clientDataJSON: clientDataJSON(method, params),
        credentialId,
        authenticatorData: b64(authenticatorData(params.rpId)),
        signature: b64(randomBytes(70)),
        userHandle: b64(Buffer.from(`user-${ceremony.account ?? 0}`)),
        authenticatorAttachment: 'cross-platform',
      },
    });
  }
}

function fail(id, code) {
  ceremonies.delete(id);
  write({ id, error: { code, message: code } });
}

function startHybrid(ceremony) {
  const { id } = ceremony;
  write({ event: 'qr', ceremony: id, data: `FIDO:/${'0123456789'.repeat(12)}` });
  write({ event: 'status', ceremony: id, state: 'waiting-for-phone' });
  ceremony.timer = setInterval(() => {
    if (!log || !fs.existsSync(`${log}.proceed`)) return;
    clearInterval(ceremony.timer);
    fs.rmSync(`${log}.proceed`, { force: true });
    write({ event: 'status', ceremony: id, state: 'connecting' });
    write({ event: 'status', ceremony: id, state: 'waiting-for-approval' });
    setTimeout(() => ceremonies.has(id) && finish(ceremony), 100);
  }, 50);
}

function startUsb(ceremony) {
  write({ event: 'status', ceremony: ceremony.id, state: 'touch-key' });
  setTimeout(() => {
    if (ceremonies.has(ceremony.id)) {
      write({ event: 'pin-needed', ceremony: ceremony.id, kind: 'usb', wrongPin: false });
    }
  }, 100);
}

readline.createInterface({ input: process.stdin }).on('line', (line) => {
  const request = JSON.parse(line);
  record(request);
  const { id, method, params } = request;
  switch (method) {
    case 'hello':
      write({
        id,
        result: {
          protocol: 1,
          version: 'fake',
          transports: { hybrid: bluetooth === 'on', usb: true, device: false },
          bluetooth,
        },
      });
      return;
    case 'create':
    case 'get': {
      if (ceremonies.size > 0) {
        write({ id, error: { code: 'NotAllowed', message: 'busy' } });
        return;
      }
      const ceremony = { id, method, params };
      ceremonies.set(id, ceremony);
      if (params.transport === 'hybrid') startHybrid(ceremony);
      else startUsb(ceremony);
      return;
    }
    case 'cancel': {
      const ceremony = ceremonies.get(params.ceremony);
      write({ id, result: {} });
      if (ceremony) {
        clearInterval(ceremony.timer);
        fail(ceremony.id, 'Abort');
      }
      return;
    }
    case 'pin': {
      write({ id, result: {} });
      const ceremony = ceremonies.get(params.ceremony);
      if (!ceremony) return;
      if (params.pin === '9999') {
        fail(ceremony.id, 'PinLocked');
      } else if (params.pin === '0000') {
        write({
          event: 'pin-needed',
          ceremony: ceremony.id,
          kind: 'usb',
          wrongPin: true,
          attemptsLeft: 3,
        });
      } else if (ceremony.method === 'get') {
        write({
          event: 'choose-account',
          ceremony: ceremony.id,
          accounts: [
            { index: 0, userName: 'ada@example.com', userDisplayName: 'Ada Lovelace' },
            { index: 1, userName: 'grace@example.com', userDisplayName: 'Grace Hopper' },
          ],
        });
      } else {
        finish(ceremony);
      }
      return;
    }
    case 'choose': {
      write({ id, result: {} });
      const ceremony = ceremonies.get(params.ceremony);
      if (ceremony) {
        ceremony.account = params.index;
        finish(ceremony);
      }
      return;
    }
    default:
      write({ id, error: { code: 'NotSupported', message: method } });
  }
});
