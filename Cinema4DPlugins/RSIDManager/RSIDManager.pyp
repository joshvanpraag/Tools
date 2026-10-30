"""RS ID Manager: table view of Redshift Object IDs and Material IDs."""
import c4d
import maxon
import os
import traceback
import time
from c4d import gui, plugins
try:
    import redshift
except ImportError:
    redshift = None

PLUGIN_ID = 1069431
RS_TAG = 1036222
RS_VP = 1036219
SPACE = "com.redshift3d.redshift4c4d.class.nodespace"
OUT_ASSET = "com.redshift3d.redshift4c4d.node.output"
PORT = "com.redshift3d.redshift4c4d.node.output.materialid"
MODE_OBJ = getattr(c4d, "REDSHIFT_AOV_PUZZLE_MATTE_MODE_OBJECT_ID", 1)
MODE_MAT = getattr(c4d, "REDSHIFT_AOV_PUZZLE_MATTE_MODE_MATERIAL_ID", 0)
CH_PARAMS = (c4d.REDSHIFT_AOV_PUZZLE_MATTE_RED_ID, c4d.REDSHIFT_AOV_PUZZLE_MATTE_GREEN_ID, c4d.REDSHIFT_AOV_PUZZLE_MATTE_BLUE_ID)
FILLER_ID = 9999
MAXV = 999999

CHAN = "RGB"
CHAN_COL = [c4d.Vector(1, 0, 0), c4d.Vector(0, 1, 0), c4d.Vector(0, 0, 1)]
COL_NONE = c4d.Vector(0.32)
COL_ZERO = c4d.Vector(0.18)
TXT_DIM = c4d.Vector(0.5)

# dialog widgets
ID_MODE, ID_SEARCH, ID_GROUP, ID_REFRESH, ID_COUNT = 1001, 1002, 1003, 1004, 1005
ID_NUM, ID_NEXT, ID_ASSIGN, ID_BUILD, ID_TREE, ID_STATUS = 1006, 1007, 1008, 1009, 1010, 1011
ID_PULL, ID_PREVIEW, ID_PSRC = 1012, 1014, 1015
ID_BTN_OBJ, ID_BTN_TAG, ID_BTN_MAT = 1020, 1021, 1022
TARGET_BTNS = (("objects", ID_BTN_OBJ), ("tags", ID_BTN_TAG), ("materials", ID_BTN_MAT))
PURE = [c4d.Vector(1, 0, 0), c4d.Vector(0, 1, 0), c4d.Vector(0, 0, 1)]
BLACK = c4d.Vector(0)
PREVIEW_NONE = c4d.Vector(0.35)
PREVIEW_DIM = c4d.Vector(0.06)
WARN_ORANGE = c4d.Vector(1.0, 0.6, 0.15)
UNMATTED = c4d.Vector(1.0, 0.5, 0.0)
# tree columns
C_NAME, C_ID, C_SW, C_MATTE, C_OVR, C_INFO = 1, 2, 3, 4, 5, 6
C_LABEL = 7
C_TAKE = 8
LABEL_BC = 1000
# context menu
CM = c4d.ID_TREEVIEW_FIRST_NEW_ID
CM_SETID, CM_SELOBJ, CM_SELTAG, CM_SELUSING, CM_FOLD, CM_UNFOLD, CM_OVR_ON, CM_OVR_OFF = [CM + i for i in range(1, 9)]
CM_LABEL, CM_LABEL_CLR, CM_LABEL_FROM_MATTE, CM_MATTE_FROM_LABEL = [CM + i for i in range(20, 24)]

ERRORS = []


def guard(default=None):
    def deco(fn):
        def wrap(*a, **k):
            try:
                return fn(*a, **k)
            except Exception:
                ERRORS.append(traceback.format_exc())
                del ERRORS[:-20]
                return default
        return wrap
    return deco


# ---------------------------------------------------------------- scene scan
def walk_objects(doc):
    result, stack = [], []
    op = doc.GetFirstObject()
    while op or stack:
        if op is None:
            op = stack.pop()
            continue
        result.append(op)
        down = op.GetDown()
        if down:
            stack.append(op.GetNext())
            op = down
        else:
            op = op.GetNext()
    return result


def as_int(v):
    if v is None:
        return 0
    try:
        return int(v)
    except Exception:
        try:
            return int(str(v))
        except Exception:
            return 0


def next_free(used):
    i = 1
    while i in used:
        i += 1
    return i


def obj_path(o):
    parts = []
    p = o.GetUp()
    while p:
        parts.insert(0, p.GetName())
        p = p.GetUp()
    return " > ".join(parts)


def mat_key(m):
    u = m.FindUniqueID(c4d.MAXON_CREATOR_ID)
    return bytes(u) if u is not None else ("n", m.GetName())


def scan_objects(doc):
    ids, off = {}, []
    for op in walk_objects(doc):
        for t in op.GetTags():
            if t.GetType() != RS_TAG:
                continue
            if t[c4d.REDSHIFT_OBJECT_OBJECTID_OVERRIDE]:
                ids.setdefault(int(t[c4d.REDSHIFT_OBJECT_OBJECTID_ID]), []).append((op, t))
            else:
                off.append((op, t))
    return ids, off


def material_ports(mat):
    try:
        ref = mat.GetNodeMaterialReference()
        if not ref.HasSpace(SPACE):
            return None, []
        g = ref.GetGraph(SPACE)
        if g.IsNullValue():
            return None, []
        ports = []
        for n in g.GetViewRoot().GetInnerNodes(maxon.NODE_KIND.NODE, False):
            aid = n.GetValue("net.maxon.node.attribute.assetid")
            if aid is None or str(aid[0]) != OUT_ASSET:
                continue
            p = n.GetInputs().FindChild(PORT)
            if p is not None and not p.IsNullValue():
                ports.append(p)
        return g, ports
    except Exception:
        return None, []


def scan_materials(doc):
    ids, skipped = {}, []
    for m in doc.GetMaterials():
        g, ports = material_ports(m)
        if not ports:
            skipped.append(m)
            continue
        ids.setdefault(as_int(ports[0].GetEffectivePortValue()), []).append(m)
    return ids, skipped


def material_usage(doc):
    cnt = {}
    for op in walk_objects(doc):
        seen = set()
        for t in op.GetTags():
            if t.GetType() == c4d.Ttexture:
                m = t.GetMaterial()
                if m is not None:
                    k = mat_key(m)
                    if k not in seen:
                        seen.add(k)
                        cnt[k] = cnt.get(k, 0) + 1
    return cnt


def objects_using(doc, mats):
    keys = set(mat_key(m) for m in mats if m.IsAlive())
    res = []
    for op in walk_objects(doc):
        for t in op.GetTags():
            if t.GetType() == c4d.Ttexture:
                m = t.GetMaterial()
                if m is not None and mat_key(m) in keys:
                    res.append(op)
                    break
    return res


def aov_name(a):
    n = str(a.GetParameter(c4d.REDSHIFT_AOV_NAME) or "")
    if not n:
        n = str(a.GetParameter(c4d.REDSHIFT_AOV_EFFECTIVE_NAME) or "PuzzleMatte")
    return n


def get_rs_videopost(doc):
    rd = doc.GetActiveRenderData()
    vp = rd.GetFirstVideoPost() if rd else None
    while vp and vp.GetType() != RS_VP:
        vp = vp.GetNext()
    return vp


def scan_coverage(doc):
    cov = {MODE_OBJ: {}, MODE_MAT: {}}
    vp = get_rs_videopost(doc)
    if vp is None or redshift is None:
        return cov, False
    for a in redshift.RendererGetAOVs(vp):
        if a.GetParameter(c4d.REDSHIFT_AOV_TYPE) != c4d.REDSHIFT_AOV_TYPE_PUZZLE_MATTE:
            continue
        if not a.GetParameter(c4d.REDSHIFT_AOV_ENABLED):
            continue
        mode = a.GetParameter(c4d.REDSHIFT_AOV_PUZZLE_MATTE_MODE)
        name = aov_name(a)
        for ch, pid in enumerate(CH_PARAMS):
            v = as_int(a.GetParameter(pid))
            if v == 0 or v == FILLER_ID:
                continue
            cov.setdefault(mode, {}).setdefault(v, []).append((name, ch))
    return cov, True


