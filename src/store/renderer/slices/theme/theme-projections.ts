import type { ThemeState } from './theme-types';

export const getIsDarkTheme = (state: { theme: ThemeState }): boolean =>
  state.theme.name === 'dark';
