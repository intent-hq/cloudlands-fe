// Renderer compatibility entry point; remove after existing renderer consumers migrate to $shared/keyboard-shortcut-bindings.
// eslint-disable-next-line themis/pass-through-wrapper -- Preserve existing renderer imports during the native shared-source migration; remove with the final consumer migration.
export * from '$shared/keyboard-shortcut-bindings';
