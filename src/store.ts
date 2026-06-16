import { create } from 'zustand';
import {
  SkillNode,
  Position,
  Camera,
  InteractionMode,
  DataType,
  FieldDefinition,
  FieldType,
  PoolType,
  PoolEntry,
  MapLine,
  LayoutAlgorithm,
  NodeDisplayMode,
  ProjectType,
  EdgeData,
  edgeId,
  NamedSnapshot,
} from './types';
import {
  loadFileSettings,
  saveFileSettings,
  type FileViewSettings,
} from './fileSettings';

export const NODE_WIDTH = 160;
export const NODE_MIN_HEIGHT = 53;
export const MAP_TEXT_LINE_HEIGHT = 18;
export const GRID_SIZE = 20;
export const DEMO_NODE_SIZE = 72;

const CHARS_PER_LINE = 18;
const TITLE_CHARS_PER_LINE = 14;
const TITLE_LINE_HEIGHT = 20;

// --- helpers ---

function getDescendantIds(
  nodeId: string,
  nodes: Record<string, SkillNode>,
): string[] {
  const childrenOf: Record<string, string[]> = {};
  for (const n of Object.values(nodes)) {
    if (n.parentId) {
      (childrenOf[n.parentId] ??= []).push(n.id);
    }
  }
  const result: string[] = [];
  const stack = childrenOf[nodeId] ? [...childrenOf[nodeId]] : [];
  while (stack.length > 0) {
    const id = stack.pop()!;
    result.push(id);
    if (childrenOf[id]) stack.push(...childrenOf[id]);
  }
  return result;
}

export function getMapLines(
  node: SkillNode,
  dataTypes: Record<string, DataType>,
  poolTypes: Record<string, PoolType>,
): MapLine[] {
  const dt = dataTypes[node.dataTypeId];
  if (!dt) return [];
  const result: MapLine[] = [];
  for (const f of dt.fields) {
    if (!f.showOnMap) continue;
    if (f.type === 'text') {
      const v = node.fieldValues[f.id];
      if (typeof v === 'string' && v.trim()) {
        result.push({ type: 'text', text: v });
      }
    } else if (f.type === 'pool' && f.poolTypeId) {
      const entries = node.fieldValues[f.id] as PoolEntry[] | undefined;
      const pt = poolTypes[f.poolTypeId];
      if (entries && pt) {
        for (const entry of entries) {
          const item = pt.items.find((i) => i.id === entry.itemId);
          if (item && entry.count > 0) {
            result.push({
              type: 'pool-entry',
              text: `${entry.count}x ${item.name}`,
              color: item.color,
            });
          }
        }
      }
    }
  }
  return result;
}

export function computeNodeHeight(
  node: SkillNode,
  dataTypes: Record<string, DataType>,
  poolTypes: Record<string, PoolType>,
): number {
  // Icon mode: compact + has image
  if (node.displayMode === 'compact' && node.imageData) {
    return 64;
  }

  const titleLines = Math.max(1, Math.ceil(node.title.length / TITLE_CHARS_PER_LINE));
  const titleExtra = (titleLines - 1) * TITLE_LINE_HEIGHT;
  const imageExtra = node.imageData ? 84 : 0; // 80px image + 4px margin

  if (node.displayMode === 'compact') {
    return NODE_MIN_HEIGHT + titleExtra + imageExtra;
  }

  const lines = getMapLines(node, dataTypes, poolTypes);
  let extra = 0;
  for (const line of lines) {
    if (line.type === 'text') {
      const lineCount = Math.max(
        1,
        Math.ceil(line.text.length / CHARS_PER_LINE),
      );
      extra += lineCount * 16 + 4;
    } else {
      extra += MAP_TEXT_LINE_HEIGHT;
    }
  }
  return NODE_MIN_HEIGHT + titleExtra + imageExtra + extra;
}

// Find nodes whose title or any text field contains the query. Matches are
// returned in canvas reading order (top-to-bottom, then left-to-right) so the
// next/prev arrows walk them the way the user sees them.
function computeSearchMatches(
  query: string,
  nodes: Record<string, SkillNode>,
  dataTypes: Record<string, DataType>,
): string[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const matched: SkillNode[] = [];
  for (const n of Object.values(nodes)) {
    let hay = n.title.toLowerCase();
    const dt = dataTypes[n.dataTypeId];
    if (dt) {
      for (const f of dt.fields) {
        if (f.type === 'text') {
          const v = n.fieldValues[f.id];
          if (typeof v === 'string' && v) hay += '\n' + v.toLowerCase();
        }
      }
    }
    if (hay.includes(q)) matched.push(n);
  }
  matched.sort(
    (a, b) => a.position.y - b.position.y || a.position.x - b.position.x,
  );
  return matched.map((n) => n.id);
}

// Re-map a node's field values when its data type changes. Values carry over
// positionally per field type (Nth text → Nth text, …); dropdown values only
// survive if the chosen option id still exists, pool values only if the field
// points at the same pool type.
function remapFieldValues(
  node: SkillNode,
  oldDt: DataType | undefined,
  newDt: DataType | undefined,
): Record<string, string | number | boolean | PoolEntry[]> {
  const newValues: Record<string, string | number | boolean | PoolEntry[]> = {};
  if (!oldDt || !newDt) return newValues;
  const oldByType: Record<FieldType, FieldDefinition[]> = {
    text: [], number: [], boolean: [], dropdown: [], pool: [],
  };
  for (const f of oldDt.fields) oldByType[f.type].push(f);
  for (const newField of newDt.fields) {
    const oldField = oldByType[newField.type].shift();
    if (!oldField) continue;
    const oldVal = node.fieldValues[oldField.id];
    if (oldVal === undefined) continue;
    if (newField.type === 'pool') {
      if (oldField.poolTypeId !== newField.poolTypeId) continue;
      newValues[newField.id] = oldVal;
    } else if (newField.type === 'dropdown') {
      if (newField.dropdownOptions.some((o) => o.id === oldVal)) {
        newValues[newField.id] = oldVal;
      }
    } else {
      newValues[newField.id] = oldVal;
    }
  }
  return newValues;
}

// --- initial data ---

const DATA_TYPE_COLORS = [
  '#ffffff', '#e0e7ff', '#dbeafe', '#d1fae5', '#fef3c7',
  '#fce7f3', '#ede9fe', '#ffedd5', '#f0fdf4', '#fdf2f8',
];

function createInitialDataTypes(): Record<string, DataType> {
  return {
    'dt-1': {
      id: 'dt-1',
      name: 'Veri Tipi 1',
      color: '#ffffff',
      fields: [
        {
          id: 'f-1',
          name: 'Description',
          type: 'text',
          showOnMap: false,
          dropdownOptions: [],
          poolTypeId: null,
        },
      ],
    },
  };
}

// Flowchart preset: a single fixed data type with the locked Description field.
// The store enforces "no add field / no field deletion" in flowchart mode so
// these stay the only fields available.
export const FLOWCHART_DESCRIPTION_FIELD_ID = 'f-desc';
export const FLOWCHART_DATA_TYPE_ID = 'dt-flow';

export function createFlowchartDataTypes(): Record<string, DataType> {
  return {
    [FLOWCHART_DATA_TYPE_ID]: {
      id: FLOWCHART_DATA_TYPE_ID,
      name: 'Node',
      color: '#ffffff',
      fields: [
        {
          id: FLOWCHART_DESCRIPTION_FIELD_ID,
          name: 'Description',
          type: 'text',
          showOnMap: false,
          dropdownOptions: [],
          poolTypeId: null,
        },
      ],
    },
  };
}

function createInitialNodes(): Record<string, SkillNode> {
  return {
    n1: {
      id: 'n1',
      title: 'Combat Mastery',
      position: { x: 0, y: 0 },
      parentId: null,
      dataTypeId: 'dt-1',
      fieldValues: { 'f-1': 'The foundation of all combat skills' },
      displayMode: 'expanded',
    },
    n2: {
      id: 'n2',
      title: 'Swordsmanship',
      position: { x: -220, y: 160 },
      parentId: 'n1',
      dataTypeId: 'dt-1',
      fieldValues: { 'f-1': 'Master the art of the blade' },
      displayMode: 'expanded',
    },
    n3: {
      id: 'n3',
      title: 'Archery',
      position: { x: 0, y: 160 },
      parentId: 'n1',
      dataTypeId: 'dt-1',
      fieldValues: { 'f-1': 'Precision ranged attacks' },
      displayMode: 'expanded',
    },
    n4: {
      id: 'n4',
      title: 'Shield Defense',
      position: { x: 220, y: 160 },
      parentId: 'n1',
      dataTypeId: 'dt-1',
      fieldValues: { 'f-1': 'Block and parry incoming attacks' },
      displayMode: 'expanded',
    },
    n5: {
      id: 'n5',
      title: 'Dual Wielding',
      position: { x: -300, y: 320 },
      parentId: 'n2',
      dataTypeId: 'dt-1',
      fieldValues: { 'f-1': 'Fight with two weapons at once' },
      displayMode: 'expanded',
    },
    n6: {
      id: 'n6',
      title: 'Power Strike',
      position: { x: -140, y: 320 },
      parentId: 'n2',
      dataTypeId: 'dt-1',
      fieldValues: { 'f-1': 'Devastating heavy attacks' },
      displayMode: 'expanded',
    },
    n7: {
      id: 'n7',
      title: 'Eagle Eye',
      position: { x: 0, y: 320 },
      parentId: 'n3',
      dataTypeId: 'dt-1',
      fieldValues: { 'f-1': 'Enhanced ranged accuracy' },
      displayMode: 'expanded',
    },
  };
}

// --- store interface ---

interface TreeStore {
  nodes: Record<string, SkillNode>;
  dataTypes: Record<string, DataType>;
  poolTypes: Record<string, PoolType>;
  edges: Record<string, EdgeData>;
  projectType: ProjectType;
  camera: Camera;
  selectedNodeIds: string[];
  selectedEdgeId: string | null;
  editingNodeId: string | null;
  mode: InteractionMode;
  gridSnap: boolean;
  /** 0 = off; otherwise the snap step in degrees (5/10/15/20/30/40/45/90). */
  angleSnap: number;
  demoMode: boolean;
  autoTargetLength: number;
  /** Number of nodes currently on the clipboard (0 = paste disabled). */
  clipboardCount: number;
  theme: 'night' | 'day';
  currentFilePath: string | null;
  /**
   * File identity used only for remembering per-file view settings. Equals
   * currentFilePath for .perkloom; for imported .json (which opens as an
   * unsaved doc with currentFilePath = null) this holds the source path so its
   * snap settings can still persist. Never used for saving.
   */
  settingsPath: string | null;
  startScreenOpen: boolean;
  isDirty: boolean;
  minimapVisible: boolean;
  inspectorWidth: number;
  toasts: Toast[];

  // Search (Ctrl+F): match node title / text fields, step through hits.
  searchOpen: boolean;
  searchQuery: string;
  searchMatchIds: string[];
  searchActiveIndex: number;
  openSearch: () => void;
  closeSearch: () => void;
  setSearchQuery: (q: string) => void;
  searchNext: () => void;
  searchPrev: () => void;

