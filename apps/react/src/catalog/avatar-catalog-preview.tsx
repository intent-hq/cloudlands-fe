// Source: PrincipalAvatarCatalogPreview.svelte, partial tile-states. Colored fill and presence stacks remain unported.
// i18n-ignore (reference catalog fixture content)
import { PrincipalAvatar } from '@/components/ui/principal-avatar';
import type { UiComponentFixture } from '$lib/components/ui/component-metadata';
const failingUrl = 'https://avatar.invalid/missing.png';
const rows = [
  ['No URL', null],
  ['Failing URL', failingUrl],
] as const;
export function AvatarCatalogPreview({ fixture }: { fixture: UiComponentFixture }) {
  if (fixture.id !== 'tile-states')
    return (
      <p data-catalog-unimplemented={fixture.id}>
        This reference fixture requires the unported presence avatar stack.
      </p>
    );
  return (
    <div
      className="flex min-w-0 max-w-full flex-wrap items-center gap-3"
      data-catalog-renderer-fixture={fixture.id}
    >
      <div
        className="grid min-w-0 gap-4"
        data-catalog-rendered-state="no-url failing-url size-16 size-24 size-32 empty-label"
      >
        <p className="type-caption text-muted-foreground">
          Rows: no URL, a failed image. Columns: 16, 24, and 32 px.
        </p>
        {rows.map(([caption, avatarUrl]) => (
          <div key={caption} className="flex items-center gap-3">
            <span className="type-caption w-24 text-muted-foreground">{caption}</span>
            {[16, 24, 32].map((size) => (
              <span key={size} data-catalog-fail={avatarUrl === failingUrl || undefined}>
                <PrincipalAvatar avatarUrl={avatarUrl} label="Ada Lovelace" size={size} />
              </span>
            ))}
          </div>
        ))}
        <div className="flex items-center gap-3">
          <span className="type-caption w-24 text-muted-foreground">Empty label</span>
          <span>
            <PrincipalAvatar avatarUrl={null} label="" size={24} />
          </span>
        </div>
        <p data-catalog-unimplemented="fill">
          The colored fill fixture requires the unported presence identity color helper.
        </p>
      </div>
    </div>
  );
}
