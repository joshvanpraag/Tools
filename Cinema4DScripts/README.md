# Cinema 4D Scripts

- [Align Parent to Child](#align-parent-to-child) — `AlignParentToChild.py`

## Align Parent to Child

`AlignParentToChild.py`

Re-anchors a parent object's pivot to its first child's position without disturbing any child's world-space transform.

**What it does**

1. Select the top (parent) object and run the script via **Extensions > Script Manager**.
2. It reads the first child's current world position, then rotates the parent to "look at" that position (computed from the parent's original position, before it moves).
3. It moves the parent's pivot to the child's world position.
4. It re-anchors every direct child's local matrix so each child's world-space position, rotation, and scale are unchanged — only the parent's pivot visibly moves, geometry stays put.

Preserves the parent's existing per-axis scale. Wrapped in a single undo step.

**Usage**

Select the parent object (its first child defines the target position/orientation) and run the script — no UI, no dialog beyond error messages if nothing is selected or the object has no children.
