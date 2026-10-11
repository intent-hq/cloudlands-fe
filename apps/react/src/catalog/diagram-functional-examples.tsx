// Direct callers of real engines; full NoteWithComments and MessageContent hosts remain unported.
// i18n-ignore (internal catalog exercise controls and reference fixture content)
import { useMemo, useState } from 'react';
import { DiagramPresentation } from '@/components/diagrams/diagram-presentation';
import { DiagramRenderer } from '@/components/diagrams/diagram-renderer';
import { StreamingDiagramRenderer } from '@/components/diagrams/streaming-diagram-renderer';
import { MermaidRenderer, type MermaidRenderState } from '@/components/markdown/mermaid-renderer';
import { FormField } from '@/components/patterns/form';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import {
  CUSTOM_WORKBENCH_CASES,
  MERMAID_WORKBENCH_CASES,
} from '$lib/components/diagrams/diagram-workbench.preview-fixtures';
import { parseIncrementalDiagramJson } from '$lib/utils/incrementalDiagramJson';
import type { DiagramPrimitive } from '$shared/types/notes-primitives';

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <FormField
      label={label}
      control={(props) => <Switch {...props} checked={checked} onCheckedChange={onChange} />}
    />
  );
}

function MermaidEngineExample() {
  const [code, setCode] = useState(MERMAID_WORKBENCH_CASES['mermaid-flow'].source);
  const [streaming, setStreaming] = useState(false);
  const [mounted, setMounted] = useState(true);
  const [showSource, setShowSource] = useState(false);
  const [renderState, setRenderState] = useState<MermaidRenderState>('pending');
  const [secondMounted, setSecondMounted] = useState(false);
  return (
    <section
      className="grid min-w-0 grid-cols-1 gap-4"
      data-functional-example="mermaid-engine"
      aria-label="Mermaid engine exercise"
    >
      <h2>Mermaid engine</h2>
      <FormField
        label="Mermaid source"
        control={(props) => (
          <Textarea
            {...props}
            value={code}
            onChange={(event) => setCode(event.target.value)}
            rows={8}
          />
        )}
      />
      <div className="flex flex-wrap gap-4">
        <Toggle label="Mermaid streaming" checked={streaming} onChange={setStreaming} />
        <Toggle label="Mount Mermaid renderer" checked={mounted} onChange={setMounted} />
        <Toggle label="Show Mermaid source" checked={showSource} onChange={setShowSource} />
        <Toggle
          label="Mount second Mermaid renderer"
          checked={secondMounted}
          onChange={setSecondMounted}
        />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => setCode(MERMAID_WORKBENCH_CASES['mermaid-flow'].source)}>
          Restore Mermaid flow
        </Button>
        <Button onClick={() => setCode(MERMAID_WORKBENCH_CASES['mermaid-sequence'].source)}>
          Load Mermaid sequence
        </Button>
        <Button onClick={() => setCode('')}>Clear Mermaid source</Button>
      </div>
      <div data-diagram-exercise-renderer="mermaid-primary">
        {mounted && (
          <DiagramPresentation kind="mermaid" rendererOwnsActions>
            <MermaidRenderer
              code={code}
              isStreaming={streaming}
              showExportButton
              showSource={showSource}
              onShowSourceChange={setShowSource}
              onRenderStateChange={setRenderState}
            />
          </DiagramPresentation>
        )}
      </div>
      <output aria-label="Mermaid render state">{mounted ? renderState : 'unmounted'}</output>
      <output aria-label="Mermaid source visibility">{String(showSource)}</output>
      {secondMounted && (
        <section
          aria-label="Independent Mermaid renderer"
          data-diagram-exercise-renderer="mermaid-secondary"
        >
          <DiagramPresentation kind="mermaid" rendererOwnsActions>
            <MermaidRenderer
              code={MERMAID_WORKBENCH_CASES['mermaid-two-node'].source}
              showExportButton
            />
          </DiagramPresentation>
        </section>
      )}
    </section>
  );
}

type CustomCaseId = keyof typeof CUSTOM_WORKBENCH_CASES;
const customCases = Object.entries(CUSTOM_WORKBENCH_CASES).map(([value, fixture]) => ({
  value,
  label: fixture.title,
}));

