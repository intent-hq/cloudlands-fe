// Port of CatalogControls.svelte. Keep the reference's developer specimen labels.
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectGroup,
  SelectItem,
} from '@/components/ui/select';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { themePresets } from '$lib/utils/theme-presets';
import { m } from '$shared/paraglide/messages.js';
import {
  catalogColorThemes,
  type CatalogColorTheme,
  type CatalogMotion,
  type CatalogTheme,
} from './catalog-preferences';
import './catalog-controls.css';

export interface CatalogControlsProps {
  theme: CatalogTheme;
  colorTheme: CatalogColorTheme;
  resolvedTheme: 'light' | 'dark';
  motion: CatalogMotion;
  width?: number;
  density: 'default' | 'compact';
  radius: 'rounded' | 'square';
  onThemeChange: (value: CatalogTheme) => void;
  onColorThemeChange: (value: CatalogColorTheme) => void;
  onMotionChange: (value: CatalogMotion) => void;
  onWidthChange: (value: number | undefined) => void;
  onDensityChange: (value: 'default' | 'compact') => void;
  onRadiusChange: (value: 'rounded' | 'square') => void;
}

const themeOptions = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'System' },
] as const;
const colorThemeOptions = [
  { value: 'default', label: 'Default' },
  ...themePresets.map(({ id, label }) => ({ value: id, label })),
];

export function CatalogControls(props: CatalogControlsProps) {
  const { theme, colorTheme, resolvedTheme, motion, width, density, radius } = props;
  const widthOptions = [
    { value: 'auto', label: 'Responsive' },
    ...(!width || [320, 420, 680, 960].includes(width)
      ? []
      : [{ value: String(width), label: `${width}px` }]),
    ...[320, 420, 680, 960].map((value) => ({ value: String(value), label: `${value}px` })),
  ];
  return (
    <div className="catalog-controls" aria-label="Catalog display controls">
      <h2>Make them yours</h2>
      <div className="control-set">
        <span id="catalog-color-theme-label" className="control-label">
          Color theme
        </span>
        <div className="color-theme-dropdown">
          <Select
            value={colorTheme}
            items={colorThemeOptions}
            onValueChange={(value) => {
              if (catalogColorThemes.includes(value as CatalogColorTheme))
                props.onColorThemeChange(value as CatalogColorTheme);
            }}
          >
            <SelectTrigger
              aria-labelledby="catalog-color-theme-label"
              data-testid="catalog-color-theme-control"
              data-catalog-control="color-theme"
              className="color-theme-select"
            >
              <span className="truncate">
                {colorThemeOptions.find((option) => option.value === colorTheme)?.label ??
                  colorThemeOptions[0]!.label}
              </span>
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {colorThemeOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="control-set">
        <span id="catalog-theme-label" className="control-label">
          Theme
        </span>
        <ToggleGroup
          type="single"
          value={theme}
          onValueChange={(value) => {
            if (value) props.onThemeChange(value as CatalogTheme);
          }}
          size="sm"
          aria-labelledby="catalog-theme-label"
          aria-describedby="catalog-theme-status"
          data-testid="catalog-theme-control"
          data-catalog-control="theme"
        >
          {themeOptions.map((option) => (
            <ToggleGroupItem key={option.value} value={option.value} className="control-choice">
              {option.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <output id="catalog-theme-status" className="sr-only" aria-live="polite">
          {theme === 'system'
            ? `System theme selected, currently ${resolvedTheme}`
            : `${theme === 'light' ? 'Light' : 'Dark'} theme selected`}
        </output>
      </div>
      <div className="control-set" data-testid="catalog-motion-control">
        <span id="catalog-motion-label" className="control-label">
          {m.sandbox_catalog_motion_label()}
        </span>
        <ToggleGroup
          type="single"
          value={motion}
          onValueChange={(value) => {
            if (value) props.onMotionChange(value as CatalogMotion);
          }}
          size="sm"
          aria-labelledby="catalog-motion-label"
          data-catalog-control="motion"
        >
          <ToggleGroupItem value="system" className="control-choice">
            {m.sandbox_catalog_motionSystem_label()}
          </ToggleGroupItem>
          <ToggleGroupItem value="full" className="control-choice">
            {m.sandbox_catalog_motionFull_label()}
          </ToggleGroupItem>
          <ToggleGroupItem value="reduced" className="control-choice">
            {m.sandbox_catalog_motionReduced_label()}
          </ToggleGroupItem>
        </ToggleGroup>
      </div>
      <div className="control-set">
        <span id="catalog-size-label" className="control-label">
          Size
        </span>
        <ToggleGroup
          type="single"
          value={density}
          onValueChange={(value) => {
            if (value === 'default' || value === 'compact') props.onDensityChange(value);
          }}
          size="sm"
          aria-labelledby="catalog-size-label"
          data-catalog-control="size"
        >
          <ToggleGroupItem value="default" className="control-choice">
            Default
          </ToggleGroupItem>
          <ToggleGroupItem value="compact" className="control-choice">
            Compact
          </ToggleGroupItem>
        </ToggleGroup>
      </div>
      <div className="control-set">
        <span id="catalog-radius-label" className="control-label">
          Radius
        </span>
        <ToggleGroup
          type="single"
          value={radius}
          onValueChange={(value) => {
            if (value === 'rounded' || value === 'square') props.onRadiusChange(value);
          }}
          size="sm"
          aria-labelledby="catalog-radius-label"
          data-catalog-control="radius"
        >
          <ToggleGroupItem value="rounded" className="control-choice">
            Rounded
          </ToggleGroupItem>
          <ToggleGroupItem value="square" className="control-choice">
            Square
          </ToggleGroupItem>
        </ToggleGroup>
      </div>
      <div className="control-set">
        <span id="catalog-width-label" className="control-label">
          Preview
        </span>
        <div className="color-theme-dropdown">
          <Select
            value={width ? String(width) : 'auto'}
            items={widthOptions}
            onValueChange={(value) =>
              props.onWidthChange(value === 'auto' ? undefined : Number(value))
            }
          >
            <SelectTrigger aria-labelledby="catalog-width-label" data-catalog-control="width">
              <SelectValue placeholder="Responsive" />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {widthOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  );
}
