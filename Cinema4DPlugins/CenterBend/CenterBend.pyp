"""
Center Bend deformer for Cinema 4D 2026.

Wraps geometry around a cylinder from a center point outward: a flat
zone stays undeformed at the front, both ends curve back symmetrically.
Bend length runs along the deformer's local X, the cylinder axis is
local Y, ends curve toward local +Z (away from a default camera).
No rotation is needed for text built in the XY plane.

Auto Fit measures the incoming geometry in the deformer's own frame
every cook, so it fits correctly at any orientation. Fit to Parent
bakes that measurement into Size and moves the deformer to center it.
"""

import c4d
import math
import os
from c4d import plugins

PLUGIN_ID = 1067345

CB_AUTOFIT = 1000
CB_FIT = 1001
CB_SIZE = 1002
CB_ANGLE = 1003
CB_CENTER = 1004
CB_FLAT = 1005
CB_BLEND = 1006
CB_MODE = 1007
CB_YSHIFT = 1008
CB_YMODE = 1009

YMODE_SAME = 0
YMODE_OPPOSITE = 1

MODE_LIMITED = 0
MODE_UNLIMITED = 1

SAMPLES = 512  # integration steps per side


def _weight(s, h, b):
    a = abs(s)
    if a <= h:
        return 0.0
    if b <= 1e-12 or a >= h + b:
        return 1.0
    t = (a - h) / b
    return t * t * (3.0 - 2.0 * t)


class BendCurve(object):
    """Centerline of the bend as a function of s (distance from the
    front center along the undeformed length axis)."""

    def __init__(self, xmin, xmax, angle, center, flat, blend, mode, yshift=0.0, ymode=0):
        self.valid = False
        self.yshift = yshift
        self.ymode = ymode
        L = xmax - xmin
        if L <= 1e-9 or abs(angle) <= 1e-9:
            return
        self.mode = mode
        self.cx = (xmin + xmax) * 0.5 + center * L
        self.cx = min(max(self.cx, xmin), xmax)
        self.smin = xmin - self.cx
        self.smax = xmax - self.cx
        h = flat * L * 0.5
        b = blend * L

        # total weighted (curving) length so the full wrap equals angle
        W = 0.0
        sides = []
        for send in (self.smax, self.smin):
            n = SAMPLES
            ds = send / n if n else 0.0
            ws = [_weight((i + 0.5) * ds, h, b) for i in range(n)]
            W += sum(ws) * abs(ds)
            sides.append((send, ds, ws))
        if W <= 1e-9:
            return
        self.k0 = angle / W

        self.tables = []
        for send, ds, ws in sides:
            th = [0.0]; X = [0.0]; Z = [0.0]
            t = x = z = 0.0
            for w in ws:
                t1 = t + self.k0 * w * ds
                tm = (t + t1) * 0.5
                x += math.cos(tm) * ds
                z += math.sin(tm) * ds
                t = t1
                th.append(t); X.append(x); Z.append(z)
            self.tables.append((send, ds, th, X, Z))
        self.valid = True

    def eval(self, s):
        """Returns (X, Z, theta) of the centerline at s, relative to cx."""
        send, ds, th, X, Z = self.tables[0] if s >= 0.0 else self.tables[1]
        if ds == 0.0:
            return s, 0.0, 0.0
        f = s / ds
        n = len(th) - 1
        if f >= n:
            te, xe, ze = th[n], X[n], Z[n]
            d = s - send
            if self.mode == MODE_UNLIMITED:
                t = te + self.k0 * d
                return (xe + (math.sin(t) - math.sin(te)) / self.k0,
                        ze + (math.cos(te) - math.cos(t)) / self.k0, t)
            return xe + math.cos(te) * d, ze + math.sin(te) * d, te
        i = int(f)
        u = f - i
        return (X[i] + (X[i + 1] - X[i]) * u,
                Z[i] + (Z[i + 1] - Z[i]) * u,
                th[i] + (th[i + 1] - th[i]) * u)

    def map(self, p):
        s = p.x - self.cx
        X, Z, t = self.eval(s)
        st, ct = math.sin(t), math.cos(t)
        y = p.y
        if self.yshift != 0.0:
            # Y shift follows the wrap progress on each side: zero in the
            # flat zone, full value where that side reaches its end angle.
            te = self.tables[0 if s >= 0.0 else 1][2][-1]
            frac = t / te if abs(te) > 1e-12 else 0.0
            if self.ymode == YMODE_OPPOSITE:
                # helix: linear climb, already smooth through the center
                if s < 0.0:
                    frac = -frac
            else:
                # same direction: ease in like the wrap itself does,
                # zero slope at the front so there is no pinch
                frac = frac * frac
            y += self.yshift * frac
        return c4d.Vector(self.cx + X - p.z * st, y, Z + p.z * ct)