  setInspectorWidth: (w: number) => void;
  addNode: (x: number, y: number) => string;
  deleteNode: (id: string) => void;
  selectNode: (id: string | null) => void;
  selectNodes: (ids: string[]) => void;
  selectEdge: (id: string | null) => void;
  setEdgeName: (id: string, name: string) => void;
  setEdgeDescription: (id: string, description: string) => void;
  addEdge: (fromId: string, toId: string) => string | null;
  removeEdge: (id: string) => void;
  setEdgeBidirectional: (id: string, bidirectional: boolean) => void;
  setProjectType: (type: ProjectType) => void;
  moveNode: (nodeId: string, dx: number, dy: number) => void;
  moveSubtree: (nodeId: string, dx: number, dy: number) => void;
  updateNodeTitle: (id: string, title: string) => void;
  connectNodes: (parentId: string, childId: string) => void;
  disconnectNode: (childId: string) => void;
  disconnectAll: (nodeId: string) => void;
  swapParentChild: (parentId: string, childId: string) => void;
  setCamera: (patch: Partial<Camera>) => void;
  setMode: (mode: InteractionMode) => void;
  setGridSnap: (enabled: boolean) => void;
  setAngleSnap: (degrees: number) => void;
  setDemoMode: (enabled: boolean) => void;
  setAutoTargetLength: (length: number) => void;
  setTheme: (theme: 'night' | 'day') => void;
  setCurrentFilePath: (path: string | null) => void;
  setStartScreenOpen: (open: boolean) => void;
  setIsDirty: (dirty: boolean) => void;
  setMinimapVisible: (visible: boolean) => void;
  addToast: (message: string, kind?: ToastKind) => void;
  removeToast: (id: string) => void;
  getChildIds: (parentId: string) => string[];

  addDataType: () => string;
  renameDataType: (id: string, name: string) => void;
  setDataTypeColor: (id: string, color: string) => void;
  setNodeDataType: (nodeId: string, dataTypeId: string) => void;
  setNodesDataType: (nodeIds: string[], dataTypeId: string) => void;
  setNodeColor: (nodeId: string, color: string | null) => void;
  deleteDataType: (id: string, convertTo: string | null) => void;

  addField: (dataTypeId: string, type: FieldType) => void;
  renameField: (dataTypeId: string, fieldId: string, name: string) => void;
  deleteField: (dataTypeId: string, fieldId: string) => void;
  setFieldShowOnMap: (dtId: string, fId: string, show: boolean) => void;
  setFieldPoolType: (dtId: string, fId: string, ptId: string) => void;

  addDropdownOption: (dtId: string, fId: string) => void;
  renameDropdownOption: (dtId: string, fId: string, oId: string, l: string) => void;
  deleteDropdownOption: (dtId: string, fId: string, oId: string) => void;

  addPoolType: () => string;
  renamePoolType: (id: string, name: string) => void;
  addPoolItem: (ptId: string) => void;
  renamePoolItem: (ptId: string, iId: string, name: string) => void;
  deletePoolItem: (ptId: string, iId: string) => void;
  setPoolItemColor: (ptId: string, iId: string, color: string) => void;

  addPoolEntry: (nId: string, fId: string, iId: string) => void;
  removePoolEntry: (nId: string, fId: string, idx: number) => void;
  setPoolEntryCount: (nId: string, fId: string, idx: number, c: number) => void;
  setPoolEntryItem: (nId: string, fId: string, idx: number, iId: string) => void;

  setEditingNodeId: (id: string | null) => void;
  setFieldValue: (nId: string, fId: string, v: string | number | boolean) => void;
  /**
   * Set a field on many nodes at once, matching the target field by name+type
   * within each node's own data type (ids may differ across data types). Used
   * by the multi-select inspector to bulk-edit a shared variable.
   */
  setCommonFieldValue: (
    nodeIds: string[],
    fieldName: string,
    fieldType: FieldType,
    value: string | number | boolean,
  ) => void;

  setNodeImage: (nId: string, data: string | null) => void;
  setNodeDisplayMode: (nId: string, mode: NodeDisplayMode) => void;
  setAllDisplayMode: (mode: NodeDisplayMode) => void;

  copyNodes: (ids: string[]) => void;
  copySingle: (ids: string[]) => void;
  pasteNodes: (cx: number, cy: number) => void;

  autoLayout: (algorithm: LayoutAlgorithm) => void;

  getProjectData: () => ProjectData;
  loadProjectData: (data: ProjectData) => void;
  getReadableExport: () => ReadableExport;
  getCsvExport: () => string;

  undo: () => void;
  redo: () => void;
  pushHistory: () => void;

  // Snapshots
  namedSnapshots: NamedSnapshot[];
  snapshotPanelOpen: boolean;
  setSnapshotPanelOpen: (open: boolean) => void;
  saveSnapshot: (name: string) => void;
  restoreSnapshot: (id: string) => void;
  deleteSnapshot: (id: string) => void;
  renameSnapshot: (id: string, name: string) => void;

  // Tabs
  tabs: TabEntry[];
  activeTabId: string | null;
  newTab: (projectType: ProjectType, title?: string) => string;
  openInNewTab: (
    data: ProjectData,
    filePath: string | null,
    title: string,
    settingsPath?: string | null,
  ) => string;
  switchTab: (id: string) => void;
  closeTab: (id: string) => void;
  setActiveTabTitle: (title: string) => void;
}

export type ToastKind = 'info' | 'success' | 'error';

export interface Toast {
  id: string;
  message: string;
  kind: ToastKind;
}

export interface ProjectData {
  nodes: Record<string, SkillNode>;
  dataTypes: Record<string, DataType>;
  poolTypes: Record<string, PoolType>;
  edges?: Record<string, EdgeData>;
  projectType?: ProjectType;
  inspectorWidth?: number;
  snapshots?: SnapshotEntry[];
  /** Snap/auto-length settings, embedded so they travel with the file. */
  viewSettings?: FileViewSettings;
}

/** Full project state stored inside a named snapshot. */
export interface SnapshotEntry {
  id: string;
  name: string;
  createdAt: number;
  data: {
    nodes: Record<string, SkillNode>;
    dataTypes: Record<string, DataType>;
    poolTypes: Record<string, PoolType>;
    edges: Record<string, EdgeData>;
    projectType: ProjectType;
  };
}

export interface ReadableExport {
  projectType: ProjectType;
  dataTypes: ReadableDataType[];
  nodes: ReadableNode[];
  edges?: ReadableEdge[];
}

interface ReadableEdge {
  from: string;
  to: string;
  name: string;
  description: string;
}

interface ReadableDataType {
  name: string;
  color: string;
  fields: ReadableFieldDef[];
}

interface ReadableFieldDef {
  name: string;
  type: FieldType;
  options?: string[];
  poolType?: string;
}

interface ReadableNode {
  title: string;
  dataType: string;
  parent: string | null;
  position: Position;
  fields: Record<string, unknown>;
}

// Id counters live in a mutable object so the whole bucket can be captured
// and restored wholesale when swapping tabs.
interface IdCounters {
  nextNodeId: number;
  nextDtId: number;
  nextFieldId: number;
  nextOptId: number;
  nextPoolTypeId: number;
  nextPoolItemId: number;
}
const counters: IdCounters = {
  nextNodeId: 100,
  nextDtId: 2,
  nextFieldId: 2,
  nextOptId: 1,
  nextPoolTypeId: 1,
  nextPoolItemId: 1,
};

const DEFAULT_ITEM_COLORS = [
  '#ef4444',
  '#3b82f6',
  '#22c55e',
  '#f59e0b',
  '#8b5cf6',
  '#ec4899',
];

interface Snapshot {
  nodes: Record<string, SkillNode>;
  dataTypes: Record<string, DataType>;
  poolTypes: Record<string, PoolType>;
  edges: Record<string, EdgeData>;
  mode: InteractionMode;
}

const MAX_HISTORY = 100;
let undoStack: Snapshot[] = [];
let redoStack: Snapshot[] = [];

// clipboard (module-level, not serialized). Carries the definitions referenced
// by the copied nodes (dataTypes + any poolTypes their fields reference) so a
// paste into a different file can re-create a missing data type by name.
let clipboard: {
  nodes: SkillNode[];
  rootIds: string[];
  dataTypes: Record<string, DataType>;
  poolTypes: Record<string, PoolType>;
} | null = null;

// Collect the data type (+ referenced pool type) definitions used by a set of
// nodes, deep-cloned, so a cross-file paste can re-create what's missing.
function collectClipboardDefs(
  nodeList: SkillNode[],
  dataTypes: Record<string, DataType>,
  poolTypes: Record<string, PoolType>,
): { dataTypes: Record<string, DataType>; poolTypes: Record<string, PoolType> } {
  const dts: Record<string, DataType> = {};
  const pts: Record<string, PoolType> = {};
  for (const n of nodeList) {
    const dt = dataTypes[n.dataTypeId];
    if (!dt || dts[dt.id]) continue;
    dts[dt.id] = JSON.parse(JSON.stringify(dt));
    for (const f of dt.fields) {
      if (f.type === 'pool' && f.poolTypeId && poolTypes[f.poolTypeId] && !pts[f.poolTypeId]) {
        pts[f.poolTypeId] = JSON.parse(JSON.stringify(poolTypes[f.poolTypeId]));
      }
    }
  }
  return { dataTypes: dts, poolTypes: pts };
}

// Snapshot full data stored outside Zustand to avoid rerender bloat.
// The store only keeps lightweight NamedSnapshot metadata; the heavy
// ProjectData payloads live here, keyed by snapshot id.
export const snapshotDataMap = new Map<string, SnapshotEntry['data']>();

// Per-tab snapshot data backup used during tab switching
const tabSnapshotDataBackup = new Map<string, Map<string, SnapshotEntry['data']>>();

function takeSnapshot(s: Snapshot): Snapshot {
  return {
    nodes: JSON.parse(JSON.stringify(s.nodes)),
    dataTypes: JSON.parse(JSON.stringify(s.dataTypes)),
    poolTypes: JSON.parse(JSON.stringify(s.poolTypes)),
    edges: JSON.parse(JSON.stringify(s.edges)),
    mode: s.mode,
  };
}

// Snapshot of a non-active tab. The active tab's data lives in the store;
// on tab switch we move state into/out of this bucket.
interface TabDocState {
  nodes: Record<string, SkillNode>;
  dataTypes: Record<string, DataType>;
  poolTypes: Record<string, PoolType>;
  edges: Record<string, EdgeData>;
  projectType: ProjectType;
  camera: Camera;
  selectedNodeIds: string[];
  selectedEdgeId: string | null;
  editingNodeId: string | null;
  currentFilePath: string | null;
  settingsPath: string | null;
  isDirty: boolean;
  inspectorWidth: number;
  counters: IdCounters;
  undo: Snapshot[];
  redo: Snapshot[];
  namedSnapshots: NamedSnapshot[];
}

export interface TabEntry {
  id: string;
  title: string;
  // Present only for inactive tabs. Active tab's data is the live store.
  snapshot?: TabDocState;
}

let tabIdSeq = 0;
const newTabId = () => `tab-${++tabIdSeq}`;

function loadInitialInspectorWidth(): number {
  try {
    const raw = localStorage.getItem('perkloom-inspector-width');
    if (!raw) return 280;
    const n = parseInt(raw, 10);
    if (!Number.isFinite(n)) return 280;
    return Math.min(720, Math.max(240, n));
  } catch {
    return 280;
  }
}

const freshCounters = (): IdCounters => ({
  nextNodeId: 100,
  nextDtId: 2,
  nextFieldId: 2,
  nextOptId: 1,
  nextPoolTypeId: 1,
  nextPoolItemId: 1,
});