function CustomEngineExample() {
  const [caseId, setCaseId] = useState<CustomCaseId>('custom-architecture');
  const [diagram, setDiagram] = useState<DiagramPrimitive>(
    CUSTOM_WORKBENCH_CASES['custom-architecture'].diagram,
  );
  const [mounted, setMounted] = useState(true);
  const [selected, setSelected] = useState(false);
  const [editable, setEditable] = useState(false);
  const [viewRevision, setViewRevision] = useState(0);
  const [updates, setUpdates] = useState(0);
  const [lastUpdate, setLastUpdate] = useState<Partial<DiagramPrimitive> | null>(null);
  const [binding, setBinding] = useState('');
  function chooseCase(value: string) {
    if (!Object.hasOwn(CUSTOM_WORKBENCH_CASES, value)) return;
    const next = value as CustomCaseId;
    setCaseId(next);
    setDiagram(CUSTOM_WORKBENCH_CASES[next].diagram);
    setLastUpdate(null);
    setBinding('');
  }
  return (
    <section
      className="grid min-w-0 grid-cols-1 gap-4"
      data-functional-example="custom-diagram-engine"
      aria-label="Custom diagram engine exercise"
    >
      <h2>Custom diagram engine</h2>
      <FormField
        label="Custom diagram fixture"
        control={(props) => (
          <Select items={customCases} value={caseId} onValueChange={chooseCase}>
            <SelectTrigger {...props}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {customCases.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        )}
      />
      <div className="flex flex-wrap gap-4">
        <Toggle label="Mount custom renderer" checked={mounted} onChange={setMounted} />
        <Toggle label="Select custom presentation" checked={selected} onChange={setSelected} />
        <Toggle label="Edit custom diagram" checked={editable} onChange={setEditable} />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => setViewRevision((revision) => revision + 1)}>
          Reset custom viewport
        </Button>
      </div>
      <div data-diagram-exercise-renderer="custom">
        {mounted && (
          <DiagramPresentation kind="custom" selected={selected} fileName="custom-workbench">
            <DiagramRenderer
              key={caseId}
              diagram={diagram}
              editable={editable}
              viewResetKey={`${caseId}:${viewRevision}`}
              onUpdate={(update) => {
                setDiagram((previous) => ({ ...previous, ...update }));
                setLastUpdate(update);
                setUpdates((count) => count + 1);
              }}
              onBindingClick={(_event, target) => setBinding(`${target.type}: ${target.target}`)}
            />
          </DiagramPresentation>
        )}
      </div>
      <output aria-label="Custom current state">{diagram.currentStateId ?? 'none'}</output>
      <output aria-label="Custom update count">{updates}</output>
      <output aria-label="Custom last update" className="min-w-0 wrap-anywhere">
        {JSON.stringify(lastUpdate)}
      </output>
      <output aria-label="Custom binding target" className="min-w-0 wrap-anywhere">
        {binding}
      </output>
    </section>
  );
}

const streamingFixture = CUSTOM_WORKBENCH_CASES['custom-bindings'].diagram;
// Put metadata before model so the actual incremental parser can publish a completed first node.
const { model: streamingModel, ...streamingMetadata } = streamingFixture;
const streamingHeader = JSON.stringify(streamingMetadata).slice(0, -1);
const streamingPrefix = `${streamingHeader},"model":{"nodes":[${JSON.stringify(streamingModel.nodes[0])},`;
const streamingComplete = JSON.stringify({ ...streamingMetadata, model: streamingModel });

function StreamingEngineExample() {
  const [source, setSource] = useState(streamingComplete);
  const [streaming, setStreaming] = useState(false);
  const [mounted, setMounted] = useState(true);
  const [viewRevision, setViewRevision] = useState(0);
  const [binding, setBinding] = useState('');
  const projection = useMemo(
    () => parseIncrementalDiagramJson(source, !streaming),
    [source, streaming],
  );
  return (
    <section
      className="grid min-w-0 grid-cols-1 gap-4"
      data-functional-example="streaming-diagram-engine"
      aria-label="Streaming custom diagram exercise"
    >
      <h2>Streaming custom diagram</h2>
      <FormField
        label="Custom diagram JSON"
        control={(props) => (
          <Textarea
            {...props}
            value={source}
            onChange={(event) => setSource(event.target.value)}
            rows={8}
          />
        )}
      />
      <div className="flex flex-wrap gap-4">
        <Toggle label="Custom JSON streaming" checked={streaming} onChange={setStreaming} />
        <Toggle label="Mount streaming custom renderer" checked={mounted} onChange={setMounted} />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          onClick={() => {
            setStreaming(true);
            setSource(streamingPrefix);
          }}
        >
          Start custom JSON stream
        </Button>
        <Button
          onClick={() => {
            setSource(streamingComplete);
            setStreaming(false);
          }}
        >
          Complete custom JSON stream
        </Button>
        <Button onClick={() => setViewRevision((revision) => revision + 1)}>
          Replace custom stream identity
        </Button>
      </div>
      <div data-diagram-exercise-renderer="streaming-custom">
        {mounted && (
          <DiagramPresentation kind="custom" fileName="streaming-workbench">
            <StreamingDiagramRenderer
              diagram={projection.diagram}
              source={source}
              sourceError={projection.error}
              isStreaming={streaming}
              viewResetKey={`stream:${viewRevision}`}
              onBindingClick={(_event, target) => setBinding(`${target.type}: ${target.target}`)}
            />
          </DiagramPresentation>
        )}
      </div>
      <output aria-label="Custom JSON parse status">{projection.status}</output>
      <output aria-label="Streaming custom binding target" className="min-w-0 wrap-anywhere">
        {binding}
      </output>
    </section>
  );
}

export function DiagramFunctionalExamples() {
  return (
    <div className="grid min-w-0 grid-cols-1 gap-8" data-functional-example="diagram-engines">
      <p>
        These exercises call the real diagram engines. Full note controls (NoteWithComments) and
        chat embedding (MessageContent) remain deferred until those React hosts are ported.
      </p>
      <MermaidEngineExample />
      <CustomEngineExample />
      <StreamingEngineExample />
    </div>
  );
}
