# Eraser diagram JSON — authoring reference

For `@eraserlabs/diagrams` 0.2.0 (the version `eraser.mjs` pins). The authoritative schema for any
tag is the helper's `schema <Tag>` command; this page is the working subset.

## Document

```json
{ "entities": [ ... ], "connections": [ ... ] }
```

- Both keys are required, even when `connections` is `[]`.
- Every entity needs `tag`, a document-unique `id`, and `x`, `y`.
- Connections need `from` and `to` (entity ids). `tag` defaults to `Relationship`; `id` is optional.
- Coordinates are pixels from the top-left. `x`, `y` are an entity's **top-left corner**.
- `width` / `height` are **minimums**: text, padding and fonts can grow an element past them. Groups,
  lanes and pools never grow to fit their children — size them yourself.
- Any other top-level key (a `title`, notes) is ignored with a `W_UNKNOWN_KEY` warning; avoid it.
- Keep ids short and meaningful (`api`, `orders-db`). Edits and connections refer to them.

## Entities

| Tag | Use for | Key properties |
| --- | --- | --- |
| `Shape` | Boxes, decisions, terminals, data stores | `shape`, `texts`, `color`, `icon`, `width`, `height` |
| `Icon` | A technology or actor with a caption underneath | `icon`, `size`, `texts` |
| `Group` | A boundary: a resource group, a VNet, a service, a layer | `title`, `color`, `width`, `height` |
| `Pool` / `Lane` | Swimlanes (BPMN). Lanes sit inside a pool | `title`, `color`, `width`, `height` |
| `Activity` | BPMN task: rounded box, optional icon left of the text | `texts`, `icon`, `width`, `height` |
| `Event` | BPMN start/end/intermediate event: 56px circle, label below | `texts`, `icon` |
| `Gateway` | BPMN decision: 56px diamond, label below | `texts`, `icon` (`x` for exclusive) |
| `DatabaseTable` | ERD table | `label`, `fields`, `icon`, `color`, `width` |
| `Textbox` | Free markdown text: a title, a note, a caption | `text` (required), `fontSize`, `hAlign`, `width` |
| `Legend` | Key to the colours used | `entries: [{ text, color }]` |
| `Divider` | Horizontal or vertical rule | `orientation` (required), `label`, `width`/`height` |

### Shape

```json
{ "tag": "Shape", "id": "check", "shape": "rectangle", "x": 310, "y": 160, "width": 180, "height": 64,
  "color": "blue", "texts": [{ "text": "Check receipt" }] }
```

- `shape`: `rectangle` (default), `diamond`, `oval`, `circle`, `ellipse`, `cylinder`, `hexagon`,
  `parallelogram`, `trapezoid`, `triangle`, `document`, `star`.
- Always give `width` and `height`. Unsized, a Shape shrinks to about 99×40 and a diamond collapses
  around its text.
- `icon` puts an icon beside the text inside the box (`iconProps: { size: "sm"|"md"|"lg"|"xl" }`).
  Use this instead of an `Icon` when a node needs connections on all four sides.
- `vAlign`: `top` | `middle` | `bottom`. `typeface` is per text run, not on the Shape.

### Icon

```json
{ "tag": "Icon", "id": "cosmos", "icon": "azure-cosmos-db", "size": "md", "x": 1035, "y": 150,
  "containerId": "data", "texts": [{ "text": "Cosmos DB" }] }
```

- `size`: `sm` 32px, `md` 50px, `lg` 72px, `xl` 100px. Use `md` unless there is a reason not to.
- The caption hangs **below** the icon box and is not part of its measured size (see layout.md).
- `color` is the glyph/text ink (raw CSS colour), not a palette identity.

### Group, Pool, Lane

```json
{ "tag": "Group", "id": "data", "title": { "text": "Data", "icon": "database" }, "color": "green",
  "x": 960, "y": 100, "width": 200, "height": 370 }
```

- Children join with `"containerId": "<group id>"`. Containment is semantic — it is what makes
  routing and the layout check treat a node as inside — so set it on every child, nested groups
  included.
- `title`: `{ text, icon, width: "snug"|"full"|"none", border, fontSize, hAlign, typeface, color, bgColor }`.
  Groups default to a snug chip at the top-left; pools and lanes to a full-height band on the left.
- `borderStyle: "dashed"` reads as a logical boundary (a trust zone, a subnet) rather than a box.

### DatabaseTable and DatabaseRelationship

```json
{ "tag": "DatabaseTable", "id": "tasks", "label": "tasks", "icon": "list-checks", "color": "green",
  "x": 460, "y": 360, "width": 240,
  "fields": [{ "name": "id", "type": "uuid", "meta": "pk" }, { "name": "project_id", "type": "uuid", "meta": "fk" }] }
```