def matte_suggestions(doc):
    sug = {MODE_OBJ: {}, MODE_MAT: {}}
    vp = get_rs_videopost(doc)
    if vp is None or redshift is None:
        return sug
    for a in redshift.RendererGetAOVs(vp):
        if a.GetParameter(c4d.REDSHIFT_AOV_TYPE) != c4d.REDSHIFT_AOV_TYPE_PUZZLE_MATTE:
            continue
        if not a.GetParameter(c4d.REDSHIFT_AOV_ENABLED):
            continue
        mode = a.GetParameter(c4d.REDSHIFT_AOV_PUZZLE_MATTE_MODE)
        name = aov_name(a)
        chans = [(ch, as_int(a.GetParameter(pid))) for ch, pid in enumerate(CH_PARAMS)]
        chans = [(ch, v) for ch, v in chans if v not in (0, FILLER_ID)]
        tokens = [t for t in name.split("_") if t]
        for k, (ch, v) in enumerate(chans):
            if len(chans) == 1:
                s = name
            elif len(tokens) == len(chans):
                s = tokens[k]
            else:
                s = "%s.%s" % (name, CHAN[ch])
            sug.setdefault(mode, {}).setdefault(v, s)
    return sug


def get_labels(doc, mode):
    sub = doc.GetDataInstance().GetContainer(PLUGIN_ID).GetContainer(LABEL_BC + mode)
    out = {}
    for k, v in sub:
        if isinstance(v, str) and v:
            out[k] = v
    return out


def set_labels(doc, mode, mapping):
    data = doc.GetDataInstance()
    rootbc = data.GetContainer(PLUGIN_ID)
    sub = rootbc.GetContainer(LABEL_BC + mode)
    for k, v in mapping.items():
        if v:
            sub.SetString(int(k), v)
        else:
            sub.RemoveData(int(k))
    rootbc.SetContainer(LABEL_BC + mode, sub)
    data.SetContainer(PLUGIN_ID, rootbc)
    doc.SetChanged()
    c4d.EventAdd()


def rename_mattes_from_labels(doc, rs_mode, ids, labels):
    vp = get_rs_videopost(doc)
    if vp is None or redshift is None:
        return 0
    aovs = list(redshift.RendererGetAOVs(vp))
    n = 0
    for a in aovs:
        if a.GetParameter(c4d.REDSHIFT_AOV_TYPE) != c4d.REDSHIFT_AOV_TYPE_PUZZLE_MATTE:
            continue
        if a.GetParameter(c4d.REDSHIFT_AOV_PUZZLE_MATTE_MODE) != rs_mode:
            continue
        used = [as_int(a.GetParameter(pid)) for pid in CH_PARAMS]
        used = [v for v in used if v not in (0, FILLER_ID)]
        if not used or not any(v in ids for v in used):
            continue
        parts = []
        for v in used:
            lab = labels.get(v) or ("id%d" % v)
            parts.append("-".join(lab.replace("_", "-").split()))
        a.SetParameter(c4d.REDSHIFT_AOV_NAME, "_".join(parts))
        n += 1
    if n:
        doc.StartUndo()
        doc.AddUndo(c4d.UNDOTYPE_CHANGE, vp)
        redshift.RendererSetAOVs(vp, aovs)
        doc.EndUndo()
        c4d.EventAdd()
    return n


def matte_snapshot(doc):
    vp = get_rs_videopost(doc)
    snap = {}
    if vp is None or redshift is None:
        return snap
    for i, a in enumerate(redshift.RendererGetAOVs(vp)):
        if a.GetParameter(c4d.REDSHIFT_AOV_TYPE) != c4d.REDSHIFT_AOV_TYPE_PUZZLE_MATTE:
            continue
        snap[i] = (a.GetParameter(c4d.REDSHIFT_AOV_PUZZLE_MATTE_MODE),
                   tuple(as_int(a.GetParameter(p)) for p in CH_PARAMS))
    return snap


def sync_mattes_doc(doc, only=None):
    """Rename Puzzle Mattes (all, or only the given AOV indices) from labels.
    A matte is touched only if at least one of its IDs has a label."""
    vp = get_rs_videopost(doc)
    if vp is None or redshift is None:
        return 0
    labels = {MODE_OBJ: get_labels(doc, 0), MODE_MAT: get_labels(doc, 1)}
    aovs = list(redshift.RendererGetAOVs(vp))
    n = 0
    for i, a in enumerate(aovs):
        if only is not None and i not in only:
            continue
        if a.GetParameter(c4d.REDSHIFT_AOV_TYPE) != c4d.REDSHIFT_AOV_TYPE_PUZZLE_MATTE:
            continue
        lab = labels.get(a.GetParameter(c4d.REDSHIFT_AOV_PUZZLE_MATTE_MODE), {})
        used = [as_int(a.GetParameter(p)) for p in CH_PARAMS]
        used = [v for v in used if v not in (0, FILLER_ID)]
        if not used or not any(v in lab for v in used):
            continue
        name = "_".join("-".join((lab.get(v) or ("id%d" % v)).replace("_", "-").split()) for v in used)
        if str(a.GetParameter(c4d.REDSHIFT_AOV_NAME)) != name:
            a.SetParameter(c4d.REDSHIFT_AOV_NAME, name)
            n += 1
    if n:
        doc.StartUndo()
        doc.AddUndo(c4d.UNDOTYPE_CHANGE, vp)
        redshift.RendererSetAOVs(vp, aovs)
        doc.EndUndo()
        c4d.EventAdd()
    return n


# ---------------------------------------------------------------- scene edits
def take_auto(doc):
    td = doc.GetTakeData()
    if td is None:
        return None, None
    cur = td.GetCurrentTake()
    if cur is None or cur.IsMain() or td.GetTakeMode() != c4d.TAKE_MODE_AUTO:
        return td, None
    return td, cur


def tag_write(doc, tag, pairs):
    td, take = take_auto(doc)
    if take is None:
        for pid, val in pairs:
            tag[pid] = val
        return
    for pid, val in pairs:
        did = c4d.DescID(c4d.DescLevel(pid))
        ov = take.FindOrAddOverrideParam(td, tag, did, val)
        if ov is not None:
            ov.UpdateSceneNode(td, did)


def assign_objects(doc, objs, val):
    if not objs:
        return 0
    doc.StartUndo()
    for op in objs:
        t = op.GetTag(RS_TAG)
        if t is None:
            t = c4d.BaseTag(RS_TAG)
            op.InsertTag(t)
            doc.AddUndo(c4d.UNDOTYPE_NEWOBJ, t)
        else:
            doc.AddUndo(c4d.UNDOTYPE_CHANGE, t)
        tag_write(doc, t, [(c4d.REDSHIFT_OBJECT_OBJECTID_OVERRIDE, True), (c4d.REDSHIFT_OBJECT_OBJECTID_ID, val)])
    doc.EndUndo()
    c4d.EventAdd()
    return len(objs)


def set_tag_ids(doc, tags, val):
    tags = [t for t in tags if t is not None and t.IsAlive()]
    doc.StartUndo()
    for t in tags:
        doc.AddUndo(c4d.UNDOTYPE_CHANGE, t)
        tag_write(doc, t, [(c4d.REDSHIFT_OBJECT_OBJECTID_OVERRIDE, True), (c4d.REDSHIFT_OBJECT_OBJECTID_ID, val)])
    doc.EndUndo()
    c4d.EventAdd()
    return len(tags)


def set_tag_override(doc, tags, on):
    tags = [t for t in tags if t is not None and t.IsAlive()]
    doc.StartUndo()
    for t in tags:
        doc.AddUndo(c4d.UNDOTYPE_CHANGE, t)
        tag_write(doc, t, [(c4d.REDSHIFT_OBJECT_OBJECTID_OVERRIDE, bool(on))])
    doc.EndUndo()
    c4d.EventAdd()
    return len(tags)


def tag_key(t):
    o = t.GetObject()
    return ("o", str(o.GetGUID()), o.GetTags().index(t))


def take_info(doc):
    td = doc.GetTakeData()
    if td is None:
        return "Main", set(), set()
    cur = td.GetCurrentTake()
    dids = [c4d.DescID(c4d.DescLevel(c4d.REDSHIFT_OBJECT_OBJECTID_ID)),
            c4d.DescID(c4d.DescLevel(c4d.REDSHIFT_OBJECT_OBJECTID_OVERRIDE))]
    active, anywhere = set(), set()

    def visit(t):
        while t:
            for ov in (t.GetOverrides() or []):
                node = ov.GetSceneNode()
                if node is None or node.GetType() != RS_TAG or node.GetObject() is None:
                    continue
                if any(ov.IsOverriddenParam(d) for d in dids):
                    k = tag_key(node)
                    anywhere.add(k)
                    if t == cur:
                        active.add(k)
            visit(t.GetDown())
            t = t.GetNext()
    visit(td.GetMainTake().GetDown())
    return (cur.GetName() if cur else "Main"), active, anywhere


