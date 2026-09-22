// Exact Mermaid blocks 0 and 2 from workspace note
// 168ea39a-91f7-4aad-b5fe-cca09d948d31 (test note), read 2026-09-16.
// Preserve source labels, whitespace and authored directives; no test-only styling.
export const COMMIT_CHAIN_SOURCE = `flowchart LR
    C4["Commit #4 (latest)"] --> C3["Commit #3"]
    C3 --> C2["Commit #2"]
    C2 --> C1["Commit #1 (first)"]
    C4 -.points to.-> T4[Tree of files]
    T4 -.points to.-> F1[File: app.js]
    T4 -.points to.-> F2[File: readme.md]

    style C4 fill:#dbeafe
    style C3 fill:#dbeafe
    style C2 fill:#dbeafe
    style C1 fill:#dbeafe
`;

export const S3_LOGBOOK_SOURCE = `flowchart TD
    subgraph S3["☁️ S3 (the logbook — the ONE source of truth)"]
        L1[Push #1] --> L2[Push #2] --> L3[Push #3] --> L4["Push #4 (newest)"]
    end

    S3 -->|"replay/rebuild"| M1["Machine A (disk = cache)"]
    S3 -->|"replay/rebuild"| M2["Machine B (disk = cache)"]
    S3 -->|"replay/rebuild"| M3["Machine C (disk = cache)"]

    Dev1[Developer pushes] -->|"1. write to logbook"| S3
    Dev2[Developer fetches] -->|"2. check logbook,
then read from any cache"| M1

    style S3 fill:#fef3c7
    style M1 fill:#dcfce7
    style M2 fill:#dcfce7
    style M3 fill:#dcfce7
`;
