// i18n-ignore (internal source-display and callback exercise, not released product copy)
import { useState } from 'react';
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
import { AgentAvatar } from '@/features/agent/components/agent-avatar/agent-avatar';
import {
  AgentAvatarStack,
  type AgentAvatarStackItem,
} from '@/features/agent/components/agent-avatar/agent-avatar-stack';
import { AgentAvatarWithState } from '@/features/agent/components/agent-avatar/agent-avatar-with-state';
import {
  agentAvatarCatalogIdentities,
  agentAvatarCatalogStates,
} from '../../../../src/features/agent/components/agent-avatar/agent-avatar.catalog';
import {
  builtinAgentAvatarDesigns,
  builtinSpecialistAvatarDesigns,
} from '../../../../src/features/agent/components/agent-avatar/avatar-design';
import {
  agentAvatarVariants,
  type AgentAvatarVariant,
} from '../../../../src/features/agent/components/agent-avatar/avatar-size';
import type { AvatarState } from '../../../../src/features/agent/components/agent-avatar/avatar-state-core';

// Exact pure display fixtures from AgentAvatarCatalog.svelte at 8293131f29c7.
// These identities are catalog art seeds, never agent sessions or Store records.
const catalogStackStates = ['running', 'unread', 'attention-discussion'] as const;
const catalogStackItems: AgentAvatarStackItem[] = Array.from({ length: 6 }, (_, index) => ({
  key: `catalog-stack-${index}`,
  agentId: `catalog-stack-${index}`,
  specialist: 'coordinator',
  state: catalogStackStates[index % catalogStackStates.length],
}));