def set_material_ids(doc, mats, val):
    n = 0
    doc.StartUndo()
    for m in mats:
        if not m.IsAlive():
            continue
        g, ports = material_ports(m)
        if not ports:
            continue
        doc.AddUndo(c4d.UNDOTYPE_CHANGE, m)
        with g.BeginTransaction() as tr:
            for p in ports:
                p.SetPortValue(int(val))
            tr.Commit()
        n += 1
    doc.EndUndo()
    c4d.EventAdd()
    return n


def build_mattes(doc, mode, ids, prefix):
    vp = get_rs_videopost(doc)
    if vp is None or redshift is None or not ids:
        return 0
    aovs = list(redshift.RendererGetAOVs(vp))
    names = set(str(a.GetParameter(c4d.REDSHIFT_AOV_NAME)) for a in aovs)
    ids = sorted(ids)
    made, n = 0, 1
    for i in range(0, len(ids), 3):
        chunk = ids[i:i + 3]
        while "%s_%02d" % (prefix, n) in names:
            n += 1
        name = "%s_%02d" % (prefix, n)
        names.add(name)
        a = redshift.RSAOV()
        a.SetParameter(c4d.REDSHIFT_AOV_TYPE, c4d.REDSHIFT_AOV_TYPE_PUZZLE_MATTE)
        a.SetParameter(c4d.REDSHIFT_AOV_ENABLED, True)
        a.SetParameter(c4d.REDSHIFT_AOV_NAME, name)
        a.SetParameter(c4d.REDSHIFT_AOV_PUZZLE_MATTE_MODE, mode)
        for ch, pid in enumerate(CH_PARAMS):
            a.SetParameter(pid, chunk[ch] if ch < len(chunk) else FILLER_ID)
        aovs.append(a)
        made += 1
    doc.StartUndo()
    doc.AddUndo(c4d.UNDOTYPE_CHANGE, vp)
    redshift.RendererSetAOVs(vp, aovs)
    doc.EndUndo()
    c4d.EventAdd()
    return made


# ---------------------------------------------------------------- viewport preview
def puzzle_aovs(doc, rs_mode):
    vp = get_rs_videopost(doc)
    out = []
    if vp is None or redshift is None:
        return out
    for a in redshift.RendererGetAOVs(vp):
        if a.GetParameter(c4d.REDSHIFT_AOV_TYPE) != c4d.REDSHIFT_AOV_TYPE_PUZZLE_MATTE:
            continue
        if not a.GetParameter(c4d.REDSHIFT_AOV_ENABLED) or a.GetParameter(c4d.REDSHIFT_AOV_PUZZLE_MATTE_MODE) != rs_mode:
            continue
        out.append((aov_name(a), [as_int(a.GetParameter(p)) for p in CH_PARAMS]))
    return out


def effective_object_ids(doc):
    """(object, effective Object ID, object whose tag set it) for every object."""
    out = []

    def rec(op, inherited, owner):
        while op:
            v, ow = inherited, owner
            for t in op.GetTags():
                if t.GetType() == RS_TAG and t[c4d.REDSHIFT_OBJECT_OBJECTID_OVERRIDE]:
                    v, ow = int(t[c4d.REDSHIFT_OBJECT_OBJECTID_ID]), op
            out.append((op, v, ow))
            rec(op.GetDown(), v, ow)
            op = op.GetNext()
    rec(doc.GetFirstObject(), None, None)
    return out


def effective_materials(doc):
    out = []

    def rec(op, inherited):
        while op:
            full, anym = None, None
            for t in op.GetTags():
                if t.GetType() == c4d.Ttexture and t.GetMaterial() is not None:
                    anym = t.GetMaterial()
                    if not t[c4d.TEXTURETAG_RESTRICTION]:
                        full = anym
            m = full or anym or inherited
            out.append((op, m))
            rec(op.GetDown(), m)
            op = op.GetNext()
    rec(doc.GetFirstObject(), None)
    return out


VIEW_BC = 2000
VIEW_KEYS = (c4d.BASEDRAW_DATA_SDISPLAYACTIVE, c4d.BASEDRAW_DATA_SDISPLAYINACTIVE,
             c4d.BASEDRAW_DATA_HQ_SSAO, c4d.BASEDRAW_DATA_HQ_SHADOWS, c4d.BASEDRAW_DATA_HQ_REFLECTIONS)
VIEW_FLAT = (c4d.BASEDRAW_SDISPLAY_FLAT, c4d.BASEDRAW_SDISPLAY_FLAT, False, False, False)


def flat_views(doc):
    data = doc.GetDataInstance()
    rootbc = data.GetContainer(PLUGIN_ID)
    if rootbc.GetType(VIEW_BC) != c4d.DA_CONTAINER:
        bk = c4d.BaseContainer()
        for i in range(doc.GetBaseDrawCount()):
            bd = doc.GetBaseDraw(i)
            if bd is None:
                continue
            b = c4d.BaseContainer()
            for k in VIEW_KEYS:
                b.SetInt32(k, int(bd[k]))
            bk.SetContainer(i, b)
        rootbc.SetContainer(VIEW_BC, bk)
        data.SetContainer(PLUGIN_ID, rootbc)
    for i in range(doc.GetBaseDrawCount()):
        bd = doc.GetBaseDraw(i)
        if bd is None:
            continue
        for k, v in zip(VIEW_KEYS, VIEW_FLAT):
            if bd[k] != v:
                bd[k] = v


def restore_views(doc):
    data = doc.GetDataInstance()
    rootbc = data.GetContainer(PLUGIN_ID)
    if rootbc.GetType(VIEW_BC) != c4d.DA_CONTAINER:
        return 0
    bk = rootbc.GetContainer(VIEW_BC)
    for i in range(doc.GetBaseDrawCount()):
        bd = doc.GetBaseDraw(i)
        if bd is None or bk.GetType(i) != c4d.DA_CONTAINER:
            continue
        b = bk.GetContainer(i)
        for k in VIEW_KEYS:
            v = b.GetInt32(k)
            bd[k] = bool(v) if k not in VIEW_KEYS[:2] else v
    rootbc.RemoveData(VIEW_BC)
    data.SetContainer(PLUGIN_ID, rootbc)
    return 1


def apply_preview(doc, colors):
    flat_views(doc)
    for op, col in colors:
        data = op.GetDataInstance()
        if data.GetType(PLUGIN_ID) != c4d.DA_CONTAINER:
            b = c4d.BaseContainer()
            b.SetInt32(1, op[c4d.ID_BASEOBJECT_USECOLOR])
            b.SetVector(2, op[c4d.ID_BASEOBJECT_COLOR])
            data.SetContainer(PLUGIN_ID, b)
        if op[c4d.ID_BASEOBJECT_USECOLOR] != c4d.ID_BASEOBJECT_USECOLOR_ALWAYS:
            op[c4d.ID_BASEOBJECT_USECOLOR] = c4d.ID_BASEOBJECT_USECOLOR_ALWAYS
        if op[c4d.ID_BASEOBJECT_COLOR] != col:
            op[c4d.ID_BASEOBJECT_COLOR] = col


def restore_preview(doc):
    n = 0
    for op in walk_objects(doc):
        data = op.GetDataInstance()
        if data.GetType(PLUGIN_ID) == c4d.DA_CONTAINER:
            b = data.GetContainer(PLUGIN_ID)
            op[c4d.ID_BASEOBJECT_USECOLOR] = b.GetInt32(1)
            op[c4d.ID_BASEOBJECT_COLOR] = b.GetVector(2)
            data.RemoveData(PLUGIN_ID)
            n += 1
    n += restore_views(doc)
    return n


# ---------------------------------------------------------------- selection
def reveal(op):
    p = op.GetUp()
    while p:
        p.ChangeNBit(c4d.NBIT_OM1_FOLD, c4d.NBITCONTROL_SET)
        p = p.GetUp()


