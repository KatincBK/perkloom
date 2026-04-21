/* eslint-disable no-console */
import { parseImportedJson, ImportOk, ImportError } from './src/importJson';
import {
  FLOWCHART_DATA_TYPE_ID,
  FLOWCHART_DESCRIPTION_FIELD_ID,
} from './src/store';
import { edgeId } from './src/types';

let passed = 0;
let failed = 0;
const failures: string[] = [];

function isOk(r: ImportOk | ImportError): r is ImportOk {
  return !('error' in r);
}

function assert(name: string, cond: boolean, detail = '') {
  if (cond) {
    passed++;
    console.log(`  \u2713 ${name}`);
  } else {
    failed++;
    failures.push(`${name}${detail ? ' — ' + detail : ''}`);
    console.log(`  \u2717 ${name}${detail ? ' — ' + detail : ''}`);
  }
}

function section(name: string) {
  console.log(`\n${name}`);
}

function findNode(result: ImportOk, title: string) {
  return Object.values(result.data.nodes).find((n) => n.title === title);
}

function findEdge(
  result: ImportOk,
  fromTitle: string,
  toTitle: string,
) {
  const from = findNode(result, fromTitle);
  const to = findNode(result, toTitle);
  if (!from || !to) return undefined;
  return result.data.edges![edgeId(from.id, to.id)];
}

// ============================================================
// 1. Top-level validation
// ============================================================
section('1. Top-level validation');
{
  const r = parseImportedJson(null);
  assert('null rejected', !isOk(r));
}
{
  const r = parseImportedJson([1, 2, 3]);
  assert('bare array rejected', !isOk(r));
}
{
  const r = parseImportedJson('just a string');
  assert('string rejected', !isOk(r));
}
{
  const r = parseImportedJson(42);
  assert('number rejected', !isOk(r));
}
{
  const r = parseImportedJson({ nothing: true });
  assert(
    'object without nodes rejected',
    !isOk(r) && /nodes/.test((r as ImportError).error),
  );
}
{
  const r = parseImportedJson({ nodes: [] });
  assert(
    'empty nodes array rejected',
    !isOk(r) && /boş/.test((r as ImportError).error),
  );
}
{
  const r = parseImportedJson({ nodes: 'not an array' });
  assert('non-array nodes rejected', !isOk(r));
}

// ============================================================
// 2. Generic: string-shorthand nodes
// ============================================================
section('2. Generic: string-shorthand nodes');
{
  const r = parseImportedJson({
    nodes: ['Alice', 'Bob', 'Carol'],
    edges: [['Alice', 'Bob']],
  });
  assert('parses', isOk(r));
  if (isOk(r)) {
    assert('kind is generic', r.kind === 'generic');
    assert('3 nodes', Object.keys(r.data.nodes).length === 3);
    assert('Alice exists', !!findNode(r, 'Alice'));
    assert('Bob exists', !!findNode(r, 'Bob'));
    assert('Alice->Bob edge', !!findEdge(r, 'Alice', 'Bob'));
    assert(
      'all dataTypeId = flowchart',
      Object.values(r.data.nodes).every(
        (n) => n.dataTypeId === FLOWCHART_DATA_TYPE_ID,
      ),
    );
    assert('projectType = flowchart', r.data.projectType === 'flowchart');
    const positions = Object.values(r.data.nodes).map((n) => n.position);
    const allZero = positions.every((p) => p.x === 0 && p.y === 0);
    assert('positions left at 0,0 (autoLayout will run)', allZero);
    assert('suggestedLayout = horizontal', r.suggestedLayout === 'horizontal');
  }
}