export const useStore = create<TreeStore>((set, get) => ({
  tabs: [],
  activeTabId: null,
  nodes: createInitialNodes(),
  dataTypes: createInitialDataTypes(),
  poolTypes: {},
  edges: {},
  projectType: 'skilltree',
  camera: { x: 0, y: 0, zoom: 1 },
  selectedNodeIds: [],
  selectedEdgeId: null,
  editingNodeId: null,
  mode: 'static',
  gridSnap: true,
  angleSnap: 0,
  demoMode: false,
  autoTargetLength: 160,
  clipboardCount: 0,
  theme: 'night',
  currentFilePath: null,
  settingsPath: null,
  startScreenOpen: true,
  isDirty: false,
  minimapVisible: true,
  inspectorWidth: loadInitialInspectorWidth(),
  toasts: [],
  namedSnapshots: [],
  snapshotPanelOpen: false,
  searchOpen: false,
  searchQuery: '',
  searchMatchIds: [],
  searchActiveIndex: -1,

  setInspectorWidth: (w) => {
    const clamped = Math.min(720, Math.max(240, Math.round(w)));
    if (typeof document !== 'undefined') {
      document.documentElement.style.setProperty(
        '--inspector-width',
        `${clamped}px`,
      );
    }
    try {
      localStorage.setItem('perkloom-inspector-width', String(clamped));
    } catch {
      // ignore storage errors
    }
    set({ inspectorWidth: clamped });
  },

  addNode: (x, y) => {
    get().pushHistory();
    const id = `node-${counters.nextNodeId++}`;
    const dtId = Object.keys(get().dataTypes)[0] ?? '';
    set((s) => ({
      nodes: {
        ...s.nodes,
        [id]: {
          id,
          title: 'New Skill',
          position: { x, y },
          parentId: null,
          dataTypeId: dtId,
          fieldValues: {},
          displayMode: 'expanded',
        },
      },
    }));
    return id;
  },

  deleteNode: (id) => {
    get().pushHistory();
    set((s) => {
      const victim = s.nodes[id];
      if (!victim) return s;
      const grandparentId = victim.parentId;
      const newNodes: Record<string, SkillNode> = {};
      for (const [nid, node] of Object.entries(s.nodes)) {
        if (nid === id) continue;
        if (node.parentId === id) {
          newNodes[nid] = { ...node, parentId: grandparentId };
        } else {
          newNodes[nid] = node;
        }
      }
      // Drop all edges that reference the deleted node. In skilltree mode,
      // rewire the "from → child" edges up to the grandparent so metadata
      // follows the new parent connection. In flowchart mode, edges are
      // independent and just get removed with the node.
      const newEdges: Record<string, EdgeData> = {};
      const isSkilltree = s.projectType !== 'flowchart';
      for (const e of Object.values(s.edges)) {
        if (e.fromId === id || e.toId === id) {
          if (isSkilltree && e.fromId === id && grandparentId) {
            const nid = edgeId(grandparentId, e.toId);
            newEdges[nid] = { ...e, id: nid, fromId: grandparentId };
          }
          continue;
        }
        newEdges[e.id] = e;
      }
      return {
        nodes: newNodes,
        edges: newEdges,
        selectedNodeIds: s.selectedNodeIds.filter((nid) => nid !== id),
        selectedEdgeId:
          s.selectedEdgeId && newEdges[s.selectedEdgeId]
            ? s.selectedEdgeId
            : null,
      };
    });
  },

  selectNode: (id) => set((s) => ({
    selectedNodeIds: id ? [id] : [],
    selectedEdgeId: id ? null : s.selectedEdgeId,
    editingNodeId: id !== s.editingNodeId ? null : s.editingNodeId,
  })),
  selectNodes: (ids) =>
    set((s) => ({
      selectedNodeIds: ids,
      selectedEdgeId: ids.length > 0 ? null : s.selectedEdgeId,
      editingNodeId: null,
    })),

  selectEdge: (id) =>
    set((s) => ({
      selectedEdgeId: id,
      selectedNodeIds: id ? [] : s.selectedNodeIds,
      editingNodeId: id ? null : s.editingNodeId,
    })),

  setEdgeName: (id, name) => {
    set((s) => {
      const e = s.edges[id];
      if (!e) return s;
      return { edges: { ...s.edges, [id]: { ...e, name } } };
    });
  },

  setEdgeDescription: (id, description) => {
    set((s) => {
      const e = s.edges[id];
      if (!e) return s;
      return { edges: { ...s.edges, [id]: { ...e, description } } };
    });
  },

  addEdge: (fromId, toId) => {
    if (fromId === toId) return null;
    const { nodes, edges } = get();
    if (!nodes[fromId] || !nodes[toId]) return null;
    const id = edgeId(fromId, toId);
    if (edges[id]) return id;
    get().pushHistory();
    set((s) => ({
      edges: {
        ...s.edges,
        [id]: { id, fromId, toId, name: '', description: '' },
      },
    }));
    return id;
  },

  removeEdge: (id) => {
    get().pushHistory();
    set((s) => {
      if (!s.edges[id]) return s;
      const { [id]: _, ...rest } = s.edges;
      return {
        edges: rest,
        selectedEdgeId: s.selectedEdgeId === id ? null : s.selectedEdgeId,
      };
    });
  },

  setEdgeBidirectional: (id, bidirectional) => {
    const { edges } = get();
    const e = edges[id];
    if (!e) return;
    const reverseId = edgeId(e.toId, e.fromId);
    const hasReverse = !!edges[reverseId];
    if (bidirectional === hasReverse) return;
    get().pushHistory();
    set((s) => {
      const next = { ...s.edges };
      if (bidirectional) {
        next[reverseId] = {
          id: reverseId,
          fromId: e.toId,
          toId: e.fromId,
          name: '',
          description: '',
        };
      } else {
        delete next[reverseId];
      }
      return { edges: next };
    });
  },

  setProjectType: (type) => set({ projectType: type }),

  moveNode: (nodeId, dx, dy) => {
    set((s) => {
      const n = s.nodes[nodeId];
      if (!n) return s;
      return {
        nodes: {
          ...s.nodes,
          [nodeId]: {
            ...n,
            position: { x: n.position.x + dx, y: n.position.y + dy },
          },
        },
      };
    });
  },

  moveSubtree: (nodeId, dx, dy) => {
    const { nodes } = get();
    const ids = [nodeId, ...getDescendantIds(nodeId, nodes)];
    set((s) => {
      const updated = { ...s.nodes };
      for (const id of ids) {
        const n = updated[id];
        if (n) {
          updated[id] = {
            ...n,
            position: { x: n.position.x + dx, y: n.position.y + dy },
          };
        }
      }
      return { nodes: updated };
    });
  },

  updateNodeTitle: (id, title) => {
    set((s) => ({
      nodes: { ...s.nodes, [id]: { ...s.nodes[id], title } },
    }));
  },

  connectNodes: (parentId, childId) => {
    get().pushHistory();
    set((s) => {
      const child = s.nodes[childId];
      if (!child) return s;
      const newEdges = { ...s.edges };
      const isFlowchart = s.projectType === 'flowchart';
      if (!isFlowchart) {
        // Skilltree: enforce single-parent by dropping the old parent edge.
        if (child.parentId) {
          delete newEdges[edgeId(child.parentId, childId)];
        }
      }
      const newId = edgeId(parentId, childId);
      newEdges[newId] = newEdges[newId] ?? {
        id: newId,
        fromId: parentId,
        toId: childId,
        name: '',
        description: '',
      };
      return {
        nodes: isFlowchart
          ? s.nodes
          : {
              ...s.nodes,
              [childId]: { ...child, parentId },
            },
        edges: newEdges,
      };
    });
  },

  disconnectNode: (childId) => {
    get().pushHistory();
    set((s) => {
      const child = s.nodes[childId];
      if (!child) return s;
      const newEdges = { ...s.edges };
      if (s.projectType === 'flowchart') {
        // In flowchart mode the arg is treated as "remove every edge targeting
        // this node"; this keeps right-click disconnect usable on graphs.
        for (const e of Object.values(newEdges)) {
          if (e.toId === childId || e.fromId === childId) delete newEdges[e.id];
        }
        return {
          edges: newEdges,
          selectedEdgeId:
            s.selectedEdgeId && newEdges[s.selectedEdgeId]
              ? s.selectedEdgeId
              : null,
        };
      }
      if (child.parentId) {
        delete newEdges[edgeId(child.parentId, childId)];
      }
      return {
        nodes: { ...s.nodes, [childId]: { ...child, parentId: null } },
        edges: newEdges,
        selectedEdgeId:
          s.selectedEdgeId && newEdges[s.selectedEdgeId]
            ? s.selectedEdgeId
            : null,
      };
    });
  },

  disconnectAll: (nodeId) => {
    get().pushHistory();
    set((s) => {
      const newEdges: Record<string, EdgeData> = {};
      for (const e of Object.values(s.edges)) {
        if (e.fromId === nodeId || e.toId === nodeId) continue;
        newEdges[e.id] = e;
      }
      if (s.projectType === 'flowchart') {
        return {
          edges: newEdges,
          selectedEdgeId:
            s.selectedEdgeId && newEdges[s.selectedEdgeId]
              ? s.selectedEdgeId
              : null,
        };
      }
      const updated: Record<string, SkillNode> = {};
      for (const [nid, node] of Object.entries(s.nodes)) {
        if (nid === nodeId || node.parentId === nodeId) {
          updated[nid] = { ...node, parentId: null };
        } else {
          updated[nid] = node;
        }
      }
      return {
        nodes: updated,
        edges: newEdges,
        selectedEdgeId:
          s.selectedEdgeId && newEdges[s.selectedEdgeId]
            ? s.selectedEdgeId
            : null,
      };
    });
  },

  swapParentChild: (parentId, childId) => {
    const { nodes } = get();
    const p = nodes[parentId];
    const c = nodes[childId];
    if (!p || !c || c.parentId !== parentId) return;
    get().pushHistory();
    const grandparentId = p.parentId;
    set((s) => {
      const newEdges = { ...s.edges };
      // Reverse the parent→child edge, preserving name/description
      const oldId = edgeId(parentId, childId);
      const old = newEdges[oldId];
      delete newEdges[oldId];
      const reversedId = edgeId(childId, parentId);
      newEdges[reversedId] = {
        id: reversedId,
        fromId: childId,
        toId: parentId,
        name: old?.name ?? '',
        description: old?.description ?? '',
      };
      if (grandparentId) {
        const oldGpId = edgeId(grandparentId, parentId);
        const oldGp = newEdges[oldGpId];
        delete newEdges[oldGpId];
        const newGpId = edgeId(grandparentId, childId);
        newEdges[newGpId] = {
          id: newGpId,
          fromId: grandparentId,
          toId: childId,
          name: oldGp?.name ?? '',
          description: oldGp?.description ?? '',
        };
      }
      return {
        nodes: {
          ...s.nodes,
          [parentId]: { ...s.nodes[parentId], parentId: childId },
          [childId]: { ...s.nodes[childId], parentId: grandparentId },
        },
        edges: newEdges,
      };
    });
  },

  setCamera: (patch) => set((s) => ({ camera: { ...s.camera, ...patch } })),
  setMode: (mode) => {
    if (get().mode === mode) return;
    get().pushHistory();
    set({ mode });
    persistViewSettings();
  },
  setGridSnap: (enabled) => {
    set({ gridSnap: enabled });
    persistViewSettings();
  },
  setAngleSnap: (degrees) => {
    const allowed = [0, 5, 10, 15, 20, 30, 40, 45, 90];
    const v = allowed.includes(degrees) ? degrees : 0;
    set({ angleSnap: v });
    persistViewSettings();
  },
  setDemoMode: (enabled) => set({ demoMode: enabled }),
  setAutoTargetLength: (length) => {
    set({ autoTargetLength: Math.max(20, length) });
    persistViewSettings();
  },
  setTheme: (theme) => {
    if (theme === 'day') {
      document.documentElement.setAttribute('data-theme', 'day');
    } else {
      document.documentElement.removeAttribute('data-theme');
    }
    set({ theme });
  },
  setCurrentFilePath: (path) => set({ currentFilePath: path }),
  setStartScreenOpen: (open) => set({ startScreenOpen: open }),
  setIsDirty: (dirty) => set({ isDirty: dirty }),
  setMinimapVisible: (visible) => set({ minimapVisible: visible }),
  addToast: (message, kind = 'info') => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    set((s) => ({ toasts: [...s.toasts, { id, message, kind }] }));
    setTimeout(() => {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
    }, 3000);
  },
  removeToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

  getChildIds: (parentId) =>
    Object.values(get().nodes)
      .filter((n) => n.parentId === parentId)
      .map((n) => n.id),

  // --- search (Ctrl+F) ---

  openSearch: () => set({ searchOpen: true }),
  closeSearch: () =>
    set({
      searchOpen: false,
      searchQuery: '',
      searchMatchIds: [],
      searchActiveIndex: -1,
    }),
  setSearchQuery: (q) => {
    const { nodes, dataTypes } = get();
    const ids = computeSearchMatches(q, nodes, dataTypes);
    set({
      searchQuery: q,
      searchMatchIds: ids,
      searchActiveIndex: ids.length > 0 ? 0 : -1,
    });
  },
  searchNext: () =>
    set((s) => {
      const n = s.searchMatchIds.length;
      if (n === 0) return s;
      return { searchActiveIndex: (s.searchActiveIndex + 1) % n };
    }),
  searchPrev: () =>
    set((s) => {
      const n = s.searchMatchIds.length;
      if (n === 0) return s;
      return { searchActiveIndex: (s.searchActiveIndex - 1 + n) % n };
    }),

  // --- data type ---

  addDataType: () => {
    get().pushHistory();
    const num = counters.nextDtId++;
    const id = `dt-${num}`;
    const color = DATA_TYPE_COLORS[num % DATA_TYPE_COLORS.length];
    set((s) => ({
      dataTypes: {
        ...s.dataTypes,
        [id]: { id, name: `Veri Tipi ${num}`, color, fields: [] },
      },
    }));
    return id;
  },

  renameDataType: (id, name) => {
    get().pushHistory();
    set((s) => {
      const dt = s.dataTypes[id];
      if (!dt) return s;
      return { dataTypes: { ...s.dataTypes, [id]: { ...dt, name } } };
    });
  },

  setDataTypeColor: (id, color) => {
    get().pushHistory();
    set((s) => {
      const dt = s.dataTypes[id];
      if (!dt) return s;
      return { dataTypes: { ...s.dataTypes, [id]: { ...dt, color } } };
    });
  },

  deleteDataType: (id, convertTo) => {
    get().pushHistory();
    set((s) => {
      if (!s.dataTypes[id]) return s;
      const remainingIds = Object.keys(s.dataTypes).filter((k) => k !== id);
      if (remainingIds.length === 0) return s;
      const fallback = convertTo && s.dataTypes[convertTo] ? convertTo : remainingIds[0];
      const nextDataTypes = { ...s.dataTypes };
      delete nextDataTypes[id];
      const nextNodes: Record<string, SkillNode> = {};
      for (const [nid, node] of Object.entries(s.nodes)) {
        if (node.dataTypeId === id) {
          nextNodes[nid] = { ...node, dataTypeId: fallback, fieldValues: {} };
        } else {
          nextNodes[nid] = node;
        }
      }
      return { dataTypes: nextDataTypes, nodes: nextNodes };
    });
  },

  setNodeDataType: (nodeId, dataTypeId) => {
    get().pushHistory();
    set((s) => {
      const node = s.nodes[nodeId];
      if (!node || node.dataTypeId === dataTypeId) return s;
      const newValues = remapFieldValues(
        node,
        s.dataTypes[node.dataTypeId],
        s.dataTypes[dataTypeId],
      );
      return {
        nodes: {
          ...s.nodes,
          [nodeId]: { ...node, dataTypeId, fieldValues: newValues },
        },
      };
    });
  },

  setNodesDataType: (nodeIds, dataTypeId) => {
    get().pushHistory();
    set((s) => {
      const newDt = s.dataTypes[dataTypeId];
      if (!newDt) return s;
      const nodes = { ...s.nodes };
      let changed = false;
      for (const id of nodeIds) {
        const node = nodes[id];
        if (!node || node.dataTypeId === dataTypeId) continue;
        const newValues = remapFieldValues(
          node,
          s.dataTypes[node.dataTypeId],
          newDt,
        );
        nodes[id] = { ...node, dataTypeId, fieldValues: newValues };
        changed = true;
      }
      return changed ? { nodes } : s;
    });
  },

  setNodeColor: (nodeId, color) => {
    get().pushHistory();
    set((s) => {
      const node = s.nodes[nodeId];
      if (!node) return s;
      const next = { ...node };
      if (color === null) delete next.color;
      else next.color = color;
      return {
        nodes: { ...s.nodes, [nodeId]: next },
        isDirty: true,
      };
    });
  },

  // --- fields ---

  addField: (dataTypeId, type) => {
    get().pushHistory();
    const id = `f-${counters.nextFieldId++}`;
    const names: Record<FieldType, string> = {
      text: 'Text',
      dropdown: 'Dropdown',
      number: 'Number',
      boolean: 'Boolean',
      pool: 'Countable Pool',
    };
    set((s) => {
      const dt = s.dataTypes[dataTypeId];
      if (!dt) return s;

      let poolTypeId: string | null = null;
      let newPoolTypes = s.poolTypes;

      if (type === 'pool') {
        const ptIds = Object.keys(s.poolTypes);
        if (ptIds.length > 0) {
          poolTypeId = ptIds[0];
        } else {
          const ptNum = counters.nextPoolTypeId++;
          poolTypeId = `pt-${ptNum}`;
          newPoolTypes = {
            ...s.poolTypes,
            [poolTypeId]: {
              id: poolTypeId,
              name: `Pool ${ptNum}`,
              items: [],
            },
          };
        }
      }

      return {
        poolTypes: newPoolTypes,
        dataTypes: {
          ...s.dataTypes,
          [dataTypeId]: {
            ...dt,
            fields: [
              ...dt.fields,
              {
                id,
                name: names[type],
                type,
                showOnMap: false,
                dropdownOptions: [],
                poolTypeId,
              },
            ],
          },
        },
      };
    });
  },

  renameField: (dataTypeId, fieldId, name) => {
    set((s) => {
      const dt = s.dataTypes[dataTypeId];
      if (!dt) return s;
      return {
        dataTypes: {
          ...s.dataTypes,
          [dataTypeId]: {
            ...dt,
            fields: dt.fields.map((f) =>
              f.id === fieldId ? { ...f, name } : f,
            ),
          },
        },
      };
    });
  },

  deleteField: (dataTypeId, fieldId) => {
    get().pushHistory();
    set((s) => {
      const dt = s.dataTypes[dataTypeId];
      if (!dt) return s;
      return {
        dataTypes: {
          ...s.dataTypes,
          [dataTypeId]: {
            ...dt,
            fields: dt.fields.filter((f) => f.id !== fieldId),
          },
        },
      };
    });
  },

  setFieldShowOnMap: (dtId, fId, show) => {
    set((s) => {
      const dt = s.dataTypes[dtId];
      if (!dt) return s;
      return {
        dataTypes: {
          ...s.dataTypes,
          [dtId]: {
            ...dt,
            fields: dt.fields.map((f) =>
              f.id === fId ? { ...f, showOnMap: show } : f,
            ),
          },
        },
      };
    });
  },

  setFieldPoolType: (dtId, fId, ptId) => {
    set((s) => {
      const dt = s.dataTypes[dtId];
      if (!dt) return s;
      return {
        dataTypes: {
          ...s.dataTypes,
          [dtId]: {
            ...dt,
            fields: dt.fields.map((f) =>
              f.id === fId ? { ...f, poolTypeId: ptId } : f,
            ),
          },
        },
      };
    });
  },

  // --- dropdown options ---

  addDropdownOption: (dtId, fId) => {
    get().pushHistory();
    const num = counters.nextOptId++;
    const optId = `opt-${num}`;
    set((s) => {
      const dt = s.dataTypes[dtId];
      if (!dt) return s;
      return {
        dataTypes: {
          ...s.dataTypes,
          [dtId]: {
            ...dt,
            fields: dt.fields.map((f) =>
              f.id === fId
                ? {
                    ...f,
                    dropdownOptions: [
                      ...f.dropdownOptions,
                      { id: optId, label: `Secenek ${num}` },
                    ],
                  }
                : f,
            ),
          },
        },
      };
    });
  },

  renameDropdownOption: (dtId, fId, oId, label) => {
    set((s) => {
      const dt = s.dataTypes[dtId];
      if (!dt) return s;
      return {
        dataTypes: {
          ...s.dataTypes,
          [dtId]: {
            ...dt,
            fields: dt.fields.map((f) =>
              f.id === fId
                ? {
                    ...f,
                    dropdownOptions: f.dropdownOptions.map((o) =>
                      o.id === oId ? { ...o, label } : o,
                    ),
                  }
                : f,
            ),
          },
        },
      };
    });
  },

  deleteDropdownOption: (dtId, fId, oId) => {
    get().pushHistory();
    set((s) => {
      const dt = s.dataTypes[dtId];
      if (!dt) return s;
      return {
        dataTypes: {
          ...s.dataTypes,
          [dtId]: {
            ...dt,
            fields: dt.fields.map((f) =>
              f.id === fId
                ? {
                    ...f,
                    dropdownOptions: f.dropdownOptions.filter(
                      (o) => o.id !== oId,
                    ),
                  }
                : f,
            ),
          },
        },
      };
    });
  },

  // --- pool types ---

  addPoolType: () => {
    get().pushHistory();
    const num = counters.nextPoolTypeId++;
    const id = `pt-${num}`;
    set((s) => ({
      poolTypes: {
        ...s.poolTypes,
        [id]: { id, name: `Pool ${num}`, items: [] },
      },
    }));
    return id;
  },

  renamePoolType: (id, name) => {
    set((s) => {
      const pt = s.poolTypes[id];
      if (!pt) return s;
      return { poolTypes: { ...s.poolTypes, [id]: { ...pt, name } } };
    });
  },

  addPoolItem: (ptId) => {
    get().pushHistory();
    const num = counters.nextPoolItemId++;
    const itemId = `pi-${num}`;
    const color = DEFAULT_ITEM_COLORS[(num - 1) % DEFAULT_ITEM_COLORS.length];
    set((s) => {
      const pt = s.poolTypes[ptId];
      if (!pt) return s;
      return {
        poolTypes: {
          ...s.poolTypes,
          [ptId]: {
            ...pt,
            items: [
              ...pt.items,
              { id: itemId, name: `Item ${num}`, color },
            ],
          },
        },
      };
    });
  },

  renamePoolItem: (ptId, iId, name) => {
    set((s) => {
      const pt = s.poolTypes[ptId];
      if (!pt) return s;
      return {
        poolTypes: {
          ...s.poolTypes,
          [ptId]: {
            ...pt,
            items: pt.items.map((i) =>
              i.id === iId ? { ...i, name } : i,
            ),
          },
        },
      };
    });
  },

  deletePoolItem: (ptId, iId) => {
    get().pushHistory();
    set((s) => {
      const pt = s.poolTypes[ptId];
      if (!pt) return s;
      return {
        poolTypes: {
          ...s.poolTypes,
          [ptId]: {
            ...pt,
            items: pt.items.filter((i) => i.id !== iId),
          },
        },
      };
    });
  },

  setPoolItemColor: (ptId, iId, color) => {
    set((s) => {
      const pt = s.poolTypes[ptId];
      if (!pt) return s;
      return {
        poolTypes: {
          ...s.poolTypes,
          [ptId]: {
            ...pt,
            items: pt.items.map((i) =>
              i.id === iId ? { ...i, color } : i,
            ),
          },
        },
      };
    });
  },

  // --- pool entries ---

  addPoolEntry: (nId, fId, iId) => {
    get().pushHistory();
    set((s) => {
      const node = s.nodes[nId];
      if (!node) return s;
      const cur = (node.fieldValues[fId] as PoolEntry[] | undefined) ?? [];
      return {
        nodes: {
          ...s.nodes,
          [nId]: {
            ...node,
            fieldValues: {
              ...node.fieldValues,
              [fId]: [...cur, { itemId: iId, count: 1 }],
            },
          },
        },
      };
    });
  },

  removePoolEntry: (nId, fId, idx) => {
    get().pushHistory();
    set((s) => {
      const node = s.nodes[nId];
      if (!node) return s;
      const cur = [
        ...((node.fieldValues[fId] as PoolEntry[] | undefined) ?? []),
      ];
      cur.splice(idx, 1);
      return {
        nodes: {
          ...s.nodes,
          [nId]: {
            ...node,
            fieldValues: { ...node.fieldValues, [fId]: cur },
          },
        },
      };
    });
  },

  setPoolEntryCount: (nId, fId, idx, c) => {
    set((s) => {
      const node = s.nodes[nId];
      if (!node) return s;
      const cur = [
        ...((node.fieldValues[fId] as PoolEntry[] | undefined) ?? []),
      ];
      if (idx < 0 || idx >= cur.length) return s;
      cur[idx] = { ...cur[idx], count: c };
      return {
        nodes: {
          ...s.nodes,
          [nId]: {
            ...node,
            fieldValues: { ...node.fieldValues, [fId]: cur },
          },
        },
      };
    });
  },

  setPoolEntryItem: (nId, fId, idx, iId) => {
    set((s) => {
      const node = s.nodes[nId];
      if (!node) return s;
      const cur = [
        ...((node.fieldValues[fId] as PoolEntry[] | undefined) ?? []),
      ];
      if (idx < 0 || idx >= cur.length) return s;
      cur[idx] = { ...cur[idx], itemId: iId };
      return {
        nodes: {
          ...s.nodes,
          [nId]: {
            ...node,
            fieldValues: { ...node.fieldValues, [fId]: cur },
          },
        },
      };
    });
  },

  setEditingNodeId: (id) => set({ editingNodeId: id }),

  // --- field values ---

  setFieldValue: (nId, fId, v) => {
    set((s) => {
      const node = s.nodes[nId];
      if (!node) return s;
      return {
        nodes: {
          ...s.nodes,
          [nId]: {
            ...node,
            fieldValues: { ...node.fieldValues, [fId]: v },
          },
        },
      };
    });
  },

  setCommonFieldValue: (nodeIds, fieldName, fieldType, value) => {
    set((s) => {
      const nodes = { ...s.nodes };
      let changed = false;
      for (const id of nodeIds) {
        const node = nodes[id];
        if (!node) continue;
        const dt = s.dataTypes[node.dataTypeId];
        if (!dt) continue;
        const field = dt.fields.find(
          (f) => f.name === fieldName && f.type === fieldType,
        );
        if (!field) continue;
        nodes[id] = {
          ...node,
          fieldValues: { ...node.fieldValues, [field.id]: value },
        };
        changed = true;
      }
      // Bulk edits are explicit operations — mark the doc dirty so they get
      // saved/recovered even though single text edits don't push history.
      return changed ? { nodes, isDirty: true } : s;
    });
  },

  // --- node image & display mode ---

  setNodeImage: (nId, data) => {
    get().pushHistory();
    set((s) => {
      const node = s.nodes[nId];
      if (!node) return s;
      return { nodes: { ...s.nodes, [nId]: { ...node, imageData: data } } };
    });
  },

  setNodeDisplayMode: (nId, mode) => {
    set((s) => {
      const node = s.nodes[nId];
      if (!node) return s;
      return { nodes: { ...s.nodes, [nId]: { ...node, displayMode: mode } } };
    });
  },

  setAllDisplayMode: (mode) => {
    set((s) => {
      const updated: Record<string, SkillNode> = {};
      for (const [id, n] of Object.entries(s.nodes)) {
        updated[id] = { ...n, displayMode: mode };
      }
      return { nodes: updated };
    });
  },

  // --- clipboard ---

  copyNodes: (ids) => {
    const { nodes, dataTypes, poolTypes } = get();
    // Collect selected + all their descendants
    const allIds = new Set<string>();
    for (const id of ids) {
      allIds.add(id);
      for (const did of getDescendantIds(id, nodes)) allIds.add(did);
    }
    const copied = Array.from(allIds)
      .filter((id) => nodes[id])
      .map((id) => JSON.parse(JSON.stringify(nodes[id])) as SkillNode);
    // Root ids = the ones originally selected (top-level)
    clipboard = {
      nodes: copied,
      rootIds: [...ids],
      ...collectClipboardDefs(copied, dataTypes, poolTypes),
    };
    set({ clipboardCount: copied.length });
  },

  // Copy only the given nodes, detached from their parents (no descendants),
  // so they paste as standalone roots.
  copySingle: (ids) => {
    const { nodes, dataTypes, poolTypes } = get();
    const copied = ids
      .filter((id) => nodes[id])
      .map((id) => {
        const clone = JSON.parse(JSON.stringify(nodes[id])) as SkillNode;
        clone.parentId = null;
        return clone;
      });
    clipboard = {
      nodes: copied,
      rootIds: [...ids],
      ...collectClipboardDefs(copied, dataTypes, poolTypes),
    };
    set({ clipboardCount: copied.length });
  },

  pasteNodes: (cx, cy) => {
    if (!clipboard || clipboard.nodes.length === 0) return;
    get().pushHistory();
    const { dataTypes: destDataTypes, poolTypes: destPoolTypes } = get();

    // Remap clipboard data types / pool types onto the destination file: reuse
    // a same-named def if present, otherwise create it. Field ids are kept as-is
    // (node.fieldValues are keyed by them and looked up per data type), so only
    // the def ids and pool references need rewriting.
    const newDataTypes: Record<string, DataType> = {};
    const newPoolTypes: Record<string, PoolType> = {};
    const dtRemap: Record<string, string> = {};
    const ptRemap: Record<string, string> = {};

    for (const pt of Object.values(clipboard.poolTypes)) {
      const existing = Object.values(destPoolTypes).find((p) => p.name === pt.name);
      if (existing) {
        ptRemap[pt.id] = existing.id;
      } else {
        const newId = `pt-${counters.nextPoolTypeId++}`;
        ptRemap[pt.id] = newId;
        newPoolTypes[newId] = { ...JSON.parse(JSON.stringify(pt)), id: newId };
      }
    }

    for (const dt of Object.values(clipboard.dataTypes)) {
      const existing = Object.values(destDataTypes).find((d) => d.name === dt.name);
      if (existing) {
        dtRemap[dt.id] = existing.id;
      } else {
        const newId = `dt-${counters.nextDtId++}`;
        dtRemap[dt.id] = newId;
        const cloned = JSON.parse(JSON.stringify(dt)) as DataType;
        cloned.id = newId;
        for (const f of cloned.fields) {
          if (f.type === 'pool' && f.poolTypeId && ptRemap[f.poolTypeId]) {
            f.poolTypeId = ptRemap[f.poolTypeId];
          }
        }
        newDataTypes[newId] = cloned;
      }
    }

    const idMap: Record<string, string> = {};
    for (const n of clipboard.nodes) {
      idMap[n.id] = `node-${counters.nextNodeId++}`;
    }
    // Compute center of copied nodes for offset
    let sumX = 0, sumY = 0;
    for (const n of clipboard.nodes) { sumX += n.position.x; sumY += n.position.y; }
    const avgX = sumX / clipboard.nodes.length;
    const avgY = sumY / clipboard.nodes.length;

    const newNodes: Record<string, SkillNode> = {};
    const newEdges: Record<string, EdgeData> = {};
    for (const n of clipboard.nodes) {
      const newId = idMap[n.id];
      const newParentId = n.parentId && idMap[n.parentId] ? idMap[n.parentId] : null;
      newNodes[newId] = {
        ...n,
        id: newId,
        parentId: newParentId,
        dataTypeId: dtRemap[n.dataTypeId] ?? n.dataTypeId,
        position: { x: cx + (n.position.x - avgX), y: cy + (n.position.y - avgY) },
      };
      if (newParentId) {
        const eid = edgeId(newParentId, newId);
        newEdges[eid] = { id: eid, fromId: newParentId, toId: newId, name: '', description: '' };
      }
    }
    set((s) => ({
      nodes: { ...s.nodes, ...newNodes },
      edges: { ...s.edges, ...newEdges },
      dataTypes: { ...s.dataTypes, ...newDataTypes },
      poolTypes: { ...s.poolTypes, ...newPoolTypes },
      selectedNodeIds: Object.keys(newNodes),
    }));
  },

  // --- auto layout ---

  autoLayout: (algorithm) => {
    get().pushHistory();
    const { nodes: ns, edges: es } = get();
    const list = Object.values(ns);
    if (list.length === 0) return;

    // Build children map. Prefer parentId hierarchy (skilltree); fall back to
    // edge topology (flowchart) when no node has a parent.
    const childrenOf: Record<string, string[]> = {};
    const roots: string[] = [];
    const hasParentHierarchy = list.some((n) => n.parentId && ns[n.parentId]);

    if (hasParentHierarchy) {
      for (const n of list) {
        if (n.parentId && ns[n.parentId]) {
          (childrenOf[n.parentId] ??= []).push(n.id);
        } else {
          roots.push(n.id);
        }
      }
    } else {
      const childSets: Record<string, Set<string>> = {};
      const incoming = new Set<string>();
      for (const e of Object.values(es)) {
        if (!ns[e.fromId] || !ns[e.toId] || e.fromId === e.toId) continue;
        (childSets[e.fromId] ??= new Set()).add(e.toId);
        incoming.add(e.toId);
      }
      for (const id in childSets) childrenOf[id] = Array.from(childSets[id]);
      for (const n of list) if (!incoming.has(n.id)) roots.push(n.id);
    }
    // If everything is in a cycle (or no tree structure), fall back to first
    if (roots.length === 0) roots.push(list[0].id);

    const H_GAP = 200;
    const V_GAP = 120;

    // Cycle-safe: each node visited once for sizing/placement.
    const widthCache = new Map<string, number>();
    function subtreeWidth(id: string, seen: Set<string>): number {
      if (seen.has(id)) return 0;
      const cached = widthCache.get(id);
      if (cached !== undefined) return cached;
      seen.add(id);
      const kids = childrenOf[id] || [];
      const w = kids.length === 0
        ? 1
        : kids.reduce((sum, c) => sum + subtreeWidth(c, seen), 0) || 1;
      seen.delete(id);
      widthCache.set(id, w);
      return w;
    }

    const positions: Record<string, Position> = {};

    const placed = new Set<string>();

    if (algorithm === 'tree') {
      // Top-down tree
      function layoutTree(id: string, x: number, y: number) {
        if (placed.has(id)) return;
        placed.add(id);
        positions[id] = { x, y };
        const kids = (childrenOf[id] || []).filter((k) => !placed.has(k));
        if (kids.length === 0) return;
        const totalW = kids.reduce((s, c) => s + subtreeWidth(c, new Set()), 0);
        let cx = x - ((totalW - 1) * H_GAP) / 2;
        for (const kid of kids) {
          const w = subtreeWidth(kid, new Set());
          layoutTree(kid, cx + ((w - 1) * H_GAP) / 2, y + V_GAP);
          cx += w * H_GAP;
        }
      }
      let rx = 0;
      for (const rid of roots) {
        const w = subtreeWidth(rid, new Set());
        layoutTree(rid, rx + ((w - 1) * H_GAP) / 2, 0);
        rx += w * H_GAP + H_GAP;
      }
    } else if (algorithm === 'horizontal') {
      // Left-to-right tree
      function layoutHoriz(id: string, x: number, y: number) {
        if (placed.has(id)) return;
        placed.add(id);
        positions[id] = { x, y };
        const kids = (childrenOf[id] || []).filter((k) => !placed.has(k));
        if (kids.length === 0) return;
        const totalW = kids.reduce((s, c) => s + subtreeWidth(c, new Set()), 0);
        let cy = y - ((totalW - 1) * V_GAP) / 2;
        for (const kid of kids) {
          const w = subtreeWidth(kid, new Set());
          layoutHoriz(kid, x + H_GAP, cy + ((w - 1) * V_GAP) / 2);
          cy += w * V_GAP;
        }
      }
      let ry = 0;
      for (const rid of roots) {
        const w = subtreeWidth(rid, new Set());
        layoutHoriz(rid, 0, ry + ((w - 1) * V_GAP) / 2);
        ry += w * V_GAP + V_GAP;
      }
    } else if (algorithm === 'radial') {
      // Wedge-based radial: each subtree gets an angular wedge proportional
      // to its leaf count, recursively subdivided. Nodes sit at depth*RING_GAP
      // from origin at the wedge midpoint. For a pure tree (no cross-links),
      // wedges nest without overlap — guarantees no node overlap and no
      // parent→child edge crossings.
      const BASE_RING = 240;
      const MIN_ARC_PER_LEAF = 0.10; // radians per leaf at outermost ring
      const root = roots[0];

      // Cycle-safe leaf count
      const leafCache = new Map<string, number>();
      function leafCount(id: string, seen: Set<string>): number {
        if (seen.has(id)) return 1;
        const cached = leafCache.get(id);
        if (cached !== undefined) return cached;
        seen.add(id);
        const kids = childrenOf[id] || [];
        const n = kids.length === 0
          ? 1
          : kids.reduce((s, c) => s + leafCount(c, seen), 0) || 1;
        seen.delete(id);
        leafCache.set(id, n);
        return n;
      }

      // Max depth from a given node (cycle-safe)
      const depthCache = new Map<string, number>();
      function maxDepth(id: string, seen: Set<string>): number {
        if (seen.has(id)) return 0;
        const cached = depthCache.get(id);
        if (cached !== undefined) return cached;
        seen.add(id);
        const kids = childrenOf[id] || [];
        const d = kids.length === 0
          ? 0
          : 1 + Math.max(...kids.map((c) => maxDepth(c, seen)));
        seen.delete(id);
        depthCache.set(id, d);
        return d;
      }

      positions[root] = { x: 0, y: 0 };
      placed.add(root);

      function placeWedge(
        id: string,
        depth: number,
        angleStart: number,
        angleEnd: number,
      ) {
        const kids = (childrenOf[id] || []).filter((k) => !placed.has(k));
        if (kids.length === 0) return;

        // Ensure outermost ring of this subtree gives every leaf at least
        // MIN_ARC_PER_LEAF of arc — push the ring outward if needed.
        const subLeaves = leafCount(id, new Set());
        const subDepth = maxDepth(id, new Set());
        const wedgeSpan = angleEnd - angleStart;
        const outerDepth = depth + Math.max(1, subDepth);
        const requiredOuter =
          (subLeaves * MIN_ARC_PER_LEAF) / Math.max(wedgeSpan, 0.001);
        const ringGap = Math.max(BASE_RING, requiredOuter / outerDepth);

        const totalLeaves = kids.reduce(
          (s, c) => s + leafCount(c, new Set()),
          0,
        ) || 1;

        let a = angleStart;
        for (const kid of kids) {
          const kidLeaves = leafCount(kid, new Set());
          const kidWedge = (kidLeaves / totalLeaves) * wedgeSpan;
          const mid = a + kidWedge / 2;
          const r = depth * ringGap;
          positions[kid] = { x: Math.cos(mid) * r, y: Math.sin(mid) * r };
          placed.add(kid);
          placeWedge(kid, depth + 1, a, a + kidWedge);
          a += kidWedge;
        }
      }

      // Root gets the full circle, starting from the top (-π/2)
      placeWedge(root, 1, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2);

      // Place any orphan roots in their own concentric rings to the side
      let ox = 400;
      for (const rid of roots) {
        if (rid === root || placed.has(rid)) continue;
        positions[rid] = { x: ox, y: 0 };
        placed.add(rid);
        ox += H_GAP;
      }
    } else if (algorithm === 'layered' || algorithm === 'layered-td') {
      // Sugiyama-lite with long-edge splitting: rank nodes by longest path,
      // insert virtual nodes for edges spanning >1 rank, run median-heuristic
      // crossing reduction on the extended graph, then pack with real sizes.
      const td = algorithm === 'layered-td';

      // Original (real-only) adjacency, needed for ranking.
      const realParents: Record<string, string[]> = {};
      for (const [pid, kids] of Object.entries(childrenOf)) {
        for (const k of kids) (realParents[k] ??= []).push(pid);
      }

      const rank: Record<string, number> = {};
      const visiting = new Set<string>();
      // Longest-path ranking. Cycles break at the recursion guard: a back
      // edge treats the unresolved parent as rank 0 so the cycle's second
      // node lands one column right, giving the edge a visible length.
      const assignRank = (id: string): number => {
        if (rank[id] !== undefined) return rank[id];
        if (visiting.has(id)) return 0;
        visiting.add(id);
        const ps = realParents[id] || [];
        let maxR = -1;
        for (const p of ps) {
          const r = assignRank(p);
          if (r > maxR) maxR = r;
        }
        visiting.delete(id);
        const r = maxR + 1;
        rank[id] = r;
        return r;
      };
      for (const n of list) assignRank(n.id);

      const maxRank = list.reduce((m, n) => Math.max(m, rank[n.id] ?? 0), 0);
      const layers: string[][] = Array.from({ length: maxRank + 1 }, () => []);
      for (const n of list) layers[rank[n.id]].push(n.id);

      // Extended adjacency: real edges shortened to length 1 via virtual
      // nodes in each intermediate rank. Virtual ids are never placed as
      // real nodes — they only consume an ordering slot + a narrow packing
      // gap, forcing real nodes to slide out of the long edge's corridor.
      const isVirtual = (id: string) => id.startsWith('__vn__');
      const extChildren: Record<string, string[]> = {};
      const extParents: Record<string, string[]> = {};
      const addEdge = (a: string, b: string) => {
        (extChildren[a] ??= []).push(b);
        (extParents[b] ??= []).push(a);
      };
      let vnCounter = 0;
      for (const [pid, kids] of Object.entries(childrenOf)) {
        for (const k of kids) {
          const span = (rank[k] ?? 0) - (rank[pid] ?? 0);
          if (span <= 1) {
            addEdge(pid, k);
          } else {
            // Chain: pid → v1 → v2 → ... → k, one virtual per intermediate rank
            let prev = pid;
            for (let r = (rank[pid] ?? 0) + 1; r < (rank[k] ?? 0); r++) {
              const v = `__vn__${vnCounter++}`;
              layers[r].push(v);
              addEdge(prev, v);
              prev = v;
            }
            addEdge(prev, k);
          }
        }
      }

      const order: Record<string, number> = {};
      const reindex = () => {
        for (const layer of layers) {
          for (let i = 0; i < layer.length; i++) order[layer[i]] = i;
        }
      };
      reindex();

      const medianOf = (ids: string[]): number => {
        const xs: number[] = [];
        for (const id of ids) {
          const v = order[id];
          if (v !== undefined) xs.push(v);
        }
        if (xs.length === 0) return -1;
        xs.sort((a, b) => a - b);
        const mid = Math.floor(xs.length / 2);
        return xs.length % 2 === 1 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2;
      };

      // 6 sweeps (more benefit now that virtual nodes carry signal
      // through long edges).
      for (let sweep = 0; sweep < 6; sweep++) {
        const down = sweep % 2 === 0;
        if (down) {
          for (let i = 1; i < layers.length; i++) {
            layers[i].sort(
              (a, b) =>
                medianOf(extParents[a] || []) - medianOf(extParents[b] || []),
            );
          }
        } else {
          for (let i = layers.length - 2; i >= 0; i--) {
            layers[i].sort(
              (a, b) =>
                medianOf(extChildren[a] || []) -
                medianOf(extChildren[b] || []),
            );
          }
        }
        reindex();
      }

      // Description-aware packing. Virtual nodes reserve a narrow slot
      // (corridor for the long edge) but aren't placed in `positions`.
      const { dataTypes: dts, poolTypes: pts } = get();
      const V_MARGIN = 28;
      const H_MARGIN = 100;
      const VN_H = 40; // vertical slot for virtual in LR mode
      const VN_W = 40; // horizontal slot for virtual in TD mode

      if (!td) {
        const colStep = NODE_WIDTH + H_MARGIN;
        const layerHeights: number[][] = layers.map((layer) =>
          layer.map((id) =>
            isVirtual(id) ? VN_H : computeNodeHeight(ns[id], dts, pts),
          ),
        );
        const layerTotals = layerHeights.map((hs) =>
          hs.reduce((s, h) => s + h + V_MARGIN, 0) - V_MARGIN,
        );
        const globalH = layerTotals.reduce((m, t) => Math.max(m, t), 0);
        for (let i = 0; i < layers.length; i++) {
          const layer = layers[i];
          const heights = layerHeights[i];
          let y = (globalH - layerTotals[i]) / 2;
          for (let j = 0; j < layer.length; j++) {
            const h = heights[j];
            if (!isVirtual(layer[j])) {
              positions[layer[j]] = { x: i * colStep, y: y + h / 2 };
            }
            y += h + V_MARGIN;
          }
        }
      } else {
        const layerWidths = layers.map((layer) =>
          layer.reduce(
            (s, id) => s + (isVirtual(id) ? VN_W : NODE_WIDTH) + H_MARGIN,
            0,
          ) - H_MARGIN,
        );
        const globalW = layerWidths.reduce((m, w) => Math.max(m, w), 0);
        const layerHeights: number[][] = layers.map((layer) =>
          layer.map((id) =>
            isVirtual(id) ? VN_H : computeNodeHeight(ns[id], dts, pts),
          ),
        );
        let y = 0;
        for (let i = 0; i < layers.length; i++) {
          const layer = layers[i];
          const heights = layerHeights[i];
          const rowH = heights.reduce((m, h) => Math.max(m, h), 0);
          let x = (globalW - layerWidths[i]) / 2;
          for (let j = 0; j < layer.length; j++) {
            const w = isVirtual(layer[j]) ? VN_W : NODE_WIDTH;
            if (!isVirtual(layer[j])) {
              positions[layer[j]] = { x: x + w / 2, y: y + rowH / 2 };
            }
            x += w + H_MARGIN;
          }
          y += rowH + V_MARGIN;
        }
      }
    } else {
      // force — just space evenly in grid
      const cols = Math.ceil(Math.sqrt(list.length));
      list.forEach((n, i) => {
        positions[n.id] = { x: (i % cols) * H_GAP, y: Math.floor(i / cols) * V_GAP };
      });
    }

    // Catch any nodes left unplaced (cycle-only components, disconnected
    // subgraphs the tree/horizontal/radial walks missed). Stack them in a
    // row below the rest.
    if (algorithm !== 'force' && algorithm !== 'layered' && algorithm !== 'layered-td') {
      const unplaced = list.filter((n) => !(n.id in positions));
      if (unplaced.length > 0) {
        let maxY = 0;
        for (const p of Object.values(positions)) {
          if (p.y > maxY) maxY = p.y;
        }
        const baseY = maxY + V_GAP * 2;
        unplaced.forEach((n, i) => {
          positions[n.id] = { x: i * H_GAP, y: baseY };
        });
      }
    }

    // Apply positions
    set((s) => {
      const updated = { ...s.nodes };
      for (const [id, pos] of Object.entries(positions)) {
        if (updated[id]) updated[id] = { ...updated[id], position: pos };
      }
      return { nodes: updated };
    });
  },

  getProjectData: () => {
    const {
      nodes, dataTypes, poolTypes, edges, projectType, inspectorWidth, namedSnapshots,
      mode, gridSnap, angleSnap, autoTargetLength,
    } = get();
    // Rebuild full SnapshotEntry[] for serialization
    const snapshots: SnapshotEntry[] | undefined =
      namedSnapshots.length > 0
        ? namedSnapshots
            .map((meta) => {
              const data = snapshotDataMap.get(meta.id);
              if (!data) return null;
              return { id: meta.id, name: meta.name, createdAt: meta.createdAt, data };
            })
            .filter((e): e is SnapshotEntry => e !== null)
        : undefined;
    return {
      nodes, dataTypes, poolTypes, edges, projectType, inspectorWidth, snapshots,
      viewSettings: { mode, gridSnap, angleSnap, autoTargetLength },
    };
  },

  loadProjectData: (data) => {
    // rebuild id counters from loaded data
    const nodeNums = Object.keys(data.nodes).map((k) => {
      const m = k.match(/\d+/);
      return m ? parseInt(m[0]) : 0;
    });
    const dtNums = Object.keys(data.dataTypes).map((k) => {
      const m = k.match(/\d+/);
      return m ? parseInt(m[0]) : 0;
    });
    const fieldNums = Object.values(data.dataTypes).flatMap((dt) =>
      dt.fields.map((f) => {
        const m = f.id.match(/\d+/);
        return m ? parseInt(m[0]) : 0;
      }),
    );
    const ptNums = Object.keys(data.poolTypes).map((k) => {
      const m = k.match(/\d+/);
      return m ? parseInt(m[0]) : 0;
    });
    const piNums = Object.values(data.poolTypes).flatMap((pt) =>
      pt.items.map((i) => {
        const m = i.id.match(/\d+/);
        return m ? parseInt(m[0]) : 0;
      }),
    );

    counters.nextNodeId = Math.max(counters.nextNodeId, ...nodeNums, 0) + 1;
    counters.nextDtId = Math.max(counters.nextDtId, ...dtNums, 0) + 1;
    counters.nextFieldId = Math.max(counters.nextFieldId, ...fieldNums, 0) + 1;
    counters.nextPoolTypeId = Math.max(counters.nextPoolTypeId, ...ptNums, 0) + 1;
    counters.nextPoolItemId = Math.max(counters.nextPoolItemId, ...piNums, 0) + 1;

    // Ensure displayMode is set on all loaded nodes (backward compat)
    const migratedNodes: Record<string, SkillNode> = {};
    for (const [id, n] of Object.entries(data.nodes)) {
      migratedNodes[id] = { ...n, displayMode: n.displayMode ?? 'expanded' };
    }
    // Backfill edges for files saved before edge metadata existed, and
    // migrate the older { parentId, childId, type } shape to the new
    // { fromId, toId, name } shape.
    let edges: Record<string, EdgeData> = {};
    if (data.edges) {
      for (const raw of Object.values(data.edges) as Array<
        Partial<EdgeData> & {
          parentId?: string;
          childId?: string;
          type?: string;
        }
      >) {
        const fromId = raw.fromId ?? raw.parentId;
        const toId = raw.toId ?? raw.childId;
        if (!fromId || !toId) continue;
        const id = raw.id ?? edgeId(fromId, toId);
        edges[id] = {
          id,
          fromId,
          toId,
          name: raw.name ?? raw.type ?? '',
          description: raw.description ?? '',
        };
      }
    } else {
      for (const n of Object.values(migratedNodes)) {
        if (n.parentId && migratedNodes[n.parentId]) {
          const eid = edgeId(n.parentId, n.id);
          edges[eid] = { id: eid, fromId: n.parentId, toId: n.id, name: '', description: '' };
        }
      }
    }
    set({
      nodes: migratedNodes,
      dataTypes: data.dataTypes,
      poolTypes: data.poolTypes,
      edges,
      projectType: data.projectType ?? 'skilltree',
      selectedNodeIds: [],
      selectedEdgeId: null,
      isDirty: false,
    });
    if (typeof data.inspectorWidth === 'number') {
      get().setInspectorWidth(data.inspectorWidth);
    }
    if (data.viewSettings) {
      applyViewSettings(data.viewSettings);
    }
    // Restore named snapshots from file
    snapshotDataMap.clear();
    const loadedMeta: NamedSnapshot[] = [];
    if (data.snapshots && Array.isArray(data.snapshots)) {
      for (const entry of data.snapshots) {
        if (entry.id && entry.data) {
          snapshotDataMap.set(entry.id, entry.data);
          loadedMeta.push({ id: entry.id, name: entry.name, createdAt: entry.createdAt });
        }
      }
    }
    set({ namedSnapshots: loadedMeta });
    undoStack = [];
    redoStack = [];
  },

  getReadableExport: () => {
    const { nodes, dataTypes, poolTypes, edges, projectType } = get();

    const readableDataTypes = Object.values(dataTypes).map((dt) => ({
      name: dt.name,
      color: dt.color,
      fields: dt.fields.map((f) => {
        const def: ReadableFieldDef = {
          name: f.name,
          type: f.type,
        };
        if (f.type === 'dropdown' && f.dropdownOptions.length > 0) {
          def.options = f.dropdownOptions.map((o) => o.label);
        }
        if (f.type === 'pool' && f.poolTypeId && poolTypes[f.poolTypeId]) {
          def.poolType = poolTypes[f.poolTypeId].name;
        }
        return def;
      }),
    }));

    const readableNodes = Object.values(nodes).map((node) => {
      const dt = dataTypes[node.dataTypeId];
      const parentNode = node.parentId ? nodes[node.parentId] : null;

      const fields: Record<string, unknown> = {};
      if (dt) {
        for (const f of dt.fields) {
          const raw = node.fieldValues[f.id];
          if (raw === undefined || raw === '' || raw === null) continue;

          if (f.type === 'dropdown') {
            const opt = f.dropdownOptions.find((o) => o.id === raw);
            fields[f.name] = opt ? opt.label : raw;
          } else if (f.type === 'pool' && Array.isArray(raw)) {
            const pt = f.poolTypeId ? poolTypes[f.poolTypeId] : null;
            fields[f.name] = (raw as PoolEntry[]).map((entry) => {
              const item = pt?.items.find((i) => i.id === entry.itemId);
              return { item: item?.name ?? entry.itemId, count: entry.count };
            });
          } else {
            fields[f.name] = raw;
          }
        }
      }

      return {
        title: node.title,
        dataType: dt?.name ?? node.dataTypeId,
        parent: parentNode?.title ?? null,
        position: node.position,
        fields,
      };
    });

    const readableEdges: ReadableEdge[] = Object.values(edges)
      .filter((e) => nodes[e.fromId] && nodes[e.toId])
      .map((e) => ({
        from: nodes[e.fromId].title,
        to: nodes[e.toId].title,
        name: e.name,
        description: e.description,
      }));

    return {
      projectType,
      dataTypes: readableDataTypes,
      nodes: readableNodes,
      edges: readableEdges,
    };
  },

  getCsvExport: () => {
    const { nodes, dataTypes, poolTypes, edges } = get();
    // Collect all field names across all data types
    const allFields: string[] = [];
    const fieldSet = new Set<string>();
    for (const dt of Object.values(dataTypes)) {
      for (const f of dt.fields) {
        if (!fieldSet.has(f.name)) { fieldSet.add(f.name); allFields.push(f.name); }
      }
    }
    const headers = ['Title', 'Data Type', 'Parent', 'X', 'Y', ...allFields];
    const esc = (v: string) => {
      if (v.includes(',') || v.includes('"') || v.includes('\n')) return `"${v.replace(/"/g, '""')}"`;
      return v;
    };
    const rows = [headers.map(esc).join(',')];
    for (const node of Object.values(nodes)) {
      const dt = dataTypes[node.dataTypeId];
      const parent = node.parentId ? nodes[node.parentId]?.title ?? '' : '';
      const fieldVals = allFields.map((fname) => {
        if (!dt) return '';
        const f = dt.fields.find((fd) => fd.name === fname);
        if (!f) return '';
        const raw = node.fieldValues[f.id];
        if (raw === undefined || raw === null) return '';
        if (f.type === 'dropdown') {
          const opt = f.dropdownOptions.find((o) => o.id === raw);
          return opt ? opt.label : String(raw);
        }
        if (f.type === 'pool' && Array.isArray(raw)) {
          const pt = f.poolTypeId ? poolTypes[f.poolTypeId] : null;
          return (raw as PoolEntry[]).map((e) => {
            const item = pt?.items.find((i) => i.id === e.itemId);
            return `${e.count}x ${item?.name ?? e.itemId}`;
          }).join('; ');
        }
        return String(raw);
      });
      rows.push([
        esc(node.title),
        esc(dt?.name ?? ''),
        esc(parent),
        String(Math.round(node.position.x)),
        String(Math.round(node.position.y)),
        ...fieldVals.map(esc),
      ].join(','));
    }

    // Append a Connections section so edge metadata round-trips through CSV.
    const edgeList = Object.values(edges).filter(
      (e) => nodes[e.fromId] && nodes[e.toId],
    );
    if (edgeList.length > 0) {
      rows.push('');
      rows.push(['From', 'To', 'Name', 'Description'].map(esc).join(','));
      for (const e of edgeList) {
        rows.push(
          [
            esc(nodes[e.fromId].title),
            esc(nodes[e.toId].title),
            esc(e.name),
            esc(e.description),
          ].join(','),
        );
      }
    }
    return rows.join('\n');
  },

  pushHistory: () => {
    const { nodes, dataTypes, poolTypes, edges, mode, isDirty } = get();
    undoStack.push(takeSnapshot({ nodes, dataTypes, poolTypes, edges, mode }));
    if (undoStack.length > MAX_HISTORY) undoStack.shift();
    redoStack = [];
    if (!isDirty) set({ isDirty: true });
  },

  undo: () => {
    if (undoStack.length === 0) {
      get().addToast('Nothing to undo', 'info');
      return;
    }
    const { nodes, dataTypes, poolTypes, edges, mode } = get();
    redoStack.push(takeSnapshot({ nodes, dataTypes, poolTypes, edges, mode }));
    const prev = undoStack.pop()!;
    set({
      nodes: prev.nodes,
      dataTypes: prev.dataTypes,
      poolTypes: prev.poolTypes,
      edges: prev.edges,
      mode: prev.mode,
      isDirty: true,
    });
    get().addToast('Undo', 'info');
  },

  redo: () => {
    if (redoStack.length === 0) {
      get().addToast('Nothing to redo', 'info');
      return;
    }
    const { nodes, dataTypes, poolTypes, edges, mode } = get();
    undoStack.push(takeSnapshot({ nodes, dataTypes, poolTypes, edges, mode }));
    const next = redoStack.pop()!;
    set({
      nodes: next.nodes,
      dataTypes: next.dataTypes,
      poolTypes: next.poolTypes,
      edges: next.edges,
      mode: next.mode,
      isDirty: true,
    });
    get().addToast('Redo', 'info');
  },

  // --- Snapshots ---

  setSnapshotPanelOpen: (open) => set({ snapshotPanelOpen: open }),

  saveSnapshot: (name) => {
    const { nodes, dataTypes, poolTypes, edges, projectType } = get();
    const entry: SnapshotEntry = {
      id: `snap-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name,
      createdAt: Date.now(),
      data: JSON.parse(JSON.stringify({ nodes, dataTypes, poolTypes, edges, projectType })),
    };
    const meta: NamedSnapshot = { id: entry.id, name: entry.name, createdAt: entry.createdAt };
    set((s) => ({
      namedSnapshots: [...s.namedSnapshots, meta],
      isDirty: true,
    }));
    // Store the full data in module-level map so it doesn't bloat Zustand rerenders
    snapshotDataMap.set(entry.id, entry.data);
    get().addToast(`Snapshot saved: ${name}`, 'success');
  },

  restoreSnapshot: (id) => {
    const data = snapshotDataMap.get(id);
    if (!data) {
      get().addToast('Snapshot data not found', 'error');
      return;
    }
    // Push current state to undo so restore is undoable
    get().pushHistory();
    const restored = JSON.parse(JSON.stringify(data));
    set({
      nodes: restored.nodes,
      dataTypes: restored.dataTypes,
      poolTypes: restored.poolTypes,
      edges: restored.edges,
      projectType: restored.projectType,
      selectedNodeIds: [],
      selectedEdgeId: null,
      isDirty: true,
    });
    get().addToast('Snapshot restored', 'success');
  },

  deleteSnapshot: (id) => {
    snapshotDataMap.delete(id);
    set((s) => ({
      namedSnapshots: s.namedSnapshots.filter((sn) => sn.id !== id),
      isDirty: true,
    }));
  },

  renameSnapshot: (id, name) => {
    set((s) => ({
      namedSnapshots: s.namedSnapshots.map((sn) =>
        sn.id === id ? { ...sn, name } : sn,
      ),
      isDirty: true,
    }));
  },

  // --- Tabs ---

  newTab: (projectType, title) => {
    captureActiveIntoTab();
    const id = newTabId();
    const resolvedTitle =
      title ??
      (projectType === 'flowchart' ? 'New Flowchart' : 'New Skill Tree');
    set((s) => ({
      tabs: [...s.tabs, { id, title: resolvedTitle }],
      activeTabId: id,
      startScreenOpen: false,
      nodes: {},
      dataTypes:
        projectType === 'flowchart' ? createFlowchartDataTypes() : {},
      poolTypes: {},
      edges: {},
      projectType,
      camera: { x: 0, y: 0, zoom: 1 },
      selectedNodeIds: [],
      selectedEdgeId: null,
      editingNodeId: null,
      currentFilePath: null,
      settingsPath: null,
      isDirty: false,
      namedSnapshots: [],
    }));
    Object.assign(counters, freshCounters());
    undoStack = [];
    redoStack = [];
    snapshotDataMap.clear();
    return id;
  },

  openInNewTab: (data, filePath, title, settingsPath) => {
    captureActiveIntoTab();
    const id = newTabId();
    // .perkloom passes only filePath (settings tracked by the same path);
    // imported .json passes a settingsPath while filePath stays null.
    const resolvedSettingsPath = settingsPath ?? filePath;
    // Seed with the incoming project type so loadProjectData doesn't
    // inherit the previous tab's counters or state on its first set().
    set((s) => ({
      tabs: [...s.tabs, { id, title }],
      activeTabId: id,
      startScreenOpen: false,
      nodes: {},
      dataTypes: {},
      poolTypes: {},
      edges: {},
      projectType: data.projectType ?? 'skilltree',
      camera: { x: 0, y: 0, zoom: 1 },
      selectedNodeIds: [],
      selectedEdgeId: null,
      editingNodeId: null,
      currentFilePath: filePath,
      settingsPath: resolvedSettingsPath,
      isDirty: false,
    }));
    Object.assign(counters, freshCounters());
    undoStack = [];
    redoStack = [];
    get().loadProjectData(data);
    // loadProjectData resets isDirty to false; re-apply currentFilePath
    // since its own set() call wipes it implicitly via spread above.
    if (filePath !== null) set({ currentFilePath: filePath });
    set({ settingsPath: resolvedSettingsPath });
    // Restore per-file view settings. Embedded viewSettings (.perkloom) win;
    // otherwise fall back to localStorage (covers .json, which can't embed).
    if (resolvedSettingsPath !== null && !data.viewSettings) {
      const fs = loadFileSettings(resolvedSettingsPath);
      if (fs) applyViewSettings(fs);
    }
    return id;
  },

  switchTab: (id) => {
    const s = get();
    if (s.activeTabId === id) return;
    const target = s.tabs.find((t) => t.id === id);
    if (!target) return;
    captureActiveIntoTab();
    const snap = target.snapshot;
    if (snap) {
      set({
        nodes: snap.nodes,
        dataTypes: snap.dataTypes,
        poolTypes: snap.poolTypes,
        edges: snap.edges,
        projectType: snap.projectType,
        camera: snap.camera,
        selectedNodeIds: snap.selectedNodeIds,
        selectedEdgeId: snap.selectedEdgeId,
        editingNodeId: snap.editingNodeId,
        currentFilePath: snap.currentFilePath,
        settingsPath: snap.settingsPath,
        isDirty: snap.isDirty,
      });
      Object.assign(counters, snap.counters);
      undoStack = snap.undo;
      redoStack = snap.redo;
      // Restore snapshot data for this tab
      snapshotDataMap.clear();
      const backup = tabSnapshotDataBackup.get(id);
      if (backup) {
        for (const [sid, sdata] of backup) snapshotDataMap.set(sid, sdata);
        tabSnapshotDataBackup.delete(id);
      }
      set({ namedSnapshots: snap.namedSnapshots });
      get().setInspectorWidth(snap.inspectorWidth);
      // Re-apply the destination file's saved snap settings so switching
      // between open files stays consistent with reopening them.
      if (snap.settingsPath) {
        const fs = loadFileSettings(snap.settingsPath);
        if (fs) applyViewSettings(fs);
      }
    }
    set((s) => ({
      activeTabId: id,
      tabs: s.tabs.map((t) =>
        t.id === id ? { ...t, snapshot: undefined } : t,
      ),
    }));
  },

  closeTab: (id) => {
    const s = get();
    const idx = s.tabs.findIndex((t) => t.id === id);
    if (idx < 0) return;

    if (s.activeTabId === id) {
      const neighbor = s.tabs[idx + 1] ?? s.tabs[idx - 1];
      if (neighbor) {
        // Switch first so neighbor becomes live, then drop the target.
        get().switchTab(neighbor.id);
        set((s2) => ({ tabs: s2.tabs.filter((t) => t.id !== id) }));
      } else {
        // Last tab closed — fall back to the Start Screen with empty live state.
        undoStack = [];
        redoStack = [];
        snapshotDataMap.clear();
        Object.assign(counters, freshCounters());
        set({
          tabs: [],
          activeTabId: null,
          startScreenOpen: true,
          nodes: {},
          dataTypes: {},
          namedSnapshots: [],
          poolTypes: {},
          edges: {},
          projectType: 'skilltree',
          selectedNodeIds: [],
          selectedEdgeId: null,
          editingNodeId: null,
          currentFilePath: null,
          settingsPath: null,
          isDirty: false,
        });
      }
    } else {
      set((s2) => ({ tabs: s2.tabs.filter((t) => t.id !== id) }));
    }
  },

  setActiveTabTitle: (title) => {
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === s.activeTabId ? { ...t, title } : t,
      ),
    }));
  },
}));

// Persist the live view settings (snap mode / grid / angle / auto-length) for
// the currently-open file so they are restored on reopen. Called by the snap
// setters. No-op for unsaved (path-less) documents.
function persistViewSettings() {
  const s = useStore.getState();
  if (!s.settingsPath) return;
  saveFileSettings(s.settingsPath, {
    mode: s.mode,
    gridSnap: s.gridSnap,
    angleSnap: s.angleSnap,
    autoTargetLength: s.autoTargetLength,
  });
}

// Apply a (possibly partial) FileViewSettings onto the live store without
// triggering history/persistence side effects.
function applyViewSettings(vs: Partial<FileViewSettings>) {
  const patch: Partial<TreeStore> = {};
  if (vs.mode) patch.mode = vs.mode;
  if (typeof vs.gridSnap === 'boolean') patch.gridSnap = vs.gridSnap;
  if (typeof vs.angleSnap === 'number') patch.angleSnap = vs.angleSnap;
  if (typeof vs.autoTargetLength === 'number') patch.autoTargetLength = vs.autoTargetLength;
  if (Object.keys(patch).length > 0) useStore.setState(patch);
}

// Snapshot the currently-active tab's live state back into its tabs[] entry.
// Used before any tab switch/new/open so subsequent restoration works.
function captureActiveIntoTab() {
  const s = useStore.getState();
  if (!s.activeTabId) return;
  const snapshot: TabDocState = {
    nodes: s.nodes,
    dataTypes: s.dataTypes,
    poolTypes: s.poolTypes,
    edges: s.edges,
    projectType: s.projectType,
    camera: s.camera,
    selectedNodeIds: s.selectedNodeIds,
    selectedEdgeId: s.selectedEdgeId,
    editingNodeId: s.editingNodeId,
    currentFilePath: s.currentFilePath,
    settingsPath: s.settingsPath,
    isDirty: s.isDirty,
    inspectorWidth: s.inspectorWidth,
    counters: { ...counters },
    undo: undoStack,
    redo: redoStack,
    namedSnapshots: s.namedSnapshots,
  };
  // Backup snapshot data for this tab
  const dataBackup = new Map<string, SnapshotEntry['data']>();
  for (const meta of s.namedSnapshots) {
    const d = snapshotDataMap.get(meta.id);
    if (d) dataBackup.set(meta.id, d);
  }
  tabSnapshotDataBackup.set(s.activeTabId, dataBackup);
  useStore.setState((prev) => ({
    tabs: prev.tabs.map((t) =>
      t.id === prev.activeTabId ? { ...t, snapshot } : t,
    ),
  }));
}