def select_objects(doc, objs):
    objs = [o for o in objs if o is not None and o.IsAlive()]
    for i, o in enumerate(objs):
        doc.SetActiveObject(o, c4d.SELECTION_NEW if i == 0 else c4d.SELECTION_ADD)
        reveal(o)
    c4d.EventAdd()


def select_tags(doc, tags):
    tags = [t for t in tags if t is not None and t.IsAlive()]
    for i, t in enumerate(tags):
        doc.SetActiveTag(t, c4d.SELECTION_NEW if i == 0 else c4d.SELECTION_ADD)
        reveal(t.GetObject())
    c4d.EventAdd()


def select_materials(doc, mats):
    mats = [m for m in mats if m is not None and m.IsAlive()]
    for i, m in enumerate(mats):
        doc.SetActiveMaterial(m, c4d.SELECTION_NEW if i == 0 else c4d.SELECTION_ADD)
    c4d.EventAdd()


def apply_scene_selection(doc, objs, tags, mats, touch_mats):
    for o in doc.GetActiveObjects(c4d.GETACTIVEOBJECTFLAGS_NONE):
        o.DelBit(c4d.BIT_ACTIVE)
    for t in doc.GetActiveTags():
        t.DelBit(c4d.BIT_ACTIVE)
    for o in objs:
        if o is not None and o.IsAlive():
            o.SetBit(c4d.BIT_ACTIVE)
            reveal(o)
    for t in tags:
        if t is not None and t.IsAlive():
            t.SetBit(c4d.BIT_ACTIVE)
            reveal(t.GetObject())
    if touch_mats:
        for m in doc.GetActiveMaterials():
            m.DelBit(c4d.BIT_ACTIVE)
        for m in mats:
            if m is not None and m.IsAlive():
                m.SetBit(c4d.BIT_ACTIVE)
    c4d.EventAdd()


# ---------------------------------------------------------------- tree model
class Row(object):
    def __init__(self, kind, key, name):
        self.kind = kind          # "group" or "item"
        self.key = key
        self.name = name
        self.idv = None
        self.idtext = ""
        self.obj = None
        self.tag = None
        self.mat = None
        self.on = True
        self.col = COL_NONE
        self.matte = ""
        self.info = ""
        self.label = ""
        self.label_auto = False
        self.take = ""
        self.children = []
        self.sibs = None
        self.i = 0
        self.uid = 0


