---
name: diagram
description: Draw diagrams — cloud and software architecture, data flows, flowcharts, swimlane/BPMN processes, entity-relationship diagrams, org charts — as Eraser diagram JSON, and render them locally to PNG or self-contained HTML with Eraser's open-source engine. Use when asked to draw, create, sketch, update or render a diagram or picture of a system or process, to turn a description, document or codebase into a diagram, when Eraser is mentioned, or when editing a *.diagram.json file.
argument-hint: "[what to draw, or path to a .diagram.json]"
allowed-tools: Bash(node ${CLAUDE_SKILL_DIR}/scripts/eraser.mjs *)
---

# Diagrams with Eraser

You write a diagram as JSON — entities with positions, and connections between them — and the
Eraser engine renders it: icons, line routing, fonts, PNG. You own the layout; it owns the drawing.

This JSON format is not the older Eraser diagram-as-code DSL (`.eraser` files, `cloud-architecture-diagram`,
`node > node` syntax). The engine here does not read that DSL, and app.eraser.io is not needed. If
asked to convert an existing `.eraser` file, read it for content and write it afresh as JSON.

Every command below is `node ${CLAUDE_SKILL_DIR}/scripts/eraser.mjs <command>`. It needs Node.js
22.12+ and an installed Chrome, Chromium or Edge, and installs the pinned engine on first use (a few
seconds). If anything about the setup fails, run its `doctor` command and report what it says.

If the project already keeps its diagrams in another format (Mermaid, PlantUML, draw.io) and the user
did not ask for Eraser, follow the project's convention instead of this skill.

## Workflow

### 1. Decide what the diagram says

One diagram, one point: "how a request reaches the database", "what happens when an expense is
rejected". Name the audience and leave out what they do not need. If the subject is a codebase, read
the code first and draw what is there, not what the README hopes for. Past about 20 nodes, plan an
overview plus focused diagrams instead.

### 2. Load the guides and the closest example

The skill's files sit outside the user's project, so read them through the helper, not with Read:

```bash
node ${CLAUDE_SKILL_DIR}/scripts/eraser.mjs guide format
node ${CLAUDE_SKILL_DIR}/scripts/eraser.mjs guide layout
node ${CLAUDE_SKILL_DIR}/scripts/eraser.mjs example architecture
```

| Diagram | `example` | Main tags |
| --- | --- | --- |
| Architecture, cloud topology, data flow | `architecture` | `Group`, `Icon` |
| Flowchart, decision tree, lifecycle | `flowchart` | `Shape` |
| Swimlane / BPMN process | `swimlane` | `Pool`, `Lane`, `Activity`, `Event`, `Gateway` |
| Entity-relationship | `erd` | `DatabaseTable`, `DatabaseRelationship` |

Read both guides and the example before writing JSON. The exact schema for any tag is `schema <Tag>`.
There is no sequence-diagram primitive — use a swimlane, or say that Mermaid suits a sequence
diagram better.

### 3. Look up every icon

```bash
node ${CLAUDE_SKILL_DIR}/scripts/eraser.mjs icons cosmos "key vault" "container apps" fastapi users
```

One line of matching names per query, best first, from the catalog of ~3,900 icons (Azure `azure-*`,
AWS `aws-*`, GCP `gcp-*`, technology logos, and general glyphs like `user`, `server`, `database`,
`globe`, `mail`, `file`). **Never guess a name** — an unknown name renders as an ✕ placeholder.

### 4. Plan the layout, then write the JSON

Follow the layout guide: choose a flow direction, put nodes on a grid, compute centres from a fixed
pitch, derive each top-left from its centre. Size every `Shape`,
`Activity`, `Group`, `Pool` and `Lane` explicitly.

Save as `<slug>.diagram.json` in kebab-case, next to the document that will show it, or wherever the
project keeps diagrams (`docs/diagrams/` is a good default). The rendered PNG takes the same name.

### 5. Render and fix until clean

```bash
node ${CLAUDE_SKILL_DIR}/scripts/eraser.mjs render docs/diagrams/order-flow.diagram.json
```

This writes `order-flow.png` beside the JSON at 2× and prints a JSON report per input:

- `errors` — the diagram did not render. Each has a JSON Pointer `path` into your file and often a
  `suggestion`. Fix and re-render.
- `warnings` — rendered, but something is off; `W_UNKNOWN_ICON` means search for the icon again.
- `layout` — faults found by measuring the rendered page: `overlap`, `outside-container` (often an
  Icon's caption spilling out of its group), `label-on-node`, `label-crowded`, `short-line`,
  `line-through-text`, `line-through-label`, `lines-overlap`, `too-small`. Each message says
  what to change, often with the exact size needed.

Repeat until the report says `"clean": true`. Fix by moving nodes and resizing containers; reach
for ports only when a route is still wrong.

### 6. Look at the picture

Read the PNG. A clean report is necessary, not sufficient. Check:

- Does it tell the story from step 1, in reading order (left to right or top to bottom)?
- Do lines cross that would not if two nodes swapped places?
- Is any label ambiguous about which line it belongs to?
- Is anything cramped, or is there a large hole that makes the diagram hard to fit on a page?
- Do colours mean something, and is that meaning stated (group titles or a `Legend`)?
- Is every icon the right one?

Fix, re-render, look again. Two or three rounds is normal. Stop when another round would not change
what a reader understands.

### 7. Hand it over

Give the user the PNG path and the JSON path, and say in a sentence what the diagram shows. When it
goes into markdown, embed the PNG and link the source, so the next editor finds it:

```markdown
![Order flow](diagrams/order-flow.png)

_Source: [order-flow.diagram.json](diagrams/order-flow.diagram.json). Edit the JSON and re-render; never edit the PNG._
```

Commit the JSON and the PNG together; they must not drift.

## Editing an existing diagram

Read the `.diagram.json`, change what was asked, keep existing ids, re-render, look at it. Moving one
node usually means moving its neighbours too — re-check the grid rather than nudging until the
report goes quiet.

## Commands

| Command | Does |
| --- | --- |
| `render <file...> [-o out.png] [--scale 2] [--html] [--transparent] [--strict]` | Render to PNG beside each input, plus `.html` with `--html` (fonts embedded, so it opens anywhere). `--strict` exits 1 unless clean. |
| `icons <query...> [--limit 12]` | Search icon names. |
| `guide format` / `guide layout` / `example <name>` | Print a reference or an example diagram. |
| `schema <Tag>` / `registry` | The engine's JSON Schema for a tag / the list of tags. |
| `validate <file>` | Structure only, no browser. Does not check icon names — `render` does. |
| `doctor` | Node version, engine install, browser found, icon host reachable. |

Rendering needs network access for icons (fetched from Eraser's public catalog).
