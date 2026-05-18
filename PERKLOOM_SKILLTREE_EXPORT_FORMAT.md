# Perkloom Skilltree Export — Consumer Format Spec

> This document describes the JSON file produced by **Perkloom** when a
> `projectType: "skilltree"` project is exported via **File → Save / Export**.
> The audience is any downstream consumer (game engine, code generator, AI
> agent) that needs to parse this file and reconstruct the skilltree in its
> own runtime.
>
> The spec is engine-agnostic. No Unity / Unreal / Godot specifics here.

> **What this file is, and is not.** The file is a **designer-time
> definition** of the tree: which nodes exist, how they connect, their
> base costs and level caps. It is **not** a save file. The player's
> runtime state (which nodes are owned, current level of each, currency
> balances) lives entirely on the consumer side and must be persisted
> separately. Treat this JSON as read-only data loaded once at startup.

---

## 1. Top-level shape

```json
{
  "projectType": "skilltree",
  "dataTypes":   [ ... ],
  "nodes":       [ ... ],
  "edges":       [ ... ]
}
```

| Field | Type | Notes |
|---|---|---|
| `projectType` | string | Always `"skilltree"` for trees. Reject other values. |
| `dataTypes`   | array  | Node category schemas. Defines the shape of `fields`. |
| `nodes`       | array  | The actual tree nodes. |
| `edges`       | array  | Connections between nodes (see §5 — includes the tree skeleton). |

The file is strict JSON: no comments, no trailing commas, no `undefined`.
All strings are UTF-8 and may contain non-ASCII text (Turkish characters are
common in descriptive fields).

---

## 2. `dataTypes`

Each entry defines a **category** of node. All nodes of the same category
share a color and a field schema.

```json
{
  "name": "Multiple Upgrades",
  "color": "#67e8f9",
  "fields": [
    { "name": "Description",    "type": "text"   },
    { "name": "Implementation", "type": "text"   },
    { "name": "BaseCost",       "type": "number" },
    { "name": "MaxLevel",       "type": "number" },
    { "name": "CostFormula",    "type": "text"   }
  ]
}
```

| Key | Type | Notes |
|---|---|---|
| `name`   | string  | Unique within `dataTypes`. Case-sensitive. Used by `nodes[].dataType` to reference this schema. May contain non-ASCII (e.g. `"Ön koşullu olanlar"`). |
| `color`  | string  | `#RRGGBB` hex. Advisory — use for UI tinting / category swatches. |
| `fields` | array   | Zero or more field definitions (see below). An empty `fields` array means the dataType is used purely as a tag/category marker; nodes of that type carry no structured data. |

### Field definition

```json
{ "name": "BaseCost", "type": "number" }
```

| `type` value | Runtime mapping suggestion |
|---|---|
| `text`    | string (free-form, may be multi-paragraph) |
| `number`  | double / float / int — parse as numeric, accept both `42` and `42.0` |
| `boolean` | bool |

> **Note:** Perkloom supports two more field types — `dropdown` and `pool` —
> but they do not appear in valid readable exports. If you encounter them,
> treat the file as malformed.

---

## 3. `nodes`

```json
{
  "title": "Cursor Damage",
  "dataType": "Multiple Upgrades",
  "parent": "Cursor Power",
  "position": { "x": 7.28, "y": -927.29 },
  "fields": {
    "Description": "click'lerin bir şeylere zarar verme gücünü arttırır",
    "Implementation": "cursor.click_power per-level artar.",
    "BaseCost": 30,
    "MaxLevel": 8,
    "CostFormula": "BaseCost × 2^level"
  }
}
```

| Key | Type | Notes |
|---|---|---|
| `title`    | string  | **Identity key.** Unique across all nodes. Other nodes and edges reference this node by its `title`. Treat as the stable ID. |
| `dataType` | string  | Must match a `dataTypes[].name` exactly (case-sensitive). Tells you which `fields` schema applies. |
| `parent`   | string \| null | The `title` of another node, or `null` for the tree root. Forms the tree skeleton. |
| `position` | `{x,y}` | Layout hint from the editor canvas. `x` grows rightward, `y` grows **downward** (screen-space). Floats. Advisory only — re-layout for your own UI if you wish. |
| `fields`   | object  | Keys must match the names defined by the node's `dataType`. Values must satisfy the declared `type`. Missing keys default to "absent"; unknown keys should be ignored. |