class TreeFuncs(gui.TreeViewFunctions):
    def __init__(self, dlg):
        super().__init__()
        self.d = dlg

    @guard(None)
    def GetFirst(self, root, ud):
        return self.d.top[0] if self.d.top else None

    @guard(None)
    def GetDown(self, root, ud, obj):
        return obj.children[0] if obj.children else None

    @guard(None)
    def GetNext(self, root, ud, obj):
        return obj.sibs[obj.i + 1] if obj.i + 1 < len(obj.sibs) else None

    @guard(None)
    def GetPred(self, root, ud, obj):
        return obj.sibs[obj.i - 1] if obj.i > 0 else None

    @guard(0)
    def GetId(self, root, ud, obj):
        return obj.uid

    @guard(False)
    def IsSelected(self, root, ud, obj):
        return obj.key in self.d.sel

    @guard(None)
    def Select(self, root, ud, obj, mode):
        if mode == c4d.SELECTION_NEW:
            self.d.sel = {obj.key}
        elif mode == c4d.SELECTION_ADD:
            self.d.sel.add(obj.key)
        elif mode == c4d.SELECTION_SUB:
            self.d.sel.discard(obj.key)

    @guard(None)
    def SelectionChanged(self, root, ud):
        self.d.push_selection()

    @guard(True)
    def IsOpened(self, root, ud, obj):
        return self.d.opened.get(obj.key, True)

    @guard(None)
    def Open(self, root, ud, obj, onoff):
        self.d.opened[obj.key] = bool(onoff)

    @guard("")
    def GetName(self, root, ud, obj):
        return obj.name

    @guard(None)
    def SetName(self, root, ud, obj, name):
        pass

    @guard(20)
    def GetLineHeight(self, root, ud, obj, col, area):
        return area.DrawGetFontHeight() + 6

    @guard(80)
    def GetColumnWidth(self, root, ud, obj, col, area):
        if col == C_NAME:
            return area.DrawGetTextWidth(obj.name) + 30
        if col == C_ID:
            return 56
        if col == C_SW:
            return 26
        if col == C_MATTE:
            return max(area.DrawGetTextWidth(obj.matte) + 16, 130)
        if col == C_LABEL:
            return max(area.DrawGetTextWidth(obj.label) + 16, 120)
        if col == C_TAKE:
            return 72
        if col == C_INFO:
            return max(area.DrawGetTextWidth(obj.info) + 16, 90)
        return 70

    @guard(None)
    def DrawCell(self, root, ud, obj, col, drawinfo, bgColor):
        f = drawinfo["frame"]
        x, y = drawinfo["xpos"], drawinfo["ypos"]
        w, h = drawinfo["width"], drawinfo["height"]
        if col == C_SW:
            s = max(6, min(h - 8, 14))
            cx, cy = x + (w - s) // 2, y + (h - s) // 2
            f.DrawSetPen(obj.col)
            f.DrawRectangle(cx, cy, cx + s, cy + s)
            return
        txt = {C_ID: obj.idtext, C_MATTE: obj.matte, C_INFO: obj.info, C_LABEL: obj.label, C_TAKE: obj.take}.get(col, "")
        dim = (not obj.on) or (col == C_MATTE and obj.col in (COL_NONE, COL_ZERO)) or (col == C_LABEL and obj.label_auto)
        f.DrawSetTextCol(TXT_DIM if dim else c4d.COLOR_TEXT, c4d.COLOR_TRANS)
        f.DrawText(txt, x + 6, y + (h - f.DrawGetFontHeight()) // 2)

    @guard(c4d.LV_CHECKBOX_HIDE)
    def GetCheckbox(self, root, ud, obj, column, info):
        if column != C_OVR or obj.kind != "item" or obj.tag is None:
            return c4d.LV_CHECKBOX_HIDE
        return c4d.LV_CHECKBOX_ENABLED | (c4d.LV_CHECKBOX_CHECKED if obj.on else 0)

    @guard(None)
    def SetCheckbox(self, root, ud, obj, column, checked, msg):
        if column == C_OVR and obj.tag is not None:
            rows = self.d.targets(obj)
            set_tag_override(c4d.documents.GetActiveDocument(), [r.tag for r in rows], checked)
            self.d.request_rebuild()

    @guard(True)
    def DoubleClick(self, root, ud, obj, col, mouseinfo):
        if col == C_LABEL:
            self.d.prompt_label(obj)
        elif col == C_ID or obj.kind == "group":
            self.d.prompt_id(obj)
        return True

    @guard(None)
    def CreateContextMenu(self, root, ud, obj, lColumn, bc):
        bc.FlushAll()
        bc.SetString(CM_FOLD, "Fold All")
        bc.SetString(CM_UNFOLD, "Unfold All")

    @guard(False)
    def ContextMenuCall(self, root, ud, obj, lColumn, lCommand):
        return self.d.context(obj, lCommand)

    @guard(False)
    def HeaderClick(self, root, ud, column, channel, is_double_click, mouseX, mouseY, ua):
        if column == C_SW or column == C_OVR:
            return False
        col, direc = self.d.sort
        self.d.sort = (column, -direc if col == column else 1)
        self.d.populate()
        return True

    @guard(0)
    def GetHeaderSortArrow(self, root, ud, column):
        col, direc = self.d.sort
        return direc if column == col else 0

    @guard(0)
    def GetDragType(self, root, ud, obj):
        return c4d.DRAGTYPE_ATOMARRAY

    @guard(0)
    def DragStart(self, root, ud, obj):
        return c4d.TREEVIEW_DRAGSTART_ALLOW | c4d.TREEVIEW_DRAGSTART_SELECT

    @guard(None)
    def GenerateDragArray(self, root, ud, obj):
        rows = self.d.targets(obj)
        atoms = [r.obj if self.d.mode == 0 else r.mat for r in rows]
        return [a for a in atoms if a is not None and a.IsAlive()] or None

    @guard((0, False))
    def AcceptDragObject(self, root, ud, obj, dragtype, dragobject):
        if dragtype != c4d.DRAGTYPE_ATOMARRAY or obj is None or obj.idv is None or not obj.on:
            return 0, False
        want = c4d.BaseObject if self.d.mode == 0 else c4d.BaseMaterial
        if not any(isinstance(a, want) for a in (dragobject or [])):
            return 0, False
        return c4d.INSERT_UNDER, False

    @guard(None)
    def InsertObject(self, root, ud, obj, dragtype, dragobject, insertmode, bCopy):
        if dragtype == c4d.DRAGTYPE_ATOMARRAY:
            self.d.drop_on(obj, list(dragobject or []))

    @guard("")
    def EmptyText(self, root, ud):
        if self.d.mode == 0:
            return "No Redshift Object tags in this scene"
        return "No Redshift node materials in this scene"


# ---------------------------------------------------------------- dialog
class LabelDialog(gui.GeDialog):
    """Small OK/Cancel prompt: OK with an empty field clears the label, Cancel changes nothing."""
    def __init__(self, title, preset):
        super().__init__()
        self.title = title
        self.value = preset
        self.ok = False

    def CreateLayout(self):
        self.SetTitle(self.title)
        self.GroupBegin(0, c4d.BFH_SCALEFIT, 1, 0)
        self.GroupBorderSpace(8, 8, 8, 4)
        self.AddEditText(100, c4d.BFH_SCALEFIT, 300, 0)
        self.GroupEnd()
        self.AddDlgGroup(c4d.DLG_OK | c4d.DLG_CANCEL)
        return True

    def InitValues(self):
        self.SetString(100, self.value)
        self.Activate(100)
        return True

    def Command(self, wid, bc):
        if wid == c4d.DLG_OK:
            self.value = self.GetString(100)
            self.ok = True
            self.Close()
        elif wid == c4d.DLG_CANCEL:
            self.Close()
        return True


class IDManagerDialog(gui.GeDialog):
    def __init__(self):
        super().__init__()
        self.mode = 0
        self.grouped = True
        self.search = ""
        self.sel = set()
        self.opened = {}
        self.top = []
        self.sig = None
        self.cache = None
        self.sort = (C_NAME, 1)
        self.funcs = TreeFuncs(self)
        self.tree = None
        self.num = 1
        self.labels = {}
        self.sugg = {}
        self.used = set()
        self.preview = False
        self.preview_doc = None
        self.psrc = 0
        self.aovs = []
        self.index = {}
        self.pushed = set()
        self.last_scene = None
        self.toggles = set()
        self.tabs = {}
        self.takeinfo = ("Main", set(), set())
        self.matte_doc = None
        self.matte_snap = None
        self.cm = {}
        self.warn_text = ""
        self.last_click = {}

    # layout
    def CreateLayout(self):
        self.SetTitle("RS ID Manager")
        self.GroupBegin(0, c4d.BFH_SCALEFIT, 0, 1)
        self.GroupBorderSpace(6, 6, 6, 2)
        self.AddComboBox(ID_MODE, c4d.BFH_LEFT, 120, 0)
        self.AddChild(ID_MODE, 0, "Object IDs")
        self.AddChild(ID_MODE, 1, "Material IDs")
        self.AddStaticText(0, c4d.BFH_LEFT, 0, 0, "  Search:", 0)
        self.AddEditText(ID_SEARCH, c4d.BFH_LEFT, 160, 0)
        self.AddStaticText(0, c4d.BFH_LEFT, 0, 0, "  Group:", 0)
        self.AddComboBox(ID_GROUP, c4d.BFH_LEFT, 90, 0)
        self.AddChild(ID_GROUP, 1, "By ID")
        self.AddChild(ID_GROUP, 0, "None")
        self.AddStaticText(ID_COUNT, c4d.BFH_SCALEFIT, 0, 0, "", 0)
        self.AddCheckbox(ID_PREVIEW, c4d.BFH_RIGHT, 0, 0, "Viewport Preview")
        self.AddComboBox(ID_PSRC, c4d.BFH_RIGHT, 150, 0)
        self.AddChild(ID_PSRC, 0, "All IDs")
        self.AddButton(ID_REFRESH, c4d.BFH_RIGHT, 0, 0, "Refresh")
        self.GroupEnd()

        self.GroupBegin(0, c4d.BFH_SCALEFIT, 0, 1)
        self.GroupBorderSpace(6, 2, 6, 4)
        self.AddStaticText(0, c4d.BFH_LEFT, 0, 0, "Assign ID:", 0)
        self.AddEditNumberArrows(ID_NUM, c4d.BFH_LEFT, 70, 0)
        self.AddButton(ID_ASSIGN, c4d.BFH_LEFT, 0, 0, "Assign to Selected")
        self.AddStaticText(0, c4d.BFH_LEFT, 16, 0, "", 0)
        self.add_tab(ID_BTN_OBJ, "Objects")
        self.add_tab(ID_BTN_TAG, "Tags")
        self.add_tab(ID_BTN_MAT, "Materials")
        self.GroupEnd()

        bc = c4d.BaseContainer()
        bc[c4d.TREEVIEW_BORDER] = c4d.BORDER_THIN_IN
        bc[c4d.TREEVIEW_HAS_HEADER] = True
        bc[c4d.TREEVIEW_RESIZE_HEADER] = True
        bc[c4d.TREEVIEW_MOVE_COLUMN] = False
        bc[c4d.TREEVIEW_FIXED_LAYOUT] = True
        bc[c4d.TREEVIEW_ALTERNATE_BG] = True
        bc[c4d.TREEVIEW_CURSORKEYS] = True
        bc[c4d.TREEVIEW_NOENTERRENAME] = True
        self.tree = self.AddCustomGui(ID_TREE, c4d.CUSTOMGUI_TREEVIEW, "",
                                      c4d.BFH_SCALEFIT | c4d.BFV_SCALEFIT, 400, 300, bc)

        self.GroupBegin(0, c4d.BFH_SCALEFIT, 1, 0)
        self.GroupBorderSpace(6, 2, 6, 6)
        self.AddStaticText(ID_STATUS, c4d.BFH_SCALEFIT, 0, 0, "", 0)
        self.GroupEnd()
        return True

    def InitValues(self):
        self.SetInt32(ID_MODE, self.mode)
        self.SetInt32(ID_GROUP, 1 if self.grouped else 0)
        self.SetInt32(ID_NUM, self.num, 0, MAXV)
        self.SetBool(ID_PREVIEW, self.preview)
        if not self.preview and restore_preview(c4d.documents.GetActiveDocument()):
            c4d.EventAdd()
        self.apply_layout()
        self.tree.SetRoot(self, self.funcs, None)
        self.Rebuild(True)
        return True

    def apply_layout(self):
        cols = [(C_NAME, c4d.LV_TREE, "Name"), (C_ID, c4d.LV_USER, "ID"), (C_LABEL, c4d.LV_USER, "Label"),
                (C_SW, c4d.LV_USER, ""), (C_MATTE, c4d.LV_USER, "Puzzle Matte")]
        if self.mode == 0:
            cols += [(C_OVR, c4d.LV_CHECKBOX, "On"), (C_TAKE, c4d.LV_USER, "Take"), (C_INFO, c4d.LV_USER, "Path")]
        else:
            cols += [(C_INFO, c4d.LV_USER, "Used By")]
        bc = c4d.BaseContainer()
        for c, t, _ in cols:
            bc.SetInt32(c, t)
        self.tree.SetLayout(len(cols), bc)
        for c, _, h in cols:
            self.tree.SetHeaderText(c, h)

    # data
    def request_rebuild(self):
        self.SetTimer(30)

    def Timer(self, msg):
        self.SetTimer(0)
        self.Rebuild(True)

    def Rebuild(self, force=False):
        doc = c4d.documents.GetActiveDocument()
        self.auto_sync_mattes(doc)
        objs, off = scan_objects(doc)
        mats, skipped = scan_materials(doc)
        cov, has_rs = scan_coverage(doc)
        usage = material_usage(doc) if self.mode == 1 else {}
        labels = get_labels(doc, self.mode)
        sugg = matte_suggestions(doc)[MODE_OBJ if self.mode == 0 else MODE_MAT]
        self.aovs = puzzle_aovs(doc, MODE_OBJ if self.mode == 0 else MODE_MAT)
        self.takeinfo = take_info(doc)
        sig = (self.mode, str(doc.GetDocumentPath()), doc.GetDocumentName(),
               sorted((k, [o.GetName() + str(o.GetGUID()) + obj_path(o) for o, t in v]) for k, v in objs.items()),
               [o.GetName() + str(o.GetGUID()) for o, t in off],
               sorted((k, [m.GetName() for m in v]) for k, v in mats.items()),
               repr(sorted((m, sorted(d.items())) for m, d in cov.items())), len(skipped),
               sorted(usage.values()), sorted(labels.items()), sorted(sugg.items()),
               self.preview, (len(walk_objects(doc)) if self.preview else 0), self.psrc, repr(self.aovs),
               self.takeinfo[0], sorted(self.takeinfo[1]), sorted(self.takeinfo[2]))
        if not force and sig == self.sig:
            return
        self.sig = sig
        self.cache = (objs, off, mats, skipped, cov, has_rs, usage, labels, sugg)
        self.populate()
        if self.preview:
            if self.preview_doc is not None and self.preview_doc.IsAlive() and self.preview_doc != doc:
                restore_preview(self.preview_doc)
            self.preview_doc = doc
            apply_preview(doc, self.preview_colors(doc))
            c4d.EventAdd()
            self.preview_status()

    def pcolor(self, v):
        if self.psrc <= 0 or self.psrc > len(self.aovs):
            hits = self.cm.get(v) if v else None
            return PURE[hits[0][1]] if hits else (UNMATTED if v else PREVIEW_NONE)
        for ch, x in enumerate(self.aovs[self.psrc - 1][1]):
            if v and x == v:
                return PURE[ch]
        return BLACK

    @guard(None)
    def auto_sync_mattes(self, doc):
        key = (str(doc.GetDocumentPath()), doc.GetDocumentName())
        snap = matte_snapshot(doc)
        prev = self.matte_snap if self.matte_doc == key else None
        self.matte_doc, self.matte_snap = key, snap
        if prev is None:
            return
        changed = set(i for i, s in snap.items() if prev.get(i) != s)
        if not changed:
            return
        n = sync_mattes_doc(doc, changed)
        if n:
            self.SetString(ID_STATUS, "Synced %d Puzzle Matte name%s from labels" % (n, "" if n == 1 else "s"))

    def preview_colors(self, doc):
        items = self.items_of(self.selected_rows()) if self.sel else []
        if self.mode == 0:
            focus = set(str(r.obj.GetGUID()) for r in items if r.obj is not None and r.obj.IsAlive())
            res = []
            for op, v, owner in effective_object_ids(doc):
                if owner is None or str(owner.GetGUID()) not in focus:
                    res.append((op, PREVIEW_DIM))
                else:
                    res.append((op, self.pcolor(v)))
            return res
        idmap = {}
        for idv, ms in self.cache[2].items():
            for m in ms:
                idmap[mat_key(m)] = idv
        focus = set(mat_key(r.mat) for r in items if r.mat is not None and r.mat.IsAlive())
        res = []
        for op, m in effective_materials(doc):
            k = mat_key(m) if m is not None else None
            if k is None or k not in focus:
                res.append((op, PREVIEW_DIM))
            else:
                res.append((op, self.pcolor(idmap.get(k) if k is not None else None)))
        return res

    def preview_status(self):
        if self.preview and not self.sel:
            self.SetDefaultColor(ID_STATUS, c4d.COLOR_TEXT, WARN_ORANGE)
            self.SetString(ID_STATUS, "Viewport Preview is on: select rows in the table to show their IDs")
        else:
            self.SetDefaultColor(ID_STATUS, c4d.COLOR_TEXT, c4d.gui.GetGuiWorldColor(c4d.COLOR_TEXT))
            self.SetString(ID_STATUS, self.warn_text)

    def refresh_preview(self):
        if self.preview:
            doc = c4d.documents.GetActiveDocument()
            apply_preview(doc, self.preview_colors(doc))
            c4d.EventAdd()
            self.preview_status()

    def coverage(self, cm, i):
        if i == 0:
            return COL_ZERO, "default (not matted)"
        hits = cm.get(i)
        if not hits:
            return COL_NONE, "none"
        return CHAN_COL[hits[0][1]], ", ".join("%s.%s" % (n, CHAN[c]) for n, c in hits)

    def sort_rows(self, rows):
        col, direc = self.sort
        keyf = {
            C_NAME: lambda r: r.name.lower(),
            C_ID: lambda r: ((r.idv if r.on else -1), r.name.lower()),
            C_MATTE: lambda r: (r.matte.lower(), r.name.lower()),
            C_INFO: lambda r: (r.info.lower(), r.name.lower()),
            C_LABEL: lambda r: (r.label.lower(), r.name.lower()),
        }.get(col, lambda r: r.name.lower())
        rows.sort(key=keyf, reverse=(direc < 0))
        return rows

    def populate(self):
        if self.cache is None:
            return
        objs, off, mats, skipped, cov, has_rs, usage, self.labels, self.sugg = self.cache
        s = self.search.lower().strip()
        items_by_id = {}
        if self.mode == 0:
            cm = cov.get(MODE_OBJ, {})
            groups = list(objs.items()) + ([(None, off)] if off else [])
            for idv, pairs in groups:
                for o, t in pairs:
                    path = obj_path(o)
                    if s and s not in o.GetName().lower() and s not in path.lower() and s not in self.label_for(idv)[0].lower():
                        continue
                    r = Row("item", ("o", str(o.GetGUID()), o.GetTags().index(t)), o.GetName())
                    r.obj, r.tag = o, t
                    r.on = idv is not None
                    r.idv = idv if idv is not None else as_int(t[c4d.REDSHIFT_OBJECT_OBJECTID_ID])
                    r.idtext = str(r.idv) if r.on else "off"
                    r.col, r.matte = self.coverage(cm, r.idv) if r.on else (COL_ZERO, "override off")
                    if self.preview and r.on:
                        r.col = self.pcolor(r.idv)
                    r.info = path
                    r.label, r.label_auto = self.label_for(idv)
                    r.take = "override" if r.key in self.takeinfo[1] else ("varies" if r.key in self.takeinfo[2] else "")
                    items_by_id.setdefault(idv, []).append(r)
            used = set(objs.keys())
            noun = "object"
        else:
            cm = cov.get(MODE_MAT, {})
            for idv, ms in mats.items():
                for m in ms:
                    if s and s not in m.GetName().lower() and s not in self.label_for(idv)[0].lower():
                        continue
                    r = Row("item", ("m", mat_key(m)), m.GetName())
                    r.mat, r.idv = m, idv
                    r.idtext = str(idv)
                    r.col, r.matte = self.coverage(cm, idv)
                    if self.preview:
                        r.col = self.pcolor(idv)
                    n = usage.get(mat_key(m), 0)
                    r.info = "%d object%s" % (n, "" if n == 1 else "s") if n else "unused"
                    r.label, r.label_auto = self.label_for(idv)
                    items_by_id.setdefault(idv, []).append(r)
            used = set(mats.keys())
            noun = "material"

        self.cm = cm
        top = []
        if self.grouped:
            order = sorted(k for k in items_by_id if k is not None)
            if self.sort[0] == C_ID and self.sort[1] < 0:
                order.reverse()
            if None in items_by_id:
                order.append(None)
            for idv in order:
                kids = self.sort_rows(items_by_id[idv])
                if idv is None:
                    g = Row("group", ("g", self.mode, "off"), "Override off")
                    g.on, g.col, g.matte = False, COL_ZERO, "override off"
                else:
                    g = Row("group", ("g", self.mode, idv), "ID %d" % idv)
                    g.idv, g.idtext = idv, str(idv)
                    g.col, g.matte = self.coverage(cm, idv)
                    if self.preview:
                        g.col = self.pcolor(idv)
                    g.label, g.label_auto = self.label_for(idv)
                g.info = "%d %s%s" % (len(kids), noun, "" if len(kids) == 1 else "s")
                g.children = kids
                tk = set(c.take for c in kids)
                g.take = "override" if "override" in tk else ("varies" if "varies" in tk else "")
                top.append(g)
        else:
            flat = []
            for v in items_by_id.values():
                flat.extend(v)
            top = self.sort_rows(flat)

        uid = [1]

        def link(rows):
            for i, r in enumerate(rows):
                r.sibs, r.i, r.uid = rows, i, uid[0]
                uid[0] += 1
                link(r.children)
        link(top)
        self.top = top
        self.index = {}
        for g in top:
            for r in (g.children if g.kind == "group" else [g]):
                self.index.setdefault(self.lookup(r), []).append(r.key)

        # live keys only
        alive = set()
        for g in top:
            alive.add(g.key)
            for c in g.children:
                alive.add(c.key)
        self.sel &= alive

        self.used = used
        self.uncovered = sorted(i for i in used if i > 0 and i not in cm)
        n_items = sum(len(v) for k, v in items_by_id.items())
        self.SetString(ID_COUNT, "   %d %ss  |  %d IDs  |  Take: %s" % (n_items, noun, len([k for k in used]), self.takeinfo[0]))
        self.warn_text = self.warnings(used, cm, has_rs, skipped)
        self.preview_status()
        if self.psrc > len(self.aovs):
            self.psrc = 0
        self.FreeChildren(ID_PSRC)
        self.AddChild(ID_PSRC, 0, "All IDs")
        for k, (nm, ids) in enumerate(self.aovs):
            self.AddChild(ID_PSRC, k + 1, nm)
        self.SetInt32(ID_PSRC, self.psrc)
        self.update_buttons()
        self.tree.Refresh()

    def warnings(self, used, cm, has_rs, skipped):
        if not has_rs:
            return "Redshift isn't the active renderer, so Puzzle Matte checks are off."
        w = []
        if self.uncovered:
            w.append("Not in any Puzzle Matte: " + ", ".join(map(str, self.uncovered)))
        stale = sorted(i for i in cm if i not in used)
        if stale:
            w.append("Matte channels with nothing assigned: " + ", ".join(
                "%d (%s)" % (i, ", ".join("%s.%s" % (n, CHAN[c]) for n, c in cm[i])) for i in stale))
        dup = sorted(i for i in cm if len(cm[i]) > 1)
        if dup:
            w.append("In more than one matte: " + ", ".join(map(str, dup)))
        if self.mode == 1 and skipped:
            w.append("%d non-Redshift materials not shown" % len(skipped))
        return "   |   ".join(w) if w else "All IDs covered by Puzzle Mattes."

    # helpers
    def items_of(self, rows):
        out, seen = [], set()
        for r in rows:
            for x in (r.children if r.kind == "group" else [r]):
                if x.key not in seen:
                    seen.add(x.key)
                    out.append(x)
        return out

    def selected_rows(self):
        res = []
        for g in self.top:
            if g.key in self.sel:
                res.append(g)
            for c in g.children:
                if c.key in self.sel:
                    res.append(c)
        return res

    def targets(self, obj):
        if obj is not None and obj.key in self.sel:
            return self.items_of(self.selected_rows())
        return self.items_of([obj]) if obj is not None else []

    def add_tab(self, gid, text):
        bc = c4d.BaseContainer()
        bc.SetBool(c4d.QUICKTAB_BAR, False)
        bc.SetBool(c4d.QUICKTAB_SHOWSINGLE, True)
        bc.SetBool(c4d.QUICKTAB_NOMULTISELECT, True)
        qt = self.AddCustomGui(gid, c4d.CUSTOMGUI_QUICKTAB, "", c4d.BFH_LEFT, 0, 0, bc)
        if qt is not None:
            qt.AppendString(0, text, False)
            self.tabs[gid] = qt

    def allowed_targets(self):
        return ("objects", "tags") if self.mode == 0 else ("materials", "objects")

    def default_targets(self):
        return {"objects"} if self.mode == 0 else {"materials"}

    @guard(None)
    def update_buttons(self):
        has = bool(self.items_of(self.selected_rows()))
        if not has:
            self.toggles = set()
        allowed = self.allowed_targets()
        for name, gid in TARGET_BTNS:
            self.Enable(gid, has and name in allowed)
            qt = self.tabs.get(gid)
            if qt is not None:
                qt.Select(0, bool(has and name in self.toggles))
                qt.DoLayoutChange()

    def lookup(self, r):
        return str(r.obj.GetGUID()) if self.mode == 0 else mat_key(r.mat)

    @guard(None)
    def sync_from_scene(self):
        doc = c4d.documents.GetActiveDocument()
        has_sel = bool(self.sel)
        if self.mode == 0:
            act_objs = set(str(o.GetGUID()) for o in doc.GetActiveObjects(c4d.GETACTIVEOBJECTFLAGS_NONE))
            act_tags = set(str(tg.GetObject().GetGUID()) for tg in doc.GetActiveTags() if tg.GetType() == RS_TAG)
            act = act_objs | act_tags
        else:
            act_objs, act_tags = set(), set()
            act = set(mat_key(m) for m in doc.GetActiveMaterials())
        if act == self.last_scene:
            return
        self.last_scene = act
        if act == self.pushed:
            return
        if has_sel and not self.toggles:
            return
        if self.mode == 1 and has_sel and "materials" not in self.toggles:
            return
        self.pushed = set()
        keys = set()
        for lk in act:
            keys.update(self.index.get(lk, []))
        self.sel = keys
        if self.mode == 0:
            self.toggles = set()
            if act_objs:
                self.toggles.add("objects")
            if act_tags:
                self.toggles.add("tags")
        else:
            self.toggles = {"materials"} if act else set()
        first = None
        for g in self.top:
            if g.key in keys and first is None:
                first = g
            for c in g.children:
                if c.key in keys:
                    self.opened[g.key] = True
                    if first is None:
                        first = c
        self.tree.Refresh()
        self.update_buttons()
        self.refresh_preview()
        if first is not None:
            try:
                self.tree.MakeVisible(first)
            except Exception:
                pass

    def push_selection(self, from_toggle=False):
        items = self.items_of(self.selected_rows())
        if not items:
            apply_scene_selection(c4d.documents.GetActiveDocument(), [], [], [], self.mode == 1)
            self.pushed = set()
            self.last_scene = None
            self.update_buttons()
            self.refresh_preview()
            return
        if not from_toggle and not self.toggles:
            self.toggles = set(self.default_targets())
        doc = c4d.documents.GetActiveDocument()
        on = self.toggles
        if self.mode == 0:
            objs = [r.obj for r in items] if "objects" in on else []
            tags = [r.tag for r in items] if "tags" in on else []
            apply_scene_selection(doc, objs, tags, [], False)
        else:
            all_mats = [r.mat for r in items]
            objs = objects_using(doc, all_mats) if "objects" in on else []
            mats = all_mats if "materials" in on else []
            apply_scene_selection(doc, objs, [], mats, True)
        self.pushed = set(self.lookup(r) for r in items)
        self.update_buttons()
        self.refresh_preview()

    def apply_id(self, rows, val):
        doc = c4d.documents.GetActiveDocument()
        c4d.StopAllThreads()
        if self.mode == 0:
            n = set_tag_ids(doc, [r.tag for r in rows], val)
            self.SetString(ID_STATUS, "Set %d objects to Object ID %d" % (n, val))
        else:
            n = set_material_ids(doc, [r.mat for r in rows], val)
            self.SetString(ID_STATUS, "Set %d materials to Material ID %d" % (n, val))
        self.request_rebuild()

    def prompt_id(self, obj):
        rows = self.targets(obj)
        if not rows:
            return
        preset = str(obj.idv) if obj.idv is not None else str(next_free(self.used))
        res = gui.InputDialog("New ID for %d item%s" % (len(rows), "" if len(rows) == 1 else "s"), preset)
        if not res:
            return
        try:
            val = int(str(res).strip())
        except ValueError:
            return
        if 0 <= val <= MAXV:
            self.apply_id(rows, val)

    def label_for(self, idv):
        if idv is None:
            return "", False
        lab = self.labels.get(idv)
        if lab:
            return lab, False
        return "id%d" % idv, True

    def target_ids(self, obj):
        if obj is not None and obj.key in self.sel:
            rows = self.selected_rows()
        else:
            rows = [obj] if obj is not None else []
        return sorted(set(r.idv for r in rows if r.idv is not None and r.on))

    def drop_on(self, obj, atoms):
        if obj is None or obj.idv is None or not obj.on:
            return
        doc = c4d.documents.GetActiveDocument()
        c4d.StopAllThreads()
        if self.mode == 0:
            objs = [a for a in atoms if isinstance(a, c4d.BaseObject) and a.IsAlive()]
            n = assign_objects(doc, objs, obj.idv)
            self.SetString(ID_STATUS, "Moved %d objects to Object ID %d" % (n, obj.idv))
        else:
            mats = [a for a in atoms if isinstance(a, c4d.BaseMaterial) and a.IsAlive()]
            n = set_material_ids(doc, mats, obj.idv)
            self.SetString(ID_STATUS, "Moved %d materials to Material ID %d" % (n, obj.idv))
        self.request_rebuild()

    def scope_ids(self):
        ids = sorted(set(r.idv for r in self.selected_rows() if r.idv is not None and r.on))
        return ids or sorted(i for i in self.used if i > 0)

    def sync_mattes(self, ids):
        doc = c4d.documents.GetActiveDocument()
        c4d.StopAllThreads()
        n = rename_mattes_from_labels(doc, MODE_OBJ if self.mode == 0 else MODE_MAT, set(ids), get_labels(doc, self.mode))
        if n:
            self.SetString(ID_STATUS, "Label updated, renamed %d Puzzle Matte%s" % (n, "" if n == 1 else "s"))

    def prompt_label(self, obj):
        ids = self.target_ids(obj)
        if not ids:
            return
        cur = self.labels.get(ids[0], "") if len(ids) == 1 else ""
        dlg = LabelDialog("Label for ID %s" % ", ".join(map(str, ids)), cur)
        dlg.Open(c4d.DLG_TYPE_MODAL, defaultw=340, defaulth=0)
        if not dlg.ok:
            return
        val = dlg.value.strip()
        set_labels(c4d.documents.GetActiveDocument(), self.mode, dict((i, val) for i in ids))
        self.sync_mattes(ids)
        self.request_rebuild()

    def context(self, obj, cmd):
        doc = c4d.documents.GetActiveDocument()
        rows = self.targets(obj)
        if cmd == CM_SETID:
            self.prompt_id(obj)
        elif cmd == CM_SELOBJ:
            if self.mode == 0:
                select_objects(doc, [r.obj for r in rows])
            else:
                select_materials(doc, [r.mat for r in rows])
        elif cmd == CM_SELTAG:
            select_tags(doc, [r.tag for r in rows])
        elif cmd == CM_SELUSING:
            select_objects(doc, objects_using(doc, [r.mat for r in rows]))
        elif cmd in (CM_OVR_ON, CM_OVR_OFF):
            set_tag_override(doc, [r.tag for r in rows], cmd == CM_OVR_ON)
            self.request_rebuild()
        elif cmd == CM_LABEL:
            self.prompt_label(obj)
        elif cmd == CM_LABEL_CLR:
            set_labels(doc, self.mode, dict((i, "") for i in self.target_ids(obj)))
            self.sync_mattes(self.target_ids(obj))
            self.request_rebuild()
        elif cmd == CM_LABEL_FROM_MATTE:
            m = dict((i, self.sugg[i]) for i in self.target_ids(obj) if i in self.sugg)
            if m:
                set_labels(doc, self.mode, m)
            self.SetString(ID_STATUS, "Pulled %d names from Puzzle Mattes" % len(m))
            self.request_rebuild()
        elif cmd == CM_MATTE_FROM_LABEL:
            c4d.StopAllThreads()
            n = rename_mattes_from_labels(doc, MODE_OBJ if self.mode == 0 else MODE_MAT, set(self.target_ids(obj)), self.labels)
            self.SetString(ID_STATUS, "Pushed names to %d Puzzle Mattes" % n if n else "No Puzzle Matte covers those IDs")
            self.request_rebuild()
        elif cmd in (CM_FOLD, CM_UNFOLD):
            for g in self.top:
                if g.kind == "group":
                    self.opened[g.key] = (cmd == CM_UNFOLD)
            self.tree.Refresh()
        else:
            return False
        return True

    # events
    def Command(self, wid, bc):
        doc = c4d.documents.GetActiveDocument()
        if wid == ID_MODE:
            self.mode = self.GetInt32(ID_MODE)
            self.sel = set()
            self.toggles = set()
            self.pushed = set()
            self.last_scene = None
            apply_scene_selection(doc, [], [], [], True)
            self.apply_layout()
            self.Rebuild(True)
        elif wid == ID_GROUP:
            self.grouped = self.GetInt32(ID_GROUP) == 1
            self.populate()
        elif wid == ID_SEARCH:
            self.search = self.GetString(ID_SEARCH)
            self.populate()
        elif wid == ID_PREVIEW:
            self.preview = self.GetBool(ID_PREVIEW)
            if not self.preview:
                target = self.preview_doc if (self.preview_doc is not None and self.preview_doc.IsAlive()) else doc
                restore_preview(target)
                self.preview_doc = None
                c4d.EventAdd()
            self.Rebuild(True)
        elif wid in (ID_BTN_OBJ, ID_BTN_TAG, ID_BTN_MAT):
            name = dict((g, n) for n, g in TARGET_BTNS)[wid]
            now = time.time()
            if now - self.last_click.get(wid, 0) > 0.3:
                self.last_click[wid] = now
                if name in self.allowed_targets() and self.items_of(self.selected_rows()):
                    self.toggles ^= {name}
                    self.push_selection(from_toggle=True)
            self.update_buttons()
        elif wid == ID_PSRC:
            self.psrc = self.GetInt32(ID_PSRC)
            self.Rebuild(True)
        elif wid == ID_PULL:
            ids = self.scope_ids()
            m = dict((i, self.sugg[i]) for i in ids if i in self.sugg)
            if m:
                set_labels(doc, self.mode, m)
            self.SetString(ID_STATUS, "Pulled %d names from Puzzle Mattes" % len(m) if m else "No Puzzle Matte names to pull")
            self.request_rebuild()
        elif wid == ID_REFRESH:
            c4d.StopAllThreads()
            n = sync_mattes_doc(doc)
            if n:
                self.SetString(ID_STATUS, "Synced %d Puzzle Matte name%s from labels" % (n, "" if n == 1 else "s"))
            self.Rebuild(True)
        elif wid == ID_ASSIGN:
            c4d.StopAllThreads()
            val = self.GetInt32(ID_NUM)
            if self.mode == 0:
                n = assign_objects(doc, doc.GetActiveObjects(c4d.GETACTIVEOBJECTFLAGS_NONE), val)
                msg = "Assigned Object ID %d to %d objects" % (val, n) if n else "Select objects first"
            else:
                n = set_material_ids(doc, doc.GetActiveMaterials(), val)
                msg = "Assigned Material ID %d to %d materials" % (val, n) if n else "Select Redshift materials first"
            self.SetString(ID_STATUS, msg)
            self.request_rebuild()
        return True

    def DestroyWindow(self):
        if self.preview:
            target = self.preview_doc if (self.preview_doc is not None and self.preview_doc.IsAlive()) else c4d.documents.GetActiveDocument()
            restore_preview(target)
            self.preview = False
            self.preview_doc = None
            c4d.EventAdd()

    def CoreMessage(self, mid, bc):
        if mid == c4d.EVMSG_CHANGE and self.IsOpen():
            self.Rebuild(False)
            self.sync_from_scene()
        return gui.GeDialog.CoreMessage(self, mid, bc)


class IDManagerCommand(plugins.CommandData):
    dlg = None

    def Execute(self, doc):
        if self.dlg is None:
            self.dlg = IDManagerDialog()
        return self.dlg.Open(c4d.DLG_TYPE_ASYNC, PLUGIN_ID, defaultw=900, defaulth=520)

    def RestoreLayout(self, sec_ref):
        if self.dlg is None:
            self.dlg = IDManagerDialog()
        return self.dlg.Restore(PLUGIN_ID, secret=sec_ref)


def load_icon():
    """
    CommandData icons are NOT auto-discovered by filename the way
    ObjectData/TagData description icons are. We have to load the bitmap
    ourselves and hand it to RegisterCommandPlugin.

    Expects the plugin to live in its own folder, e.g.:
      plugins/RSIDManager/RSIDManager.pyp
      plugins/RSIDManager/res/RSIDManager.tif
    """
    path = os.path.join(os.path.dirname(__file__), "res", "RSIDManager.tif")
    if not os.path.exists(path):
        print(f"[RSIDManager] Icon not found at: {path}")
        return None
    bmp = c4d.bitmaps.BaseBitmap()
    result = bmp.InitWith(path)[0]
    if result == c4d.IMAGERESULT_OK:
        return bmp
    print(f"[RSIDManager] Icon failed to load (InitWith result: {result}): {path}")
    return None


if __name__ == "__main__":
    plugins.RegisterCommandPlugin(PLUGIN_ID, "RS ID Manager", 0, load_icon(),
                                  "Table of Redshift Object IDs and Material IDs", IDManagerCommand())