// ============================================================
// 3. Generic: explicit ids + titles + positions
// ============================================================
section('3. Generic: explicit fields');
{
  const r = parseImportedJson({
    nodes: [
      { id: 'n1', title: 'Start', position: { x: 10, y: 20 }, description: 'Begin' },
      { _id: 'n2', label: 'Middle', x: 30, y: 40, desc: 'Transition' },
      { key: 'n3', name: 'End', pos: { x: 50, y: 60 }, notes: 'Finish' },
    ],
    edges: [
      { from: 'n1', to: 'n2', name: 'goes' },
      { source: 'n2', target: 'n3', label: 'continues' },
    ],
  });
  assert('parses', isOk(r));
  if (isOk(r)) {
    const start = findNode(r, 'Start')!;
    const middle = findNode(r, 'Middle')!;
    const end = findNode(r, 'End')!;
    assert('Start pos 10,20', start.position.x === 10 && start.position.y === 20);
    assert('Middle pos 30,40 (flat x/y)', middle.position.x === 30 && middle.position.y === 40);
    assert('End pos 50,60 (pos key)', end.position.x === 50 && end.position.y === 60);
    assert(
      'Start description stored',
      start.fieldValues[FLOWCHART_DESCRIPTION_FIELD_ID] === 'Begin',
    );
    assert(
      'Middle description stored (desc alias)',
      middle.fieldValues[FLOWCHART_DESCRIPTION_FIELD_ID] === 'Transition',
    );
    assert(
      'End description stored (notes alias)',
      end.fieldValues[FLOWCHART_DESCRIPTION_FIELD_ID] === 'Finish',
    );
    const e1 = findEdge(r, 'Start', 'Middle')!;
    const e2 = findEdge(r, 'Middle', 'End')!;
    assert('Start->Middle name', e1 && e1.name === 'goes');
    assert('Middle->End name (label alias)', e2 && e2.name === 'continues');
  }
}

// ============================================================
// 4. Generic: implicit edges via parent / children
// ============================================================
section('4. Generic: parent/children implicit edges');
{
  const r = parseImportedJson({
    nodes: [
      { id: 'root', title: 'Root' },
      { id: 'a', title: 'A', parent: 'root' },
      { id: 'b', title: 'B', parentId: 'root' },
      { id: 'c', title: 'C', children: ['a', 'b'] },
    ],
  });
  assert('parses', isOk(r));
  if (isOk(r)) {
    assert('root->A edge', !!findEdge(r, 'Root', 'A'));
    assert('root->B edge', !!findEdge(r, 'Root', 'B'));
    assert('C->A edge', !!findEdge(r, 'C', 'A'));
    assert('C->B edge', !!findEdge(r, 'C', 'B'));
    assert('4 edges total', Object.keys(r.data.edges!).length === 4);
  }
}

// ============================================================
// 5. Generic: alias collections (vertices/links/connections/relations)
// ============================================================
section('5. Generic: alias collection names');
{
  const r = parseImportedJson({
    vertices: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }],
    links: [{ from: 'a', to: 'b' }],
  });
  assert('vertices+links parses', isOk(r));
  if (isOk(r)) assert('A->B edge', !!findEdge(r, 'A', 'B'));
}
{
  const r = parseImportedJson({
    items: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }],
    connections: [['a', 'b']],
  });
  assert('items+connections parses', isOk(r));
  if (isOk(r)) assert('tuple edge formed', !!findEdge(r, 'A', 'B'));
}
{
  const r = parseImportedJson({
    nodes: [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }],
    relations: [{ source: 'a', target: 'b', relation: 'knows' }],
  });
  assert('relations parses', isOk(r));
  if (isOk(r)) {
    const e = findEdge(r, 'A', 'B');
    assert('relation name stored', !!e && e.name === 'knows');
  }
}

