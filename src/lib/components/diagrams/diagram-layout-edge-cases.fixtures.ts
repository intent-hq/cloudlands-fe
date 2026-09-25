function mermaid(title: string, description: string, source: string) {
  return { kind: 'mermaid' as const, title, description, source };
}

export const EXTRA_DIAGRAM_LAYOUT_CASES = {
  'edge-eight-way-fanout': mermaid(
    'Eight-way fan-out',
    'Many labeled branches leave one decision.',
    `flowchart TD
    A{Route request} -->|North| B[North]
    A -->|South| C[South]
    A -->|East| D[East]
    A -->|West| E[West]
    A -->|Local| F[Local]
    A -->|Remote| G[Remote]
    A -->|Cached| H[Cache]
    A -->|Unknown| I[Review]`,
  ),
  'edge-eight-way-fanin': mermaid(
    'Eight-way fan-in',
    'Independent producers feed a single consumer.',
    `flowchart TD
    A[Web] --> Z[(Event store)]
    B[Mobile] --> Z
    C[Worker] --> Z
    D[Import] --> Z
    E[Webhook] --> Z
    F[Timer] --> Z
    G[CLI] --> Z
    H[Audit] --> Z
    Z --> R[Read model]`,
  ),
  'edge-braided-diamonds': mermaid(
    'Braided decisions',
    'Two decisions cross-connect to shared outcomes.',
    `flowchart LR
    A[Request] --> B{Identity valid?}
    A --> C{Policy allows?}
    B -->|Yes| D[Accepted]
    B -->|No| E[Review]
    C -->|Yes| D
    C -->|No| E
    E -->|Appeal| B
    D --> F[Audit]
    E --> F`,
  ),
  'edge-three-parallel-labels': mermaid(
    'Three parallel labeled routes',
    'Three meanings share the same pair of endpoints.',
    `flowchart LR
    A[Client] -->|Request| B[Service]
    A -.->|Metadata| B
    A ==>|Priority| B
    B -->|Response| A`,
  ),
  'edge-four-self-loops': mermaid(
    'Self-loops on different shapes',
    'Loops attach to a rectangle, decision, database, and terminal.',
    `flowchart LR
    A[Worker] -->|Poll| A
    A --> B{Ready?}
    B -->|Recheck| B
    B --> C[(Store)]
    C -->|Compact| C
    C --> D([Idle])
    D -->|Wait| D`,
  ),
  'edge-two-feedback-loops': mermaid(
    'Independent feedback loops',
    'Short and long return paths share a processing pipeline.',
    `flowchart TD
    A[Receive] --> B[Validate] --> C[Transform] --> D[Write] --> E[Publish]
    C -->|Invalid mapping| B
    E -->|Retry delivery| D
    E -.->|Replay from source| A`,
  ),
  'edge-shortcut-ladder': mermaid(
    'Shortcut ladder',
    'Each stage can skip ahead to the final result.',
    `flowchart TD
    A[Memory cache] -->|Miss| B[Disk cache]
    B -->|Miss| C[Regional cache]
    C -->|Miss| D[Origin]
    A -->|Hit| E[Return result]
    B -->|Hit| E
    C -->|Hit| E
    D --> E`,
  ),
  'edge-unequal-merge': mermaid(
    'Four branches of unequal depth',
    'A join waits for one, two, three, and four processing steps.',
    `flowchart TD
    A[Start] --> B[Fast path] --> Z[Join]
    A --> C[Read] --> D[Parse] --> Z
    A --> E[Download] --> F[Decode] --> G[Validate] --> Z
    A --> H[Authorize] --> I[Query] --> J[Map] --> K[Persist] --> Z`,
  ),
  'edge-reversed-declarations': mermaid(
    'Nodes declared in reverse order',
    'Source declaration order must not determine the reading order.',
    `flowchart TD
    Z[Finish]
    Y[Publish]
    X[Build]
    B{Approved?}
    A[Start]
    A --> B
    B -->|Yes| X
    B -->|No| Z
    X --> Y --> Z`,
  ),
  'edge-disconnected-cycles': mermaid(
    'Disconnected cycles and isolated nodes',
    'Two cyclic components sit beside an independent node.',
    `flowchart LR
    A[Poll] --> B[Process] --> A
    C[Request] --> D[Response] --> E[Backoff] --> C
    F[Offline observer]`,
  ),
  'edge-compact-diamond-grid': mermaid(
    'Decision grid',
    'Repeated branches reconverge before splitting again.',
    `flowchart TD
    A{Entry} --> B{Left check}
    A --> C{Right check}
    B --> D[Read]
    B --> E[Write]
    C --> E
    C --> F[Ignore]
    D --> G{Final check}
    E --> G
    F --> G
    G -->|Accept| H[Done]
    G -->|Reject| I[Stop]`,
  ),
  'edge-many-roots-late-join': mermaid(
    'Many roots with late joins',
    'New entry points join different stages without becoming extra steps.',
    `flowchart TD
    A[Fresh install] --> B[Create account] --> C[Sign in] --> D[Choose team] --> E[Open project]
    F[Returning user] --> C
    G[Team invitation] --> D
    H[Deep link] --> E
    I[Restore window] --> E`,
  ),
  'edge-subgraph-siblings': mermaid(
    'Sibling groups with shared dependencies',
    'Three services use two common infrastructure groups.',
    `flowchart TD
    subgraph Apps[Applications]
      A[Web]
      B[Mobile]
      C[Batch]
    end
    subgraph Data[Data services]
      D[(Primary database)]
      E[(Cache)]
    end
    subgraph Ops[Operations]
      F[Metrics]
      G[Logs]
    end
    A --> D
    B --> E
    C --> D
    A -.-> F
    B -.-> G
    C -.-> F
    E --> D`,
  ),
  'edge-four-nested-groups': mermaid(
    'Four nested boundaries',
    'Deep containment with entry and exit routes.',
    `flowchart TD
    A[Outside client]
    subgraph Org[Organization]
      subgraph Region[Region]
        subgraph Cluster[Cluster]
          subgraph Pod[Pod]
            B[Worker] --> C[(Local state)]
          end
          D[Queue]
        end
        E[Gateway]
      end
      F[Audit]
    end
    A --> E --> D --> B
    C --> F`,
  ),
  'edge-long-group-titles': mermaid(
    'Long boundary titles',
    'Headers must leave enough space above nodes and connectors.',
    `flowchart LR
    subgraph A[Customer controlled environment with restricted network access]
      X[Client]
    end
    subgraph B[Organization managed processing and compliance boundary]
      Y[Gateway] --> Z[Worker]
    end
    X -->|Authenticated request| Y`,
  ),
  'edge-group-local-directions': mermaid(
    'Local directions inside groups',
    'A horizontal diagram contains authored vertical subgraphs.',
    `flowchart LR
    subgraph A[Preparation]
      direction TB
      A1[Read] --> A2[Validate] --> A3[Package]
    end
    subgraph B[Delivery]
      direction TB
      B1[Upload] --> B2[Verify] --> B3[Publish]
    end
    A --> B`,
  ),
  'edge-group-return-trip': mermaid(
    'Round trip across groups',
    'Request and response cross a boundary in opposite directions.',
    `flowchart LR
    subgraph Device[Device]
      A[Editor]
      B[View]
    end
    subgraph Server[Server]
      C[API]
      D[(Store)]
    end
    A -->|Save| C
    C -->|Write| D
    D -->|Updated record| B
    B -->|Edit again| A`,
  ),
  'edge-one-node-groups': mermaid(
    'Many single-node groups',
    'Small group frames should remain readable without dominating the graph.',
    `flowchart LR
    subgraph A[Client]
      A1[Request]
    end
    subgraph B[Edge]
      B1[Proxy]
    end
    subgraph C[Runtime]
      C1[Service]
    end
    subgraph D[Storage]
      D1[(Database)]
    end
    A1 --> B1 --> C1 --> D1`,
  ),
  'edge-mixed-node-shapes': mermaid(
    'Mixed node shapes',
    'Ports attach to the actual outlines of common Mermaid shapes.',
    `flowchart LR
    A([Start]) --> B[/Input/]
    B --> C{Check}
    C --> D[[Subroutine]]
    D --> E[(Database)]
    E --> F((Event))
    F --> G{{Prepare}}
    G --> H([End])`,
  ),
  'edge-long-identifiers': mermaid(
    'Unbroken identifiers',
    'Paths, identifiers, and hostnames put pressure on label wrapping.',
    `flowchart TD
    A["organization_workspace_membership_permissions"] --> B["/api/v1/organizations/workspaces/invitations/accept"]
    B --> C["collaboration.internal.example.company"]`,
  ),
  'edge-mixed-label-lengths': mermaid(
    'Short and very long neighbors',
    'One large label should not obscure nearby small nodes.',
    `flowchart LR
    A[Go] --> B[Confirm that this invitation belongs to the account currently signed in on this device]
    B --> C{OK?}
    C -->|Yes| D[Done]
    C -->|No| E[Ask the host administrator to send a replacement invitation]`,
  ),
  'edge-multilingual-decisions': mermaid(
    'Multilingual decisions',
    'Branch placement must not depend on English Yes and No labels.',
    `flowchart TD
    A["確認 • Review"] --> B{"続行しますか？"}
    B -->|はい| C["接続する"]
    B -->|いいえ| D["戻る"]
    C --> E["Terminé • 完了"]
    D --> E`,
  ),
  'edge-punctuation-labels': mermaid(
    'Punctuation and symbols',
    'Quoted labels contain punctuation that resembles diagram syntax.',
    `flowchart LR
    A["Input: a → b"] -->|"status = 200"| B{"Ready (v2)?"}
    B -->|"yes / continue"| C["Save #42 & notify"]
    B -->|"no / retry"| D["Retry: 5s, 10s, 30s"]`,
  ),
  'edge-styled-branches': mermaid(
    'Authored colors and line styles',
    'Default layout preserves user-supplied node and connector styling.',
    `flowchart TD
    A[Request] --> B{Valid?}
    B -->|Yes| C[Accepted]
    B -.->|No| D[Rejected]
    C ==> E[Published]
    classDef success fill:#dcfce7,color:#14532d,stroke:#16a34a
    classDef failure fill:#fee2e2,color:#7f1d1d,stroke:#dc2626
    class C,E success
    class D failure`,
  ),
  'edge-explicit-breaks': mermaid(
    'Explicit line breaks',
    'Multiline node and edge labels retain their authored structure.',
    `flowchart TD
    A["Open invitation<br/>Review host<br/>Confirm identity"] --> B{"Saved session<br/>still valid?"}
    B -->|"Yes<br/>Reuse identity"| C["Connect<br/>Fetch role"]
    B -->|"No<br/>Sign in again"| D["Publish proof<br/>Wait for verification"]
    D --> C`,
  ),
  'edge-sequence-six-actors': mermaid(
    'Sequence with six participants',
    'A long request chain returns through every participant.',
    `sequenceDiagram
    actor User
    participant UI
    participant API
    participant Queue
    participant Worker
    participant Store
    User->>UI: Submit
    UI->>API: Request
    API->>Queue: Enqueue
    Queue->>Worker: Deliver
    Worker->>Store: Write
    Store-->>Worker: Saved
    Worker-->>API: Complete
    API-->>UI: Result
    UI-->>User: Ready`,
  ),
  'edge-sequence-nested-alt': mermaid(
    'Nested sequence alternatives',
    'Success, recovery, and failure branches share nested frames.',
    `sequenceDiagram
    participant Client
    participant Host
    Client->>Host: Connect
    alt Session valid
      Host-->>Client: Welcome
    else Session missing
      Client->>Host: Publish identity proof
      alt Proof accepted
        Host-->>Client: New session
      else Proof rejected
        Host-->>Client: Explain rejection
      end
    end`,
  ),
  'edge-sequence-parallel': mermaid(
    'Parallel sequence work',
    'Parallel frames contain independent messages and a shared result.',
    `sequenceDiagram
    participant UI
    participant API
    participant Cache
    participant DB
    UI->>API: Load workspace
    par Read fast state
      API->>Cache: Read cache
      Cache-->>API: Cached values
    and Read durable state
      API->>DB: Query records
      DB-->>API: Records
    end
    API-->>UI: Merged state`,
  ),
  'edge-sequence-activation': mermaid(
    'Nested activations and self-call',
    'Activation bars and a recursive operation share one lifeline.',
    `sequenceDiagram
    participant Client
    participant Service
    Client->>+Service: Start
    Service->>+Service: Validate recursively
    Service-->>-Service: Valid
    Service-->>-Client: Complete`,
  ),
  'edge-sequence-long-notes': mermaid(
    'Long sequence notes',
    'Notes beside and across actors compete with long messages.',
    `sequenceDiagram
    participant Device
    participant Host
    Note over Device,Host: The host verifies the proof before granting the invitation scope to this device
    Device->>Host: Request a new session for the currently selected account identity
    Note right of Host: Check expiry, host identity, account identity, and effective permissions
    Host-->>Device: Return the verified session and current workspace role`,
  ),
  'edge-sequence-loop-break': mermaid(
    'Retry loop with an early exit',
    'Nested loop and break frames retain readable labels.',
    `sequenceDiagram
    participant Client
    participant Server
    loop Until accepted
      Client->>Server: Retry request
      break Account disabled
        Server-->>Client: Stop retrying
      end
      Server-->>Client: Try later
    end`,
  ),
  'edge-state-compound': mermaid(
    'Compound state machine',
    'Nested states have local and outer transitions.',
    `stateDiagram-v2
    [*] --> Idle
    Idle --> Active: start
    state Active {
      [*] --> Loading
      Loading --> Ready
      Ready --> Refreshing: refresh
      Refreshing --> Ready
    }
    Active --> Failed: error
    Failed --> Active: retry
    Active --> [*]: stop`,
  ),
  'edge-state-fork-join': mermaid(
    'State fork and join',
    'Concurrent branches synchronize before completion.',
    `stateDiagram-v2
    state fork_state <<fork>>
    state join_state <<join>>
    [*] --> fork_state
    fork_state --> FetchProfile
    fork_state --> FetchPermissions
    FetchProfile --> join_state
    FetchPermissions --> join_state
    join_state --> Ready
    Ready --> [*]`,
  ),
  'edge-state-choice': mermaid(
    'State choice and recovery',
    'A choice has accepted, denied, and retry outcomes.',
    `stateDiagram-v2
    state decision <<choice>>
    [*] --> Checking
    Checking --> decision
    decision --> Connected: allowed
    decision --> Denied: forbidden
    decision --> Waiting: unavailable
    Waiting --> Checking: retry
    Connected --> [*]
    Denied --> [*]`,
  ),
  'edge-class-inheritance': mermaid(
    'Class inheritance diamond',
    'Inheritance, composition, and dependency use different arrowheads.',
    `classDiagram
    Entity <|-- User
    Entity <|-- Team
    User <|-- Member
    Team "1" *-- "many" Member
    Member ..> Permission
    class Entity {
      +String id
    }
    class Permission {
      +canEdit() bool
    }`,
  ),
  'edge-class-long-signatures': mermaid(
    'Long class signatures',
    'Methods, generics, and large attribute sets stress class widths.',
    `classDiagram
    class InvitationService {
      +String organizationIdentifier
      +String workspaceIdentifier
      +DateTime expirationTimestamp
      +verifyInvitationIdentity(accountIdentifier) bool
      +resolveEffectiveWorkspacePermissions(sessionIdentifier) PermissionSet
    }
    class PermissionSet {
      +List~String~ capabilities
      +bool canManageWorkspaces
    }
    InvitationService --> PermissionSet`,
  ),
  'edge-er-hub': mermaid(
    'Entity relationship hub',
    'A shared account participates in several cardinality relationships.',
    `erDiagram
    ACCOUNT ||--o{ SESSION : owns
    ACCOUNT ||--o{ INVITATION : receives
    ACCOUNT ||--o{ MEMBERSHIP : holds
    TEAM ||--o{ MEMBERSHIP : includes
    TEAM ||--o{ WORKSPACE : contains
    WORKSPACE ||--o{ INVITATION : grants
    ACCOUNT {
      string id PK
      string provider
      string display_name
    }
    MEMBERSHIP {
      string account_id FK
      string team_id FK
      string role
    }`,
  ),
  'edge-er-recursive': mermaid(
    'Recursive entity relationships',
    'A folder owns subfolders and documents while users share access.',
    `erDiagram
    FOLDER ||--o{ FOLDER : contains
    FOLDER ||--o{ DOCUMENT : stores
    USER }o--o{ DOCUMENT : collaborates
    DOCUMENT ||--o{ REVISION : tracks
    REVISION }o--|| USER : authored_by`,
  ),
};
