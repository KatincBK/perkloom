import {
  EdgeData,
  FieldDefinition,
  FieldType,
  PoolEntry,
  Position,
  ProjectType,
  SkillNode,
  DataType,
  edgeId,
} from './types';
import {
  createFlowchartDataTypes,
  FLOWCHART_DATA_TYPE_ID,
  FLOWCHART_DESCRIPTION_FIELD_ID,
  ProjectData,
} from './store';

export interface ImportOk {
  data: ProjectData;
  warnings: string[];
  kind: 'readable' | 'generic';
  // Set when the source had no positions and Perkloom should run its layout
  // engine after loadProjectData. Null means positions came from the source.
  suggestedLayout: 'horizontal' | 'tree' | null;
}

export interface ImportError {
  error: string;
}

export function parseImportedJson(raw: unknown): ImportOk | ImportError {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return {
      error:
        "JSON üst seviyede bir obje olmalı (dizi ya da basit bir değer değil)",
    };
  }
  const obj = raw as Record<string, unknown>;

  if (looksLikeReadableExport(obj)) {
    const r = parseReadableExport(obj);
    if ('error' in r) return r;
    return { ...r, kind: 'readable', suggestedLayout: null };
  }
  const r = parseGeneric(obj);
  if ('error' in r) return r;
  return { ...r, kind: 'generic' };
}

// ============================================================
//  FORMAT DETECTION
// ============================================================

function looksLikeReadableExport(obj: Record<string, unknown>): boolean {
  if (!Array.isArray(obj.nodes) || !Array.isArray(obj.dataTypes)) return false;
  // Sample first non-null node — readable export always has title+dataType+fields
  for (const raw of obj.nodes) {
    if (raw && typeof raw === 'object') {
      const n = raw as Record<string, unknown>;
      return 'title' in n && 'dataType' in n && 'fields' in n;
    }
  }
  return false;
}

// ============================================================
//  SHARED HELPERS
// ============================================================

function stringOf(v: unknown): string | undefined {
  if (typeof v === 'string') return v.length > 0 ? v : undefined;
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return undefined;
}

function isTruthy(v: unknown): boolean {
  if (v === true) return true;
  if (typeof v === 'string') return v.toLowerCase() === 'true';
  return false;
}

function parsePosition(obj: Record<string, unknown>): Position | null {
  const posObj = obj.position ?? obj.pos ?? obj.coords;
  if (posObj && typeof posObj === 'object' && !Array.isArray(posObj)) {
    const p = posObj as Record<string, unknown>;
    if (typeof p.x === 'number' && typeof p.y === 'number') {
      return { x: p.x, y: p.y };
    }
  }
  if (typeof obj.x === 'number' && typeof obj.y === 'number') {
    return { x: obj.x, y: obj.y };
  }
  return null;
}

// ============================================================
//  GENERIC SCHEMA
//
//  Accepted shape (all fields are optional except nodes):
//  {
//    "nodes": [
//      "Alice",                              // shorthand — string becomes both id and title
//      { "id": "n1", "title": "Bob" },       // explicit
//      { "label": "...", "x": 0, "y": 0 },   // title via label/name/text, position inline
//      { "name": "...", "position": { x, y }, "description": "..." },
//      { "id": "...", "parent": "n1" },      // implicit edge
//      { "id": "...", "children": ["n2"] }   // implicit edges
//    ],
//    "edges": [                              // also accepts links/connections/relations
//      { "from": "n1", "to": "n2" },         // also source/target, fromId/toId
//      { "from": "...", "to": "...", "name": "triggers", "description": "..." },
//      { "from": "...", "to": "...", "bidirectional": true },
//      ["n1", "n2"]                          // tuple shorthand — optional 3rd entry is name
//    ]
//  }
// ============================================================

