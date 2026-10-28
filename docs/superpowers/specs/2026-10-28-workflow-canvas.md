# Dify-style production canvas

## Authority

The owner clarified that Studio should be a chat-driven agent workflow, selected from Arthur / Not Yet / a new template, with visible connected stages, research/script feedback, approvals, generation and editing. They explicitly chose Dify's canvas UI, confirmed the proposed center canvas/right configuration/chat composition, then said “go”. This authorizes implementation directly. Earlier “do not make anything yet” is superseded by “go”. English UI. Existing channel analytics stay intact; server deployment and paid external execution during development remain out of scope.

## Experience

Studio opens a template library, with Arthur and Not Yet bound to existing playbooks, plus Create workflow. Recent production conversations are actual workflow runs, not the 11 imported YouTube catalog records. Keep old records recoverable and their legacy editor links working; do not delete them or pretend they were generated here.

Opening a template reveals a Dify-style workflow editor: full-height bounded node canvas, node library, draggable typed cards, visible connections, zoom/pan/fit controls, selected-node configuration on the right, editable instructions and human-review policy. Save name, graph, positions and node settings server-side with optimistic version checking. New templates are actual persisted records. Invalid/disconnected/cyclic graphs cannot be saved or executed. Use React Flow rather than recreating a graph engine.

Run starts one explicit new production and persistent chat, from the selected saved template. The graph is snapshotted into the run. A later template edit must not mutate an existing run. Node status is derived from actual quote/provider/document/job state. User messages are durable production direction, used by the next/revised node; system acknowledgements must not pretend to be generated research. AI output appears in the conversation and artifact panel when a real provider completed it. Missing connections yield actionable blocked states, not synthetic content. Reviews pause execution and bind the exact current document revision. Every provider operation retains the existing quote, one-use approval and budget checks. Rendering uses the existing queue/worker. No automatic publishing.

Research uses the existing source-aware research operation. It must identify research leads and require verified sources rather than inventing live research/views. A dedicated browser research tool is not silently assumed to exist. Builtin playbook instructions remain intact and authoritative; their required research/concept, complete-script, visual-plan and final-review pauses are retained.

## Shared TypeScript contract (packages/core/src/workflow.ts; re-export from index)

`WorkflowNodeKind = 'brief'|'research'|'script'|'storyboard'|'voiceover'|'media'|'render'|'review'|'upload_pack'`.

`WorkflowNode = {id:string;kind:WorkflowNodeKind;title:string;instructions:string;position:{x:number;y:number};review:boolean;provider?:'manual'|'flow'|'webhook';media_kind?:'image'|'video'}`.

`WorkflowGraph = {nodes:WorkflowNode[];edges:{id:string;source:string;target:string}[];viewport?:{x:number;y:number;zoom:number}}`.

`WorkflowTemplate = {id:string;name:string;description:string;channel:string;playbook_path:string;instructions:string;graph:WorkflowGraph;version:string;updated:string;builtin:boolean}`. Template IDs are logical keys (arthur, not-yet, or custom-generated keys), not necessarily PocketBase record IDs. Builtin defaults are returned without GET mutations; PUT persists an override. A template's selected channel/playbook supplies real production context.

`WorkflowNodeStatus = 'idle'|'ready'|'running'|'waiting_approval'|'waiting_review'|'completed'|'failed'|'blocked'`.

`WorkflowNodeState = {status:WorkflowNodeStatus;quote?:{id:string;operation:string;provider:string;units:number;est_cost:number;currency:string;expires:string;note:string};job_id?:string;document?:'riset.md'|'script.md'|'storyboard.md'|'upload-pack.md';output?:string;error?:string;output_revision?:string;beat?:number}`.

`WorkflowMessage = {id:string;role:'user'|'assistant'|'system';content:string;node_id?:string;created_at:string}`.

`WorkflowRun = {id:string;template_id:string;template_name:string;channel:string;episode:string;graph:WorkflowGraph;playbook_path:string;instructions:string;brief:string;status:'idle'|'running'|'waiting'|'completed'|'failed';states:Record<string,WorkflowNodeState>;messages:WorkflowMessage[];revision:number;created:string;updated:string}`.

Export `workflowKinds` and `workflowNodeInfo: Record<WorkflowNodeKind,{label:string;description:string}>`, `defaultWorkflowGraph():WorkflowGraph`, `validateWorkflowGraph(value:unknown):WorkflowGraph`, `readyWorkflowNodes(graph:WorkflowGraph,states:Record<string,WorkflowNodeState>):WorkflowNode[]`. Root/leaf validity, reachable DAG and bounded input required. Exactly one brief root. At most 40 nodes/100 edges; no self/dangling/duplicate edges. Ready nodes follow dependencies, never pixel position.