// ============================================================
// 6. Generic: bidirectional flags
// ============================================================
section('6. Generic: bidirectional variants');
{
  const r = parseImportedJson({
    nodes: [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }],
    edges: [{ from: 'a', to: 'b', bidirectional: true }],
  });
  assert('bidirectional:true parses', isOk(r));
  if (isOk(r)) {
    assert('A->B exists', !!findEdge(r, 'A', 'B'));
    assert('B->A exists (reverse)', !!findEdge(r, 'B', 'A'));
  }
}
{
  const r = parseImportedJson({
    nodes: [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }],
    edges: [{ from: 'a', to: 'b', directed: false }],
  });
  assert('directed:false = bidir', isOk(r));
  if (isOk(r)) assert('reverse edge created', !!findEdge(r, 'B', 'A'));
}
{
  const r = parseImportedJson({
    nodes: [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }],
    edges: [{ from: 'a', to: 'b', twoWay: 'true' }],
  });
  assert("twoWay:'true' string parses", isOk(r));
  if (isOk(r)) assert('reverse edge created', !!findEdge(r, 'B', 'A'));
}

// ============================================================
// 7. Generic: error messages for bad data
// ============================================================
section('7. Generic: helpful errors and warnings');
{
  const r = parseImportedJson({
    nodes: [
      { id: 'a', title: 'A' },
      { id: 'a', title: 'Duplicate' },
    ],
  });
  assert(
    'duplicate id rejected with specific message',
    !isOk(r) && /Tekrarlanan node id/.test((r as ImportError).error),
  );
}
{
  const r = parseImportedJson({
    nodes: [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }],
    edges: [{ from: 'a', to: 'ghost' }],
  });
  assert('missing target warns, not errors', isOk(r));
  if (isOk(r)) {
    assert('warning mentions ghost', r.warnings.some((w) => w.includes('ghost')));
    assert('0 edges produced', Object.keys(r.data.edges!).length === 0);
  }
}
{
  const r = parseImportedJson({
    nodes: [{ id: 'a', title: 'A' }],
    edges: [{ from: 'a', to: 'a' }],
  });
  assert('self-loop warns', isOk(r));
  if (isOk(r)) {
    assert('warning mentions kendisine', r.warnings.some((w) => /kendisine/.test(w)));
  }
}
{
  const r = parseImportedJson({ nodes: [1234] });
  assert(
    'invalid node type errors with type info',
    !isOk(r) && /obje ya da string/.test((r as ImportError).error),
  );
}
{
  const r = parseImportedJson({
    nodes: [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }],
    edges: 'not an array',
  });
  assert(
    'non-array edges errors',
    !isOk(r) && /dizi olmalı/.test((r as ImportError).error),
  );
}
{
  const r = parseImportedJson({
    nodes: [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }],
    edges: [{ from: 'a' }],
  });
  assert('edge without to warns', isOk(r));
  if (isOk(r)) assert('warning about missing from/to', r.warnings.length === 1);
}
{
  const r = parseImportedJson({
    nodes: [{ x: 10, y: 20 }],
  });
  assert('node without id/title gets warning but succeeds', isOk(r));
  if (isOk(r)) {
    assert('warning about missing id', r.warnings.some((w) => /otomatik id/.test(w)));
  }
}

// ============================================================
// 8. Generic: tuple edges
// ============================================================
section('8. Generic: tuple edge variants');
{
  const r = parseImportedJson({
    nodes: [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }],
    edges: [['a', 'b', 'triggers']],
  });
  assert('[from,to,name] parses', isOk(r));
  if (isOk(r)) {
    const e = findEdge(r, 'A', 'B');
    assert('name from tuple', !!e && e.name === 'triggers');
  }
}

// ============================================================
// 9. Generic: positions round-trip; no-position triggers grid
// ============================================================
section('9. Generic: position handling');
{
  const r = parseImportedJson({
    nodes: [
      { id: 'a', title: 'A', position: { x: 100, y: 200 } },
      { id: 'b', title: 'B' }, // missing position
    ],
  });
  assert('mixed positions parses', isOk(r));
  if (isOk(r)) {
    const a = findNode(r, 'A')!;
    const b = findNode(r, 'B')!;
    assert('A position preserved', a.position.x === 100 && a.position.y === 200);
    assert('B position defaulted to 0,0', b.position.x === 0 && b.position.y === 0);
    assert('suggestedLayout = null (any positions given)', r.suggestedLayout === null);
  }
}

