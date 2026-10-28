"use client";

import { memo, useCallback, useEffect, useId, useRef, useState } from "react";
import {
  Background, BackgroundVariant, Handle, MarkerType, Position, ReactFlow, ReactFlowProvider,
  applyEdgeChanges, applyNodeChanges, useNodesInitialized, useReactFlow, useStore, useViewport,
  type Connection, type Edge, type EdgeChange, type Node, type NodeChange, type NodeProps,
} from "@xyflow/react";
import {
  ArrowRight, CheckCheck, Circle, CircleAlert, ClipboardList, Film, Hand, Image,
  Keyboard, LayoutPanelTop, LockKeyhole, Maximize, Mic, MousePointer2, Pause,
  Plus, Search, ShieldCheck, Sparkles, Trash2, Upload, X, ZoomIn, ZoomOut,
  type LucideIcon,
} from "lucide-react";
import {
  workflowKinds, workflowNodeInfo,
  type WorkflowGraph, type WorkflowNode, type WorkflowNodeKind, type WorkflowNodeState,
  type WorkflowNodeStatus,
} from "@studio/core";
import "@xyflow/react/dist/style.css";
import "./workflow-canvas.css";

export interface WorkflowCanvasProps {
  graph: WorkflowGraph;
  onChange: (graph: WorkflowGraph) => void;
  selected: string;
  onSelect: (id: string) => void;
  states?: Record<string, WorkflowNodeState>;
  readOnly?: boolean;
}

type CanvasNode = Node<{
  node: WorkflowNode;
  state?: WorkflowNodeState;
  readOnly: boolean;
}, "workflow">;

const kindIcons: Record<WorkflowNodeKind, LucideIcon> = {
  brief: ClipboardList, research: Search, script: Sparkles, storyboard: LayoutPanelTop,
  voiceover: Mic, media: Image, render: Film, review: ShieldCheck, upload_pack: Upload,
};
const statusLabels: Record<WorkflowNodeStatus, string> = {
  idle: "Not started", ready: "Ready", running: "Running", waiting_approval: "Approval needed",
  waiting_review: "Review needed", completed: "Completed", failed: "Failed", blocked: "Blocked",
};

const WorkflowCard = memo(function WorkflowCard({ data, selected, isConnectable }: NodeProps<CanvasNode>) {
  const { node, state, readOnly } = data;
  const Icon = kindIcons[node.kind];
  const StatusIcon = state?.status === "completed" ? CheckCheck
    : state?.status === "failed" || state?.status === "blocked" ? CircleAlert
    : state?.status === "waiting_review" || state?.status === "waiting_approval" ? Pause : Circle;
  return <div className={`workflow-node workflow-kind-${node.kind}${selected ? " is-selected" : ""}${state ? ` workflow-state-${state.status}` : ""}`}>
    {node.kind !== "brief" && <Handle type="target" position={Position.Left} isConnectable={isConnectable && !readOnly} aria-label={`Input for ${node.title}`} />}
    <div className="workflow-node-heading">
      <span className="workflow-node-icon"><Icon size={16} /></span>
      <div><strong title={node.title}>{node.title}</strong><span>{workflowNodeInfo[node.kind].label}</span></div>
      {node.kind === "brief" && <LockKeyhole className="workflow-root-lock" size={12} aria-label="Required starting node" />}
    </div>
    <p className="workflow-node-preview">{node.instructions.trim() || workflowNodeInfo[node.kind].description}</p>
    <div className="workflow-node-footer">
      {readOnly ? <span className={`workflow-node-status workflow-status-${state?.status || "idle"}`}><StatusIcon size={11} />{statusLabels[state?.status || "idle"]}</span>
        : <span>{node.review || node.kind === "review" ? <><ShieldCheck size={11} />Human review</> : <><ArrowRight size={11} />{node.kind === "brief" ? "Workflow input" : "Connected stage"}</>}</span>}
      {readOnly && (node.review || node.kind === "review") && <ShieldCheck size={11} aria-label="Human review required" />}
    </div>
    <Handle type="source" position={Position.Right} isConnectable={isConnectable && !readOnly} aria-label={`Output from ${node.title}`} />
  </div>;
});
const nodeTypes = { workflow: WorkflowCard };