class CenterBendData(plugins.ObjectData):

    def __init__(self):
        self._ext = None   # last measured input extents (deformer space)

    def Init(self, node, isCloneInit=False):
        if not isCloneInit:
            self.InitAttr(node, bool, CB_AUTOFIT)
            self.InitAttr(node, c4d.Vector, CB_SIZE)
            self.InitAttr(node, float, CB_ANGLE)
            self.InitAttr(node, float, CB_CENTER)
            self.InitAttr(node, float, CB_FLAT)
            self.InitAttr(node, float, CB_BLEND)
            self.InitAttr(node, int, CB_MODE)
            self.InitAttr(node, float, CB_YSHIFT)
            self.InitAttr(node, int, CB_YMODE)
            node[CB_AUTOFIT] = True
            node[CB_SIZE] = c4d.Vector(200.0, 50.0, 50.0)
            node[CB_ANGLE] = math.radians(180.0)
            node[CB_CENTER] = 0.0
            node[CB_FLAT] = 0.0
            node[CB_BLEND] = 0.0
            node[CB_MODE] = MODE_LIMITED
            node[CB_YSHIFT] = 0.0
            node[CB_YMODE] = YMODE_SAME
        return True

    # ---------------------------------------------------------- description
    def GetDDescription(self, node, description, flags):
        if not description.LoadDescription(c4d.Obase):
            return False
        single = description.GetSingleDescID()
        grp = c4d.DescID(c4d.ID_OBJECTPROPERTIES)

        def add(pid, dtype, name, setup=None):
            did = c4d.DescID(c4d.DescLevel(pid, dtype, 0))
            if single is None or did.IsPartOf(single)[0]:
                bc = c4d.GetCustomDataTypeDefault(dtype)
                bc[c4d.DESC_NAME] = name
                bc[c4d.DESC_SHORT_NAME] = name
                if setup:
                    setup(bc)
                description.SetParameter(did, bc, grp)

        def btn(bc):
            bc[c4d.DESC_CUSTOMGUI] = c4d.CUSTOMGUI_BUTTON

        def size(bc):
            bc[c4d.DESC_UNIT] = c4d.DESC_UNIT_METER
            bc[c4d.DESC_MIN] = c4d.Vector(0.0)

        def mode(bc):
            bc[c4d.DESC_CUSTOMGUI] = c4d.CUSTOMGUI_CYCLE
            cyc = c4d.BaseContainer()
            cyc.SetString(MODE_LIMITED, "Limited")
            cyc.SetString(MODE_UNLIMITED, "Unlimited")
            bc[c4d.DESC_CYCLE] = cyc

        def ymode(bc):
            bc[c4d.DESC_CUSTOMGUI] = c4d.CUSTOMGUI_CYCLE
            cyc = c4d.BaseContainer()
            cyc.SetString(YMODE_SAME, "Both Ends Same")
            cyc.SetString(YMODE_OPPOSITE, "Opposite (Spiral)")
            bc[c4d.DESC_CYCLE] = cyc

        def meters(bc):
            bc[c4d.DESC_UNIT] = c4d.DESC_UNIT_METER
            bc[c4d.DESC_STEP] = 0.1

        def angle(bc):
            bc[c4d.DESC_UNIT] = c4d.DESC_UNIT_DEGREE
            bc[c4d.DESC_CUSTOMGUI] = c4d.CUSTOMGUI_REALSLIDER
            bc[c4d.DESC_MIN] = math.radians(-360.0)
            bc[c4d.DESC_MAX] = math.radians(360.0)
            bc[c4d.DESC_MINSLIDER] = 0.0
            bc[c4d.DESC_MAXSLIDER] = math.radians(360.0)
            bc[c4d.DESC_STEP] = math.radians(1.0)

        def pct(lo, hi):
            def f(bc):
                bc[c4d.DESC_UNIT] = c4d.DESC_UNIT_PERCENT
                bc[c4d.DESC_CUSTOMGUI] = c4d.CUSTOMGUI_REALSLIDER
                bc[c4d.DESC_MIN] = lo
                bc[c4d.DESC_MAX] = hi
                bc[c4d.DESC_MINSLIDER] = lo
                bc[c4d.DESC_MAXSLIDER] = hi
                bc[c4d.DESC_STEP] = 0.01
            return f

        add(CB_AUTOFIT, c4d.DTYPE_BOOL, "Auto Fit")
        add(CB_FIT, c4d.DTYPE_BUTTON, "Fit to Parent", btn)
        add(CB_SIZE, c4d.DTYPE_VECTOR, "Size", size)
        add(CB_MODE, c4d.DTYPE_LONG, "Mode", mode)
        add(CB_ANGLE, c4d.DTYPE_REAL, "Angle", angle)
        add(CB_CENTER, c4d.DTYPE_REAL, "Center Offset", pct(-0.5, 0.5))
        add(CB_FLAT, c4d.DTYPE_REAL, "Flat Zone", pct(0.0, 1.0))
        add(CB_BLEND, c4d.DTYPE_REAL, "Falloff", pct(0.0, 1.0))
        add(CB_YSHIFT, c4d.DTYPE_REAL, "Y Offset", meters)
        add(CB_YMODE, c4d.DTYPE_LONG, "Y Direction", ymode)
        return (True, flags | c4d.DESCFLAGS_DESC_LOADED)

    def GetDEnabling(self, node, id, t_data, flags, itemdesc):
        if id[0].id == CB_SIZE:
            return not node[CB_AUTOFIT]
        return True

    # ---------------------------------------------------------- helpers
    def _range(self, op):
        """(xmin, xmax, ymin, ymax, zmin, zmax) in deformer space."""
        if op[CB_AUTOFIT] and self._ext is not None:
            return self._ext
        s = op[CB_SIZE] or c4d.Vector(200, 50, 50)
        return (-s.x * 0.5, s.x * 0.5, -s.y * 0.5, s.y * 0.5, -s.z * 0.5, s.z * 0.5)

    def _curve(self, op, xmin, xmax):
        return BendCurve(xmin, xmax, op[CB_ANGLE] or 0.0, op[CB_CENTER] or 0.0,
                         op[CB_FLAT] or 0.0, op[CB_BLEND] or 0.0,
                         op[CB_MODE] or 0,
                         op[CB_YSHIFT] or 0.0, op[CB_YMODE] or 0)

    # ---------------------------------------------------------- deform
    def ModifyObject(self, mod, doc, op, op_mg, mod_mg, lod, flags, thread):
        try:
            pts = op.GetAllPoints()
        except AttributeError:
            return True
        if not pts:
            return True

        toMod = ~mod_mg * op_mg
        toOp = ~toMod
        loc = [toMod * p for p in pts]

        xs = [p.x for p in loc]; ys = [p.y for p in loc]; zs = [p.z for p in loc]
        self._ext = (min(xs), max(xs), min(ys), max(ys), min(zs), max(zs))

        if mod[CB_AUTOFIT]:
            xmin, xmax = self._ext[0], self._ext[1]
        else:
            sx = (mod[CB_SIZE] or c4d.Vector(0)).x
            xmin, xmax = -sx * 0.5, sx * 0.5

        curve = self._curve(mod, xmin, xmax)
        if not curve.valid:
            return True

        op.SetAllPoints([toOp * curve.map(p) for p in loc])
        op.Message(c4d.MSG_UPDATE)
        return True

    # ---------------------------------------------------------- fit button
    def Message(self, node, type, data):
        if type == c4d.MSG_DESCRIPTION_COMMAND and data:
            try:
                pid = data["id"][0].id
            except Exception:
                pid = None
            if pid == CB_FIT:
                self._fit(node)
        return True

    def _fit(self, node):
        doc = node.GetDocument()
        if doc is None or self._ext is None:
            return
        xmin, xmax, ymin, ymax, zmin, zmax = self._ext
        ctr = c4d.Vector((xmin + xmax) * 0.5, (ymin + ymax) * 0.5, (zmin + zmax) * 0.5)
        size = c4d.Vector(max(xmax - xmin, 0.01), max(ymax - ymin, 0.01), max(zmax - zmin, 0.01))
        doc.StartUndo()
        doc.AddUndo(c4d.UNDOTYPE_CHANGE, node)
        mg = node.GetMg()
        mg.off = mg * ctr
        node.SetMg(mg)
        node[CB_SIZE] = size
        node[CB_AUTOFIT] = False
        doc.EndUndo()
        self._ext = (xmin - ctr.x, xmax - ctr.x, ymin - ctr.y, ymax - ctr.y, zmin - ctr.z, zmax - ctr.z)
        c4d.EventAdd()

    # ---------------------------------------------------------- viewport
    def Draw(self, op, drawpass, bd, bh):
        if drawpass != c4d.DRAWPASS_OBJECT:
            return c4d.DRAWRESULT_SKIP
        xmin, xmax, ymin, ymax, zmin, zmax = self._range(op)
        if not op[CB_AUTOFIT]:
            s = op[CB_SIZE] or c4d.Vector(0)
            xmin, xmax = -s.x * 0.5, s.x * 0.5
        curve = self._curve(op, xmin, xmax)
        bd.SetMatrix_Matrix(op, op.GetMg())

        def mp(x, y, z):
            p = c4d.Vector(x, y, z)
            return curve.map(p) if curve.valid else p

        n = 64
        col = c4d.Vector(0.55, 0.45, 1.0)
        bd.SetPen(col)
        for y in (ymin, ymax):
            for z in (zmin, zmax):
                prev = mp(xmin, y, z)
                for i in range(1, n + 1):
                    cur = mp(xmin + (xmax - xmin) * i / n, y, z)
                    bd.DrawLine(prev, cur, 0)
                    prev = cur
        for x in (xmin, xmax):
            corners = [mp(x, ymin, zmin), mp(x, ymax, zmin), mp(x, ymax, zmax), mp(x, ymin, zmax)]
            for i in range(4):
                bd.DrawLine(corners[i], corners[(i + 1) % 4], 0)

        # flat zone markers
        if curve.valid:
            L = xmax - xmin
            h = (op[CB_FLAT] or 0.0) * L * 0.5
            bd.SetPen(c4d.Vector(1.0, 0.6, 0.1))
            for x in (curve.cx - h, curve.cx + h):
                if xmin <= x <= xmax:
                    bd.DrawLine(mp(x, ymin, zmin), mp(x, ymax, zmin), 0)
            bd.DrawLine(mp(curve.cx, ymin, zmin), mp(curve.cx, ymax, zmin), 0)
        return c4d.DRAWRESULT_OK


def make_icon():
    bmp = c4d.bitmaps.BaseBitmap()
    if bmp.Init(64, 64) != c4d.IMAGERESULT_OK:
        return None
    for y in range(64):
        for x in range(64):
            bmp.SetPixel(x, y, 0, 0, 0)
    # symmetric arc: flat center, curling ends
    for i in range(-30, 31):
        t = i / 30.0
        a = max(0.0, abs(t) - 0.3) / 0.7
        yy = int(22 + 26 * a * a)
        for w in range(-2, 3):
            px, py = 32 + i, yy + w
            if 0 <= px < 64 and 0 <= py < 64:
                bmp.SetPixel(px, py, 160, 130, 255)
    return bmp


if __name__ == "__main__":
    plugins.RegisterObjectPlugin(
        id=PLUGIN_ID,
        str="Center Bend",
        g=CenterBendData,
        description="ocenterbend",
        icon=make_icon(),
        info=c4d.OBJECT_MODIFIER,
    )
