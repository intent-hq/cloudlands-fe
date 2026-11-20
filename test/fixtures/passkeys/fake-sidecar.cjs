#!/usr/bin/env node
// Scripted stand-in for `intent-passkey --stdio` (spec §11). Every request is
// appended to FAKE_PASSKEY_LOG. Hybrid ceremonies wait for the file
// `<FAKE_PASSKEY_LOG>.proceed` so the test can capture the QR step.
// PIN rules (USB): "0000" is wrong (3 tries left), "9999" locks the key,
// anything else is accepted. While `<FAKE_PASSKEY_LOG>.tamper` exists, the
// returned clientDataJSON names another origin.
// With FAKE_PASSKEY_DEVICE=1 the "device" transport keeps passkeys in memory.
// Device PIN rules: "1111" is wrong, "2222" starts a 1.5 s wait, "3333"
// locks device passkeys, "4444" is a changed PIN (asks for the old PIN, which
// is "5555"), anything else is accepted. A get with more than one passkey for
// the site asks to choose an account after the PIN.
const fs = require('node:fs');
const { createHash, randomBytes } = require('node:crypto');
const readline = require('node:readline');

const log = process.env.FAKE_PASSKEY_LOG;
const bluetooth = process.env.FAKE_PASSKEY_BLUETOOTH || 'on';
const deviceEnabled = process.env.FAKE_PASSKEY_DEVICE === '1';
const ceremonies = new Map();
const deviceStore = [];
let deviceAttempts = 10;

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

function finishDevice(ceremony, credential) {
  const { id, method, params } = ceremony;
  ceremonies.delete(id);
  if (method === 'create') {
    write({
      id,
      result: {
        clientDataJSON: clientDataJSON(method, params),
        credentialId: credential.credentialId,
        attestationObject: b64(randomBytes(64)),
        authenticatorData: b64(authenticatorData(params.rpId)),
        publicKey: b64(randomBytes(91)),
        publicKeyAlgorithm: -7,
        transports: ['internal'],
        authenticatorAttachment: 'platform',
        extensions: { credProps: { rk: true } },
      },
    });
  } else {
    credential.lastUsedAt = Date.now();
    write({
      id,
      result: {
        clientDataJSON: clientDataJSON(method, params),
        credentialId: credential.credentialId,
        authenticatorData: b64(authenticatorData(params.rpId)),
        signature: b64(randomBytes(70)),
        userHandle: credential.userHandle,
        authenticatorAttachment: 'platform',
      },
    });
  }
}

function askDevicePin(ceremony, extra = {}) {
  write({
    event: 'pin-needed',
    ceremony: ceremony.id,
    kind: 'device',
    attemptsLeft: deviceAttempts,
    wrongPin: false,
    ...extra,
  });
}

function startDevice(ceremony) {
  const { params, method } = ceremony;
  if (method === 'create') {
    const excluded = (params.excludeCredentials || []).some((entry) =>
      deviceStore.some((stored) => stored.credentialId === entry.id),
    );
    if (excluded) {
      fail(ceremony.id, 'InvalidState');
      return;
    }
  }
  askDevicePin(ceremony);
}

function afterDevicePin(ceremony) {
  write({ event: 'status', ceremony: ceremony.id, state: 'processing' });
  const { params } = ceremony;
  if (ceremony.method === 'create') {
    const credential = {
      credentialId: b64(randomBytes(16)),
      rpId: params.rpId,
      userName: params.user.name,
      userDisplayName: params.user.displayName,
      userHandle: params.user.id,
      createdAt: Date.now(),
      lastUsedAt: null,
    };
    deviceStore.push(credential);
    finishDevice(ceremony, credential);
    return;
  }
  const candidates = deviceStore.filter((stored) => stored.rpId === params.rpId);
  if (candidates.length === 0) {
    fail(ceremony.id, 'NotAllowed');
  } else if (candidates.length === 1) {
    finishDevice(ceremony, candidates[0]);
  } else {
    ceremony.candidates = candidates;
    write({
      event: 'choose-account',
      ceremony: ceremony.id,
      accounts: candidates.map((stored, index) => ({
        index,
        userName: stored.userName,
        userDisplayName: stored.userDisplayName,
      })),
    });
  }
}

function devicePin(ceremony, pin) {
  if (ceremony.waitUntil && Date.now() < ceremony.waitUntil) {
    askDevicePin(ceremony, { wrongPin: true, retryAfterMs: ceremony.waitUntil - Date.now() });
    return;
  }
  if (ceremony.askedOldPin) {
    if (pin === '5555') afterDevicePin(ceremony);
    else fail(ceremony.id, 'NotAllowed');
    return;
  }
  if (pin === '3333') {
    fail(ceremony.id, 'PinLocked');
  } else if (pin === '1111') {
    deviceAttempts -= 1;
    askDevicePin(ceremony, { wrongPin: true });
  } else if (pin === '2222') {
    deviceAttempts -= 1;
    ceremony.waitUntil = Date.now() + 1500;
    askDevicePin(ceremony, { wrongPin: true, retryAfterMs: 1500 });
  } else if (pin === '4444') {
    ceremony.askedOldPin = true;
    askDevicePin(ceremony, { oldPin: true });
  } else {
    deviceAttempts = 10;
    afterDevicePin(ceremony);
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
          transports: { hybrid: bluetooth === 'on', usb: true, device: deviceEnabled },
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
      else if (params.transport === 'device' && deviceEnabled) startDevice(ceremony);
      else if (params.transport === 'device') fail(id, 'NotSupported');
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
      if (ceremony.params.transport === 'device') {
        devicePin(ceremony, params.pin);
        return;
      }
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
      if (ceremony?.candidates) {
        const chosen = ceremony.candidates[params.index];
        if (chosen) finishDevice(ceremony, chosen);
        else fail(ceremony.id, 'NotAllowed');
      } else if (ceremony) {
        ceremony.account = params.index;
        finish(ceremony);
      }
      return;
    }
    case 'device.list':
      if (!deviceEnabled) {
        write({ id, error: { code: 'NotSupported', message: 'device' } });
        return;
      }
      write({
        id,
        result: {
          credentials: deviceStore.map(({ userHandle: _handle, ...entry }) => entry),
        },
      });
      return;
    case 'device.delete': {
      const index = deviceStore.findIndex((stored) => stored.credentialId === params.credentialId);
      if (index >= 0) deviceStore.splice(index, 1);
      write({ id, result: {} });
      return;
    }
    default:
      write({ id, error: { code: 'NotSupported', message: method } });
  }
});
