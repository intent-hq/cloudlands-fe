// Ported branches of renderers/ContentFieldCatalogPreview.svelte.
import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { InputMessage } from '@/components/ui/input-message';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import type { UiComponentFixture } from '$lib/components/ui/component-metadata';
const longText =
  'A deliberately long piece of editorial content that remains readable without overflowing a compact catalog viewport.';
export function ContentCatalogPreview({
  componentId,
  fixture,
}: {
  componentId: string;
  fixture: UiComponentFixture;
}) {
  const [inputValue, setInputValue] = useState('');
  const [textareaValue, setTextareaValue] = useState('');
  return (
    <div
      className="grid w-full min-w-0 max-w-2xl grid-cols-1 gap-4 overflow-hidden"
      data-catalog-renderer-fixture={fixture.id}
    >
      {componentId === 'input' && (
        <>
          <div
            className="grid gap-3"
            data-catalog-rendered-state="default rest hover focus empty placeholder described keyboard-focus light dark compact-28 medium-32 large-36 zoom-200 reduced-motion"
          >
            <Label htmlFor="catalog-input">Project name</Label>
            <Input
              id="catalog-input"
              value={inputValue}
              onChange={(event) => setInputValue(event.target.value)}
              placeholder="Enter a project name"
              aria-describedby="catalog-input-help"
            />
            <p id="catalog-input-help" className="text-xs text-muted-foreground">
              A stable host-independent description.
            </p>
            <Input aria-label="Compact input" className="h-(--control-height-small)" />
            <Input
              aria-label="Large input"
              className="h-(--control-height-large)"
              defaultValue="Large value"
            />
            <Input aria-label="Hover input" data-state="hover" defaultValue="Hover" />
            <Input aria-label="Focus input" data-state="focus" defaultValue="Focus" />
          </div>
          <div
            className="grid gap-3"
            data-catalog-rendered-state="disabled read-only invalid error"
          >
            <Input aria-label="Disabled input" disabled defaultValue="Disabled" />
            <Input aria-label="Read-only input" readOnly defaultValue="Read only" />
            <Input aria-label="Invalid input" error="Needs review" defaultValue="Invalid" />
          </div>
          <div data-catalog-rendered-state="file">
            <Input type="file" aria-label="Catalog file input" />
          </div>
          <div data-catalog-rendered-state="long-content">
            <Input aria-label="Long input" defaultValue={longText} />
          </div>
        </>
      )}
      {componentId === 'textarea' && (
        <>
          <div
            className="grid gap-3"
            data-catalog-rendered-state="default rest hover focus empty placeholder described auto-expand keyboard-focus light dark compact zoom-200 reduced-motion"
          >
            <Label htmlFor="catalog-textarea">Workspace summary</Label>
            <Textarea
              id="catalog-textarea"
              value={textareaValue}
              onChange={(event) => setTextareaValue(event.target.value)}
              placeholder="Describe this workspace"
              doesExpandToFit
              minHeight={80}
              maxHeight={120}
            />
            <Textarea aria-label="Hover textarea" data-state="hover" defaultValue="Hover" />
            <Textarea aria-label="Focus textarea" data-state="focus" defaultValue="Focus" />
          </div>
          <div
            className="grid gap-3"
            data-catalog-rendered-state="disabled read-only invalid error"
          >
            <Textarea aria-label="Disabled textarea" disabled defaultValue="Disabled" />
            <Textarea aria-label="Read-only textarea" readOnly defaultValue="Read only" />
            <Textarea aria-label="Invalid textarea" error="Needs review" defaultValue="Invalid" />
          </div>
          <div data-catalog-rendered-state="max-height-scroll long-content">
            <Textarea
              aria-label="Long textarea"
              doesExpandToFit
              minHeight={80}
              maxHeight={96}
              defaultValue={`${longText} ${longText}`}
            />
          </div>
        </>
      )}
      {componentId === 'input-message' && (
        <>
          <div data-catalog-rendered-state="helper light dark reduced-motion">
            <Label htmlFor="message-helper">Project name</Label>
            <Input id="message-helper" aria-describedby="message-helper-text" />
            <InputMessage id="message-helper-text">
              Use a name your team will recognize.
            </InputMessage>
          </div>
          <div data-catalog-rendered-state="error">
            <Label htmlFor="message-error">Project name</Label>
            <Input id="message-error" aria-invalid="true" aria-describedby="message-error-text" />
            <InputMessage id="message-error-text" tone="error">
              Enter a project name.
            </InputMessage>
          </div>
          <div data-catalog-rendered-state="success">
            <Label htmlFor="message-success">Project name</Label>
            <Input
              id="message-success"
              defaultValue="Design system"
              aria-describedby="message-success-text"
            />
            <InputMessage id="message-success-text">This name is available.</InputMessage>
          </div>
        </>
      )}
      {componentId === 'label' && (
        <>
          <div
            className="grid gap-3"
            data-catalog-rendered-state="default rest required optional long-content compact zoom-200 light dark"
          >
            <Label htmlFor="required-field">Required project name *</Label>
            <Input id="required-field" required />
            <Label htmlFor="optional-field">Optional supporting detail</Label>
            <Input id="optional-field" />
            <Label htmlFor="long-label">{longText}</Label>
            <Input id="long-label" />
            <Label htmlFor="hover-label" data-state="hover">
              Hover label
            </Label>
            <Input id="hover-label" />
            <Label htmlFor="focus-label" data-state="focus">
              Focus label
            </Label>
            <Input id="focus-label" />
          </div>
          <div
            className="group grid gap-2"
            data-disabled="true"
            data-catalog-rendered-state="disabled hover focus"
          >
            <Label htmlFor="disabled-field">Disabled field</Label>
            <Input id="disabled-field" disabled />
          </div>
          <div className="group grid gap-2" data-invalid="true" data-catalog-rendered-state="error">
            <Label htmlFor="error-field" invalid>
              Error field
            </Label>
            <Input id="error-field" error="Required" />
          </div>
        </>
      )}
      {componentId === 'separator' && (
        <>
          <div
            className="grid gap-4"
            data-catalog-rendered-state="horizontal decorative compact zoom-200 light dark"
          >
            <Separator decorative />
          </div>
          <div
            className="flex h-12 items-stretch gap-3"
            data-catalog-rendered-state="vertical semantic"
          >
            <span>Before</span>
            <Separator orientation="vertical" decorative={false} />
            <span>After</span>
          </div>
        </>
      )}
      {componentId === 'skeleton' && (
        <>
          <output
            className="grid gap-3"
            aria-label="Loading preview"
            data-catalog-rendered-state="default line card shimmer compact zoom-200 light dark reduced-motion"
          >
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-3/4" />
            <Skeleton className="h-20 w-full" />
          </output>
          <div data-catalog-rendered-state="avatar">
            <Skeleton className="size-8 rounded-full" />
          </div>
        </>
      )}
    </div>
  );
}