### Rules a valid file satisfies

- Exactly **one** node has `parent: null` (the root).
- Every non-null `parent` resolves to another node's `title`.
- Titles are unique across the entire `nodes` array.
- No self-loops (a node is never its own parent).
- No cycles — the parent graph is a tree.

If any of these are violated, fail loudly during parse.

### 3.1 Traversal recipes

The `nodes` array is flat. Nodes do **not** carry an explicit `children`
array — children are derived by scanning the array for entries whose
`parent` equals the current node's `title`. Build the index once at load
time and reuse it.

Language-agnostic pseudocode:

```text
// One-time indexing (do this once after parse)
byTitle  := map[title -> node]      for n in nodes
children := map[title -> list of node titles]
                                    for n in nodes where n.parent != null:
                                        children[n.parent].append(n.title)

// Find the root
root := first n in nodes where n.parent == null
// (the spec guarantees exactly one)

// Walk the entire tree depth-first from root
function walk(title, visit):
    visit(byTitle[title])
    for childTitle in children[title]:
        walk(childTitle, visit)

// Walk ancestor chain from a node up to the root
function ancestors(title):
    cur := byTitle[title].parent
    while cur != null:
        yield byTitle[cur]
        cur := byTitle[cur].parent
```

### 3.2 Unlockability check

A skill-tree's central runtime question is "can the player buy node X
right now?". This combines three pieces the spec scatters across §3, §5,
and §6.2. The canonical check, in order:

```text
function canUnlock(title, playerState):
    node := byTitle[title]

    // (a) Level cap not yet reached
    currentLevel := playerState.levelOf(title)            // 0 if never bought
    if currentLevel >= node.fields.MaxLevel:
        return false

    // (b) Parent chain must be owned (level >= 1) all the way to root
    for ancestor in ancestors(title):
        if playerState.levelOf(ancestor.title) < 1:
            return false

    // (c) Free-text prerequisite (only on dataType "Ön koşullu olanlar"
    //     or wherever a GEREKLİLİK field is declared) must be satisfied.
    //     See §6.2 for parsing strategy.
    if node.fields has "GEREKLİLİK":
        if not playerState.prereqSatisfied(node.fields["GEREKLİLİK"]):
            return false

    // (d) Player must afford the next level's cost
    cost := evaluateCostFormula(node, currentLevel)        // see §6.1
    if playerState.currency < cost:
        return false

    return true
```

The consumer owns `playerState` (saves, currencies, level counters);
this file does not.

---

## 4. Field semantics: what's structured vs. what's prose

Field **names** are part of the schema (`dataTypes`). Field **values** are
authored content. Two important consequences for consumers:

1. **`text` fields can be anything.** They may be Turkish prose, English
   pseudo-code, formulas with non-ASCII operators (`×`, `^`, `→`), or even
   empty strings (`""`) / em-dashes (`"—"`) used as "n/a" placeholders.
   Do not attempt to parse them as structured data unless a convention is
   specifically documented for the project (see §6).

2. **`number` fields are the only reliable numeric source.** Cost curves,
   level caps, etc., come from `BaseCost` / `MaxLevel`. Formulas are stored
   as **text** strings (e.g. `"BaseCost × 2^level"`); they are documentation
   for designers, not executable expressions. The consumer is responsible
   for interpreting the formula or hard-coding the curve.

---

## 5. `edges`

```json
{
  "from": "Bigger Island",
  "to":   "Cursor Power",
  "name": "",
  "description": ""
}
```

| Key | Type | Notes |
|---|---|---|
| `from`        | string | Source node's `title`. Must resolve. |
| `to`          | string | Target node's `title`. Must resolve. |
| `name`        | string | Edge label. Often `""`. |
| `description` | string | Long-form note. Often `""`. |

### Important: the export contains tree edges explicitly

In a `skilltree` export, **every parent→child relation is emitted as an
edge** in addition to being expressible via `nodes[].parent`. The two
sources are redundant on purpose — the editor uses `parent` as the
authoritative tree structure and `edges` to round-trip the visual
representation.

**Consumers must decide which source to trust and ignore the other.** The
recommended approach is:

