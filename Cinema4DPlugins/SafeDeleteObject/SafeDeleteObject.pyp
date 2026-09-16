"""
Safe Delete Object - Cinema 4D command plugin

Select an object, run this command (it appears under Extensions once installed).
It scans the entire scene for anything that links to the selected object
(instances, boole/symmetry/cloner sources, target/constraint tags, spline
references, render settings sky/background/foreground objects, etc.), then
shows you what it found and asks for confirmation before deleting.

Children of the deleted object are NOT deleted - they are reparented one
level up, matching Cinema's standard "Delete" behavior (not "Delete With
Children"). This is deliberate so nothing downstream silently vanishes.

XPresso and Take System references are scanned on a best-effort basis (see
notes in find_link_references / scan_xpresso). Always still review the
Console after using this if you have complex XPresso setups.
"""

import os
import c4d

# Pick a real ID from plugincafe.maxon.net if you ever distribute this.
# Anything >= 1000000 is fine for personal, local-only use.
PLUGIN_ID = 1058642


def load_icon():
    """
    CommandData icons are NOT auto-discovered by filename the way
    ObjectData/TagData description icons are. We have to load the bitmap
    ourselves and hand it to RegisterCommandPlugin.

    Expects the plugin to live in its own folder, e.g.:
      plugins/SafeDeleteObject/SafeDeleteObject.pyp
      plugins/SafeDeleteObject/res/SafeDeleteObject.png
    """
    path = os.path.join(os.path.dirname(__file__), "res", "SafeDeleteObject.png")
    if not os.path.exists(path):
        print(f"[SafeDeleteObject] Icon not found at: {path}")
        return None
    bmp = c4d.bitmaps.BaseBitmap()
    result = bmp.InitWith(path)[0]
    if result == c4d.IMAGERESULT_OK:
        return bmp
    print(f"[SafeDeleteObject] Icon failed to load (InitWith result: {result}): {path}")
    return None


def check_container(bc, target, owner_label, owner_node, refs):
    """Scan one BaseContainer for link parameters pointing at target.

    owner_node is the actual object/tag that holds the reference, kept
    alongside the label so it can be selected/highlighted later if needed.
    """
    if bc is None:
        return
    for did, value in bc:
        if isinstance(value, c4d.BaseList2D) and value == target:
            refs.append({"label": owner_label, "node": owner_node})


def scan_xpresso(tag, target, label_prefix, refs):
    """
    Best-effort XPresso scan. GvNode data containers store constant link
    ports the same way regular objects store link parameters, so the same
    check_container approach usually catches them. Wrapped in try/except
    because node graph internals vary more between C4D versions than the
    regular object API does.
    """
    try:
        node_master = tag.GetNodeMaster()
        if node_master is None:
            return
        root = node_master.GetRoot()

        def walk_nodes(node):
            while node:
                check_container(
                    node.GetDataInstance(),
                    target,
                    f"{label_prefix} (XPresso node '{node.GetName()}')",
                    tag,
                    refs,
                )
                walk_nodes(node.GetDown())
                node = node.GetNext()

        walk_nodes(root.GetDown() if root else None)
    except Exception:
        # Don't let an XPresso quirk block the rest of the scan.
        pass


def find_link_references(doc, target):
    """
    Walk every object and tag in the document, plus render data, looking
    for any link parameter that points at target. Returns a list of
    human-readable labels describing what references it.
    """
    refs = []

    def walk(node, label_prefix):
        while node:
            if node != target:
                check_container(node.GetDataInstance(), target, f"{label_prefix}{node.GetName()}", node, refs)

            tag = node.GetFirstTag()
            while tag:
                owner_label = f"{label_prefix}{node.GetName()} > {tag.GetName()} (tag)"
                check_container(tag.GetDataInstance(), target, owner_label, tag, refs)
                if tag.CheckType(c4d.Texpresso):
                    scan_xpresso(tag, target, owner_label, refs)
                tag = tag.GetNext()

            walk(node.GetDown(), label_prefix)
            node = node.GetNext()

    walk(doc.GetFirstObject(), "")

    # Render settings: sky/background/foreground/floor objects, camera, etc.
    # (not attached to a selectable scene object, so no owner_node to highlight)
    rdata = doc.GetActiveRenderData()
    if rdata is not None:
        check_container(rdata.GetDataInstance(), target, "Render Settings", None, refs)

    return refs


