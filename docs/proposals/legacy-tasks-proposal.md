## **Motivation**

### **The Problem: Lost in the Weeds**

A common failure mode in agent-assisted development is the "rabbit hole problem":

1. User gives agent a high-level task: "Add user authentication"
2. Agent starts implementing and discovers: "Need database schema first"
3. Agent works on schema and discovers: "Need migration system first"
4. Agent works on migrations and discovers: "Need to choose migration tool"
5. Agent works on tool evaluation and discovers: "Need to understand deployment environment"

Soon, both the user and agent are **lost in the weeds** - multiple levels deep in prerequisites, unclear what the original goal was, and uncertain what to work on next.

### **The Core Insight**

The problem isn't that prerequisites exist - they're a natural part of development. The problem is:

1. **No visibility**: User can't see the emerging dependency structure
2. **No orchestration**: System doesn't know what to work on next
3. **No memory**: When a prerequisite completes, context is lost
4. **Agent confusion**: Single agent tries to juggle multiple concerns

### **The Solution: Task Graph**

A **dynamic task dependency graph** that:

- Emerges organically as agents discover prerequisites
- Provides clear visibility into what's blocking what
- Orchestrates which work happens when
- Maintains context across task boundaries
- Allows multiple agents to work on independent branches

## **Core Concepts**

### **Task**

A **Task** is a unit of goal-oriented work with:

- A clear objective and acceptance criteria
- A canonical note (agent's scratchpad + user's progress report)
- Dependencies on other tasks (prerequisites)
- One or more agents working on it
- A status (proposed, blocked, ready, in progress, complete)
- Tracked file changes (what files were created/modified/deleted)

Tasks are **first-class objects** at the same level as Agents, Comments, and Notes.

### **Task Graph**

The **Task Graph** is a directed acyclic graph (DAG) where:

- Nodes are tasks
- Edges are dependencies ("Task A requires Task B")
- The graph emerges dynamically as agents discover prerequisites
- The system uses the graph to determine what work is ready
- Agents can crawl the graph to understand the context of a task

### **Task Note**

Each task has a **canonical note** that serves dual purposes:

- **Agent's working memory**: Following the task-loop.md format (acceptance criteria, references, learnings, changes)
- **User's progress report**: Human-readable view of what's happening

The note is **loosely coupled** to task metadata:

- Task metadata (JSON) contains orchestration data: status, dependencies, timestamps
- Task note (Markdown) contains context and narrative: what was tried, what was learned
- They don't need to stay perfectly in sync - the note is the agent's scratchpad

## **User Flows**

### **Flow 1: Task Discovery**

**Scenario**: Agent discovers a prerequisite while working

```
1. User creates initial task: "Add real-time notifications"
   - System creates Task A
   - System creates Agent 1, assigns to Task A
   - System creates task note: task-notifications.md

2. Agent 1 starts working (Turn 1)
   - Researches codebase
   - Discovers: No WebSocket infrastructure exists
   - Realizes: Can't proceed without it

3. Agent 1 proposes prerequisite
   - Calls: propose_prerequisite_task({
       name: "Set up WebSocket infrastructure",
       reason: "Real-time notifications require WebSocket connection",
       acceptanceCriteria: [...]
     })
   - Updates task note with discovery
   - Enters WAITING state

4. System creates proposed task
   - Creates Task B (status: PROPOSED)
   - Creates task note: task-websocket.md
   - Links Task B as prerequisite of Task A
   - Task A status → BLOCKED

```

### **Flow 2: Task Creation**

**Scenario**: User reviews and accepts proposed prerequisite

```
1. System shows prerequisite proposal to user

   ┌─────────────────────────────────────────────────┐
   │ 🔍 Prerequisite Discovered                      │
   ├─────────────────────────────────────────────────┤
   │ Agent 1 discovered that Task A is blocked by:   │
   │                                                  │
   │ Task B: "Set up WebSocket infrastructure"       │
   │                                                  │
   │ Reason: Real-time notifications require         │
   │ WebSocket connection                            │
   │                                                  │
   │ Acceptance Criteria:                            │
   │ • WebSocket server running                      │
   │ • Client connection management                  │
   │ • Reconnection logic                            │
   │                                                  │
   │ [Edit Task] [Spawn Agent] [Reject]              │
   └─────────────────────────────────────────────────┘

2. User can:
   - Edit the task framing (adjust name, criteria, description)
   - Accept and spawn new agent
   - Reject (tell Agent 1 to find another approach)
   - Defer (accept task but don't spawn agent yet)

3. User clicks "Spawn Agent"
   - Task B status → NOT_STARTED
   - System creates Agent 2
   - Agent 2 assigned to Task B
   - Agent 2 begins work with task note as context

```

### **Flow 3: Task Completion**

**Scenario**: Agent completes a task

```
1. Agent 2 finishes implementing WebSocket infrastructure
   - All acceptance criteria met
   - Tests passing
   - Task note updated with final changes

2. Agent 2 marks task complete
   - Calls: complete_task({
       summary: "Implemented Socket.io server and client with reconnection"
     })
   - Task B status → COMPLETE
   - Task B completedAt timestamp recorded

3. System processes completion
   - Finds all tasks that depend on Task B
   - Checks if they're now unblocked
   - Task A has only one dependency (Task B) → now unblocked!
   - Task A status → READY

```