function Choice<T extends string>({
  label,
  value,
  values,
  onChange,
}: {
  label: string;
  value: T;
  values: readonly T[];
  onChange: (value: T) => void;
}) {
  return (
    <FormField
      label={label}
      control={(field) => (
        <Select
          value={value}
          items={values.map((item) => ({ value: item, label: item }))}
          onValueChange={(next) => {
            const match = values.find((item) => item === next);
            if (match !== undefined) onChange(match);
          }}
        >
          <SelectTrigger {...field} aria-label={label}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent portal>
            <SelectGroup>
              {values.map((item) => (
                <SelectItem key={item} value={item}>
                  {item}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      )}
    />
  );
}

function Flag({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <FormField
      label={label}
      control={(field) => (
        <Switch {...field} ariaLabel={label} checked={checked} onCheckedChange={onChange} />
      )}
    />
  );
}

function SourceCatalog() {
  // Keep the source catalog's intrinsic layout, independent of the exercise chrome.
  // Inline styles transcribe its scoped CSS; no responsive reflow inside this crop.
  return (
    <div
      className="agent-avatar-catalog"
      data-agent-avatar-catalog=""
      data-testid="source-avatar-catalog"
      style={{ display: 'grid', gap: '0.375rem', minWidth: 'max-content', padding: '0.5rem' }}
    >
      {agentAvatarCatalogIdentities.map((identity) => (
        <div
          key={identity.design}
          className="agent-avatar-catalog-row"
          data-catalog-avatar-design={identity.design}
          style={{
            display: 'grid',
            gridTemplateColumns: '10rem auto',
            alignItems: 'center',
            gap: '0.5rem',
          }}
        >
          <code style={{ color: 'hsl(var(--muted-foreground))', fontSize: '0.6875rem' }}>
            {identity.design}
          </code>
          <div
            className="agent-avatar-catalog-states"
            style={{
              display: 'grid',
              gridAutoFlow: 'column',
              gridAutoColumns: '1.25rem',
              gap: '0.375rem',
            }}
          >
            {agentAvatarCatalogStates.map((state) => (
              <AgentAvatarWithState
                key={state}
                agentId={identity.agentId}
                specialist={identity.specialist}
                state={state}
                variant="standard"
              />
            ))}
          </div>
        </div>
      ))}
      <div
        className="agent-avatar-catalog-variants"
        data-agent-avatar-catalog-variants=""
        style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
      >
        {agentAvatarVariants.map((variant) => (
          <AgentAvatarWithState
            key={variant}
            agentId="catalog-variant"
            specialist="coordinator"
            state="running"
            variant={variant}
          />
        ))}
      </div>
      <div className="agent-avatar-catalog-stack" data-agent-avatar-catalog-stack="">
        <AgentAvatarStack items={catalogStackItems} maxVisible={3} variant="emphasized" />
      </div>
    </div>
  );
}

function SourceWaitingHost({ state, zoom }: { state: AvatarState; zoom: number }) {
  // AgentAvatarWaitingHost.svelte's unchanged child order, props and box layout.
  // Theme/reduced motion come from the real catalog environment, never a local override.
  return (
    <section
      className="w-max bg-background p-4 text-foreground"
      style={{ zoom }}
      data-testid="source-avatar-waiting-host"
    >
      <div data-testid="reactive-waiting-avatar">
        <AgentAvatarWithState
          agentId="waiting-state-transition"
          specialist="coordinator"
          state={state}
          variant="standard"
        />
      </div>
      <div data-testid="plain-idle-avatar">
        <AgentAvatar agentId="plain-idle-agent" variant="standard" />
      </div>
      <div data-testid="legacy-sized-avatar">
        <AgentAvatar agentId="legacy-sized-agent" size={18} />
      </div>
      <SourceCatalog />
    </section>
  );
}

export function AgentAvatarExamples() {
  const [mode, setMode] = useState('interactive');
  const [state, setState] = useState<AvatarState>('idle');
  const [variant, setVariant] = useState<AgentAvatarVariant>('standard');
  const [identityDesign, setIdentityDesign] = useState(agentAvatarCatalogIdentities[0].design);
  const [specialistChoice, setSpecialistChoice] = useState('catalog identity');
  const [iconChoice, setIconChoice] = useState('none');
  const [legacySize, setLegacySize] = useState('named variant');
  const [zoom, setZoom] = useState('1');
  const [width, setWidth] = useState('160');
  const [maxVisible, setMaxVisible] = useState('3');
  const [align, setAlign] = useState<'start' | 'end'>('end');
  const [adaptive, setAdaptive] = useState(true);
  const [mounted, setMounted] = useState(true);
  const [customContent, setCustomContent] = useState(false);
  const [activations, setActivations] = useState<AgentAvatarStackItem[]>([]);
  const identity = agentAvatarCatalogIdentities.find((item) => item.design === identityDesign)!;
  const specialist =
    specialistChoice === 'catalog identity'
      ? identity.specialist
      : specialistChoice === 'none'
        ? null
        : specialistChoice;
  const icon = iconChoice === 'none' ? null : iconChoice;
  const size = legacySize === 'named variant' ? undefined : Number(legacySize);

  return (
    <section
      className="grid min-w-0 grid-cols-1 gap-4"
      data-functional-example="agent-avatar"
      aria-label="Agent avatar display exercise"
    >
      <h2>Internal agent avatar display exercise</h2>
      <p className="type-caption text-muted-foreground">
        Source catalog art and display props only. Controls stay in this exercise. Theme and motion
        follow the catalog environment. Runtime and visual acceptance remain pending.
      </p>
      <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2">
        <Choice
          label="Display mode"
          value={mode}
          values={['interactive', 'source waiting host', 'source catalog']}
          onChange={setMode}
        />
        {mode !== 'source catalog' && (
          <Choice
            label="Avatar state"
            value={state}
            values={agentAvatarCatalogStates}
            onChange={setState}
          />
        )}
        {mode === 'source waiting host' && (
          <Choice label="Source host zoom" value={zoom} values={['1', '2']} onChange={setZoom} />
        )}
      </div>
      {mode === 'interactive' ? (
        <>
          <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2">
            <Choice
              label="Avatar variant"
              value={variant}
              values={agentAvatarVariants}
              onChange={setVariant}
            />
            <Choice
              label="Catalog identity"
              value={identityDesign}
              values={agentAvatarCatalogIdentities.map((item) => item.design)}
              onChange={setIdentityDesign}
            />
            <Choice
              label="Specialist prop"
              value={specialistChoice}
              values={[
                'catalog identity',
                'none',
                'unknown-specialist',
                ...Object.keys(builtinSpecialistAvatarDesigns),
              ]}
              onChange={setSpecialistChoice}
            />
            <Choice
              label="Icon prop"
              value={iconChoice}
              values={['none', 'unknown-icon', ...builtinAgentAvatarDesigns]}
              onChange={setIconChoice}
            />
            <Choice
              label="Legacy size"
              value={legacySize}
              values={['named variant', '18', '40']}
              onChange={setLegacySize}
            />
          </div>
          <div
            className="flex min-w-0 flex-wrap items-center gap-4"
            data-testid="controlled-avatar-display"
          >
            <AgentAvatar
              agentId={identity.agentId}
              specialist={specialist}
              icon={icon}
              variant={variant}
              size={size}
              ariaLabel="Plain avatar display"
            />
            <AgentAvatarWithState
              agentId={identity.agentId}
              specialist={specialist}
              icon={icon}
              variant={variant}
              size={size}
              state={state}
            />
          </div>
          <h3>Adaptive stack</h3>
          <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2">
            <Choice
              label="Stack container width"
              value={width}
              values={['32', '64', '96', '160', '320']}
              onChange={setWidth}
            />
            <Choice
              label="Maximum visible avatars"
              value={maxVisible}
              values={['0', '1', '2', '3', '6']}
              onChange={setMaxVisible}
            />
            <Choice
              label="Stack alignment"
              value={align}
              values={['start', 'end']}
              onChange={setAlign}
            />
            <Flag label="Adaptive stack" checked={adaptive} onChange={setAdaptive} />
            <Flag label="Mount stack" checked={mounted} onChange={setMounted} />
            <Flag
              label="Interactive custom item content"
              checked={customContent}
              onChange={setCustomContent}
            />
          </div>
          <div className="min-w-0 overflow-x-auto">
            <div
              className="flex max-w-full"
              style={{ width: Number(width) }}
              data-testid="avatar-stack-container"
            >
              {mounted && (
                <AgentAvatarStack
                  items={catalogStackItems}
                  maxVisible={Number(maxVisible)}
                  adaptive={adaptive}
                  align={align}
                  variant={variant}
                  interactive={customContent}
                  overflowId="avatar-exercise-overflow"
                  overflowTestId="avatar-exercise-overflow"
                  itemContent={
                    customContent
                      ? (item) => (
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            className="size-full"
                            wrapContent={false}
                            aria-label={`Activate ${item.key}`}
                            onClick={() => setActivations((current) => [...current, { ...item }])}
                          >
                            <AgentAvatarWithState
                              agentId={item.agentId}
                              specialist={item.specialist}
                              icon={item.icon}
                              state={item.state}
                              variant={variant}
                            />
                          </Button>
                        )
                      : undefined
                  }
                />
              )}
            </div>
          </div>
          <output
            className="min-w-0 whitespace-pre-wrap wrap-anywhere"
            aria-label="Avatar item activations"
            aria-live="polite"
          >
            {JSON.stringify(activations)}
          </output>
          <Button variant="secondary" onClick={() => setActivations([])}>
            Clear avatar activations
          </Button>
        </>
      ) : (
        <div className="min-w-0 overflow-x-auto" data-testid="avatar-source-scroll-region">
          {mode === 'source waiting host' ? (
            <SourceWaitingHost state={state} zoom={Number(zoom)} />
          ) : (
            <SourceCatalog />
          )}
        </div>
      )}
    </section>
  );
}
