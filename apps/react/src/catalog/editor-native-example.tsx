// Source APIs: PasteChip, SkillCommand, SlashSkillSuggestionList and MentionHoverPreview.
// There is no corresponding source sandbox page; this is an internal local editor caller.
// i18n-ignore (internal editor exercise content)
import { useMemo, useRef, useState } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { PasteChip } from '@/components/tiptap/paste-chip';
import { SkillCommand } from '$lib/components/tiptap/SkillCommand';
import { Button } from '@/components/ui/button';
import { ButtonGroup } from '@/components/ui/button-group';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { FormField } from '@/components/patterns/form';
import {
  SlashSkillSuggestionList,
  type SlashSkillSuggestionListHandle,
} from '@/features/chat/components/input/slash-skill-suggestion-list';
import { MentionHoverPreview } from '@/features/chat/components/input/mention-hover-preview';
import type { MentionCandidate } from '$lib/services/mentions/types';
import type { SkillInfo } from '../../../../src/store/renderer/slices/skills/skills-types';

const skills: SkillInfo[] = [
  {
    name: 'review',
    description: 'Review the selected changes.',
    location: 'internal/review/SKILL.md',
  },
  {
    name: 'summarize',
    description: 'Summarize the current document.',
    location: 'internal/summarize/SKILL.md',
  },
  {
    name: 'verify',
    description: 'Verify the current implementation.',
    location: 'internal/verify/SKILL.md',
  },
];
const mention: MentionCandidate = {
  id: 'local-example',
  type: 'file',
  label: 'example.ts',
  uri: 'example.ts',
  meta: { path: 'internal/example.ts' },
};