// ============================================================
// 10. Readable export round-trip
// ============================================================
section('10. Readable export round-trip');
{
  const readable = {
    projectType: 'flowchart',
    dataTypes: [
      {
        name: 'Node',
        color: '#ffffff',
        fields: [{ name: 'Description', type: 'text' }],
      },
    ],
    nodes: [
      {
        title: 'Login',
        dataType: 'Node',
        parent: null,
        position: { x: 0, y: 0 },
        fields: { Description: 'user logs in' },
      },
      {
        title: 'Dashboard',
        dataType: 'Node',
        parent: null,
        position: { x: 200, y: 0 },
        fields: { Description: 'landing page' },
      },
    ],
    edges: [
      { from: 'Login', to: 'Dashboard', name: 'success', description: 'on valid creds' },
    ],
  };
  const r = parseImportedJson(readable);
  assert('readable parses', isOk(r));
  if (isOk(r)) {
    assert('kind detected as readable', r.kind === 'readable');
    assert('readable suggestedLayout = null', r.suggestedLayout === null);
    assert('projectType preserved', r.data.projectType === 'flowchart');
    assert(
      'canonical flowchart dataTypes used',
      r.data.dataTypes[FLOWCHART_DATA_TYPE_ID]?.name === 'Node',
    );
    const login = findNode(r, 'Login')!;
    assert('Login exists with description', login.fieldValues[FLOWCHART_DESCRIPTION_FIELD_ID] === 'user logs in');
    const edge = findEdge(r, 'Login', 'Dashboard')!;
    assert('edge carries name', !!edge && edge.name === 'success');
    assert('edge carries description', !!edge && edge.description === 'on valid creds');
  }
}

// ============================================================
// 11. Readable export: skilltree with parent relations (no explicit edges)
// ============================================================
section('11. Readable skilltree: parent-based edges synthesized');
{
  const readable = {
    projectType: 'skilltree',
    dataTypes: [
      {
        name: 'Skill',
        color: '#aabbcc',
        fields: [{ name: 'Cost', type: 'number' }],
      },
    ],
    nodes: [
      { title: 'Root', dataType: 'Skill', parent: null, position: { x: 0, y: 0 }, fields: {} },
      { title: 'Child1', dataType: 'Skill', parent: 'Root', position: { x: 0, y: 100 }, fields: { Cost: 3 } },
      { title: 'Child2', dataType: 'Skill', parent: 'Root', position: { x: 200, y: 100 }, fields: { Cost: 5 } },
    ],
    // no edges array
  };
  const r = parseImportedJson(readable);
  assert('parses', isOk(r));
  if (isOk(r)) {
    assert('kind = readable', r.kind === 'readable');
    assert('projectType preserved = skilltree', r.data.projectType === 'skilltree');
    const root = findNode(r, 'Root')!;
    const child1 = findNode(r, 'Child1')!;
    const child2 = findNode(r, 'Child2')!;
    assert('child1.parentId = root.id', child1.parentId === root.id);
    assert('child2.parentId = root.id', child2.parentId === root.id);
    assert('2 synthesized edges', Object.keys(r.data.edges!).length === 2);
    assert('Root->Child1 edge exists', !!findEdge(r, 'Root', 'Child1'));
    const child1Dt = r.data.dataTypes[child1.dataTypeId];
    assert('Skill data type name preserved', child1Dt.name === 'Skill');
    const costField = child1Dt.fields.find((f) => f.name === 'Cost');
    assert('Cost field preserved', !!costField && costField.type === 'number');
    assert('Cost value stored via field-id mapping', costField ? child1.fieldValues[costField.id] === 3 : false);
  }
}