function parseGeneric(
  obj: Record<string, unknown>,
): { data: ProjectData; warnings: string[]; suggestedLayout: 'horizontal' | null } | ImportError {
  const nodesRaw = obj.nodes ?? obj.vertices ?? obj.items;
  if (!Array.isArray(nodesRaw)) {
    return {
      error:
        "'nodes' (ya da 'vertices' / 'items') adında bir dizi bulamadım. JSON'un üst seviyesinde node'ları içeren bir dizi olmalı.",
    };
  }
  if (nodesRaw.length === 0) {
    return { error: "'nodes' dizisi boş — import edilecek bir şey yok" };
  }

  const warnings: string[] = [];
  const idMap = new Map<string, string>();
  const nodes: Record<string, SkillNode> = {};
  const edges: Record<string, EdgeData> = {};
  let anyPositionSpecified = false;
  let nodeCount = 100;

  // Pass 1 — create nodes, remember user-id → internal-id mapping
  for (let i = 0; i < nodesRaw.length; i++) {
    const raw = nodesRaw[i];
    let userId: string | undefined;
    let title: string | undefined;
    let position: Position | null = null;
    let description = '';

    if (typeof raw === 'string') {
      userId = raw;
      title = raw;
    } else if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      const n = raw as Record<string, unknown>;
      userId = stringOf(n.id) ?? stringOf(n._id) ?? stringOf(n.key);
      title =
        stringOf(n.title) ??
        stringOf(n.label) ??
        stringOf(n.name) ??
        stringOf(n.text);
      position = parsePosition(n);
      description =
        stringOf(n.description) ??
        stringOf(n.desc) ??
        stringOf(n.notes) ??
        '';
    } else {
      return {
        error: `Node #${i} bir obje ya da string olmalı (bulunan: ${typeof raw})`,
      };
    }

    if (!userId && title) userId = title;
    if (!userId) {
      userId = `_auto_${i}`;
      warnings.push(
        `#${i}. node'da 'id' ve 'title/label/name' bulunamadı — otomatik id verildi`,
      );
    }
    if (!title) title = userId;

    if (idMap.has(userId)) {
      return { error: `Tekrarlanan node id: "${userId}"` };
    }

    if (position) anyPositionSpecified = true;

    const newId = `node-${nodeCount++}`;
    idMap.set(userId, newId);
    nodes[newId] = {
      id: newId,
      title,
      position: position ?? { x: 0, y: 0 },
      parentId: null,
      dataTypeId: FLOWCHART_DATA_TYPE_ID,
      fieldValues: description
        ? { [FLOWCHART_DESCRIPTION_FIELD_ID]: description }
        : {},
      displayMode: 'expanded',
    };
  }

  // Positions left at (0,0) — caller will run autoLayout('horizontal') after
  // load. We leave gridLayout out of the import so the proper layout engine
  // (with edge-aware topology + cycle protection) handles it.

  // Pass 2 — implicit edges from parent / children
  for (let i = 0; i < nodesRaw.length; i++) {
    const raw = nodesRaw[i];
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const n = raw as Record<string, unknown>;

    const userId =
      stringOf(n.id) ??
      stringOf(n._id) ??
      stringOf(n.key) ??
      stringOf(n.title) ??
      stringOf(n.label) ??
      stringOf(n.name) ??
      `_auto_${i}`;
    const newId = idMap.get(userId);
    if (!newId) continue;

    const parentUser = stringOf(n.parent) ?? stringOf(n.parentId);
    if (parentUser) {
      const parentId = idMap.get(parentUser);
      if (!parentId) {
        warnings.push(
          `"${userId}" parent olarak "${parentUser}" gösteriyor ama bu node yok`,
        );
      } else {
        const eid = edgeId(parentId, newId);
        edges[eid] ??= {
          id: eid,
          fromId: parentId,
          toId: newId,
          name: '',
          description: '',
        };
      }
    }

    if (Array.isArray(n.children)) {
      for (const ch of n.children) {
        const childUser = stringOf(ch);
        if (!childUser) continue;
        const childId = idMap.get(childUser);
        if (!childId) {
          warnings.push(
            `"${userId}" children altında "${childUser}" var ama bu node yok`,
          );
          continue;
        }
        const eid = edgeId(newId, childId);
        edges[eid] ??= {
          id: eid,
          fromId: newId,
          toId: childId,
          name: '',
          description: '',
        };
      }
    }
  }

  // Pass 3 — explicit edges
  const edgesRaw =
    obj.edges ?? obj.links ?? obj.connections ?? obj.relations;
  if (edgesRaw !== undefined) {
    if (!Array.isArray(edgesRaw)) {
      return {
        error:
          "'edges' (ya da 'links' / 'connections' / 'relations') dizi olmalı",
      };
    }
    for (let i = 0; i < edgesRaw.length; i++) {
      const raw = edgesRaw[i];
      let fromUser: string | undefined;
      let toUser: string | undefined;
      let name = '';
      let description = '';
      let bidir = false;

      if (Array.isArray(raw) && raw.length >= 2) {
        fromUser = stringOf(raw[0]);
        toUser = stringOf(raw[1]);
        if (raw.length >= 3) name = stringOf(raw[2]) ?? '';
      } else if (raw && typeof raw === 'object') {
        const e = raw as Record<string, unknown>;
        fromUser =
          stringOf(e.from) ??
          stringOf(e.source) ??
          stringOf(e.fromId) ??
          stringOf(e.sourceId);
        toUser =
          stringOf(e.to) ??
          stringOf(e.target) ??
          stringOf(e.toId) ??
          stringOf(e.targetId);
        name =
          stringOf(e.name) ??
          stringOf(e.label) ??
          stringOf(e.type) ??
          stringOf(e.relation) ??
          '';
        description = stringOf(e.description) ?? stringOf(e.desc) ?? '';
        bidir =
          isTruthy(e.bidirectional) ||
          isTruthy(e.bidir) ||
          isTruthy(e.twoWay) ||
          e.directed === false;
      } else {
        warnings.push(
          `Edge #${i} atlandı: obje ya da [from, to] dizisi değil`,
        );
        continue;
      }

      if (!fromUser || !toUser) {
        warnings.push(
          `Edge #${i} atlandı: 'from' ve 'to' alanlarından biri yok`,
        );
        continue;
      }

      const fromId = idMap.get(fromUser);
      const toId = idMap.get(toUser);
      if (!fromId) {
        warnings.push(
          `Edge #${i} atlandı: "${fromUser}" adlı node tanımlı değil`,
        );
        continue;
      }
      if (!toId) {
        warnings.push(
          `Edge #${i} atlandı: "${toUser}" adlı node tanımlı değil`,
        );
        continue;
      }
      if (fromId === toId) {
        warnings.push(
          `Edge #${i} atlandı: bir node kendisine bağlanamaz ("${fromUser}")`,
        );
        continue;
      }

      const eid = edgeId(fromId, toId);
      edges[eid] = { id: eid, fromId, toId, name, description };
      if (bidir) {
        const rev = edgeId(toId, fromId);
        edges[rev] ??= {
          id: rev,
          fromId: toId,
          toId: fromId,
          name,
          description,
        };
      }
    }
  }

  return {
    data: {
      nodes,
      dataTypes: createFlowchartDataTypes(),
      poolTypes: {},
      edges,
      projectType: 'flowchart',
    },
    warnings,
    suggestedLayout: anyPositionSpecified ? null : 'horizontal',
  };
}