export function EditorNativeExample() {
  const [pasteText, setPasteText] = useState('First line\nSecond line\nThird line');
  const [snapshot, setSnapshot] = useState({ json: '', html: '', text: '' });
  const [query, setQuery] = useState('');
  const [state, setState] = useState<'ready' | 'loading' | 'error'>('ready');
  const [suggestionsOpen, setSuggestionsOpen] = useState(true);
  const [activeOption, setActiveOption] = useState<string>();
  const [selectedSkill, setSelectedSkill] = useState('');
  const [retries, setRetries] = useState(0);
  const [dismissals, setDismissals] = useState(0);
  const suggestions = useRef<SlashSkillSuggestionListHandle>(null);
  const [preview, setPreview] = useState<{ x: number; y: number } | null>(null);
  const [previewPresent, setPreviewPresent] = useState(false);
  const [previewCloses, setPreviewCloses] = useState(0);
  const items = useMemo(
    () => skills.filter((skill) => skill.name.includes(query.toLowerCase())),
    [query],
  );
  const editor = useEditor({
    extensions: [StarterKit, PasteChip, SkillCommand],
    immediatelyRender: false,
    editorProps: {
      attributes: {
        role: 'textbox',
        'aria-label': 'Native TipTap editor',
        'aria-multiline': 'true',
      },
    },
    onCreate: ({ editor: current }) =>
      setSnapshot({
        json: JSON.stringify(current.getJSON()),
        html: current.getHTML(),
        text: current.getText(),
      }),
    onUpdate: ({ editor: current }) =>
      setSnapshot({
        json: JSON.stringify(current.getJSON()),
        html: current.getHTML(),
        text: current.getText(),
      }),
  });

  function openPreview(element: HTMLElement) {
    const bounds = element.getBoundingClientRect();
    setPreview({ x: bounds.left, y: bounds.bottom });
    setPreviewPresent(true);
  }
  function closePreview() {
    if (!previewPresent) return;
    setPreviewPresent(false);
    setPreviewCloses((count) => count + 1);
  }

  return (
    <section
      className="grid gap-4"
      data-functional-example="native-editor"
      aria-label="Native editor example"
    >
      <h2>Local TipTap editor</h2>
      <p>
        These controls exercise production node views and suggestion views with local example data.
        Live mention search, workspace navigation and the full composer remain unported.
      </p>
      <FormField
        label="Paste chip text"
        control={(field) => (
          <Textarea
            {...field}
            value={pasteText}
            onChange={(event) => setPasteText(event.target.value)}
          />
        )}
      />
      <div className="flex flex-wrap gap-2">
        <Button
          disabled={!editor}
          onClick={() =>
            editor
              ?.chain()
              .focus()
              .insertPasteChip({ content: pasteText, lineCount: pasteText.split('\n').length })
              .run()
          }
        >
          Insert paste chip
        </Button>
        <Button
          variant="outline"
          disabled={!editor}
          onClick={() => editor?.commands.clearContent()}
        >
          Clear editor
        </Button>
        <Button
          variant="outline"
          disabled={!editor}
          onClick={() => editor?.chain().focus().undo().run()}
        >
          Undo editor change
        </Button>
      </div>
      <EditorContent editor={editor} className="min-h-24 rounded-md border border-border p-3" />
      <FormField
        label="Filter local skills"
        control={(field) => (
          <Input
            {...field}
            value={query}
            aria-controls={
              suggestionsOpen && state === 'ready' && items.length
                ? 'catalog-local-skills'
                : undefined
            }
            aria-activedescendant={suggestionsOpen ? activeOption : undefined}
            onChange={(event) => {
              setQuery(event.target.value);
              setSuggestionsOpen(true);
            }}
            onKeyDown={(event) => {
              if (suggestionsOpen) suggestions.current?.onKeyDown({ event: event.nativeEvent });
            }}
          />
        )}
      />
      <ButtonGroup aria-label="Controlled suggestion states">
        <Button
          variant="outline"
          onClick={() => {
            setState('ready');
            setSuggestionsOpen(true);
          }}
        >
          Show skill choices
        </Button>
        <Button
          variant="outline"
          onClick={() => {
            setState('loading');
            setSuggestionsOpen(true);
          }}
        >
          Show loading prop
        </Button>
        <Button
          variant="outline"
          onClick={() => {
            setState('error');
            setSuggestionsOpen(true);
          }}
        >
          Show error prop
        </Button>
      </ButtonGroup>
      {suggestionsOpen && (
        <SlashSkillSuggestionList
          ref={suggestions}
          listboxId="catalog-local-skills"
          items={items}
          loading={state === 'loading'}
          error={state === 'error' ? 'Internal controlled error example' : null}
          onActiveOptionChange={setActiveOption}
          onSelect={(skill) => {
            if (!editor) return;
            editor.chain().focus().insertSkillCommand({ name: skill.name }).run();
            setSelectedSkill(skill.name);
            setSuggestionsOpen(false);
          }}
          onDismiss={() => {
            setSuggestionsOpen(false);
            setDismissals((count) => count + 1);
          }}
          onRetry={() => setRetries((count) => count + 1)}
        />
      )}
      <Button
        variant="outline"
        data-mention="local-example"
        onMouseEnter={(event) => openPreview(event.currentTarget)}
        onFocus={(event) => openPreview(event.currentTarget)}
        onMouseLeave={(event) => {
          if (
            !(event.relatedTarget instanceof Element) ||
            !event.relatedTarget.closest('[role="tooltip"]')
          )
            closePreview();
        }}
        onBlur={closePreview}
        onKeyDown={(event) => {
          if (event.key === 'Escape') closePreview();
        }}
      >
        Preview local file mention
      </Button>
      {preview && (
        <MentionHoverPreview
          mention={mention}
          position={preview}
          present={previewPresent}
          onClose={closePreview}
          onExit={() => setPreview(null)}
        />
      )}
      <output aria-label="Editor JSON" className="break-all">
        {snapshot.json}
      </output>
      <output aria-label="Editor HTML" className="break-all">
        {snapshot.html}
      </output>
      <output aria-label="Editor text" className="whitespace-pre-wrap">
        {snapshot.text}
      </output>
      <output aria-label="Selected local skill">{selectedSkill}</output>
      <output aria-label="Skill retry requests">{retries}</output>
      <output aria-label="Skill dismissal count">{dismissals}</output>
      <output aria-label="Mention preview close count">{previewCloses}</output>
    </section>
  );
}