function toCanvasNode(node: WorkflowNode, selected: string, states: WorkflowCanvasProps["states"], readOnly: boolean): CanvasNode {
  return {
    id: node.id, type: "workflow", position: { ...node.position },
    data: { node, state: states?.[node.id], readOnly }, selected: selected === node.id,
    sourcePosition: Position.Right, targetPosition: Position.Left,
    deletable: !readOnly && node.kind !== "brief",
    ariaLabel: `${node.title}, ${workflowNodeInfo[node.kind].label}${readOnly ? `, ${statusLabels[states?.[node.id]?.status || "idle"]}` : ""}`,
  };
}

function toCanvasEdge(edge: WorkflowGraph["edges"][number], states: WorkflowCanvasProps["states"], readOnly: boolean): Edge {
  const complete = states?.[edge.source]?.status === "completed";
  return {
    ...edge, type: "smoothstep", pathOptions: { borderRadius: 14, offset: 24 },
    className: complete ? "workflow-edge-complete" : "", deletable: !readOnly,
    markerEnd: { type: MarkerType.ArrowClosed, width: 15, height: 15, color: complete ? "#6d9a81" : "#626677" },
    ariaLabel: `Connection from ${edge.source} to ${edge.target}`,
  } as Edge;
}

function connectionError(graph: WorkflowGraph, connection: Connection | Edge): string | null {
  const { source, target } = connection;
  if (!source || !target) return "Connect an output to another node’s input.";
  if (source === target) return "A node cannot connect to itself.";
  if (!graph.nodes.some(node => node.id === source) || !graph.nodes.some(node => node.id === target)) return "Both nodes must be in this workflow.";
  if (graph.nodes.find(node => node.id === target)?.kind === "brief") return "The brief is the workflow’s starting node.";
  if (graph.edges.some(edge => edge.source === source && edge.target === target)) return "These nodes are already connected.";
  if (graph.edges.length >= 100) return "This workflow has reached its limit of 100 connections.";
  const visit = [target];
  const seen = new Set<string>();
  while (visit.length) {
    const current = visit.pop()!;
    if (current === source) return "This connection would create a loop. Connect stages in production order.";
    if (seen.has(current)) continue;
    seen.add(current);
    graph.edges.filter(edge => edge.source === current).forEach(edge => visit.push(edge.target));
  }
  return null;
}

