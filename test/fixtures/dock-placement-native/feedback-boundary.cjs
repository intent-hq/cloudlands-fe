const { createHash } = require('node:crypto');

// External daemon/Speech boundaries only. Never connect to a real backend or microphone.
module.exports = function createFeedbackBoundary(calls) {
  let enabled = false;
  let mode = 'success';
  let discoveryFailure = false;
  let holdVoice = true;
  let holdSend = false;
  const pendingVoice = [];
  const pendingSends = [];
  const sent = [];
  const audio = [];
  const uploads = [];
  const workspaces = [
    { id: 'feedback-alpha', title: 'Navigation polish', status: 'active' },
    { id: 'feedback-beta', title: 'Search quality', status: 'active' },
    { id: 'feedback-empty', title: 'No main agent', status: 'active' },
    { id: 'feedback-archived', title: 'Archived project', status: 'archived', archived: true },
  ];
  const agents = ['alpha', 'beta', 'empty'].flatMap((key) => [
    {
      id: `${key}-override`,
      name: `${key} implementor`,
      workspaceId: `feedback-${key}`,
      status: 'idle',
      metadata: { isBackground: true },
    },
    ...(key === 'empty'
      ? []
      : [
          {
            id: `${key}-main`,
            name: `${key} main agent`,
            workspaceId: `feedback-${key}`,
            status: 'idle',
            metadata: { isInitialAgent: true },
            isInitialAgent: true,
          },
        ]),
  ]);
  function snapshot() {
    return {
      enabled,
      mode,
      pendingVoice: pendingVoice.length,
      pendingSends: pendingSends.length,
      audio: structuredClone(audio),
      sent: structuredClone(sent),
      uploads: structuredClone(uploads),
    };
  }
  return {
    get enabled() {
      return enabled;
    },
    configure(options = {}) {
      enabled = true;
      mode = options.mode ?? 'success';
      discoveryFailure = options.discoveryFailure ?? false;
      holdVoice = options.holdVoice ?? true;
      holdSend = options.holdSend ?? false;
    },
    snapshot,
    releaseVoice(text = `Narration segment ${audio.length}`) {
      pendingVoice.shift()?.(text);
    },
    releaseSend() {
      pendingSends.shift()?.();
    },
    releaseAll() {
      holdVoice = holdSend = false;
      for (const resolve of pendingVoice.splice(0)) resolve('Late cancelled narration');
      for (const resolve of pendingSends.splice(0)) resolve();
    },
    async transcribe(payload) {
      if (!enabled) throw new Error('Synthetic feedback voice boundary is not enabled');
      const wav = Buffer.from(payload.audioBase64, 'base64');
      const samples = [];
      for (let i = 44; i + 1 < wav.length; i += 2) samples.push(wav.readInt16LE(i) / 32768);
      const average = (values) =>
        values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
      audio.push({
        bytes: wav.length,
        sha256: createHash('sha256').update(wav).digest('hex'),
        samples: samples.length,
        firstMean: average(samples.slice(100, 1500)),
        lastMean: average(samples.slice(-1500, -100)),
      });
      calls.push({ boundary: 'synthetic-transcription', audio: audio.at(-1) });
      const text = holdVoice
        ? await new Promise((resolve) => pendingVoice.push(resolve))
        : `Narration segment ${audio.length}`;
      return { success: true, text, durationMs: 200 };
    },
    async request(payload) {
      const { method, params = {} } = payload;
      const fail = (message) => ({ ok: false, error: { code: 'SYNTHETIC_FAILURE', message } });
      calls.push({
        boundary: 'synthetic-feedback-backend',
        method,
        params:
          method === 'file.placeAttachment'
            ? { ...params, data: '[synthetic image bytes]' }
            : structuredClone(params),
      });
      let result;
      if (method === 'workspace.list') {
        if (discoveryFailure) return fail('Workspace discovery unavailable');
        result = { workspaces };
      } else if (method === 'workspace.get')
        result = { workspace: workspaces.find((w) => w.id === params.workspaceId) };
      // Deliberately return duplicate, non-main-first rows across scopes, as older daemons do.
      else if (method === 'agent.list')
        result = { agents: agents.filter((a) => a.workspaceId === params.workspaceId) };
      else if (method === 'agent.get')
        result = { agent: agents.find((a) => a.id === params.agentId) };
      else if (method === 'voice.getWorkspaceVocabulary') result = { terms: [] };
      else if (method === 'file.placeAttachment') {
        const attachmentId = `00000000-0000-4000-8000-${String(uploads.length + 1).padStart(12, '0')}`;
        uploads.push({
          attachmentId,
          workspaceId: params.workspaceId,
          sha256: createHash('sha256')
            .update(params.data ?? '')
            .digest('hex'),
        });
        result = {
          ok: true,
          attachmentId,
          path: `.intent/attachments/${params.fileName}`,
          fileName: params.fileName,
          mimeType: 'image/png',
          size: Buffer.from(params.data ?? '', 'base64').length,
          uploadedAt: new Date().toISOString(),
        };
      } else if (method === 'agent.getQueue')
        result = {
          success: true,
          queue:
            mode === 'uncertain'
              ? sent.map((s) => ({ id: s.messageId, submissionIds: [s.messageId] }))
              : [],
        };
      else if (method === 'agent.getConversation')
        result = { messages: [], truncated: false, totalMessages: 0, nextToken: null };
      else if (method === 'agent.sendMessage') {
        sent.push(structuredClone(params));
        if (holdSend) await new Promise((resolve) => pendingSends.push(resolve));
        if (mode === 'uncertain') throw new Error('Synthetic connection lost after acceptance');
        if (mode === 'failed' && sent.length === 1)
          result = { success: false, error: 'Synthetic rejected delivery' };
        else result = { success: true };
      } else throw new Error(`Unscripted feedback external request: ${method}`);
      return { ok: true, result };
    },
  };
};