// ============================================================
//  READABLE EXPORT (our own "Export JSON" output)
//
//  This format is lossy — pool types and dropdown option IDs are not round-
//  tripped, so pool values and dropdown selections on nodes get dropped with
//  a warning. Everything else (nodes, edges, field text values, project type)
//  survives.
// ============================================================

const VALID_FIELD_TYPES: readonly FieldType[] = [
  'text',
  'dropdown',
  'number',
  'boolean',
  'pool',
];

function parseReadableExport(
  obj: Record<string, unknown>,
): { data: ProjectData; warnings: string[] } | ImportError {
  const nodesRaw = obj.nodes;
  const dataTypesRaw = obj.dataTypes;
  const edgesRaw = obj.edges;
  const projectTypeRaw = obj.projectType;
  const projectType: ProjectType =
    projectTypeRaw === 'flowchart' ? 'flowchart' : 'skilltree';

  if (!Array.isArray(nodesRaw)) {
    return { error: "Readable export: 'nodes' dizisi bulunamadı" };
  }
  if (!Array.isArray(dataTypesRaw)) {
    return { error: "Readable export: 'dataTypes' dizisi bulunamadı" };
  }

  const warnings: string[] = [];
  const dataTypes: Record<string, DataType> = {};
  const dtIdByName = new Map<string, string>();
  const fieldIdByName = new Map<string, Map<string, string>>();
  let dtCount = 1;
  let fieldCount = 1;

  if (projectType === 'flowchart') {
    // Flowchart always uses the canonical single data type
    Object.assign(dataTypes, createFlowchartDataTypes());
    dtIdByName.set('Node', FLOWCHART_DATA_TYPE_ID);
    const flowFields = new Map<string, string>();
    flowFields.set('Description', FLOWCHART_DESCRIPTION_FIELD_ID);
    fieldIdByName.set('Node', flowFields);
  } else {
    for (const raw of dataTypesRaw) {
      if (!raw || typeof raw !== 'object') continue;
      const dt = raw as Record<string, unknown>;
      const name = stringOf(dt.name);
      if (!name) {
        warnings.push('Adı olmayan bir data type atlandı');
        continue;
      }
      const color = stringOf(dt.color) ?? '#ffffff';
      const dtId = `dt-${dtCount++}`;
      dtIdByName.set(name, dtId);
      const fMap = new Map<string, string>();
      fieldIdByName.set(name, fMap);
      const fields: FieldDefinition[] = [];

      if (Array.isArray(dt.fields)) {
        for (const fRaw of dt.fields) {
          if (!fRaw || typeof fRaw !== 'object') continue;
          const f = fRaw as Record<string, unknown>;
          const fname = stringOf(f.name);
          const ftypeRaw = stringOf(f.type);
          const ftype = VALID_FIELD_TYPES.find((t) => t === ftypeRaw);
          if (!fname || !ftype) {
            warnings.push(`'${name}' içinde geçersiz bir field atlandı`);
            continue;
          }
          if (ftype === 'pool' || ftype === 'dropdown') {
            warnings.push(
              `'${name}.${fname}' (${ftype}) tanımlandı ama option/pool içerikleri readable export'ta yok — değerler atlandı`,
            );
          }
          const fid = `f-${fieldCount++}`;
          fMap.set(fname, fid);
          fields.push({
            id: fid,
            name: fname,
            type: ftype,
            showOnMap: false,
            dropdownOptions: [],
            poolTypeId: null,
          });
        }
      }
      dataTypes[dtId] = { id: dtId, name, color, fields };
    }
  }

  if (Object.keys(dataTypes).length === 0) {
    dataTypes['dt-1'] = {
      id: 'dt-1',
      name: 'Default',
      color: '#ffffff',
      fields: [],
    };
  }

  const nodes: Record<string, SkillNode> = {};
  const idByTitle = new Map<string, string>();
  let nodeCount = 100;

  for (let i = 0; i < nodesRaw.length; i++) {
    const raw = nodesRaw[i];
    if (!raw || typeof raw !== 'object') {
      warnings.push(`#${i} node atlandı: obje değil`);
      continue;
    }
    const n = raw as Record<string, unknown>;
    const title = stringOf(n.title);
    if (!title) {
      warnings.push(`#${i} node atlandı: 'title' yok`);
      continue;
    }

    const dtName = stringOf(n.dataType);
    const dtId =
      (dtName && dtIdByName.get(dtName)) ?? Object.keys(dataTypes)[0];
    const pos = parsePosition(n) ?? { x: 0, y: 0 };
    const newId = `node-${nodeCount++}`;

    if (idByTitle.has(title)) {
      warnings.push(
        `Tekrarlayan başlık "${title}" — referans olarak sonuncu kullanılacak`,
      );
    }
    idByTitle.set(title, newId);

    const fieldValues: Record<
      string,
      string | number | boolean | PoolEntry[]
    > = {};
    if (
      dtName &&
      n.fields &&
      typeof n.fields === 'object' &&
      !Array.isArray(n.fields)
    ) {
      const fMap = fieldIdByName.get(dtName);
      if (fMap) {
        for (const [fName, val] of Object.entries(
          n.fields as Record<string, unknown>,
        )) {
          const fid = fMap.get(fName);
          if (!fid) continue;
          if (
            typeof val === 'string' ||
            typeof val === 'number' ||
            typeof val === 'boolean'
          ) {
            fieldValues[fid] = val;
          }
        }
      }
    }

    nodes[newId] = {
      id: newId,
      title,
      position: pos,
      parentId: null,
      dataTypeId: dtId,
      fieldValues,
      displayMode: 'expanded',
    };
  }

  if (projectType !== 'flowchart') {
    for (const raw of nodesRaw) {
      if (!raw || typeof raw !== 'object') continue;
      const n = raw as Record<string, unknown>;
      const title = stringOf(n.title);
      const parentTitle = stringOf(n.parent);
      if (!title || !parentTitle) continue;
      const childId = idByTitle.get(title);
      const parentId = idByTitle.get(parentTitle);
      if (childId && parentId) nodes[childId].parentId = parentId;
    }
  }

  const edges: Record<string, EdgeData> = {};
  if (Array.isArray(edgesRaw)) {
    for (let i = 0; i < edgesRaw.length; i++) {
      const raw = edgesRaw[i];
      if (!raw || typeof raw !== 'object') continue;
      const e = raw as Record<string, unknown>;
      const from = stringOf(e.from);
      const to = stringOf(e.to);
      if (!from || !to) {
        warnings.push(`Edge #${i} atlandı: 'from' ya da 'to' yok`);
        continue;
      }
      const fromId = idByTitle.get(from);
      const toId = idByTitle.get(to);
      if (!fromId || !toId) {
        warnings.push(`Edge "${from} → ${to}" atlandı: node bulunamadı`);
        continue;
      }
      const eid = edgeId(fromId, toId);
      edges[eid] = {
        id: eid,
        fromId,
        toId,
        name: stringOf(e.name) ?? '',
        description: stringOf(e.description) ?? '',
      };
    }
  }

  // Skilltree without explicit edges — synthesize from parent relations
  if (projectType !== 'flowchart' && Object.keys(edges).length === 0) {
    for (const n of Object.values(nodes)) {
      if (n.parentId) {
        const eid = edgeId(n.parentId, n.id);
        edges[eid] = {
          id: eid,
          fromId: n.parentId,
          toId: n.id,
          name: '',
          description: '',
        };
      }
    }
  }

  return {
    data: { nodes, dataTypes, poolTypes: {}, edges, projectType },
    warnings,
  };
}