```json
{ "tag": "DatabaseRelationship", "from": "projects", "to": "tasks",
  "fromField": "id", "toField": "project_id", "relType": "one-to-many" }
```

`relType`: `one-to-one`, `one-to-many`, `many-to-one`, `many-to-many` — picks the crow's-foot pair.
A `DatabaseRelationship` in `connections` must carry its `tag`.

### Textbox, Legend, Divider

```json
{ "tag": "Textbox", "id": "title", "x": 40, "y": 20, "width": 600, "text": "## Order flow", "hAlign": "left" }
{ "tag": "Legend", "id": "key", "x": 40, "y": 600, "entries": [{ "text": "Synchronous", "color": "#2866c4" }, { "text": "Queued", "color": "#c38424" }] }
{ "tag": "Divider", "id": "split", "orientation": "vertical", "x": 600, "y": 40, "height": 500, "label": "Trust boundary" }
```

## Connections (Relationship)

```json
{ "from": "worker", "to": "vault", "label": "secrets", "lineStyle": "dashed", "fromPort": "bottom" }
```

| Property | Values | Notes |
| --- | --- | --- |
| `label` | string | Inline markdown. Keep to one to three words. |
| `endArrowhead` | `triangle` (default), `arrow`, `bar`, `dot`, `crowFootSingle`, `crowFootMany`, `null` | `null` for no head. |
| `startArrowhead` | same, default none | Set both for a two-way link. |
| `fromPort`, `toPort` | `top`, `right`, `bottom`, `left` | Pin a side when the router picks a poor one. |
| `lineStyle` | `solid`, `dashed`, `dotted` | Dashed for async, optional or control-plane flows. |
| `connectorStyle` | `elbow` (default), `straight` | `straight` draws one direct line. |
| `cornerStyle` | `elbow` (rounded, default), `straight` (square) | |
| `color`, `lineWidth` | palette token or CSS colour; number | The label follows `color`. |
| `points` | `[{x, y}, ...]` | An explicit route. Rarely needed — prefer ports. |

Routing is automatic and avoids other entities. Connections never carry `containerId`.

## Colour

- `color` on `Shape`, `Group`, `Pool`, `Lane`, `DatabaseTable`, `Legend`, `Divider`, `Relationship`
  takes a palette token — `white`, `yellow`, `green`, `blue`, `purple`, `red`, `orange`, `black` — or
  any CSS colour. One value drives the whole look: pastel fill, border, title chip.
- `bgColor`, `borderColor`, a text run's `color` and a `Legend` entry's `color` take raw CSS colours
  only (`"#4a6fa5"`). `"blue"` there is CSS `#0000ff`, not the palette's blue — so for a legend
  swatch that matches a `"color": "blue"` group, use the palette's own value:

  | Token | `yellow` | `green` | `blue` | `purple` | `red` | `orange` | `black` |
  | --- | --- | --- | --- | --- | --- | --- | --- |
  | Hex | `#d3d61e` | `#30a050` | `#2866c4` | `#c43dcf` | `#bd413a` | `#c38424` | `#3a3a3a` |
- Use colour for meaning (one colour per layer, zone or kind of thing) and say what it means — by
  group titles or a `Legend`. Leave most nodes uncoloured.

## Text

- `texts` is a list of runs; each run is its own line: `[{ "text": "API" }, { "text": "FastAPI · 3 replicas", "fontSize": 12 }]`.
- Run text is markdown (`**bold**`, `_italic_`, `` `code` ``). Run options: `fontSize`, `color`, `hAlign`, `typeface`.
- `typeface`: `clean` (Inter, the default look), `rough` (hand-drawn), `mono`.
- `styleMode` on surfaces: `shadow` (default), `plain`, `watercolor`.

## Badges

Any entity or connection can carry a corner chip:
`"badge": { "text": "3", "placement": "top-right", "color": "white", "bgColor": "#d64545" }`.
`placement`: `top-left`, `top-right`, `bottom-left`, `bottom-right`, `top`, `right`, `bottom`, `left`;
connections also accept `start`, `middle`, `end`.

## Diagnostics you will meet

| Code | Meaning | Fix |
| --- | --- | --- |
| `E_UNKNOWN_TAG` | Misspelt tag; the message suggests one | Use the suggestion. |
| `E_KIND_MISMATCH` | A connection tag in `entities` or vice versa | Move it to the other list. |
| `E_ENVELOPE` | Not `{entities, connections}` or `{elements}` | Add the missing key. |
| `W_UNKNOWN_ICON` | Icon name not in the catalog; renders a placeholder | Search with `icons` and use a listed name. |
| `W_UNKNOWN_KEY` | A key the schema does not know | Remove it or check the spelling with `schema <Tag>`. |

Every issue carries a JSON Pointer `path` (`/entities/3/icon`) into the document as written.
`validate` checks structure only; unknown icons surface only on `render`.
