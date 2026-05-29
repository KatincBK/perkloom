import { useRef, useState, useEffect, useLayoutEffect, useCallback } from 'react';
import {
  useStore,
  NODE_WIDTH,
  DEMO_NODE_SIZE,
  GRID_SIZE,
  computeNodeHeight,
  getMapLines,
} from '../store';
import { SkillNode, edgeId } from '../types';
import { NodeView } from './NodeView';

// ============================================================
//  INTERACTION TYPES
// ============================================================

type Interaction =
  | { type: 'idle' }
  | { type: 'panning'; lastX: number; lastY: number }
  | { type: 'dragging'; nodeId: string; lastX: number; lastY: number }
  | { type: 'connecting'; sourceId: string }
  | { type: 'box-selecting'; startWX: number; startWY: number };

// ============================================================
//  EDGE ROUTING — closest point on rectangle boundary
// ============================================================

function getNodeEdgePoint(
  cx: number,
  cy: number,
  w: number,
  h: number,
  tx: number,
  ty: number,
): { x: number; y: number } {
  const dx = tx - cx;
  const dy = ty - cy;

  if (dx === 0 && dy === 0) return { x: cx, y: cy + h / 2 };

  const absDx = Math.abs(dx) || 0.0001;
  const absDy = Math.abs(dy) || 0.0001;
  const t = Math.min(w / 2 / absDx, h / 2 / absDy);

  return { x: cx + dx * t, y: cy + dy * t };
}

interface EdgeGeom {
  p1: { x: number; y: number };
  p2: { x: number; y: number };
  c1: { x: number; y: number };
  c2: { x: number; y: number };
  path: string;
}

function getEdgeGeom(
  from: SkillNode,
  to: SkillNode,
  fromH: number,
  toH: number,
  nodeWidth: number = NODE_WIDTH,
  perpOffset: number = 0,
): EdgeGeom {
  // Path goes from → to so marker-end arrow lands on the target node.
  const rawP1 = getNodeEdgePoint(
    from.position.x,
    from.position.y,
    nodeWidth,
    fromH,
    to.position.x,
    to.position.y,
  );
  const rawP2 = getNodeEdgePoint(
    to.position.x,
    to.position.y,
    nodeWidth,
    toH,
    from.position.x,
    from.position.y,
  );

  const rdx = rawP2.x - rawP1.x;
  const rdy = rawP2.y - rawP1.y;
  const rdist = Math.sqrt(rdx * rdx + rdy * rdy) || 1;

  // Shift BOTH endpoints along the perpendicular so bidirectional pairs form
  // two genuinely parallel lines instead of sharing endpoints and only
  // bowing apart in the middle.
  const pvx = (-rdy / rdist) * perpOffset;
  const pvy = (rdx / rdist) * perpOffset;

  const p1 = { x: rawP1.x + pvx, y: rawP1.y + pvy };
  const p2 = { x: rawP2.x + pvx, y: rawP2.y + pvy };

  const sdx = p2.x - p1.x;
  const sdy = p2.y - p1.y;
  const sdist = Math.sqrt(sdx * sdx + sdy * sdy) || 1;
  const bend = Math.max(30, sdist * 0.35);

  const c1 = {
    x: p1.x + (sdx / sdist) * bend,
    y: p1.y + (sdy / sdist) * bend,
  };
  const c2 = {
    x: p2.x - (sdx / sdist) * bend,
    y: p2.y - (sdy / sdist) * bend,
  };

  const path = `M ${p1.x} ${p1.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${p2.x} ${p2.y}`;
  return { p1, p2, c1, c2, path };
}

// ============================================================
//  CYCLE DETECTION
// ============================================================

function findRoot(
  id: string,
  nodes: Record<string, SkillNode>,
): string {
  let current = id;
  while (true) {
    const p = nodes[current]?.parentId;
    if (!p) return current;
    current = p;
  }
}

function wouldCreateCycle(
  parentId: string,
  childId: string,
  nodes: Record<string, SkillNode>,
): boolean {
  let current: string | null = parentId;
  while (current !== null) {
    if (current === childId) return true;
    current = nodes[current]?.parentId ?? null;
  }
  return false;
}

// ============================================================
//  SELECTION ROOT — the ancestor of all other selected nodes
// ============================================================

function isAncestorOf(
  ancestorId: string,
  nodeId: string,
  nodes: Record<string, SkillNode>,
): boolean {
  let cur: string | null = nodes[nodeId]?.parentId ?? null;
  while (cur) {
    if (cur === ancestorId) return true;
    cur = nodes[cur]?.parentId ?? null;
  }
  return false;
}

function findSelectionRoot(
  ids: string[],
  nodes: Record<string, SkillNode>,
): string | null {
  if (ids.length < 2) return null;
  for (const candidate of ids) {
    if (ids.every((id) => id === candidate || isAncestorOf(candidate, id, nodes))) {
      return candidate;
    }
  }
  return null;
}

// ============================================================
//  PHYSICS HELPERS
// ============================================================

const REPULSION_K = 5000;
const REPULSION_RANGE = 300;
const SPRING_K = 0.01;
const SPRING_REST = 160;
const DAMPING = 0.86;
const VEL_THRESHOLD = 0.05;
const MAX_VEL = 8;
const MASS_BASE = 1;
const MASS_PER_DESC = 0.7;

interface NodeVelocity {
  vx: number;
  vy: number;
}

function computeSubtreeSizes(
  nodes: Record<string, SkillNode>,
): Record<string, number> {
  const childrenOf: Record<string, string[]> = {};
  for (const n of Object.values(nodes)) {
    if (n.parentId) (childrenOf[n.parentId] ??= []).push(n.id);
  }
  const cache: Record<string, number> = {};
  function size(id: string): number {
    if (cache[id] !== undefined) return cache[id];
    let s = 0;
    for (const cid of childrenOf[id] || []) s += 1 + size(cid);
    return (cache[id] = s);
  }
  for (const id of Object.keys(nodes)) size(id);
  return cache;
}

