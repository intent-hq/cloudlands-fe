import { selectIsDarkTheme } from '@/store/theme/theme-selectors';
import linearDark from '../../../../../src/assets/logos/linear-dark.svg?url';
import linearLight from '../../../../../src/assets/logos/linear-light.svg?url';

interface LinearIconProps {
  size?: number;
  className?: string;
}

export function LinearIcon({ size = 16, className = '' }: LinearIconProps) {
  const isDarkTheme = selectIsDarkTheme();
  // i18n-ignore (brand name)
  const altText = 'Linear';

  return (
    <img
      src={isDarkTheme.value ? linearLight : linearDark}
      alt={altText}
      width={size}
      height={size}
      className={className}
    />
  );
}
