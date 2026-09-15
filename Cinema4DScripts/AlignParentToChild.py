"""
Align Parent to Child
----------------------
Select the TOP (parent) object, then run this script.

What it does:
1. Reads the first child's current world position.
2. Rotates the parent to "look at" that position (local Z+ points at the child),
   based on the parent's ORIGINAL position (rotation is computed before the move,
   since after the move the distance would be zero).
3. Moves the parent's pivot to the child's world position.
4. Re-anchors every direct child's local matrix so their world-space position,
   rotation, and scale are unchanged. Only the parent's anchor visibly moves;
   the geometry stays put.

Run via: Extensions > Script Manager > paste > Execute.
"""

import c4d


def get_global_matrix(obj):
    return obj.GetMg()


def set_global_matrix(obj, mg):
    """Set an object's world matrix by converting to the correct local matrix,
    whether or not it has its own parent."""
    parent = obj.GetUp()
    if parent is None:
        obj.SetMl(mg)
    else:
        obj.SetMl(~parent.GetMg() * mg)


def look_at_matrix(eye, target, up=None):
    """Build a matrix at 'eye' whose local Z+ (v3) points toward 'target'."""
    if up is None:
        up = c4d.Vector(0, 1, 0)

    forward = target - eye
    if forward.GetLength() < 1e-9:
        forward = c4d.Vector(0, 0, 1)
    forward = forward.GetNormalized()

    # Guard against forward being parallel to the up vector
    if abs(forward * up) > 0.999:
        up = c4d.Vector(1, 0, 0)

    right = up.Cross(forward).GetNormalized()
    true_up = forward.Cross(right).GetNormalized()

    m = c4d.Matrix()
    m.off = eye
    m.v1 = right
    m.v2 = true_up
    m.v3 = forward
    return m


def main():
    doc = c4d.documents.GetActiveDocument()
    obj = doc.GetActiveObject()

    if obj is None:
        c4d.gui.MessageDialog("Select the top (parent) object first.")
        return

    child = obj.GetDown()
    if child is None:
        c4d.gui.MessageDialog(f"'{obj.GetName()}' has no children.")
        return

    # Record every direct child's current world matrix, so we can restore
    # their world-space transform after the parent moves.
    children = []
    c = obj.GetDown()
    while c is not None:
        children.append((c, c.GetMg()))
        c = c.GetNext()

    old_parent_mg = obj.GetMg()
    old_parent_pos = old_parent_mg.off
    child_target_pos = child.GetMg().off

    # Preserve the parent's existing scale on each axis
    scale_x = old_parent_mg.v1.GetLength()
    scale_y = old_parent_mg.v2.GetLength()
    scale_z = old_parent_mg.v3.GetLength()

    new_mg = look_at_matrix(old_parent_pos, child_target_pos)
    new_mg.v1 = new_mg.v1 * scale_x
    new_mg.v2 = new_mg.v2 * scale_y
    new_mg.v3 = new_mg.v3 * scale_z
    new_mg.off = child_target_pos

    doc.StartUndo()

    doc.AddUndo(c4d.UNDOTYPE_CHANGE, obj)
    set_global_matrix(obj, new_mg)

    for c, old_mg in children:
        doc.AddUndo(c4d.UNDOTYPE_CHANGE, c)
        set_global_matrix(c, old_mg)

    doc.EndUndo()
    c4d.EventAdd()


if __name__ == '__main__':
    main()
