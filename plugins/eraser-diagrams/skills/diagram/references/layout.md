# Laying out a diagram

The engine places nothing for you. Every entity's `x`, `y` is yours; only connections are routed
automatically. A diagram reads well when the positions come from a plan, not from guessing.

## The method

1. **List the nodes and edges.** Name each node in two or three words. Drop anything the reader does
   not need for this diagram's one point.
2. **Pick a flow direction.** Architecture and pipelines: left → right, callers on the left, state on
   the right. Flowcharts and trees: top → bottom. Swimlanes: left → right within lanes.
3. **Put nodes on a grid.** Give each node a column and a row so most edges run between neighbouring
   cells. Nodes that talk to each other a lot go side by side; a branch goes to the next column or row.
4. **Turn cells into centres** with a fixed pitch (table below): `cx = x0 + col × pitchX`,
   `cy = y0 + row × pitchY`.
5. **Turn centres into top-left corners:** `x = cx − width / 2`, `y = cy − height / 2`. Aligning
   centres, not corners, is what makes mixed sizes line up.
6. **Wrap groups around their cells** with the padding below, and give every child its `containerId`.
7. Render, read the layout report, look at the PNG, adjust.

## Measured sizes (engine 0.2.0, stock fonts)

| Element | Box | Text |
| --- | --- | --- |
| Icon `md` | 50 × 50 | Caption starts 5px below the box, 19px per line, wraps at ~90–110px wide, centred. |
| Icon `lg` | 72 × 72 | Caption wraps at ~130px. |
| Event, Gateway | 56 × 56 | Label starts 6px below, 19px per line, ~70–80px wide. |
| Shape, unsized | ~99 × 40 | Too small for most text — always set width and height. |
| Activity, unsized | ~93 × 49 | Same — set 200 × 80 when it has an icon, or the text wraps. |
| DatabaseTable | your width | Height = 38 + 28 per field. |
| Group title chip | — | Occupies the top 37px (9px inset, 28px tall). |
| Pool / Lane title band | — | Occupies the left 37px. |

An Icon's caption is not part of its measured box, so it can spill out of a group or into a
neighbour without the engine noticing. The layout check in `render` measures it.

## Spacing

| What | Use |
| --- | --- |
| Icon columns (centre to centre) | 180 with an unlabelled edge between them; 200+ with a labelled edge. |
| Icon rows | 110 minimum (box 50 + caption ~20–40 + air). |
| Process boxes | 180 × 64; diamonds 160 × 100; terminals (oval) 180 × 60. |
| Flowchart rows | 120–130 centre to centre; add 40 for a row holding a diamond. |
| Flowchart side branch | Its own column 260 to the side of the main column. |
| Group padding | Children ≥ 50px below the group's top (title chip), ≥ 30px from the other sides — measured to the caption, not the icon. |
| Between sibling groups | 60px. |
| Pool → lanes | Lanes start 50px in from the pool's left edge, 15px from top and right; lanes stack 5px apart. |
| Inside a lane | First node ≥ 80px from the lane's left edge; lane height ≥ 170 for one row of activities. |
| ERD tables | 240 wide, 160+ apart horizontally, 100+ vertically. |

A labelled connection needs about its label's width plus 50px of straight run, or the label sits on
the nodes. The check reports `short-line` and `label-crowded` when it does not get it.

## Recipes

**Architecture / cloud topology** — start from `example architecture`.
One `Group` per boundary that matters to the reader (edge, compute, data; or a VNet, a subscription).
Groups as columns of equal height, aligned tops. Icons for services, captioned with the service's role
or name, not its SKU. Put the actor (`users`, `user`, `globe`) outside, on the left.

**Flowchart** — `example flowchart`.
Main path straight down one column. Decisions as diamonds; the "yes"/happy path continues down, the
other branch leaves from the side (`fromPort: "right"` or `"left"`) to its own column. Loops back up go
round the outside on the opposite side, dashed, with `toPort` set. Terminals are ovals.

**Swimlane / BPMN** — `example swimlane`.
One `Pool` for the process, one `Lane` per role. `Event` to start and end, `Activity` per step,
`Gateway` per decision. Keep each lane to one row; time runs left to right, so a hand-off to another
lane moves one column right as well as one lane down.

**Entity-relationship** — `example erd`.
The most-referenced table in the middle or top-left; children to its right and below. Use
`DatabaseRelationship` with `fromField`/`toField` and `relType`.

**Org chart / tree** — `Shape` rectangles 180 × 64, levels 130 apart, siblings 220 apart. Centre each
parent over its children: parent `cx` = mean of first and last child `cx`. Edges from the parent's
`bottom` port to each child's `top` port.

**Layered stack** (presentation / API / data, or a platform view) — full-width `Group`s stacked
vertically, 40px apart, each a row of icons or shapes. Edges run down between layers.

**Sequence diagrams** — there is no lifeline primitive. Draw a swimlane with time left to right, or
say plainly that Mermaid or PlantUML suits this better.

## Routing

- Icons connect best side to side: their captions sit under them, so stack icons only when the
  stacked ones do not connect to each other, or connect them from `left`/`right` ports.
- When a route takes an odd path, pin `fromPort` / `toPort` before reaching for `points`.
- Several edges into one node: spread them by pinning different `toPort`s.
- Crossing lines usually mean two nodes are in the wrong column. Move nodes before adding ports.

## Readability

- One point per diagram. Past ~20 nodes, split it: an overview plus one diagram per zoomed area.
- Labels short and parallel ("reads", "writes", "publishes"); put detail in the doc, not the picture.
- Same kind of thing, same visual treatment. Colour carries meaning, and the meaning is stated.
- Leave air. Empty space inside a group is fine; things touching are not.