### **Flow 4: Unblocking Parent Tasks**

**Scenario**: User resumes work on unblocked task

```
1. System detects Task A is ready
   - Emits event: task:ready
   - UI shows Task A with 🟢 pulsing green indicator

2. User sees ready task in task overview
   - Clicks into Task A
   - Opens enhanced note interface showing:
     * Task metadata (status, dependencies, timeline)
     * Task note (agent's previous context)
     * Completed prerequisites (links to their notes)

3. User clicks "Resume Task"
   - System determines which agent to use:
     * Option 1: Resume with Agent 1 (original agent)
     * Option 2: Spawn new agent
     * User can choose or system picks default

4. Agent resumes with full context
   - Receives message: "Your task was blocked by Task B, which is now complete"
   - Gets link to Task B's note to understand what was built
   - Reads own task note to recall previous context
   - Continues work on Task A

```

### **Flow 5: Architectural Review**

**Scenario**: Agent gets stuck or goes too deep

```
1. Agent 4 is working on Task D (3 levels deep)
   - Discovers yet another prerequisite
   - Realizes: This is getting complex
   - Depth check: Already 3 levels deep

2. Agent requests architectural review
   - Calls: request_architectural_review({
       issue: "Database infrastructure more complex than expected",
       context: "3 levels deep, started with user profiles, now on DB infra",
       options: [
         "Continue breaking down (migrations, pooling, credentials)",
         "Use database-as-a-service to skip infrastructure",
         "Set up SQLite for now, defer production DB"
       ],
       recommendation: "SQLite for now - unblocks quickly"
     })
   - Task D status → NEEDS_REVIEW
   - Agent enters WAITING state

3. System shows review to user
   - Presents the situation and options
   - User can discuss with agent
   - User makes decision

4. User responds: "Good call, use SQLite"
   - Agent archives complex Task D
   - Agent creates simpler Task D': "Set up SQLite"
   - Completes it quickly
   - Parent tasks unblock in sequence

```

## **Task ↔ Note Relationship**

### **Loose Coupling Philosophy**

The task note and task metadata are **intentionally loosely coupled**:

**Task Metadata** (task-abc.json):

- Orchestration data for the system
- Status, dependencies, timestamps
- File changes (what was created/modified/deleted)
- Lightweight, machine-readable

**Task Note** (task-abc.md):

- Context and narrative for humans and agents
- Follows task-loop.md format
- References, learnings, implementation notes
- Rich, human-readable

### **Why Loose Coupling?**

1. **Flexibility**: User can edit note without breaking system orchestration
2. **Simplicity**: No complex sync logic between note and metadata
3. **Independence**: Note is agent's scratchpad, metadata is system's data
4. **Resilience**: Changes to one don't require changes to the other

### **What Belongs in Metadata vs Note?**

**Task Metadata** (system needs to know):

- Status, dependencies, timestamps
- File changes (demonstrable progress, impact analysis)

**Task Note** (context and narrative):

- Why decisions were made
- What approaches were tried
- What was learned
- References to important resources
- Implementation notes and observations

File changes are tracked in metadata because the system needs them for:

- Demonstrating concrete progress
- Understanding what a completed prerequisite actually built
- Detecting potential conflicts between tasks
- Providing context when resuming blocked tasks

### **The Note as Canonical Context**

When an agent works on a task, the note is **THE** source of context:

- Agent reads note to understand previous work
- Agent updates note each turn (references, learnings, changes)
- User reads note to understand progress
- User can edit note to provide guidance

When a task is resumed after being blocked:

- New agent reads the note to understand context
- New agent reads completed prerequisite notes to understand what was built
- Note provides continuity across agent handoffs

## **Design Principles**

### **1. Modularity**

Tasks should be **self-contained modules**:

- Clear boundaries and single responsibility
- Independently testable
- Produces reusable components

Agents are prompted to think in terms of:

- **Implementation tasks**: Build self-contained modules
- **Integration tasks**: Connect modules together

### **2. Agents Wait, System Orchestrates**

Agents don't switch tasks autonomously:

- When blocked, agent enters WAITING state
- System manages the task graph
- System determines what's ready to work on
- User decides when to resume tasks

### **3. User in Control**

User has final say on:

- Whether to accept proposed prerequisites
- How to frame tasks
- When to spawn agents
- When to resume blocked tasks
- When to request architectural review

### **4. Organic Discovery**

The task graph **emerges** rather than being planned upfront:

- Start with high-level goal
- Discover prerequisites as you go
- Graph structure reflects actual dependencies
- No need to plan everything in advance

## **Success Criteria**

The task graph system succeeds if:

1. **Visibility**: User can always see what's blocking what
2. **Clarity**: Always clear what to work on next
3. **Context preservation**: No context lost across task boundaries
4. **Escape hatch**: Agent can request help when stuck
5. **Modularity**: Work naturally decomposes into reusable modules
6. **Completion**: Complex tasks actually get finished (not abandoned in the weeds)

## **Non-Goals**

What this system is NOT:

- **Not a project planner**: Not for upfront planning of all tasks
- **Not a ticket system**: Not for tracking bugs or feature requests
- **Not a workflow engine**: Not for rigid, predefined processes
- **Not a dependency manager**: Not for code-level dependencies

This is specifically for **agent-assisted development** where the structure of work emerges through discovery.
