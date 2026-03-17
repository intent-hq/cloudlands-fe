# Agents

Guidance for AI coding agents working in this codebase.

## Module Boundaries

Before creating or moving utility modules, read the **[Module Boundary Guide](docs/MODULE_BOUNDARY_GUIDE.md)**.

Key rules:

- **Never import from a feature's `main/` subtree in renderer code** (or vice versa)
- **Place shared utilities in process-safe directories** — see the decision flowchart in the guide
- **Don't export utility functions from orchestration modules** — extract them to a dedicated `utils/` file
- **Keep utilities dependency-light** — no stores, services, or side effects

## Verification

After any structural change (moving files, changing imports, extracting modules), run:

```bash
npx vitest run <targeted-test-files>       # tests for touched features
npx tsc -p tsconfig.json --noEmit          # renderer typecheck
npx tsc -p tsconfig.main.json --noEmit     # main process typecheck
npx tsc -p tsconfig.preload.json --noEmit  # preload typecheck
```

All three typechecks must pass. The main typecheck requires `npm run generate:build-config` to have been run at least once.

## Project Structure Quick Reference

```
src/
├── shared/          # Cross-process utilities (main + renderer)
├── lib/utils/       # Renderer-only shared utilities
├── main/utils/      # Main-process shared utilities
├── features/
│   └── <name>/
│       ├── utils/   # Feature-local utilities
│       ├── main/    # Feature's main-process code
│       └── ...      # Feature's renderer code
├── routes/          # SvelteKit pages
└── preload/         # Electron preload scripts
```

## Further Reading

- [Module Boundary Guide](docs/MODULE_BOUNDARY_GUIDE.md) — detailed placement rules and refactoring patterns
- [Developer Guide](docs/DEVELOPER_GUIDE.md) — setup, commands, and project overview
- [Component Responsibilities](docs/COMPONENT_RESPONSIBILITIES.md) — UI component organization