def reparent_children(doc, obj):
    """
    Move obj's children up to obj's parent (or to document root if obj was
    top-level), preserving their order. Returns the list of children moved.
    """
    parent = obj.GetUp()
    children = []
    child = obj.GetDown()
    while child:
        nxt = child.GetNext()
        children.append(child)
        child = nxt

    for c in children:
        doc.AddUndo(c4d.UNDOTYPE_CHANGE, c)
        c.Remove()
        if parent:
            c.InsertUnder(parent)
        else:
            doc.InsertObject(c)

    return children


class SafeDeleteCommand(c4d.plugins.CommandData):
    def highlight_references(self, doc, refs):
        """
        Select, in the Object Manager, the objects that reference the object
        the user chose not to delete. A tag's reference is shown by
        selecting the object the tag sits on (tags aren't independently
        visible as a selection highlight). Render-settings references have
        no owner_node and are skipped, since Render Settings isn't an
        object you can select.
        """
        targets = []
        for r in refs:
            node = r["node"]
            if node is None:
                continue
            owner_obj = node.GetObject() if isinstance(node, c4d.BaseTag) else node
            if owner_obj is not None and owner_obj not in targets:
                targets.append(owner_obj)

        if not targets:
            if refs:
                c4d.gui.MessageDialog(
                    "Not deleted. The references found were in Render Settings, "
                    "which can't be highlighted in the Object Manager - check "
                    "there directly (Edit > Render Settings)."
                )
            return

        doc.SetActiveObject(targets[0], c4d.SELECTION_NEW)
        for obj in targets[1:]:
            doc.SetActiveObject(obj, c4d.SELECTION_ADD)
        c4d.EventAdd()

        c4d.gui.MessageDialog(
            f"Not deleted. Selected {len(targets)} referencing object(s) in the "
            "Object Manager so you can see where it's used."
        )

    def Execute(self, doc):
        obj = doc.GetActiveObject()

        if obj is None:
            c4d.gui.MessageDialog("No object is selected.")
            return True

        refs = find_link_references(doc, obj)
        child_count = 0
        child = obj.GetDown()
        while child:
            child_count += 1
            child = child.GetNext()

        lines = [f"You are about to delete '{obj.GetName()}'."]

        if refs:
            lines.append("")
            lines.append("This object is referenced by:")
            for r in refs:
                lines.append(f"  - {r['label']}")

            if child_count:
                lines.append("")
                lines.append(
                    f"It has {child_count} child object(s). They will NOT be deleted; "
                    "they will be reparented one level up."
                )

            lines.append("")
            lines.append("Delete it anyway?")

            confirmed = c4d.gui.QuestionDialog("\n".join(lines))
            if not confirmed:
                self.highlight_references(doc, refs)
                return True

        doc.StartUndo()

        if refs:
            already_added = []
            rdata = doc.GetActiveRenderData()
            if rdata is not None:
                doc.AddUndo(c4d.UNDOTYPE_CHANGE, rdata)
            for r in refs:
                n = r["node"]
                if n is not None and not any(n == a for a in already_added):
                    doc.AddUndo(c4d.UNDOTYPE_CHANGE, n)
                    already_added.append(n)

        if child_count:
            reparent_children(doc, obj)

        doc.AddUndo(c4d.UNDOTYPE_DELETE, obj)
        obj.Remove()

        doc.EndUndo()
        c4d.EventAdd()
        return True


if __name__ == "__main__":
    c4d.plugins.RegisterCommandPlugin(
        id=PLUGIN_ID,
        str="Safe Delete Object",
        info=0,
        help="Delete the selected object after checking for references and confirming",
        dat=SafeDeleteCommand(),
        icon=load_icon(),
    )