// ============================================================
// 12. Readable export: dropdown/pool lossy warnings
// ============================================================
section('12. Readable: dropdown/pool lossy warnings');
{
  const readable = {
    projectType: 'skilltree',
    dataTypes: [
      {
        name: 'Thing',
        color: '#000',
        fields: [
          { name: 'Category', type: 'dropdown' },
          { name: 'Inventory', type: 'pool' },
        ],
      },
    ],
    nodes: [
      { title: 'A', dataType: 'Thing', parent: null, position: { x: 0, y: 0 }, fields: {} },
    ],
  };
  const r = parseImportedJson(readable);
  assert('parses', isOk(r));
  if (isOk(r)) {
    assert('dropdown lossy warning', r.warnings.some((w) => /dropdown/.test(w)));
    assert('pool lossy warning', r.warnings.some((w) => /pool/.test(w)));
  }
}

// ============================================================
// 13. Readable: duplicate titles warning
// ============================================================
section('13. Readable: duplicate titles');
{
  const readable = {
    projectType: 'flowchart',
    dataTypes: [{ name: 'Node', color: '#fff', fields: [{ name: 'Description', type: 'text' }] }],
    nodes: [
      { title: 'Step', dataType: 'Node', parent: null, position: { x: 0, y: 0 }, fields: {} },
      { title: 'Step', dataType: 'Node', parent: null, position: { x: 100, y: 0 }, fields: {} },
    ],
    edges: [],
  };
  const r = parseImportedJson(readable);
  assert('parses', isOk(r));
  if (isOk(r)) assert('duplicate title warning', r.warnings.some((w) => /Tekrarlayan başlık/.test(w)));
}

// ============================================================
// 14. Format detection edge cases
// ============================================================
section('14. Format detection');
{
  // Has `nodes` and `dataTypes` but nodes are strings (generic) — should be generic
  const r = parseImportedJson({
    nodes: ['A', 'B'],
    dataTypes: [{ name: 'Whatever', fields: [] }],
  });
  assert('string nodes with dataTypes = generic', isOk(r) && r.kind === 'generic');
}
{
  // Has dataTypes but first node lacks dataType key → generic
  const r = parseImportedJson({
    nodes: [{ id: 'a', title: 'A' }],
    dataTypes: [{ name: 'X' }],
  });
  assert('missing dataType key on node → generic', isOk(r) && r.kind === 'generic');
}

// ============================================================
// 15. Real-world-ish D3 / Cytoscape-style samples
// ============================================================
section('15. Real-world-ish external formats');
{
  // D3-style
  const r = parseImportedJson({
    nodes: [
      { id: 'alice', group: 1 },
      { id: 'bob', group: 1 },
      { id: 'carol', group: 2 },
    ],
    links: [
      { source: 'alice', target: 'bob', value: 5 },
      { source: 'bob', target: 'carol', value: 2 },
    ],
  });
  assert('D3-style parses', isOk(r));
  if (isOk(r)) {
    assert('3 nodes', Object.keys(r.data.nodes).length === 3);
    assert('2 edges', Object.keys(r.data.edges!).length === 2);
    assert('alice->bob exists', !!findEdge(r, 'alice', 'bob'));
  }
}
{
  // Tree-style with nested children would NOT be supported in our flat format;
  // user would have to flatten. But an adjacency-style tree:
  const r = parseImportedJson({
    nodes: [
      { id: '1', name: 'CEO' },
      { id: '2', name: 'CTO', parent: '1' },
      { id: '3', name: 'CFO', parent: '1' },
      { id: '4', name: 'Eng Lead', parent: '2' },
    ],
  });
  assert('org-chart parses', isOk(r));
  if (isOk(r)) {
    assert('CEO->CTO', !!findEdge(r, 'CEO', 'CTO'));
    assert('CEO->CFO', !!findEdge(r, 'CEO', 'CFO'));
    assert('CTO->Eng Lead', !!findEdge(r, 'CTO', 'Eng Lead'));
    assert('3 edges total', Object.keys(r.data.edges!).length === 3);
  }
}

// ============================================================
console.log(`\n====================================`);
console.log(`PASSED: ${passed}`);
console.log(`FAILED: ${failed}`);
if (failed > 0) {
  console.log(`\nFailures:`);
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
} else {
  console.log('All assertions passed.');
}