- Build the tree from `nodes[].parent`. It is guaranteed acyclic and rooted.
- Use `edges` **only** to discover non-tree connections (synergies,
  cross-branch prereqs). Detect these by filtering out edges that already
  correspond to a parent→child link.

Pseudocode:

```text
treeEdges := { (n.parent, n.title) for n in nodes if n.parent != null }
for e in edges:
    if (e.from, e.to) in treeEdges:  continue   // skeleton, already have it
    if (e.to,   e.from) in treeEdges: continue   // skeleton in reverse
    // otherwise: synergy / prereq / cross-link — handle separately
```

Doing both — building edges from `parent` **and** consuming `edges` — will
double every tree edge.

---

## 6. Project-specific conventions (advisory)

Conventions below are not part of the Perkloom format. They are recurring
authoring patterns the consumer should be aware of when the file uses them.

### 6.1 "Cost not applicable" sentinels

Nodes with `MaxLevel: 1` (one-shot unlocks) typically have
`CostFormula: "—"`. The em-dash means "n/a", not an actual formula. Treat
`"—"` and `""` (empty string) as "no formula".

### 6.2 Prerequisite nodes encoded in a text field

Some projects model gating rules (other than the parent chain) via a
free-text field on a dedicated dataType — e.g. a category called
`"Ön koşullu olanlar"` (Turkish for "ones with prerequisites") with a field
named `"GEREKLİLİK"` ("requirement"). The value is **free text** and may be:

- A bare node title — meaning "that node must be unlocked first"
  (e.g., `"Sugar"`, `"Oyster"`).
- Natural-language exclusion — meaning "this node is mutually exclusive
  with another" (e.g., `"\"King of Lemons\" alınmış olmamalı"` —
  "King of Lemons must not have been taken").
- A semicolon-separated combination
  (e.g., `"Barista; \"Banana Addiction\" alınmış olmamalı"`).

The consumer is responsible for parsing these strings. There is no
machine-readable form in this export. Recommended strategy: attempt
exact-match against the node-title set first; if no match, surface the raw
string to a human or LLM step.

### 6.3 Marker-only dataTypes

A dataType may declare an empty `fields` array (e.g. `"Locked"`,
`"Future Ideas"`). Nodes of these types carry no structured data and exist
purely as tags / placeholders. They may also not appear in the export at
all if no node uses them.

---

## 7. Validation checklist

When loading a file, verify in this order and fail on the first error:

- [ ] Top-level object has `projectType == "skilltree"`.
- [ ] `dataTypes`, `nodes`, `edges` are arrays.
- [ ] `dataTypes[].name` values are unique.
- [ ] No field declares `type` of `dropdown` or `pool`.
- [ ] `nodes[].title` values are unique.
- [ ] Exactly one node has `parent == null`.
- [ ] Every non-null `parent` resolves to a known title.
- [ ] Parent graph is acyclic (DFS / topological sort).
- [ ] Every `nodes[].dataType` resolves to a known dataType name.
- [ ] Every `edges[].from` and `edges[].to` resolves to a known title.
- [ ] For each node, `fields` keys are a subset of the keys declared by its
      dataType. (Strict consumers may reject extra keys; lenient ones may
      ignore them.)

---

## 8. Minimal example

```json
{
  "projectType": "skilltree",
  "dataTypes": [
    {
      "name": "Production",
      "color": "#dbeafe",
      "fields": [
        { "name": "Description", "type": "text"   },
        { "name": "BaseCost",    "type": "number" },
        { "name": "MaxLevel",    "type": "number" }
      ]
    }
  ],
  "nodes": [
    {
      "title": "Root",
      "dataType": "Production",
      "parent": null,
      "position": { "x": 0, "y": 0 },
      "fields": { "Description": "tree root", "BaseCost": 0, "MaxLevel": 1 }
    },
    {
      "title": "Faster Mines",
      "dataType": "Production",
      "parent": "Root",
      "position": { "x": 0, "y": 200 },
      "fields": { "Description": "+25% mine output per level", "BaseCost": 50, "MaxLevel": 10 }
    }
  ],
  "edges": [
    { "from": "Root", "to": "Faster Mines", "name": "", "description": "" }
  ]
}
```

Both nodes form a 2-node tree rooted at `"Root"`. The single edge is the
parent→child skeleton edge — consumers should derive the tree from
`parent` and ignore this edge as redundant (per §5).