## Server contract

Exports from server/workflows.ts:

- `workflowLibrary()` returns `{templates:WorkflowTemplate[];runs:WorkflowRun[]}`.
- `workflowTemplate(id:string)` returns WorkflowTemplate.
- `createWorkflowTemplate(input:unknown)` returns WorkflowTemplate; accepts `{name,description?,channel,playbook_path?,instructions?,graph?}`.
- `saveWorkflowTemplate(id:string,input:unknown)` returns WorkflowTemplate; accepts same fields plus required `expected_version:string`, graph required.
- `createWorkflowRun(input:unknown,owner:string)` returns `{run:WorkflowRun;detail:Awaited<ReturnType<typeof episodeDetails>>}`; input `{template:string,title:string,brief:string}`.
- `workflowRunData(id:string)` returns same run/detail pair.
- `messageWorkflowRun(id:string,input:unknown,owner:string)` returns same; input `{content:string,node_id?:string,expected_revision:number}`.
- `actWorkflowRun(id:string,input:unknown,owner:string)` returns same; input `{action:'prepare'|'approve'|'review'|'sync'|'revise',node_id?:string,quote_id?:string,document_revision?:string,expected_revision:number}`.

`prepare` completes a brief root and prepares the first dependency-ready node or requested ready node. It creates only a spending quote, never calls a paid provider. Manual media/review nodes expose real actions and artifact requirements. `approve` requires the current matching quote and uses approveQuote. Success stores output/document/job state, waits for configured human review, or completes. `review` verifies current document hash; Script explicitly stores approved_revision; manual review checks actual output/media/render. `sync` reads existing job/quote/document outcomes; never blindly retries. `revise` invalidates the requested node and downstream states, with explicit safeguards against active jobs/ambiguous provider calls and stale source documents. User then prepares a new quote; no automatic paid retry.

Serialize mutations per run and require optimistic revision. No client-supplied episode/channel/quote may redirect execution outside the run. Graph/playbook paths remain vault-confined. Persistence is additive in private workflow_templates/workflow_runs collections. No credential/token appears in chat or template responses.

## API routes owned by root

GET/POST `/api/workflows`; GET/PUT `/api/workflows/:id`; POST `/api/workflow-runs`; GET `/api/workflow-runs/:id`; POST `/api/workflow-runs/:id/messages`; POST `/api/workflow-runs/:id/actions`. Reuse owner authentication and mutation-origin checks.

## Canvas component contract (UI worker)

`WorkflowCanvas` exported from components/workflow-canvas.tsx:
`{graph:WorkflowGraph;onChange:(graph:WorkflowGraph)=>void;selected:string;onSelect:(id:string)=>void;states?:Record<string,WorkflowNodeState>;readOnly?:boolean}`.

It owns canvas, node library, node/edge add/delete/connect/drag, zoom/pan/fit, keyboard and selection; selection/configuration panel is composed by root outside it. Node kind semantics via workflowNodeInfo. Do not mutate props. Keep brief root protected. UI status labels honest. Optional on-validation error UI local. React Flow style import in its stylesheet or component permitted, but do not edit globals (root owns imports).

## Verification and limits

Automated tests must cover graph validation/dependencies, snapshots, version conflicts, auth/origin, no-production imports, quote replay/cross-run rejection, missing config, output/review hashes and job states. Browser checks: template selection/create/save/reload; node drag/connect/delete/settings; invalid graph; Run/brief/chat persistence; blocked provider state; paid review safeguards; responsive canvas and legacy analytics/editor routes. Do not call actual paid providers during testing. Clearly label any disposable fixture and archive only that owned fixture after verifying no new work appeared.

Desktop reference is Dify's canvas topology and interaction, adapted to the incumbent graphite app shell; no new decorative identity/comp round. Narrow screens use canvas/config/chat tabs, preserving zoom controls and meaningful action access. Finish with desktop/mobile/owner-width captures, one detector pass, fresh finish review and scoped design documentation.

## Implemented constraints and recovery

Each canonical output operation is unique in a graph; media permits one image and one video stage, review nodes may repeat. This prevents concurrent stages overwriting a single production document. Edited waiting-review documents can be explicitly synced into a fresh exact-output review; visual-plan coverage is revalidated against the complete approved script. Workflow render snapshots resolve explicit selected beat assets or unique selected beat metadata and reject ambiguous takes; one narration take must be selected. No live web-search tool or arbitrary conditional/loop executor was added. See docs/workflow-canvas-verification.md for observed checks and current connector limits.