function clamp(v: number, max: number): number {
  return Math.max(-max, Math.min(max, v));
}

// ============================================================
//  CANVAS COMPONENT
// ============================================================

export default function Canvas() {
  const nodes = useStore((s) => s.nodes);
  const edgesMap = useStore((s) => s.edges);
  const camera = useStore((s) => s.camera);
  const selectedNodeIds = useStore((s) => s.selectedNodeIds);
  const mode = useStore((s) => s.mode);
  const dataTypes = useStore((s) => s.dataTypes);
  const poolTypes = useStore((s) => s.poolTypes);
  const demoMode = useStore((s) => s.demoMode);
  const projectType = useStore((s) => s.projectType);
  const selectedEdgeId = useStore((s) => s.selectedEdgeId);
  const clipboardCount = useStore((s) => s.clipboardCount);
  const isFlowchart = projectType === 'flowchart';

  const viewportRef = useRef<HTMLDivElement>(null);
  const interactionRef = useRef<Interaction>({ type: 'idle' });
  const spaceHeldRef = useRef(false);

  const velocitiesRef = useRef<Record<string, NodeVelocity>>({});
  const animFrameRef = useRef(0);
  const draggedNodeRef = useRef<string | null>(null);
  const virtualPosRef = useRef<{ x: number; y: number } | null>(null);

  const [connectLine, setConnectLine] = useState<{
    x1: number;
    y1: number;
    x2: number;
    y2: number;
  } | null>(null);

  const [contextMenu, setContextMenu] = useState<
    | { type: 'node'; x: number; y: number; nodeId: string }
    | { type: 'edge'; x: number; y: number; parentId: string; childId: string }
    | { type: 'canvas'; x: number; y: number; wx: number; wy: number }
    | null
  >(null);

  const [selectionBox, setSelectionBox] = useState<{
    x: number;
    y: number;
    w: number;
    h: number;
  } | null>(null);

  // --- center camera on mount ---
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    useStore.getState().setCamera({
      x: rect.width / 2,
      y: rect.height / 3,
    });
  }, []);

  // --- close context menu on outside click ---
  useEffect(() => {
    if (!contextMenu) return;
    const close = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('.context-menu'))
        setContextMenu(null);
    };
    document.addEventListener('mousedown', close, true);
    return () => document.removeEventListener('mousedown', close, true);
  }, [contextMenu]);

  // --- close context menu on escape ---
  useEffect(() => {
    if (!contextMenu) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setContextMenu(null);
        e.stopPropagation();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [contextMenu]);

  // --- auto mode loop (equalize edge lengths, preserve angles) ---
  useEffect(() => {
    if (mode !== 'auto') return;

    const LERP = 0.08;
    const THRESHOLD = 0.3;

    let rafId = 0;

    const step = () => {
      const state = useStore.getState();
      if (state.mode !== 'auto') return;

      const ns = state.nodes;
      const list = Object.values(ns);
      if (list.length === 0) {
        rafId = requestAnimationFrame(step);
        return;
      }

      const childrenOf: Record<string, string[]> = {};
      const roots: string[] = [];
      for (const n of list) {
        if (n.parentId && ns[n.parentId]) {
          (childrenOf[n.parentId] ??= []).push(n.id);
        } else {
          roots.push(n.id);
        }
      }

      const dragId = draggedNodeRef.current;

      // Working positions we mutate through the pass
      const pos: Record<string, { x: number; y: number }> = {};
      for (const n of list) pos[n.id] = { x: n.position.x, y: n.position.y };

      // Compute descendant lists for rigid subtree movement
      const descendants: Record<string, string[]> = {};
      function collectDesc(id: string, out: string[]) {
        for (const c of childrenOf[id] || []) {
          out.push(c);
          collectDesc(c, out);
        }
      }
      for (const n of list) {
        const out: string[] = [];
        collectDesc(n.id, out);
        descendants[n.id] = out;
      }

      const TARGET_LEN = state.autoTargetLength;

      // DFS from each root; adjust each child's distance to its parent
      const visit = (id: string) => {
        for (const cid of childrenOf[id] || []) {
          if (cid === dragId) {
            visit(cid);
            continue;
          }
          const p = pos[id];
          const c = pos[cid];
          const dx = c.x - p.x;
          const dy = c.y - p.y;
          const dist = Math.sqrt(dx * dx + dy * dy) || 0.001;
          const excess = dist - TARGET_LEN;
          if (Math.abs(excess) > THRESHOLD) {
            const ux = dx / dist;
            const uy = dy / dist;
            const mv = -excess * LERP;
            const vx = ux * mv;
            const vy = uy * mv;
            c.x += vx;
            c.y += vy;
            for (const d of descendants[cid]) {
              pos[d].x += vx;
              pos[d].y += vy;
            }
          }
          visit(cid);
        }
      };
      for (const r of roots) visit(r);

      // Commit changes
      const updates: Array<[string, { x: number; y: number }]> = [];
      for (const n of list) {
        if (n.id === dragId) continue;
        const np = pos[n.id];
        if (Math.abs(np.x - n.position.x) > 0.01 || Math.abs(np.y - n.position.y) > 0.01) {
          updates.push([n.id, np]);
        }
      }
      if (updates.length > 0) {
        useStore.setState((s) => {
          const updated = { ...s.nodes };
          for (const [id, p] of updates) {
            if (updated[id]) updated[id] = { ...updated[id], position: p };
          }
          return { nodes: updated };
        });
      }

      rafId = requestAnimationFrame(step);
    };

    rafId = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafId);
  }, [mode]);

  // --- physics loop (responsive mode) ---
  useEffect(() => {
    if (mode !== 'responsive') return;

    velocitiesRef.current = {};

    const step = () => {
      const state = useStore.getState();
      if (state.mode !== 'responsive') return;

      const { nodes: ns } = state;
      const list = Object.values(ns);
      if (list.length === 0) {
        animFrameRef.current = requestAnimationFrame(step);
        return;
      }

      const vel = velocitiesRef.current;
      const dragId = draggedNodeRef.current;

      for (const n of list) {
        if (!vel[n.id]) vel[n.id] = { vx: 0, vy: 0 };
      }
      for (const id of Object.keys(vel)) {
        if (!ns[id]) delete vel[id];
      }

      const sizes = computeSubtreeSizes(ns);

      const fx: Record<string, number> = {};
      const fy: Record<string, number> = {};
      for (const n of list) {
        fx[n.id] = 0;
        fy[n.id] = 0;
      }

      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          const a = list[i];
          const b = list[j];
          const dx = b.position.x - a.position.x;
          const dy = b.position.y - a.position.y;
          const distSq = dx * dx + dy * dy;
          const dist = Math.sqrt(distSq) || 0.1;
          if (dist > REPULSION_RANGE) continue;

          const force = REPULSION_K / (distSq + 100);
          const fnx = (dx / dist) * force;
          const fny = (dy / dist) * force;
          fx[a.id] -= fnx;
          fy[a.id] -= fny;
          fx[b.id] += fnx;
          fy[b.id] += fny;
        }
      }

      for (const n of list) {
        if (!n.parentId || !ns[n.parentId]) continue;
        const parent = ns[n.parentId];
        const dx = n.position.x - parent.position.x;
        const dy = n.position.y - parent.position.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 0.1;
        const displacement = dist - SPRING_REST;
        const force = SPRING_K * displacement;
        const fnx = (dx / dist) * force;
        const fny = (dy / dist) * force;

        fx[parent.id] += fnx;
        fy[parent.id] += fny;
        fx[n.id] -= fnx;
        fy[n.id] -= fny;
      }

      const updates: Array<[string, { x: number; y: number }]> = [];

      for (const n of list) {
        const v = vel[n.id];

        if (n.id === dragId) {
          v.vx = 0;
          v.vy = 0;
          continue;
        }

        const mass = MASS_BASE + (sizes[n.id] ?? 0) * MASS_PER_DESC;
        v.vx = clamp((v.vx + fx[n.id] / mass) * DAMPING, MAX_VEL);
        v.vy = clamp((v.vy + fy[n.id] / mass) * DAMPING, MAX_VEL);

        if (Math.abs(v.vx) < VEL_THRESHOLD) v.vx = 0;
        if (Math.abs(v.vy) < VEL_THRESHOLD) v.vy = 0;

        if (v.vx !== 0 || v.vy !== 0) {
          updates.push([
            n.id,
            {
              x: n.position.x + v.vx,
              y: n.position.y + v.vy,
            },
          ]);
        }
      }

      if (updates.length > 0) {
        useStore.setState((s) => {
          const updated = { ...s.nodes };
          for (const [id, pos] of updates) {
            if (updated[id]) {
              updated[id] = { ...updated[id], position: pos };
            }
          }
          return { nodes: updated };
        });
      }

      animFrameRef.current = requestAnimationFrame(step);
    };

    animFrameRef.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(animFrameRef.current);
  }, [mode]);

  // --- global mouse listeners ---
  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      const interaction = interactionRef.current;
      if (interaction.type === 'idle') return;

      if (interaction.type === 'panning') {
        const dx = e.clientX - interaction.lastX;
        const dy = e.clientY - interaction.lastY;
        const { camera: cam, setCamera } = useStore.getState();
        setCamera({ x: cam.x + dx, y: cam.y + dy });
        interaction.lastX = e.clientX;
        interaction.lastY = e.clientY;
      } else if (interaction.type === 'dragging') {
        const dx = e.clientX - interaction.lastX;
        const dy = e.clientY - interaction.lastY;
        const {
          camera: cam,
          mode: m,
          gridSnap: snap,
          angleSnap: angleStep,
          nodes: ns,
          selectedNodeIds: selIds,
        } = useStore.getState();
        const wdx = dx / cam.zoom;
        const wdy = dy / cam.zoom;

        // Determine which nodes to move
        const isMulti =
          selIds.length > 1 && selIds.includes(interaction.nodeId);
        const dragIds = isMulti ? selIds : [interaction.nodeId];

        // Filter to top-level roots of the selection: skip any node
        // whose ancestor is also selected (moveSubtree already moves it).
        const selSet = isMulti ? new Set(selIds) : null;
        const topDragIds = selSet
          ? dragIds.filter((id) => {
              let cur = ns[id]?.parentId ?? null;
              while (cur) {
                if (selSet.has(cur)) return false;
                cur = ns[cur]?.parentId ?? null;
              }
              return true;
            })
          : dragIds;

        if (m === 'static' || m === 'engineer') {
          const node = ns[interaction.nodeId];
          const parent = node?.parentId ? ns[node.parentId] : null;
          // Angle snap only meaningful for a single dragged node that has a
          // parent — the snapped angle is the parent→child edge direction.
          const useAngleSnap =
            angleStep > 0 && !isMulti && parent && virtualPosRef.current;

          if (useAngleSnap && parent && virtualPosRef.current) {
            virtualPosRef.current.x += wdx;
            virtualPosRef.current.y += wdy;
            const vx = virtualPosRef.current.x - parent.position.x;
            const vy = virtualPosRef.current.y - parent.position.y;
            let dist = Math.hypot(vx, vy);
            if (dist > 0.0001 && node) {
              const stepRad = (angleStep * Math.PI) / 180;
              const angle = Math.atan2(vy, vx);
              const snappedAngle = Math.round(angle / stepRad) * stepRad;
              // When grid snap is also on, quantize the *distance* (not the
              // target xy) so the snapped angle stays exact — grid-quantizing
              // the target shifts the endpoint when the parent isn't aligned
              // to the grid, which manifests as a 1–2° angular error.
              if (snap) {
                dist = Math.max(GRID_SIZE, Math.round(dist / GRID_SIZE) * GRID_SIZE);
              }
              const targetX = parent.position.x + Math.cos(snappedAngle) * dist;
              const targetY = parent.position.y + Math.sin(snappedAngle) * dist;
              const adx = targetX - node.position.x;
              const ady = targetY - node.position.y;
              if (adx !== 0 || ady !== 0) {
                for (const id of topDragIds) {
                  useStore.getState().moveSubtree(id, adx, ady);
                }
              }
            }
          } else if (snap && virtualPosRef.current) {
            virtualPosRef.current.x += wdx;
            virtualPosRef.current.y += wdy;
            const snappedX =
              Math.round(virtualPosRef.current.x / GRID_SIZE) * GRID_SIZE;
            const snappedY =
              Math.round(virtualPosRef.current.y / GRID_SIZE) * GRID_SIZE;
            if (node) {
              const adx = snappedX - node.position.x;
              const ady = snappedY - node.position.y;
              if (adx !== 0 || ady !== 0) {
                for (const id of topDragIds) {
                  useStore.getState().moveSubtree(id, adx, ady);
                }
              }
            }
          } else {
            for (const id of topDragIds) {
              useStore.getState().moveSubtree(id, wdx, wdy);
            }
          }
        } else {
          for (const id of topDragIds) {
            useStore.getState().moveNode(id, wdx, wdy);
          }
        }

        interaction.lastX = e.clientX;
        interaction.lastY = e.clientY;
      } else if (interaction.type === 'connecting') {
        const vpRect = viewportRef.current!.getBoundingClientRect();
        const { camera: cam } = useStore.getState();
        const worldX = (e.clientX - vpRect.left - cam.x) / cam.zoom;
        const worldY = (e.clientY - vpRect.top - cam.y) / cam.zoom;

        // Read handle position from DOM (it tracks cursor along outline)
        const nodeEl = document.querySelector(
          `[data-node-id="${interaction.sourceId}"]`,
        );
        const handleEl = nodeEl?.querySelector('[data-handle]') as HTMLElement | null;
        if (nodeEl && handleEl) {
          const hRect = handleEl.getBoundingClientRect();
          const hx = (hRect.left + hRect.width / 2 - vpRect.left - cam.x) / cam.zoom;
          const hy = (hRect.top + hRect.height / 2 - vpRect.top - cam.y) / cam.zoom;
          setConnectLine({ x1: hx, y1: hy, x2: worldX, y2: worldY });
        }
      } else if (interaction.type === 'box-selecting') {
        const vpRect = viewportRef.current!.getBoundingClientRect();
        const { camera: cam } = useStore.getState();
        const wx = (e.clientX - vpRect.left - cam.x) / cam.zoom;
        const wy = (e.clientY - vpRect.top - cam.y) / cam.zoom;
        const sx = interaction.startWX;
        const sy = interaction.startWY;
        setSelectionBox({
          x: Math.min(sx, wx),
          y: Math.min(sy, wy),
          w: Math.abs(wx - sx),
          h: Math.abs(wy - sy),
        });
      }
    };

    const onMouseUp = (e: MouseEvent) => {
      const interaction = interactionRef.current;

      if (interaction.type === 'connecting') {
        const state = useStore.getState();
        const flowchart = state.projectType === 'flowchart';
        const el = document.elementFromPoint(e.clientX, e.clientY);
        const nodeEl = el?.closest('[data-node-id]');
        if (nodeEl) {
          const targetId = nodeEl.getAttribute('data-node-id')!;
          const sourceId = interaction.sourceId;
          if (targetId !== sourceId) {
            if (flowchart) {
              // Flowchart: plain many-to-many. Direction = source → target.
              state.addEdge(sourceId, targetId);
            } else {
              const { nodes: ns, connectNodes } = state;
              const srcRoot = findRoot(sourceId, ns);
              const tgtRoot = findRoot(targetId, ns);

              if (srcRoot !== tgtRoot) {
                // Different trees → merge. Smaller whole tree's root becomes
                // child of the node that was clicked in the larger tree, so
                // no existing connection breaks.
                const sizes = computeSubtreeSizes(ns);
                const srcTreeSize = (sizes[srcRoot] ?? 0) + 1;
                const tgtTreeSize = (sizes[tgtRoot] ?? 0) + 1;
                if (srcTreeSize <= tgtTreeSize) {
                  connectNodes(targetId, srcRoot);
                } else {
                  connectNodes(sourceId, tgtRoot);
                }
              } else {
                // Same tree → keep subtree-size based reparenting.
                const sizes = computeSubtreeSizes(ns);
                const sSize = sizes[sourceId] ?? 0;
                const tSize = sizes[targetId] ?? 0;
                const targetIsChild = tSize <= sSize;
                const parentId = targetIsChild ? sourceId : targetId;
                const childId = targetIsChild ? targetId : sourceId;
                if (!wouldCreateCycle(parentId, childId, ns)) {
                  connectNodes(parentId, childId);
                }
              }
            }
          }
        } else {
          // dropped on empty space → create new node and connect source → new
          const rect = viewportRef.current!.getBoundingClientRect();
          const { camera: cam } = state;
          const wx = (e.clientX - rect.left - cam.x) / cam.zoom;
          const wy = (e.clientY - rect.top - cam.y) / cam.zoom;
          const newId = state.addNode(wx, wy);
          if (flowchart) {
            state.addEdge(interaction.sourceId, newId);
          } else {
            state.connectNodes(interaction.sourceId, newId);
          }
          state.selectNode(newId);
          state.setEditingNodeId(newId);
        }
        setConnectLine(null);
      }

      if (interaction.type === 'box-selecting') {
        // Compute box directly from interaction start + current mouse pos
        // (don't rely on React state ref — it may be stale due to batching)
        const vpRect = viewportRef.current!.getBoundingClientRect();
        const { camera: cam, nodes: ns } = useStore.getState();
        const endWX = (e.clientX - vpRect.left - cam.x) / cam.zoom;
        const endWY = (e.clientY - vpRect.top - cam.y) / cam.zoom;
        const bx = Math.min(interaction.startWX, endWX);
        const by = Math.min(interaction.startWY, endWY);
        const bw = Math.abs(endWX - interaction.startWX);
        const bh = Math.abs(endWY - interaction.startWY);

        const matched: string[] = [];
        for (const n of Object.values(ns)) {
          if (
            n.position.x >= bx &&
            n.position.x <= bx + bw &&
            n.position.y >= by &&
            n.position.y <= by + bh
          ) {
            matched.push(n.id);
          }
        }
        if (matched.length > 0) {
          useStore.getState().selectNodes(matched);
        }
        setSelectionBox(null);
      }

      if (interaction.type === 'dragging') {
        draggedNodeRef.current = null;
        virtualPosRef.current = null;
      }

      interactionRef.current = { type: 'idle' };
      if (viewportRef.current) viewportRef.current.style.cursor = '';
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, []);

  // --- wheel ---
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const { camera: cam, setCamera } = useStore.getState();

      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const wx = (mx - cam.x) / cam.zoom;
      const wy = (my - cam.y) / cam.zoom;

      const factor = e.deltaY > 0 ? 0.92 : 1 / 0.92;
      const newZoom = Math.max(0.1, Math.min(5, cam.zoom * factor));

      setCamera({
        x: mx - wx * newZoom,
        y: my - wy * newZoom,
        zoom: newZoom,
      });
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // --- keyboard ---
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      if (e.key === ' ' && !e.repeat) {
        e.preventDefault();
        spaceHeldRef.current = true;
      }
      if (e.ctrlKey && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        useStore.getState().undo();
        return;
      }
      if (
        (e.ctrlKey && e.key === 'y') ||
        (e.ctrlKey && e.shiftKey && e.key === 'Z') ||
        (e.ctrlKey && e.key === 'r')
      ) {
        e.preventDefault();
        useStore.getState().redo();
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const { selectedNodeIds: ids, deleteNode, nodes: ns } = useStore.getState();
        const rootId = findSelectionRoot(ids, ns);
        if (rootId) {
          for (const id of ids) {
            if (id !== rootId) deleteNode(id);
          }
          useStore.getState().selectNode(rootId);
        } else {
          for (const id of ids) deleteNode(id);
        }
      }
      if (e.ctrlKey && e.shiftKey && (e.key === 'C' || e.key === 'c')) {
        // Ctrl+Shift+C → copy node with all its children
        const { selectedNodeIds: ids } = useStore.getState();
        if (ids.length > 0) {
          e.preventDefault();
          useStore.getState().copyNodes(ids);
        }
      } else if (e.ctrlKey && e.key === 'c') {
        // Ctrl+C → single copy (node only, no children)
        const { selectedNodeIds: ids } = useStore.getState();
        if (ids.length > 0) {
          e.preventDefault();
          useStore.getState().copySingle(ids);
        }
      }
      if (e.ctrlKey && e.key === 'v') {
        e.preventDefault();
        const rect = viewportRef.current?.getBoundingClientRect();
        if (rect) {
          const { camera: cam } = useStore.getState();
          // Paste at center of viewport
          const cx = (rect.width / 2 - cam.x) / cam.zoom;
          const cy = (rect.height / 2 - cam.y) / cam.zoom;
          useStore.getState().pasteNodes(cx, cy);
        }
      }
      if (e.key === 'Escape') {
        useStore.getState().selectNode(null);
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === ' ') spaceHeldRef.current = false;
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, []);

  // --- canvas mouse down ---
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    setContextMenu(null);

    if (
      e.button === 1 ||
      (e.button === 0 && e.altKey) ||
      (e.button === 0 && spaceHeldRef.current)
    ) {
      e.preventDefault();
      interactionRef.current = {
        type: 'panning',
        lastX: e.clientX,
        lastY: e.clientY,
      };
      if (viewportRef.current) viewportRef.current.style.cursor = 'grabbing';
      return;
    }

    if (e.button !== 0) return;

    const target = e.target as HTMLElement;
    const handleEl = target.closest('[data-handle]');
    const nodeEl = target.closest('[data-node-id]');
    const edgeEl = target.closest('[data-edge-id]');

    // Read projectType from live store — this callback has empty deps, so the
    // React-hooked `projectType` would stay stale after a mode switch.
    if (
      useStore.getState().projectType === 'flowchart' &&
      edgeEl &&
      !nodeEl &&
      !handleEl
    ) {
      const eid = edgeEl.getAttribute('data-edge-id')!;
      useStore.getState().selectEdge(eid);
      e.preventDefault();
      e.stopPropagation();
      return;
    }

    if (handleEl && nodeEl) {
      const sourceId = nodeEl.getAttribute('data-node-id')!;
      useStore.getState().selectNode(sourceId);
      interactionRef.current = { type: 'connecting', sourceId };
      if (viewportRef.current) viewportRef.current.style.cursor = 'crosshair';
      e.preventDefault();
    } else if (nodeEl) {
      const nodeId = nodeEl.getAttribute('data-node-id')!;
      useStore.getState().pushHistory();
      const currentIds = useStore.getState().selectedNodeIds;
      // If clicking a node already in multi-selection, keep the group
      if (!currentIds.includes(nodeId)) {
        useStore.getState().selectNode(nodeId);
      }
      const node = useStore.getState().nodes[nodeId];
      interactionRef.current = {
        type: 'dragging',
        nodeId,
        lastX: e.clientX,
        lastY: e.clientY,
      };
      draggedNodeRef.current = nodeId;
      if (node) virtualPosRef.current = { ...node.position };
      if (viewportRef.current) viewportRef.current.style.cursor = 'grabbing';
    } else {
      // empty canvas click → start box selection
      const rect = viewportRef.current!.getBoundingClientRect();
      const { camera: cam } = useStore.getState();
      const wx = (e.clientX - rect.left - cam.x) / cam.zoom;
      const wy = (e.clientY - rect.top - cam.y) / cam.zoom;
      interactionRef.current = { type: 'box-selecting', startWX: wx, startWY: wy };
      setSelectionBox({ x: wx, y: wy, w: 0, h: 0 });
      useStore.getState().selectNode(null);
      useStore.getState().selectEdge(null);
    }
  }, []);

  // --- double click to add node or edit existing ---
  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    const nodeEl = (e.target as HTMLElement).closest('[data-node-id]');
    if (nodeEl) {
      // Double-click on existing node → enter edit mode
      const nodeId = nodeEl.getAttribute('data-node-id')!;
      useStore.getState().setEditingNodeId(nodeId);
      return;
    }

    const rect = viewportRef.current!.getBoundingClientRect();
    const { camera: cam } = useStore.getState();
    const wx = (e.clientX - rect.left - cam.x) / cam.zoom;
    const wy = (e.clientY - rect.top - cam.y) / cam.zoom;

    const id = useStore.getState().addNode(wx, wy);
    useStore.getState().selectNode(id);
    useStore.getState().setEditingNodeId(id);
  }, []);

  // --- right click context menu ---
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const target = e.target as HTMLElement;
    const nodeEl = target.closest('[data-node-id]');
    if (nodeEl) {
      const nodeId = nodeEl.getAttribute('data-node-id')!;
      useStore.getState().selectNode(nodeId);
      setContextMenu({ type: 'node', x: e.clientX, y: e.clientY, nodeId });
      return;
    }
    const edgeEl = target.closest('[data-edge-id]');
    if (edgeEl) {
      const toId = edgeEl.getAttribute('data-edge-to-id')!;
      const fromId = edgeEl.getAttribute('data-edge-from-id')!;
      setContextMenu({ type: 'edge', x: e.clientX, y: e.clientY, parentId: fromId, childId: toId });
      return;
    }
    // Empty canvas → paste menu, anchored to where the click landed (world coords)
    const rect = viewportRef.current!.getBoundingClientRect();
    const { camera: cam } = useStore.getState();
    const wx = (e.clientX - rect.left - cam.x) / cam.zoom;
    const wy = (e.clientY - rect.top - cam.y) / cam.zoom;
    setContextMenu({ type: 'canvas', x: e.clientX, y: e.clientY, wx, wy });
  }, []);

  // --- build render data ---
  const nodeList = Object.values(nodes);

  const heightCache: Record<string, number> = {};
  const heightOf = (n: SkillNode) => {
    let h = heightCache[n.id];
    if (h === undefined) {
      h = demoMode ? DEMO_NODE_SIZE : computeNodeHeight(n, dataTypes, poolTypes);
      heightCache[n.id] = h;
    }
    return h;
  };

  const edges = Object.values(edgesMap)
    .filter((e) => nodes[e.fromId] && nodes[e.toId])
    .map((e) => {
      const from = nodes[e.fromId];
      const to = nodes[e.toId];
      const fromH = heightOf(from);
      const toH = heightOf(to);
      const reverseId = edgeId(e.toId, e.fromId);
      const hasReverse = !!edgesMap[reverseId];
      // Bidirectional pairs render as two parallel lines. Use a constant
      // positive perp — the perpendicular vector is built from (rdx, rdy),
      // which already flips sign for the reverse direction, so a constant
      // magnitude puts each edge on its own travel-direction-left side.
      // Flipping the sign again by id-order would double-negate and make
      // both edges overlap on the same side.
      const perp = isFlowchart && hasReverse ? 5 : 0;
      const dx = to.position.x - from.position.x;
      const dy = to.position.y - from.position.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      const angleDeg = (Math.atan2(dy, dx) * 180) / Math.PI;
      const geom = getEdgeGeom(
        from,
        to,
        fromH,
        toH,
        demoMode ? DEMO_NODE_SIZE : NODE_WIDTH,
        perp,
      );
      // Label sits on the actual curve midpoint. With uniform perp shift on
      // all 4 bezier points, the curve midpoint is the straight midpoint + perpVec.
      const invDist = distance > 0 ? 1 / distance : 0;
      const midX = (from.position.x + to.position.x) / 2;
      const midY = (from.position.y + to.position.y) / 2;
      // Bidirectional pairs also shift along the travel direction so the two
      // labels don't stack near the geometric center. Forward edge lands at
      // ~30% from `from`, reverse edge at ~30% from its own `from` (= 70% of
      // the forward direction) — sign flips naturally because dx/dy flip.
      const longBias =
        isFlowchart && hasReverse && distance > 80
          ? -Math.min(distance * 0.22, 70)
          : 0;
      return {
        id: e.id,
        fromId: e.fromId,
        toId: e.toId,
        name: e.name,
        selected: selectedEdgeId === e.id,
        path: geom.path,
        geom,
        midX,
        midY,
        midXLabel: midX + -dy * invDist * perp + dx * invDist * longBias,
        midYLabel: midY + dx * invDist * perp + dy * invDist * longBias,
        distance,
        angleDeg,
      };
    });

  // Chevrons ride each flowchart edge via RAF instead of SMIL. SMIL restarts
  // from t=0 whenever the path attribute mutates, which teleports the arrows
  // every mousemove during a drag. RAF uses elapsed time against the current
  // geom, so node motion continuously translates — no restart.
  const edgesForFlowRef = useRef(edges);
  edgesForFlowRef.current = edges;
  const flowStartRef = useRef(0);
  if (flowStartRef.current === 0) flowStartRef.current = performance.now();

  const positionChevrons = useCallback(() => {
    const elapsed = (performance.now() - flowStartRef.current) / 1000;
    const list = edgesForFlowRef.current;
    // One DOM scan per frame; cheaper than 3 lookups per edge.
    const els = new Map<string, SVGPolygonElement>();
    const found = document.querySelectorAll<SVGPolygonElement>('[data-chev]');
    for (const el of found) {
      const k = el.getAttribute('data-chev');
      if (k) els.set(k, el);
    }
    for (const e of list) {
      if (!e.geom || e.distance <= 0) continue;
      const dur = Math.max(0.9, e.distance / 90);
      const baseT = (elapsed / dur) % 1;
      const { p1, c1, c2, p2 } = e.geom;
      for (let i = 0; i < 3; i++) {
        const el = els.get(`${e.id}-${i}`);
        if (!el) continue;
        const t = (baseT + i / 3) % 1;
        const mt = 1 - t;
        const mt2 = mt * mt;
        const t2 = t * t;
        const x =
          mt2 * mt * p1.x +
          3 * mt2 * t * c1.x +
          3 * mt * t2 * c2.x +
          t2 * t * p2.x;
        const y =
          mt2 * mt * p1.y +
          3 * mt2 * t * c1.y +
          3 * mt * t2 * c2.y +
          t2 * t * p2.y;
        const dpx =
          3 * mt2 * (c1.x - p1.x) +
          6 * mt * t * (c2.x - c1.x) +
          3 * t2 * (p2.x - c2.x);
        const dpy =
          3 * mt2 * (c1.y - p1.y) +
          6 * mt * t * (c2.y - c1.y) +
          3 * t2 * (p2.y - c2.y);
        const ang = (Math.atan2(dpy, dpx) * 180) / Math.PI;
        el.setAttribute(
          'transform',
          `translate(${x.toFixed(2)},${y.toFixed(2)}) rotate(${ang.toFixed(2)})`,
        );
      }
    }
  }, []);

  // Sync-position immediately after each React commit so the first paint
  // after a drag frame already shows the new positions; otherwise chevrons
  // flash to their unset/origin transform for one frame.
  useLayoutEffect(() => {
    if (isFlowchart) positionChevrons();
  });

  useEffect(() => {
    if (!isFlowchart) return;
    let rafId = 0;
    const tick = () => {
      positionChevrons();
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [isFlowchart, positionChevrons]);

  const isEmpty = nodeList.length === 0;

  return (
    <div
      className="canvas-viewport"
      ref={viewportRef}
      onMouseDown={handleMouseDown}
      onDoubleClick={handleDoubleClick}
      onContextMenu={handleContextMenu}
      style={{
        backgroundPosition: `${camera.x}px ${camera.y}px`,
        backgroundSize: `${24 * camera.zoom}px ${24 * camera.zoom}px`,
      }}
    >
      {isEmpty && (
        <div className="canvas-empty-hint">
          Double-click to create your first node
        </div>
      )}

      <div
        className={`canvas-world${demoMode ? ' demo-mode' : ''}`}
        style={{
          transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.zoom})`,
        }}
      >
        <svg className="edges-layer" width="1" height="1" overflow="visible">
          <defs>
            <marker
              id="edge-arrow"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="7"
              markerHeight="7"
              orient="auto-start-reverse"
              markerUnits="userSpaceOnUse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" className="edge-arrow-head" />
            </marker>
            <marker
              id="edge-arrow-selected"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="7"
              markerHeight="7"
              orient="auto-start-reverse"
              markerUnits="userSpaceOnUse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" className="edge-arrow-head selected" />
            </marker>
          </defs>
          {/* First pass: paths, chevrons, hit areas. Labels go in a second
              pass below so no sibling edge's path can paint over them. */}
          {edges.map(({ id, fromId, toId, path, distance, selected }) => (
            <g key={id}>
              <path
                d={path}
                className={`edge-path${selected ? ' selected' : ''}${isFlowchart ? ' flowchart' : ''}`}
                markerEnd={
                  isFlowchart
                    ? selected
                      ? 'url(#edge-arrow-selected)'
                      : 'url(#edge-arrow)'
                    : undefined
                }
              />
              {!isFlowchart && <path d={path} className="edge-flow" />}
              {isFlowchart && distance > 0 && (
                <>
                  {[0, 1, 2].map((i) => (
                    <polygon
                      key={i}
                      points="-9,-6 0,0 -9,6"
                      className={`edge-flow-chevron${selected ? ' selected' : ''}`}
                      data-chev={`${id}-${i}`}
                    />
                  ))}
                </>
              )}
              <path
                d={path}
                className={`edge-hit${isFlowchart ? ' clickable' : ''}`}
                data-edge-id={id}
                data-edge-from-id={fromId}
                data-edge-to-id={toId}
              />
            </g>
          ))}
          {edges.map(({ id, name, midX, midY, midXLabel, midYLabel, distance, angleDeg, selected }) => {
            const hasName = isFlowchart && name.trim().length > 0;
            const labelW = Math.max(40, name.length * 7 + 14);
            if (!hasName && mode !== 'engineer') return null;
            return (
              <g key={`${id}-label`}>
                {hasName && (
                  <g
                    className="edge-label-group edge-name-group"
                    transform={`translate(${midXLabel},${midYLabel})`}
                  >
                    <rect
                      className={`edge-label-bg${selected ? ' selected' : ''}`}
                      x={-labelW / 2}
                      y={-11}
                      width={labelW}
                      height={22}
                      rx={4}
                    />
                    <text className="edge-label edge-name-label" x={0} y={4} textAnchor="middle">
                      {name}
                    </text>
                  </g>
                )}
                {mode === 'engineer' && (
                  <g className="edge-label-group" transform={`translate(${midX},${midY + (hasName ? 22 : 0)})`}>
                    <rect className="edge-label-bg" x={-32} y={-14} width={64} height={28} rx={4} />
                    <text className="edge-label" x={0} y={-2} textAnchor="middle">
                      {distance.toFixed(0)}px
                    </text>
                    <text className="edge-label edge-label-sub" x={0} y={9} textAnchor="middle">
                      {angleDeg.toFixed(0)}°
                    </text>
                  </g>
                )}
              </g>
            );
          })}
          {connectLine && (
            <line
              x1={connectLine.x1}
              y1={connectLine.y1}
              x2={connectLine.x2}
              y2={connectLine.y2}
              className="connect-line"
            />
          )}
        </svg>

        {nodeList.map((node) => (
          <NodeView
            key={node.id}
            node={node}
            isSelected={selectedNodeIds.includes(node.id)}
            mapLines={getMapLines(node, dataTypes, poolTypes)}
            color={node.color ?? dataTypes[node.dataTypeId]?.color ?? '#ffffff'}
          />
        ))}

        {selectionBox && (
          <div
            className="selection-box"
            style={{
              left: selectionBox.x,
              top: selectionBox.y,
              width: selectionBox.w,
              height: selectionBox.h,
            }}
          />
        )}
      </div>

      <div className="zoom-indicator">
        {Math.round(camera.zoom * 100)}%
      </div>

      {/* Context Menu */}
      {contextMenu?.type === 'node' && (() => {
        const cm = contextMenu;
        const cmNode = nodes[cm.nodeId];
        const isExpanded = cmNode?.displayMode !== 'compact';
        return (
          <div
            className="context-menu"
            style={{ left: cm.x, top: cm.y }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div
              className="context-menu-item"
              onMouseDown={() => {
                useStore.getState().copySingle([cm.nodeId]);
                setContextMenu(null);
              }}
            >
              <span>Single Copy</span>
              <span className="context-menu-shortcut">Ctrl+C</span>
            </div>
            <div
              className="context-menu-item"
              onMouseDown={() => {
                useStore.getState().copyNodes([cm.nodeId]);
                setContextMenu(null);
              }}
            >
              <span>Copy</span>
              <span className="context-menu-shortcut">Ctrl+Shift+C</span>
            </div>
            <div className="context-menu-divider" />
            <div
              className="context-menu-item"
              onMouseDown={() => {
                useStore.getState().setNodeDisplayMode(
                  cm.nodeId,
                  isExpanded ? 'compact' : 'expanded',
                );
                setContextMenu(null);
              }}
            >
              {isExpanded ? 'Compact View' : 'Expanded View'}
            </div>
            {cmNode?.imageData && (
              <div
                className="context-menu-item"
                onMouseDown={() => {
                  useStore.getState().setNodeImage(cm.nodeId, null);
                  setContextMenu(null);
                }}
              >
                Remove Image
              </div>
            )}
            {cmNode?.parentId && (
              <div
                className="context-menu-item"
                onMouseDown={() => {
                  useStore.getState().disconnectNode(cm.nodeId);
                  setContextMenu(null);
                }}
              >
                Disconnect from Parent
              </div>
            )}
            <div
              className="context-menu-item"
              onMouseDown={() => {
                useStore.getState().disconnectAll(cm.nodeId);
                setContextMenu(null);
              }}
            >
              Disconnect from All Nodes
            </div>
            <div
              className="context-menu-item context-menu-item-danger"
              onMouseDown={() => {
                useStore.getState().deleteNode(cm.nodeId);
                setContextMenu(null);
              }}
            >
              Delete Node
            </div>
          </div>
        );
      })()}

      {contextMenu?.type === 'edge' && (() => {
        const cm = contextMenu;
        return (
          <div
            className="context-menu"
            style={{ left: cm.x, top: cm.y }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            {!isFlowchart && (
              <div
                className="context-menu-item"
                onMouseDown={() => {
                  useStore.getState().swapParentChild(cm.parentId, cm.childId);
                  setContextMenu(null);
                }}
              >
                Swap Parent / Child
              </div>
            )}
            <div
              className="context-menu-item context-menu-item-danger"
              onMouseDown={() => {
                if (isFlowchart) {
                  useStore.getState().removeEdge(edgeId(cm.parentId, cm.childId));
                } else {
                  useStore.getState().disconnectNode(cm.childId);
                }
                setContextMenu(null);
              }}
            >
              Disconnect
            </div>
          </div>
        );
      })()}

      {contextMenu?.type === 'canvas' && (() => {
        const cm = contextMenu;
        const canPaste = clipboardCount > 0;
        return (
          <div
            className="context-menu"
            style={{ left: cm.x, top: cm.y }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div
              className={`context-menu-item${canPaste ? '' : ' disabled'}`}
              onMouseDown={() => {
                if (!canPaste) return;
                useStore.getState().pasteNodes(cm.wx, cm.wy);
                setContextMenu(null);
              }}
            >
              <span>Paste</span>
              <span className="context-menu-shortcut">Ctrl+V</span>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
