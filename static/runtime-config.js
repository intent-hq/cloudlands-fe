// Deployments may replace this same-origin asset with a non-cacheable,
// access-controlled response that assigns { intentdWsUrl: "wss://..." }.
// Never commit credentials here: production Vite bundles intentionally omit them.
globalThis.__INTENT_RUNTIME_CONFIG__ ??= Object.freeze({});
