// Real component callback contracts, separate from exact source appearance fixtures.
// i18n-ignore (internal dialog exercises; never product-operation acceptance)
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { InputDialog } from '@/components/modals/input-dialog';
import { MessageDialog } from '@/components/modals/message-dialog';
import { BulkActionConfirmDialog } from '@/components/modals/bulk-action-confirm-dialog';
import { HarnessFeaturesModal } from '@/components/chat/harness-features-modal';
import { DismissProposalConfirmDialog } from '@/components/chat/proposals/dismiss-proposal-confirm-dialog';
import { ModelSwitchConfirmDialog } from '@/components/chat/model-switch-confirm-dialog';
import { SetPrimaryClientConfirmDialog } from '@/components/workspace/set-primary-client-confirm-dialog';
import { DismissQuestionsConfirmDialog } from '@/components/chat/questions/dismiss-questions-confirm-dialog';
import { CatalogLink } from './catalog-link';

interface CallbackDialogControls {
  setBulkPreflightReady: (ready: boolean) => void;
  resolveBulk: () => boolean;
  rejectBulk: () => boolean;
  setInputOpen: (open: boolean) => void;
  closeProposal: () => void;
  closeModelSwitch: () => void;
  closePrimaryClient: () => void;
  closeQuestions: () => void;
}

declare global {
  interface Window {
    /** Internal exercise only: controls caller-owned inputs and the actual pending callback. */
    __INTENT_CALLBACK_DIALOGS__?: CallbackDialogControls;
  }
}

const longFeatures = {
  browserAutomation: true,
  backgroundHooks: false,
  structuredQuestions: true,
  ...Object.fromEntries(
    Array.from({ length: 32 }, (_, index) => [
      `experimentalCrossWorkspaceReviewCapabilityWithLongDescriptiveName${index + 1}`,
      index % 2 === 0,
    ]),
  ),
};

