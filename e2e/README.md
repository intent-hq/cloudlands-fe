# Build Smoke Tests

Playwright smoke tests that drive the **packaged** Electron app (`dist-electron/`) end to
end with the mock ACP agent. This directory holds only the build-smoke suite; the former
`all-e2e` Playwright suite was retired because no workflow ran it.

## Layout

| File                     | Role                                                                                               |
| ------------------------ | -------------------------------------------------------------------------------------------------- |
| `build-smoke.config.ts`  | Playwright config: `testMatch: **/build-smoke*.e2e.ts`, sequential, 1 retry                        |
| `build-smoke-*.e2e.ts`   | The specs (agent chat, commit, follow-up, multi-agent, navigation, providers, editorial workspace) |
| `build-smoke-helpers.ts` | Locates and launches the packaged binary; workspace/agent helpers                                  |
| `test-helpers.ts`        | `launchApp` — launches the built (unpackaged) app from `dist/`                                     |
| `mock-acp-agent.js`      | Scripted ACP agent the specs point the app at via `MOCK_AGENT_SCRIPT_PATH`                         |

## Running

The gate needs a packaged app. Build one first (or point `PACKAGED_APP_PATH` at an
existing binary); `scripts/run-build-smoke-if-packaged.ts` exits with an error otherwise.

```bash
pnpm run dist:mac                 # or set PACKAGED_APP_PATH=/path/to/Intent binary
pnpm run test:build-smoke         # whole suite
pnpm run test:build-smoke:providers
pnpm run test:build-smoke -- e2e/build-smoke-commit.e2e.ts --reporter=list
pnpm run test:build-smoke -- --grep "multi-provider"
```

Extra arguments after `--` are forwarded to `playwright test`.

## Reports

`e2e-reports/` is git-ignored:

- HTML report: `e2e-reports/build-smoke-html/index.html`
- Traces, screenshots, and video on failure: `e2e-reports/build-smoke-results/`