function Canvas({ graph, onChange, selected, onSelect, states, readOnly = false }: WorkflowCanvasProps) {
  const [nodes, setNodes] = useState<CanvasNode[]>(() => graph.nodes.map(node => toCanvasNode(node, selected, states, readOnly)));
  const [edges, setEdges] = useState<Edge[]>(() => graph.edges.map(edge => toCanvasEdge(edge, states, readOnly)));
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [libraryQuery, setLibraryQuery] = useState("");
  const [selectedEdge, setSelectedEdge] = useState("");
  const [panMode, setPanMode] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const graphRef = useRef(graph);
  const changeRef = useRef(onChange);
  const selectRef = useRef(onSelect);
  const libraryRef = useRef<HTMLDivElement>(null);
  const addButtonRef = useRef<HTMLButtonElement>(null);
  const libraryId = useId();
  const flow = useReactFlow<CanvasNode>();
  const canvasWidth = useStore(state => state.width);
  const nodesInitialized = useNodesInitialized();
  const initialFraming = useRef(false);
  const { zoom } = useViewport();
  const controlledMove = useRef(false);
  graphRef.current = graph;
  changeRef.current = onChange;
  selectRef.current = onSelect;

  const commit = useCallback((next: WorkflowGraph) => {
    if (readOnly) return;
    graphRef.current = next;
    changeRef.current(next);
  }, [readOnly]);

  useEffect(() => {
    if (initialFraming.current || !nodesInitialized || !canvasWidth) return;
    initialFraming.current = true;
    if (canvasWidth >= 500 || graph.viewport) return;
    const start = graph.nodes.find(node => node.id === selected) || graph.nodes.find(node => node.kind === "brief");
    if (!start) return;
    const frame = window.requestAnimationFrame(() => {
      void flow.setCenter(start.position.x + 114, start.position.y + 66, { zoom: 0.8 });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [canvasWidth, nodesInitialized, flow, graph, selected]);

  useEffect(() => {
    setNodes(current => graph.nodes.map(node => ({
      ...current.find(item => item.id === node.id), ...toCanvasNode(node, selected, states, readOnly),
    })));
    setEdges(current => graph.edges.map(edge => ({
      ...toCanvasEdge(edge, states, readOnly), selected: current.find(item => item.id === edge.id)?.selected || false,
    })));
    if (selected) setSelectedEdge("");
  }, [graph, selected, states, readOnly]);

  useEffect(() => {
    if (!libraryOpen) return;
    function closeOutside(event: PointerEvent) {
      if (!libraryRef.current?.contains(event.target as globalThis.Node) && !addButtonRef.current?.contains(event.target as globalThis.Node)) setLibraryOpen(false);
    }
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [libraryOpen]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 6500);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const onNodesChange = useCallback((changes: NodeChange<CanvasNode>[]) => {
    setNodes(current => applyNodeChanges(changes, current));
    const select = changes.find(change => change.type === "select" && change.selected);
    if (select?.type === "select") { selectRef.current(select.id); setSelectedEdge(""); }
    if (readOnly) return;
    const moves = new Map(changes.flatMap(change => change.type === "position" && change.position ? [[change.id, change.position] as const] : []));
    if (!moves.size) return;
    const current = graphRef.current;
    const nextNodes = current.nodes.map(node => {
      const position = moves.get(node.id);
      return position ? { ...node, position: { ...position } } : node;
    });
    if (nextNodes.some((node, index) => node.position.x !== current.nodes[index].position.x || node.position.y !== current.nodes[index].position.y)) commit({ ...current, nodes: nextNodes });
  }, [commit, readOnly]);

  const onEdgesChange = useCallback((changes: EdgeChange<Edge>[]) => {
    setEdges(current => applyEdgeChanges(changes, current));
    const select = changes.find(change => change.type === "select" && change.selected);
    if (select?.type === "select") { setSelectedEdge(select.id); selectRef.current(""); }
  }, []);

  const connect = useCallback((connection: Connection) => {
    if (readOnly) return;
    const current = graphRef.current;
    const error = connectionError(current, connection);
    if (error) { setNotice(error); return; }
    commit({ ...current, edges: [...current.edges, { id: `edge-${crypto.randomUUID()}`, source: connection.source, target: connection.target }] });
    setNotice("");
  }, [commit, readOnly]);

  const addNode = (kind: WorkflowNodeKind) => {
    if (readOnly) return;
    const current = graphRef.current;
    if (current.nodes.length >= 40) { setNotice("This workflow has reached its limit of 40 nodes."); return; }
    const mediaKind=current.nodes.some(node=>node.kind==="media"&&(node.media_kind||"image")==="image")?"video":"image";
    if(kind!=="review"&&current.nodes.some(node=>node.kind===kind&&(kind!=="media"||(node.media_kind||"image")===mediaKind))){setNotice("This output stage is already in the workflow. Configure or revise the existing node.");return;}
    const source = current.nodes.find(node => node.id === selected) || current.nodes.find(node => node.kind === "brief");
    const siblings = current.edges.filter(edge => edge.source === source?.id).length;
    let position = source ? { x: source.position.x + 300, y: source.position.y + siblings * 174 } : { x: 80, y: 100 };
    while (current.nodes.some(node => Math.abs(node.position.x - position.x) < 235 && Math.abs(node.position.y - position.y) < 150)) position = { ...position, y: position.y + 174 };
    const node: WorkflowNode = {
      id: `${kind}-${crypto.randomUUID()}`, kind, title: workflowNodeInfo[kind].label,
      instructions: "", position, review: kind === "review" || kind === "script",
      ...(kind === "media" ? { provider: "manual" as const, media_kind: mediaKind } : {}),
    };
    const newEdges = source && current.edges.length < 100 ? [...current.edges, { id: `edge-${crypto.randomUUID()}`, source: source.id, target: node.id }] : current.edges;
    commit({ ...current, nodes: [...current.nodes, node], edges: newEdges });
    onSelect(node.id);
    setSelectedEdge("");
    setLibraryOpen(false);
    setLibraryQuery("");
    setNotice(`${node.title} added${source ? ` after ${source.title}` : ""}.`);
    void flow.setCenter(position.x + 114, position.y + 66, { zoom: Math.max(flow.getZoom(), 0.75), duration: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 200 });
  };

  const selectedNode = graph.nodes.find(node => node.id === selected);
  const canDelete = !readOnly && (!!selectedEdge || (!!selectedNode && selectedNode.kind !== "brief"));
  const addAfter = selectedNode || graph.nodes.find(node => node.kind === "brief");
  const libraryKinds = workflowKinds.filter(kind => kind !== "brief" && `${workflowNodeInfo[kind].label} ${workflowNodeInfo[kind].description}`.toLowerCase().includes(libraryQuery.toLowerCase().trim()));
  const duration = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 180;
  const deleteSelected = () => {
    if (!canDelete) return;
    void flow.deleteElements({ nodes: selectedNode ? [{ id: selectedNode.id }] : [], edges: selectedEdge ? [{ id: selectedEdge }] : [] });
  };

  return <div className={`workflow-canvas${readOnly ? " is-readonly" : ""}${panMode ? " is-pan-mode" : ""}`} role="region" aria-label={readOnly ? "Production workflow canvas" : "Workflow editor canvas"}
    onKeyDown={event => {
      if (event.key === "Escape") {
        if (libraryOpen) { setLibraryOpen(false); addButtonRef.current?.focus(); }
        setHelpOpen(false);
      }
    }}>
    <ReactFlow<CanvasNode>
      nodes={nodes} edges={edges} nodeTypes={nodeTypes} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
      onConnect={connect}
      isValidConnection={connection => !readOnly && !connectionError(graphRef.current, connection)}
      onConnectEnd={(_event, connection) => {
        if (readOnly || connection.isValid || !connection.toNode || !connection.fromNode) return;
        const error = connectionError(graphRef.current, { source: connection.fromNode.id, target: connection.toNode.id, sourceHandle: null, targetHandle: null });
        if (error) setNotice(error);
      }}
      onDelete={({ nodes: removedNodes, edges: removedEdges }) => {
        if (readOnly) return;
        const current = graphRef.current;
        const nodeIds = new Set(removedNodes.filter(node => node.data.node.kind !== "brief").map(node => node.id));
        const edgeIds = new Set(removedEdges.map(edge => edge.id));
        commit({ ...current, nodes: current.nodes.filter(node => !nodeIds.has(node.id)), edges: current.edges.filter(edge => !edgeIds.has(edge.id) && !nodeIds.has(edge.source) && !nodeIds.has(edge.target)) });
        if (nodeIds.has(selected)) onSelect("");
        setSelectedEdge("");
      }}
      onBeforeDelete={async ({ nodes: deleting, edges: deletingEdges }) => readOnly ? false : { nodes: deleting.filter(node => node.data.node.kind !== "brief"), edges: deletingEdges }}
      onNodeClick={(_event, node) => { onSelect(node.id); setSelectedEdge(""); setLibraryOpen(false); }}
      onEdgeClick={(_event, edge) => { onSelect(""); setSelectedEdge(edge.id); setLibraryOpen(false); }}
      onPaneClick={() => { onSelect(""); setSelectedEdge(""); setLibraryOpen(false); }}
      onMoveEnd={(event, viewport) => {
        if (!readOnly && (event || controlledMove.current)) commit({ ...graphRef.current, viewport });
        controlledMove.current = false;
      }}
      defaultViewport={graph.viewport} fitView={!graph.viewport}
      fitViewOptions={{ padding: 0.16, minZoom: canvasWidth > 0 && canvasWidth < 500 ? 0.65 : 0.25, maxZoom: 0.95 }}
      minZoom={0.2} maxZoom={1.75} nodesDraggable={!readOnly && !panMode} nodesConnectable={!readOnly && !panMode}
      nodesFocusable edgesFocusable elementsSelectable={!panMode}
      deleteKeyCode={readOnly ? null : ["Backspace", "Delete"]}
      selectionKeyCode={null} multiSelectionKeyCode={null} panActivationKeyCode="Space"
      panOnDrag zoomOnDoubleClick={false} preventScrolling snapToGrid snapGrid={[10, 10]}
      colorMode="dark" attributionPosition="bottom-right"
    >
      <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="#383b46" />
    </ReactFlow>

    <div className="workflow-canvas-topbar">
      {!readOnly && <div className="workflow-canvas-edit-actions">
        <button ref={addButtonRef} type="button" className="workflow-add-button" aria-label="Add workflow node" aria-expanded={libraryOpen} aria-controls={libraryId} disabled={graph.nodes.length >= 40}
          onClick={() => { setLibraryOpen(open => !open); setHelpOpen(false); }}><Plus size={15} /><span>Add node</span></button>
        <span className="workflow-toolbar-divider" />
        <button type="button" className="workflow-tool-button" disabled={!canDelete} onClick={deleteSelected} aria-label={selectedEdge ? "Delete selected connection" : "Delete selected node"} title={selectedNode?.kind === "brief" ? "The brief is required" : "Delete selection"}><Trash2 size={14} /></button>
      </div>}
      <span className="workflow-canvas-count">{readOnly && <LockKeyhole size={11} />}{graph.nodes.length} nodes<span className="workflow-count-divider">·</span>{graph.edges.length} connections</span>
    </div>

    {libraryOpen && !readOnly && <div ref={libraryRef} id={libraryId} className="workflow-node-library nodrag nopan" role="dialog" aria-label="Add a workflow node">
      <div className="workflow-library-heading"><strong>Add node</strong><button type="button" className="workflow-tool-button" aria-label="Close node library" onClick={() => { setLibraryOpen(false); addButtonRef.current?.focus(); }}><X size={14} /></button></div>
      <label className="workflow-library-search"><Search size={14} /><span className="sr-only">Search node types</span><input autoFocus value={libraryQuery} onChange={event => setLibraryQuery(event.target.value)} placeholder="Search nodes…" /></label>
      <div className="workflow-library-options">
        {libraryKinds.map(kind => {
          const Icon = kindIcons[kind];
          const existing=kind!=="review"&&(kind==="media"?graph.nodes.filter(node=>node.kind==="media").length>=2:graph.nodes.some(node=>node.kind===kind));
          return <button type="button" className={`workflow-library-option workflow-kind-${kind}`} key={kind} disabled={existing} onClick={() => addNode(kind)}>
            <span className="workflow-node-icon"><Icon size={15} /></span><span><strong>{workflowNodeInfo[kind].label}</strong><small>{existing?"Already in this workflow. Configure its existing node.":workflowNodeInfo[kind].description}</small></span><Plus size={13} />
          </button>;
        })}
        {!libraryKinds.length && <p className="workflow-library-empty">No node types match “{libraryQuery}”.</p>}
      </div>
      {addAfter && <p className="workflow-library-footer">Connects after <strong>{addAfter.title}</strong></p>}
    </div>}

    <div className="workflow-canvas-controls" role="toolbar" aria-label="Canvas controls">
      <button type="button" className="workflow-tool-button" aria-label="Zoom out" title="Zoom out" disabled={zoom <= 0.2} onClick={() => { controlledMove.current = true; void flow.zoomOut({ duration: duration() }); }}><ZoomOut size={15} /></button>
      <button type="button" className="workflow-zoom-value" aria-label={`Zoom ${Math.round(zoom * 100)} percent. Reset to 100 percent`} title="Reset to 100%" onClick={() => { controlledMove.current = true; void flow.zoomTo(1, { duration: duration() }); }}>{Math.round(zoom * 100)}%</button>
      <button type="button" className="workflow-tool-button" aria-label="Zoom in" title="Zoom in" disabled={zoom >= 1.75} onClick={() => { controlledMove.current = true; void flow.zoomIn({ duration: duration() }); }}><ZoomIn size={15} /></button>
      <span className="workflow-toolbar-divider" />
      <button type="button" className="workflow-tool-button" aria-label="Fit workflow to view" title="Fit to view" onClick={() => { controlledMove.current = true; void flow.fitView({ padding: 0.16, maxZoom: 0.95, duration: duration() }); }}><Maximize size={14} /></button>
      {!readOnly && <><span className="workflow-toolbar-divider" /><button type="button" className="workflow-tool-button" aria-label={panMode ? "Switch to select tool" : "Switch to pan tool"} title={panMode ? "Select nodes" : "Pan canvas"} aria-pressed={panMode} onClick={() => setPanMode(value => !value)}>{panMode ? <Hand size={15} /> : <MousePointer2 size={14} />}</button></>}
      <span className="workflow-toolbar-divider" />
      <button type="button" className="workflow-tool-button" aria-label="Canvas keyboard shortcuts" title="Keyboard shortcuts" aria-expanded={helpOpen} onClick={() => { setHelpOpen(open => !open); setLibraryOpen(false); }}><Keyboard size={15} /></button>
    </div>

    {helpOpen && <div className="workflow-canvas-help" role="dialog" aria-label="Canvas keyboard shortcuts"><div><strong>Canvas controls</strong><button type="button" className="workflow-tool-button" aria-label="Close keyboard shortcuts" onClick={() => setHelpOpen(false)}><X size={13} /></button></div><p><span>Pan canvas</span><span>Drag background</span></p><p><span>Zoom</span><span>Scroll or pinch</span></p><p><span>Select node</span><kbd>Tab · Enter</kbd></p>{!readOnly && <><p><span>Move selected node</span><kbd>Arrow keys</kbd></p><p><span>Delete selection</span><kbd>Delete</kbd></p><p><span>Temporary pan</span><kbd>Space</kbd></p><p className="workflow-help-note">Drag between node handles to connect stages. The brief is required.</p></>}</div>}
    <div className={`workflow-canvas-notice${notice ? " is-visible" : ""}`} role="status" aria-live="polite">{notice && <><span>{notice}</span><button type="button" className="workflow-tool-button" aria-label="Dismiss canvas message" onClick={() => setNotice("")}><X size={13} /></button></>}</div>
    {!graph.nodes.length && <div className="workflow-canvas-empty"><ClipboardList size={24} /><strong>This workflow needs a brief</strong><p>The required starting node is missing. Reload the template to restore its saved graph.</p></div>}
  </div>;
}

export function WorkflowCanvas(props: WorkflowCanvasProps) {
  return <ReactFlowProvider><Canvas {...props} /></ReactFlowProvider>;
}