export function CallbackDialogExamples() {
  const [inputOpen, setInputOpen] = useState(false);
  const [inputValues, setInputValues] = useState<string[]>([]);
  const [inputCancelled, setInputCancelled] = useState(0);
  const [messageOpen, setMessageOpen] = useState(false);
  const [messageSelections, setMessageSelections] = useState<number[]>([]);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [preflightReady, setPreflightReady] = useState(false);
  const [bulkArchive, setBulkArchive] = useState(true);
  const [bulkSingular, setBulkSingular] = useState(false);
  const [bulkFocusCancel, setBulkFocusCancel] = useState(false);
  const [bulkAttempts, setBulkAttempts] = useState(0);
  const [bulkCancelled, setBulkCancelled] = useState(0);
  const [bulkStatus, setBulkStatus] = useState<'idle' | 'pending' | 'resolved' | 'rejected'>(
    'idle',
  );
  const pendingBulk = useRef<{ resolve: () => void; reject: (error: Error) => void } | null>(null);
  const [harnessOpen, setHarnessOpen] = useState(false);
  const [harnessEmpty, setHarnessEmpty] = useState(false);
  const [harnessClosed, setHarnessClosed] = useState(0);
  const [proposalOpen, setProposalOpen] = useState(false);
  const [proposalConfirmed, setProposalConfirmed] = useState(0);
  const [proposalCancelled, setProposalCancelled] = useState(0);
  const [modelSwitchOpen, setModelSwitchOpen] = useState(false);
  const [providerChange, setProviderChange] = useState(true);
  const [modelSwitchConfirmed, setModelSwitchConfirmed] = useState(0);
  const [modelSwitchCancelled, setModelSwitchCancelled] = useState(0);
  const [primaryClientOpen, setPrimaryClientOpen] = useState(false);
  const [knownHost, setKnownHost] = useState(true);
  const [primaryClientConfirmed, setPrimaryClientConfirmed] = useState(0);
  const [primaryClientCancelled, setPrimaryClientCancelled] = useState(0);
  const [questionsOpen, setQuestionsOpen] = useState(false);
  const [questionsConfirmed, setQuestionsConfirmed] = useState(0);
  const [questionsCancelled, setQuestionsCancelled] = useState(0);

  function settleBulk(rejected: boolean) {
    const pending = pendingBulk.current;
    if (!pending) return false;
    pendingBulk.current = null;
    if (rejected) pending.reject(new Error('Internal callback exercise rejection'));
    else pending.resolve();
    return true;
  }

  useEffect(() => {
    const controls: CallbackDialogControls = {
      setBulkPreflightReady: setPreflightReady,
      resolveBulk: () => settleBulk(false),
      rejectBulk: () => settleBulk(true),
      setInputOpen,
      closeProposal: () => setProposalOpen(false),
      closeModelSwitch: () => setModelSwitchOpen(false),
      closePrimaryClient: () => setPrimaryClientOpen(false),
      closeQuestions: () => setQuestionsOpen(false),
    };
    window.__INTENT_CALLBACK_DIALOGS__ = controls;
    return () => {
      if (window.__INTENT_CALLBACK_DIALOGS__ === controls)
        delete window.__INTENT_CALLBACK_DIALOGS__;
      // Release the local pending callback when navigating away; no operation exists on a daemon.
      settleBulk(false);
    };
  }, []);

  async function confirmBulk() {
    setBulkAttempts((count) => count + 1);
    setBulkStatus('pending');
    try {
      await new Promise<void>((resolve, reject) => {
        pendingBulk.current = { resolve, reject };
      });
      setBulkStatus('resolved');
    } catch (error) {
      setBulkStatus('rejected');
      throw error;
    }
  }

  return (
    <div className="grid gap-8" data-functional-example="callback-dialogs">
      <header className="grid gap-2">
        <h1>Callback dialog exercises</h1>
        <p>
          Real dialogs, native portals and caller-owned callback inputs. These exercises do not
          save, archive or delete workspaces, persist proposal or question decisions, switch models,
          or change the primary client. Browser and visual acceptance remain pending.
        </p>
        <CatalogLink href="/sandbox/modals">Source appearance fixtures and coverage</CatalogLink>
      </header>
      <section
        className="grid gap-3"
        data-dialog-example="input"
        aria-label="Input dialog exercise"
      >
        <h2>Input trim, blank validation and reset</h2>
        <Button data-testid="input-dialog-open" onClick={() => setInputOpen(true)}>
          Open input dialog
        </Button>
        <InputDialog
          open={inputOpen}
          onOpenChange={setInputOpen}
          title="Rename workspace"
          label="Workspace name"
          description="Enter a new workspace name."
          placeholder="Workspace name"
          onConfirm={(value) => setInputValues((values) => [...values, value])}
          onCancel={() => setInputCancelled((count) => count + 1)}
        />
        <output aria-label="Input callback values" data-testid="input-dialog-values">
          {JSON.stringify(inputValues)}
        </output>
        <output aria-label="Input cancel callbacks" data-testid="input-dialog-cancels">
          {inputCancelled}
        </output>
        <output aria-label="Input dialog open" data-testid="input-dialog-is-open">
          {String(inputOpen)}
        </output>
      </section>
      <section
        className="grid gap-3"
        data-dialog-example="message"
        aria-label="Message dialog exercise"
      >
        <h2>Message indices and body-owned description</h2>
        <p>
          All three labels repeat; Escape and close select index 1, while form submission selects
          index 2.
        </p>
        <Button data-testid="message-dialog-open" onClick={() => setMessageOpen(true)}>
          Open message dialog
        </Button>
        <MessageDialog
          open={messageOpen}
          onOpenChange={setMessageOpen}
          title="Workspace moved"
          message="The workspace is ready on the selected connection."
          buttons={['Continue', 'Continue', 'Continue']}
          cancelIndex={1}
          onSelect={(index) => setMessageSelections((values) => [...values, index])}
        />
        <output aria-label="Message selected indices" data-testid="message-dialog-selections">
          {JSON.stringify(messageSelections)}
        </output>
        <output aria-label="Message dialog open" data-testid="message-dialog-is-open">
          {String(messageOpen)}
        </output>
      </section>
      <section
        className="grid gap-3"
        data-dialog-example="bulk"
        aria-label="Bulk callback exercise"
      >
        <h2>Bulk preflight and pending callback</h2>
        <p>
          The callback returns a real pending Promise. Use the exercise API to finish preflight or
          resolve/reject it while the native dialog makes the page inert. This checks the component
          callback contract only.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <Label className="flex items-center gap-2">
            <Switch
              aria-label="Bulk preflight ready"
              checked={preflightReady}
              onCheckedChange={setPreflightReady}
            />
            Bulk preflight ready
          </Label>
          <Label className="flex items-center gap-2">
            <Switch
              aria-label="Archive mode"
              checked={bulkArchive}
              onCheckedChange={setBulkArchive}
            />
            Archive mode
          </Label>
          <Label className="flex items-center gap-2">
            <Switch
              aria-label="Singular warning counts"
              checked={bulkSingular}
              onCheckedChange={setBulkSingular}
            />
            Singular warning counts
          </Label>
          <Label className="flex items-center gap-2">
            <Switch
              aria-label="Initially focus cancel"
              checked={bulkFocusCancel}
              onCheckedChange={setBulkFocusCancel}
            />
            Initially focus cancel
          </Label>
        </div>
        <Button
          data-testid="bulk-dialog-open"
          onClick={() => {
            setBulkStatus('idle');
            setBulkOpen(true);
          }}
        >
          Open bulk dialog
        </Button>
        <BulkActionConfirmDialog
          open={bulkOpen}
          onOpenChange={setBulkOpen}
          title={bulkArchive ? 'Archive selected workspaces?' : 'Delete selected workspaces?'}
          description={
            bulkArchive
              ? 'The selected workspaces will move to the archive.'
              : 'The selected workspaces will be deleted.'
          }
          confirmText={bulkArchive ? 'Archive workspaces' : 'Delete workspaces'}
          variant="destructive"
          mode={bulkArchive ? 'archive' : 'delete'}
          initialFocus={bulkFocusCancel ? 'cancel' : 'confirm'}
          preflightReady={preflightReady}
          activeAgentCount={bulkSingular ? 1 : 2}
          activeHookCount={bulkSingular ? 1 : 2}
          openPrCount={bulkSingular ? 1 : 2}
          guestCount={bulkSingular ? 1 : 3}
          onConfirm={confirmBulk}
          onCancel={() => setBulkCancelled((count) => count + 1)}
        />
        <output aria-label="Bulk callback status" data-testid="bulk-dialog-status">
          {bulkStatus}
        </output>
        <output aria-label="Bulk callback attempts" data-testid="bulk-dialog-attempts">
          {bulkAttempts}
        </output>
        <output aria-label="Bulk cancel callbacks" data-testid="bulk-dialog-cancels">
          {bulkCancelled}
        </output>
        <output aria-label="Bulk dialog open" data-testid="bulk-dialog-is-open">
          {String(bulkOpen)}
        </output>
        <details>
          <summary>Exercise API</summary>
          <p>
            <code>window.__INTENT_CALLBACK_DIALOGS__.setBulkPreflightReady(true)</code>
          </p>
          <p>
            <code>window.__INTENT_CALLBACK_DIALOGS__.resolveBulk()</code>
          </p>
          <p>
            <code>window.__INTENT_CALLBACK_DIALOGS__.rejectBulk()</code>
          </p>
        </details>
      </section>
      <section
        className="grid gap-3"
        data-dialog-example="harness"
        aria-label="Harness features exercise"
      >
        <h2>Harness long list and dismissal</h2>
        <Label className="flex items-center gap-2">
          <Switch
            aria-label="Absent harness snapshot"
            checked={harnessEmpty}
            onCheckedChange={setHarnessEmpty}
          />
          Absent harness snapshot
        </Label>
        <Button data-testid="harness-dialog-open" onClick={() => setHarnessOpen(true)}>
          Open harness features
        </Button>
        <HarnessFeaturesModal
          open={harnessOpen}
          onOpenChange={(open) => {
            setHarnessOpen(open);
            if (!open) setHarnessClosed((count) => count + 1);
          }}
          version="callback exercise"
          features={harnessEmpty ? null : longFeatures}
        />
        <output aria-label="Harness close callbacks" data-testid="harness-dialog-closes">
          {harnessClosed}
        </output>
      </section>
      <section
        className="grid gap-3"
        data-dialog-example="proposal"
        aria-label="Proposal callback exercise"
      >
        <h2>Proposal confirm versus cancel</h2>
        <p>
          Confirmation records a callback and deliberately leaves the dialog open, as the component
          requires its owner to close it. No proposal is dismissed or persisted.
        </p>
        <Button data-testid="proposal-dialog-open" onClick={() => setProposalOpen(true)}>
          Open proposal confirmation
        </Button>
        <DismissProposalConfirmDialog
          open={proposalOpen}
          onConfirm={() => setProposalConfirmed((count) => count + 1)}
          onCancel={() => {
            setProposalCancelled((count) => count + 1);
            setProposalOpen(false);
          }}
        />
        <output aria-label="Proposal confirm callbacks" data-testid="proposal-dialog-confirms">
          {proposalConfirmed}
        </output>
        <output aria-label="Proposal cancel callbacks" data-testid="proposal-dialog-cancels">
          {proposalCancelled}
        </output>
        <output aria-label="Proposal dialog open" data-testid="proposal-dialog-is-open">
          {String(proposalOpen)}
        </output>
      </section>
      <section
        className="grid gap-3"
        data-dialog-example="model-switch"
        aria-label="Model switch callback exercise"
      >
        <h2>Model and provider confirmation</h2>
        <p>
          Confirmation records a callback and leaves the dialog open for its owner. No model or
          provider change is sent.
        </p>
        <Label className="flex items-center gap-2">
          <Switch
            aria-label="Change provider"
            checked={providerChange}
            onCheckedChange={setProviderChange}
          />
          Change provider
        </Label>
        <Button data-testid="model-switch-dialog-open" onClick={() => setModelSwitchOpen(true)}>
          Open model switch confirmation
        </Button>
        <ModelSwitchConfirmDialog
          open={modelSwitchOpen}
          isProviderChange={providerChange}
          fromProviderName="Augment"
          fromProviderId="auggie"
          fromModelLabel="Claude Sonnet 4.6"
          toProviderName={providerChange ? 'OpenAI' : 'Augment'}
          toProviderId={providerChange ? 'codex' : 'auggie'}
          toModelLabel={providerChange ? 'GPT-5.6' : 'Claude Opus 4.6'}
          onConfirm={() => setModelSwitchConfirmed((count) => count + 1)}
          onCancel={() => {
            setModelSwitchCancelled((count) => count + 1);
            setModelSwitchOpen(false);
          }}
        />
        <output
          aria-label="Model switch confirm callbacks"
          data-testid="model-switch-dialog-confirms"
        >
          {modelSwitchConfirmed}
        </output>
        <output
          aria-label="Model switch cancel callbacks"
          data-testid="model-switch-dialog-cancels"
        >
          {modelSwitchCancelled}
        </output>
        <output aria-label="Model switch dialog open" data-testid="model-switch-dialog-is-open">
          {String(modelSwitchOpen)}
        </output>
      </section>
      <section
        className="grid gap-3"
        data-dialog-example="primary-client"
        aria-label="Primary client callback exercise"
      >
        <h2>Known and unresolved primary client</h2>
        <p>
          Confirmation records a callback and leaves the dialog open. The primary client is not
          changed.
        </p>
        <Label className="flex items-center gap-2">
          <Switch
            aria-label="Known current host"
            checked={knownHost}
            onCheckedChange={setKnownHost}
          />
          Known current host
        </Label>
        <Button data-testid="primary-client-dialog-open" onClick={() => setPrimaryClientOpen(true)}>
          Open primary client confirmation
        </Button>
        <SetPrimaryClientConfirmDialog
          open={primaryClientOpen}
          currentHost={knownHost ? 'Studio Mac' : undefined}
          onConfirm={() => setPrimaryClientConfirmed((count) => count + 1)}
          onCancel={() => {
            setPrimaryClientCancelled((count) => count + 1);
            setPrimaryClientOpen(false);
          }}
        />
        <output
          aria-label="Primary client confirm callbacks"
          data-testid="primary-client-dialog-confirms"
        >
          {primaryClientConfirmed}
        </output>
        <output
          aria-label="Primary client cancel callbacks"
          data-testid="primary-client-dialog-cancels"
        >
          {primaryClientCancelled}
        </output>
        <output aria-label="Primary client dialog open" data-testid="primary-client-dialog-is-open">
          {String(primaryClientOpen)}
        </output>
      </section>
      <section
        className="grid gap-3"
        data-dialog-example="questions"
        aria-label="Questions dismissal callback exercise"
      >
        <h2>Question dismissal confirmation</h2>
        <p>
          Confirmation records a callback and leaves the dialog open. No questions are dismissed or
          persisted.
        </p>
        <Button data-testid="questions-dialog-open" onClick={() => setQuestionsOpen(true)}>
          Open questions confirmation
        </Button>
        <DismissQuestionsConfirmDialog
          open={questionsOpen}
          onConfirm={() => setQuestionsConfirmed((count) => count + 1)}
          onCancel={() => {
            setQuestionsCancelled((count) => count + 1);
            setQuestionsOpen(false);
          }}
        />
        <output aria-label="Questions confirm callbacks" data-testid="questions-dialog-confirms">
          {questionsConfirmed}
        </output>
        <output aria-label="Questions cancel callbacks" data-testid="questions-dialog-cancels">
          {questionsCancelled}
        </output>
        <output aria-label="Questions dialog open" data-testid="questions-dialog-is-open">
          {String(questionsOpen)}
        </output>
      </section>
    </div>
  );
}
