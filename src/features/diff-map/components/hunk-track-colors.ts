export const HUNK_TRACK_COLOR_ROLES = {
  background: 'muted',
  old: 'danger',
  new: 'success',
} as const;

export function hunkTrackColor(role: keyof typeof HUNK_TRACK_COLOR_ROLES) {
  return `hsl(var(--${HUNK_TRACK_COLOR_ROLES[role]}))`;
}
