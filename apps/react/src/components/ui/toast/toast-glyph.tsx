import {
  CheckCircleIcon,
  ChatCircleDotsIcon,
  CircleNotchIcon,
  ConfettiIcon,
  DownloadSimpleIcon,
  InfoIcon,
  WarningCircleIcon,
  WarningIcon,
} from '@phosphor-icons/react';
import './toast-glyph.css';

export type ToastGlyphVariant =
  | 'success'
  | 'error'
  | 'warning'
  | 'info'
  | 'loading'
  | 'update'
  | 'celebrate'
  | 'discussion';

const glyphs = {
  success: CheckCircleIcon,
  error: WarningCircleIcon,
  warning: WarningIcon,
  info: InfoIcon,
  loading: CircleNotchIcon,
  update: DownloadSimpleIcon,
  celebrate: ConfettiIcon,
  discussion: ChatCircleDotsIcon,
};

export function ToastGlyph({ variant }: { variant: ToastGlyphVariant }) {
  const Icon = glyphs[variant];
  return (
    <span
      className={`toast-glyph toast-glyph-${variant}`}
      data-toast-glyph={variant}
      aria-hidden="true"
    >
      <Icon
        size={16}
        weight={['loading', 'update', 'discussion'].includes(variant) ? 'regular' : 'fill'}
        aria-hidden="true"
      />
    </span>
  );
}
