import { contextBridge, ipcRenderer } from 'electron';

// Frame preload for the browser-panel session (Linux only; registered by
// src/features/passkeys/main/passkeys.ipc.ts). A sandboxed preload cannot
// require app modules, so the channels are literal; a test checks them
// against IPC_CHANNELS.PASSKEYS. The page gets only these three calls, and
// main takes the origin from the calling frame, never from the request.
const PAGE_CREATE = 'passkeys:page-create';
const PAGE_GET = 'passkeys:page-get';
const PAGE_CANCEL = 'passkeys:page-cancel';

export interface PasskeyPageBridge {
  create(request: unknown): Promise<unknown>;
  get(request: unknown): Promise<unknown>;
  cancel(requestId: string): Promise<unknown>;
}

const bridge: PasskeyPageBridge = {
  create: (request) => ipcRenderer.invoke(PAGE_CREATE, request),
  get: (request) => ipcRenderer.invoke(PAGE_GET, request),
  cancel: (requestId) => ipcRenderer.invoke(PAGE_CANCEL, { requestId }),
};

/**
 * Runs in the page's main world (serialized by executeInMainWorld): it must
 * not reference anything outside its own body.
 */
export function installPasskeyShim(bridge: PasskeyPageBridge): void {
  const w = globalThis as any;
  const container = w.CredentialsContainer?.prototype;
  if (!container || typeof w.PublicKeyCredential !== 'function') return;
  const nativeCreate = container.create;
  const nativeGet = container.get;

  const bytesOf = (source: any): Uint8Array =>
    ArrayBuffer.isView(source)
      ? new Uint8Array(source.buffer, source.byteOffset, source.byteLength)
      : new Uint8Array(source);
  const isBufferSource = (value: unknown) =>
    value instanceof ArrayBuffer || ArrayBuffer.isView(value);
  const encode = (source: any): string => {
    const bytes = bytesOf(source);
    let text = '';
    for (let i = 0; i < bytes.length; i++) text += String.fromCharCode(bytes[i]);
    return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  };
  const decode = (text: string): ArrayBuffer => {
    const base64 = text.replace(/-/g, '+').replace(/_/g, '/');
    const binary = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes.buffer;
  };
  const buffer = (value: unknown, name: string): string => {
    if (!isBufferSource(value)) throw new TypeError(`${name} must be a BufferSource.`);
    return encode(value);
  };
  const text = (value: unknown, name: string): string => {
    if (typeof value !== 'string') throw new TypeError(`${name} must be a string.`);
    return value;
  };
  const optionalText = (value: unknown) => (typeof value === 'string' ? value : undefined);
  const descriptors = (list: unknown, name: string) => {
    if (list === undefined) return [];
    if (!Array.isArray(list)) throw new TypeError(`${name} must be a sequence.`);
    return list.map((item: any) => ({
      id: buffer(item?.id, `${name}.id`),
      ...(Array.isArray(item?.transports) ? { transports: item.transports.map(String) } : {}),
    }));
  };
  const timeout = (value: unknown) =>
    typeof value === 'number' && Number.isFinite(value) ? value : undefined;

  const createRequest = (options: any) => {
    if (!options?.rp || typeof options.rp !== 'object') throw new TypeError('rp is required.');
    if (!options.user || typeof options.user !== 'object') {
      throw new TypeError('user is required.');
    }
    const userId = buffer(options.user.id, 'user.id');
    const userIdLength = bytesOf(options.user.id).byteLength;
    if (userIdLength < 1 || userIdLength > 64) {
      throw new TypeError('user.id must be between 1 and 64 bytes.');
    }
    if (!Array.isArray(options.pubKeyCredParams)) {
      throw new TypeError('pubKeyCredParams is required.');
    }
    const selection = options.authenticatorSelection ?? {};
    return {
      challenge: buffer(options.challenge, 'challenge'),
      rp: { id: optionalText(options.rp.id), name: text(options.rp.name, 'rp.name') },
      user: {
        id: userId,
        name: text(options.user.name, 'user.name'),
        displayName: text(options.user.displayName, 'user.displayName'),
      },
      pubKeyCredParams: options.pubKeyCredParams
        .filter((param: any) => param?.type === 'public-key')
        .map((param: any) => ({ type: 'public-key', alg: Number(param.alg) })),
      excludeCredentials: descriptors(options.excludeCredentials, 'excludeCredentials'),
      authenticatorSelection: {
        residentKey: optionalText(selection.residentKey),
        requireResidentKey: selection.requireResidentKey === true,
        userVerification: optionalText(selection.userVerification),
        authenticatorAttachment: optionalText(selection.authenticatorAttachment),
      },
      attestation: optionalText(options.attestation),
      extensions: { credProps: options.extensions?.credProps === true },
      timeout: timeout(options.timeout),
    };
  };

  const getRequest = (options: any) => ({
    challenge: buffer(options.challenge, 'challenge'),
    rpId: optionalText(options.rpId),
    allowCredentials: descriptors(options.allowCredentials, 'allowCredentials'),
    userVerification: optionalText(options.userVerification),
    timeout: timeout(options.timeout),
  });

  const define = (target: object, values: Record<string, unknown>) => {
    for (const [key, value] of Object.entries(values)) {
      Object.defineProperty(target, key, { value, enumerable: true, configurable: true });
    }
    return target;
  };
  const instance = (constructor: any) =>
    typeof constructor === 'function' ? Object.create(constructor.prototype) : {};

  const credentialFrom = (result: any) => {
    const rawId = decode(result.id);
    const clientDataJSON = decode(result.clientDataJSON);
    const authenticatorData = decode(result.authenticatorData);
    const extensions = result.clientExtensionResults ?? {};
    let response: object;
    let responseJSON: Record<string, unknown>;
    if (result.kind === 'create') {
      const attestationObject = decode(result.attestationObject);
      const publicKey = result.publicKey ? decode(result.publicKey) : null;
      const transports: string[] = [...result.transports];
      response = define(instance(w.AuthenticatorAttestationResponse), {
        clientDataJSON,
        attestationObject,
        getTransports: () => [...transports],
        getAuthenticatorData: () => authenticatorData.slice(0),
        getPublicKey: () => (publicKey ? publicKey.slice(0) : null),
        getPublicKeyAlgorithm: () => result.publicKeyAlgorithm,
      });
      responseJSON = {
        clientDataJSON: result.clientDataJSON,
        authenticatorData: result.authenticatorData,
        transports: [...transports],
        ...(result.publicKey ? { publicKey: result.publicKey } : {}),
        publicKeyAlgorithm: result.publicKeyAlgorithm,
        attestationObject: result.attestationObject,
      };
    } else {
      const userHandle = result.userHandle ? decode(result.userHandle) : null;
      response = define(instance(w.AuthenticatorAssertionResponse), {
        clientDataJSON,
        authenticatorData,
        signature: decode(result.signature),
        userHandle,
      });
      responseJSON = {
        clientDataJSON: result.clientDataJSON,
        authenticatorData: result.authenticatorData,
        signature: result.signature,
        ...(result.userHandle ? { userHandle: result.userHandle } : {}),
      };
    }
    return define(instance(w.PublicKeyCredential), {
      id: result.id,
      rawId,
      type: 'public-key',
      authenticatorAttachment: result.authenticatorAttachment,
      response,
      getClientExtensionResults: () => JSON.parse(JSON.stringify(extensions)),
      toJSON: () => ({
        id: result.id,
        rawId: result.id,
        type: 'public-key',
        authenticatorAttachment: result.authenticatorAttachment,
        clientExtensionResults: JSON.parse(JSON.stringify(extensions)),
        response: responseJSON,
      }),
    });
  };

  const abortReason = (signal: AbortSignal | undefined) =>
    signal?.reason ?? new DOMException('The operation was aborted.', 'AbortError');
  const newRequestId = () =>
    typeof w.crypto?.randomUUID === 'function'
      ? w.crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  const run = (kind: 'create' | 'get', publicKey: object, signal: AbortSignal | undefined) =>
    new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(abortReason(signal));
        return;
      }
      const requestId = newRequestId();
      let settled = false;
      const onAbort = () => {
        if (settled) return;
        settled = true;
        void bridge.cancel(requestId).catch(() => {});
        reject(abortReason(signal));
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      bridge[kind]({ requestId, publicKey }).then(
        (result: any) => {
          signal?.removeEventListener('abort', onAbort);
          if (settled) return;
          settled = true;
          if (result?.ok) {
            resolve(credentialFrom(result.credential));
          } else if (result?.name === 'TypeError') {
            reject(new TypeError(String(result.message)));
          } else {
            reject(
              new DOMException(
                String(result?.message ?? 'The operation failed.'),
                String(result?.name ?? 'NotAllowedError'),
              ),
            );
          }
        },
        () => {
          signal?.removeEventListener('abort', onAbort);
          if (settled) return;
          settled = true;
          reject(new DOMException('The operation failed.', 'NotAllowedError'));
        },
      );
    });

  const methods: Record<string, unknown> = {
    create(this: unknown, options?: any) {
      if (!options?.publicKey) return nativeCreate.call(this, options);
      try {
        return run('create', createRequest(options.publicKey), options.signal);
      } catch (error) {
        return Promise.reject(error);
      }
    },
    get(this: unknown, options?: any) {
      if (!options?.publicKey) return nativeGet.call(this, options);
      if (options.mediation === 'conditional') {
        // No passkey autofill: wait like a browser without a matching credential.
        return new Promise((_resolve, reject) => {
          const signal: AbortSignal | undefined = options.signal;
          if (signal?.aborted) reject(abortReason(signal));
          else signal?.addEventListener('abort', () => reject(abortReason(signal)), { once: true });
        });
      }
      try {
        return run('get', getRequest(options.publicKey), options.signal);
      } catch (error) {
        return Promise.reject(error);
      }
    },
  };
  for (const [name, value] of Object.entries(methods)) {
    Object.defineProperty(container, name, { value, writable: true, configurable: true });
  }

  const capabilities = {
    conditionalCreate: false,
    conditionalGet: false,
    hybridTransport: true,
    passkeyPlatformAuthenticator: false,
    userVerifyingPlatformAuthenticator: false,
    relatedOrigins: false,
    signalAllAcceptedCredentials: false,
    signalCurrentUserDetails: false,
    signalUnknownCredential: false,
    'extension:credProps': true,
  };
  const statics: Record<string, () => Promise<unknown>> = {
    isUserVerifyingPlatformAuthenticatorAvailable: () => Promise.resolve(false),
    isConditionalMediationAvailable: () => Promise.resolve(false),
    getClientCapabilities: () => Promise.resolve({ ...capabilities }),
  };
  for (const [name, value] of Object.entries(statics)) {
    Object.defineProperty(w.PublicKeyCredential, name, {
      value,
      writable: true,
      configurable: true,
    });
  }
}

contextBridge.executeInMainWorld({ func: installPasskeyShim, args: [bridge] });
