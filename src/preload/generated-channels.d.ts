/**
 * Type of the channel gate that scripts/inline-ipc-channels.ts generates into
 * src/preload/index.ts, so the template type-checks without carrying a copy of
 * the channel lists. The lists themselves live only in
 * src/shared/ipc-registry.ts; the generated module-scoped function shadows this
 * declaration in the real build.
 */
declare function isChannelAllowed(channel: string): boolean;
