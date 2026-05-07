import type { SkillNode, DataType, EdgeData, PoolType, ProjectType } from './types';

export interface SnapshotData {
  nodes: Record<string, SkillNode>;
  dataTypes: Record<string, DataType>;
  poolTypes: Record<string, PoolType>;
  edges: Record<string, EdgeData>;
  projectType: ProjectType;
}

export interface NodeChange {
  id: string;
  title: string;
  changes: string[];
}

export interface DiffResult {
  nodes: {
    added: { id: string; title: string }[];
    removed: { id: string; title: string }[];
    changed: NodeChange[];
  };
  dataTypes: {
    added: string[];
    removed: string[];
    changed: string[];
  };
  edges: {
    added: number;
    removed: number;
  };
  summary: string;
}

export function diffSnapshots(a: SnapshotData, b: SnapshotData): DiffResult {
  // --- Nodes ---
  const aNodeIds = new Set(Object.keys(a.nodes));
  const bNodeIds = new Set(Object.keys(b.nodes));

  const addedNodes: { id: string; title: string }[] = [];
  const removedNodes: { id: string; title: string }[] = [];
  const changedNodes: NodeChange[] = [];

  for (const id of bNodeIds) {
    if (!aNodeIds.has(id)) {
      addedNodes.push({ id, title: b.nodes[id].title });
    }
  }
  for (const id of aNodeIds) {
    if (!bNodeIds.has(id)) {
      removedNodes.push({ id, title: a.nodes[id].title });
    }
  }
  for (const id of aNodeIds) {
    if (!bNodeIds.has(id)) continue;
    const na = a.nodes[id];
    const nb = b.nodes[id];
    const changes: string[] = [];
    if (na.title !== nb.title) changes.push(`title: "${na.title}" → "${nb.title}"`);
    if (na.parentId !== nb.parentId) changes.push(`parent changed`);
    if (na.dataTypeId !== nb.dataTypeId) changes.push(`data type changed`);
    if (na.displayMode !== nb.displayMode) changes.push(`display mode: ${na.displayMode} → ${nb.displayMode}`);
    if (na.color !== nb.color) changes.push(`color changed`);
    if (Math.round(na.position.x) !== Math.round(nb.position.x) ||
        Math.round(na.position.y) !== Math.round(nb.position.y)) {
      changes.push(`position moved`);
    }
    if (JSON.stringify(na.fieldValues) !== JSON.stringify(nb.fieldValues)) {
      changes.push(`field values changed`);
    }
    if (changes.length > 0) {
      changedNodes.push({ id, title: nb.title, changes });
    }
  }

  // --- Data Types ---
  const aDtIds = new Set(Object.keys(a.dataTypes));
  const bDtIds = new Set(Object.keys(b.dataTypes));
  const addedDt: string[] = [];
  const removedDt: string[] = [];
  const changedDt: string[] = [];

  for (const id of bDtIds) {
    if (!aDtIds.has(id)) addedDt.push(b.dataTypes[id].name);
  }
  for (const id of aDtIds) {
    if (!bDtIds.has(id)) removedDt.push(a.dataTypes[id].name);
  }
  for (const id of aDtIds) {
    if (!bDtIds.has(id)) continue;
    if (JSON.stringify(a.dataTypes[id]) !== JSON.stringify(b.dataTypes[id])) {
      changedDt.push(b.dataTypes[id].name);
    }
  }

  // --- Edges ---
  const aEdgeIds = new Set(Object.keys(a.edges));
  const bEdgeIds = new Set(Object.keys(b.edges));
  let addedEdges = 0;
  let removedEdges = 0;
  for (const id of bEdgeIds) if (!aEdgeIds.has(id)) addedEdges++;
  for (const id of aEdgeIds) if (!bEdgeIds.has(id)) removedEdges++;

  // --- Summary ---
  const parts: string[] = [];
  if (addedNodes.length) parts.push(`+${addedNodes.length} node${addedNodes.length > 1 ? 's' : ''}`);
  if (removedNodes.length) parts.push(`-${removedNodes.length} node${removedNodes.length > 1 ? 's' : ''}`);
  if (changedNodes.length) parts.push(`${changedNodes.length} changed`);
  if (addedEdges) parts.push(`+${addedEdges} edge${addedEdges > 1 ? 's' : ''}`);
  if (removedEdges) parts.push(`-${removedEdges} edge${removedEdges > 1 ? 's' : ''}`);
  if (addedDt.length || removedDt.length || changedDt.length) parts.push(`data types modified`);
  const summary = parts.length > 0 ? parts.join(', ') : 'No changes';

  return {
    nodes: { added: addedNodes, removed: removedNodes, changed: changedNodes },
    dataTypes: { added: addedDt, removed: removedDt, changed: changedDt },
    edges: { added: addedEdges, removed: removedEdges },
    summary,
  };
}
