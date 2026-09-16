"""
EASE FFD — installed Python deformer plugin
======================================================================
Behaves exactly like Cinema's native FFD in terms of WHERE you place it
in the hierarchy: put it as the LAST child under a Null, alongside any
number of sibling objects (a tube, 30 animated objects moving through
it, whatever) -- it deforms all of them, combined, every frame,
including their own animation, exactly the way native FFD does.

The one thing it adds: an Ease slider that blends between a pure local
SHARP interpolation (follows the FFD cage exactly, corner for corner,
no smoothing) and the native FFD SMOOTH result (global Bernstein/
Bezier volume -- the same math stock FFD always uses, and the reason
stock FFD can't do sharp transitions no matter how dense the cage is).

    Ease = 0%    -> sharp, exactly follows the cage
    Ease = 100%  -> identical to native FFD
    0-100%       -> blend of the two
    >100%        -> allowed, extrapolates past native smoothness

SETUP
----------------------------------------------------------------------
1. Drop this whole "EaseFFD" folder into Cinema's plugins directory
   (Edit > Preferences > Open Preferences Folder > plugins), then
   restart Cinema 4D.

2. In your scene: put a Null at the top. Under it, put your tube, all
   the objects that travel through it, and finally, as the LAST child
   under that same Null, add "Ease FFD" (Create > Object > Ease FFD,
   or wherever your plugin menu lands).

   Put the FFD SOMEWHERE ELSE -- its own separate Null, or just parked
   at the root with nothing before it. Don't nest it under the same
   parent as the geometry it's meant to shape. Ease FFD doesn't read
   the FFD through hierarchy position, only through the link field
   below, so the FFD never needs to be adjacent to what it's steering.
   Keep it fully ENABLED. This matters: if the FFD has no preceding
   siblings to act on, its own native deformation has nothing to do,
   so it stays enabled (cage fully visible and live-editable in the
   viewport) without ever double-deforming your geometry. Disabling it
   instead works too, but Cinema stops drawing its editable cage when
   disabled, so you lose live visual feedback while dragging points --
   keeping it enabled-but-isolated gets you both correctness and a
   real-time view of the cage at once.

3. On the Ease FFD object: drag the FFD into the "FFD Cage" field,
   set "Ease" to taste. Done -- no tags, no duplicate objects, no
   User Data to wire up. It's a native-feeling parameter UI.

Hierarchy ends up looking like:

    FFD                     (separate branch, stays enabled, fully editable)

    Null
    ├── Tube
    ├── Object 1..30 (animated, moving through the tube)
    └── Ease FFD             <- this plugin, must be LAST, linked to the FFD above

WHY THIS WORKS FOR ANIMATED OBJECTS (unlike an earlier tag-based
version of this tool)
----------------------------------------------------------------------
Cinema calls ModifyObject() fresh every cook with each sibling's
CURRENT point cache -- already reflecting that object's own animation
for this frame, and never anything this deformer wrote out previously.
There's no risk of compounding deformation on top of itself, and no
need to cache a "pristine" copy of anything: the pipeline already
guarantees a clean input every time.

NOTES
----------------------------------------------------------------------
- PLUGIN_ID below is a placeholder personal-use ID. If it collides
  with another installed plugin, Cinema will warn in the Console --
  pick a different number >= 1000000, or register a real one at
  plugincafe.maxon.net if you ever plan to distribute this.
- If deformation looks scrambled/spiky rather than smoothly wrong, the
  FFD's internal point ordering doesn't match FFD_ORDER below -- flip
  it to 1 and try again.
- Per-vertex, per-grid-point pure Python evaluation. Keep the FFD's
  own grid resolution modest (5-15 points per axis) for interactive
  speed; the mesh resolution of what's being deformed matters much
  less than the FFD grid size.
======================================================================
"""

import c4d
import math
import os
from c4d import plugins

PLUGIN_ID = 1058961  # personal-use placeholder -- change if it collides

# These must match res/c4d_symbols.h and res/description/oeaseffd.res
# exactly. Referenced locally rather than via c4d.EASEFFD_* because
# Cinema doesn't reliably auto-inject custom c4d_symbols.h enum names
# into the c4d module namespace for pure Python object plugins.
EASEFFD_CAGE = 1000
EASEFFD_EASE = 1001

# 0 = FFD's flat point array increases X fastest, then Y, then Z
# (most common). If results look scrambled, try 1.
FFD_ORDER = 0


def bernstein_weights(n, s):
    """[B_0^n(s), ..., B_n^n(s)] -- Bernstein basis weights for a single
    axis of degree n at parametric position s in [0,1]."""
    if n <= 0:
        return [1.0]
    s = 0.0 if s < 0.0 else (1.0 if s > 1.0 else s)
    inv = 1.0 - s
    coeffs = [math.comb(n, i) for i in range(n + 1)]
    return [coeffs[i] * (s ** i) * (inv ** (n - i)) for i in range(n + 1)]


def index_3d(i, j, k, nx, ny, nz):
    if FFD_ORDER == 0:
        return i + nx * (j + ny * k)
    else:
        return k + nz * (j + ny * i)


def cell_coord(s, n):
    """s in [0,1], n = grid points along axis - 1 -> (lower idx, upper
    idx, fraction within that cell)."""
    if n <= 0:
        return 0, 0, 0.0
    s = 0.0 if s < 0.0 else (1.0 if s > 1.0 else s)
    t = s * n
    i0 = int(math.floor(t))
    if i0 >= n:
        i0 = n - 1
    return i0, i0 + 1, t - i0


def read_ffd_control_points(ffd):
    """Returns (ctrl_points, count) reading either directly via
    PointObject methods or via the hidden point tag, depending on
    build. Returns (None, None) if unavailable."""
    try:
        count = ffd.GetPointCount()
        ctrl = ffd.GetAllPoints()
        return ctrl, count
    except AttributeError:
        pass
    ptag = ffd.GetTag(c4d.Tpoint)
    if ptag is None:
        return None, None
    ctrl = ptag.GetAllHighlevelData()
    return ctrl, len(ctrl)


class EaseFFDData(plugins.ObjectData):

    def __init__(self):
        self._last_ffd_dirty = None

    def Init(self, node, isCloneInit=False):
        if not isCloneInit:
            self.InitAttr(node, float, EASEFFD_EASE)
            node[EASEFFD_EASE] = 1.0  # 100% == matches native FFD
        self._last_ffd_dirty = None
        return True

    def CheckDirty(self, op, doc):
        # Cinema has no built-in way to know this object depends on the
        # FFD linked in the "FFD Cage" field, since we only read its
        # points manually inside ModifyObject rather than through a
        # tracked geometry connection. Without this, dragging the FFD's
        # points in the viewport wouldn't trigger a re-cook here at all.
        ffd = op[EASEFFD_CAGE]
        if ffd is None:
            return
        dirty = ffd.GetDirty(c4d.DIRTYFLAGS_DATA | c4d.DIRTYFLAGS_MATRIX)
        if dirty != self._last_ffd_dirty:
            self._last_ffd_dirty = dirty
            op.SetDirty(c4d.DIRTYFLAGS_DATA)

    def GetDDescription(self, node, description, flags):
        # Build the parameter UI directly in code rather than relying on
        # the external res/description/oeaseffd.res file being found and
        # parsed correctly -- this only depends on Cinema's built-in
        # Obase description, which is guaranteed to exist.
        if not description.LoadDescription(c4d.Obase):
            return False

        singleID = description.GetSingleDescID()

        # -- FFD Cage (Link) --
        cageID = c4d.DescID(c4d.DescLevel(EASEFFD_CAGE, c4d.DTYPE_BASELISTLINK, 0))
        if singleID is None or cageID.IsPartOf(singleID)[0]:
            bc = c4d.GetCustomDataTypeDefault(c4d.DTYPE_BASELISTLINK)
            bc[c4d.DESC_NAME] = "FFD Cage"
            bc[c4d.DESC_SHORT_NAME] = "FFD Cage"
            bc[c4d.DESC_ANIMATE] = c4d.DESC_ANIMATE_OFF
            if not description.SetParameter(cageID, bc, c4d.DescID(c4d.ID_OBJECTPROPERTIES)):
                return False

        # -- Ease (Real, percent) --
        easeID = c4d.DescID(c4d.DescLevel(EASEFFD_EASE, c4d.DTYPE_REAL, 0))
        if singleID is None or easeID.IsPartOf(singleID)[0]:
            bc = c4d.GetCustomDataTypeDefault(c4d.DTYPE_REAL)
            bc[c4d.DESC_NAME] = "Ease"
            bc[c4d.DESC_SHORT_NAME] = "Ease"
            bc[c4d.DESC_UNIT] = c4d.DESC_UNIT_PERCENT
            bc[c4d.DESC_MIN] = 0.0
            bc[c4d.DESC_STEP] = 0.01
            bc[c4d.DESC_ANIMATE] = c4d.DESC_ANIMATE_ON
            if not description.SetParameter(easeID, bc, c4d.DescID(c4d.ID_OBJECTPROPERTIES)):
                return False

        flags |= c4d.DESCFLAGS_DESC_LOADED
        return (True, flags)

    def ModifyObject(self, mod, doc, op, op_mg, mod_mg, lod, flags, thread):
        ffd = mod[EASEFFD_CAGE]
        ease = mod[EASEFFD_EASE]  # Percent-unit param already stores
                                       # the 0.0-1.0 fraction directly.
        if ffd is None or ease is None:
            return True

        nx = ffd[c4d.FFDOBJECT_XSUB]
        ny = ffd[c4d.FFDOBJECT_YSUB]
        nz = ffd[c4d.FFDOBJECT_ZSUB]
        size = ffd[c4d.FFDOBJECT_SIZE]
        if not nx or not ny or not nz or size is None:
            return True

        ctrl, pointCount = read_ffd_control_points(ffd)
        if ctrl is None or pointCount != nx * ny * nz:
            return True  # bail safely rather than deform incorrectly

        try:
            pts = op.GetAllPoints()
        except AttributeError:
            return True  # op has no point data (e.g. a Null) -- skip it

        ffdMg = ffd.GetMg()
        toFFD = ~ffdMg * op_mg   # op-local -> FFD-local
        toOp = ~toFFD            # FFD-local -> op-local

        lx, ly, lz = nx - 1, ny - 1, nz - 1
        newPts = [None] * len(pts)

        for idx in range(len(pts)):
            pf = toFFD * pts[idx]

            sx = (pf.x + size.x * 0.5) / size.x if size.x != 0 else 0.0
            sy = (pf.y + size.y * 0.5) / size.y if size.y != 0 else 0.0
            sz = (pf.z + size.z * 0.5) / size.z if size.z != 0 else 0.0

            # ---- smooth: global Bernstein/Bezier volume (native FFD math) ----
            wx = bernstein_weights(lx, sx)
            wy = bernstein_weights(ly, sy)
            wz = bernstein_weights(lz, sz)

            smoothP = c4d.Vector(0)
            for k in range(nz):
                wzk = wz[k]
                if wzk == 0.0:
                    continue
                for j in range(ny):
                    wyj = wy[j] * wzk
                    if wyj == 0.0:
                        continue
                    for i in range(nx):
                        w = wx[i] * wyj
                        if w == 0.0:
                            continue
                        smoothP += ctrl[index_3d(i, j, k, nx, ny, nz)] * w

            # ---- sharp: local trilinear across the nearest cell ----
            ix0, ix1, fx = cell_coord(sx, lx)
            iy0, iy1, fy = cell_coord(sy, ly)
            iz0, iz1, fz = cell_coord(sz, lz)

            c000 = ctrl[index_3d(ix0, iy0, iz0, nx, ny, nz)]
            c100 = ctrl[index_3d(ix1, iy0, iz0, nx, ny, nz)]
            c010 = ctrl[index_3d(ix0, iy1, iz0, nx, ny, nz)]
            c110 = ctrl[index_3d(ix1, iy1, iz0, nx, ny, nz)]
            c001 = ctrl[index_3d(ix0, iy0, iz1, nx, ny, nz)]
            c101 = ctrl[index_3d(ix1, iy0, iz1, nx, ny, nz)]
            c011 = ctrl[index_3d(ix0, iy1, iz1, nx, ny, nz)]
            c111 = ctrl[index_3d(ix1, iy1, iz1, nx, ny, nz)]

            c00 = c000 * (1 - fx) + c100 * fx
            c10 = c010 * (1 - fx) + c110 * fx
            c01 = c001 * (1 - fx) + c101 * fx
            c11 = c011 * (1 - fx) + c111 * fx

            c0 = c00 * (1 - fy) + c10 * fy
            c1 = c01 * (1 - fy) + c11 * fy

            sharpP = c0 * (1 - fz) + c1 * fz

            blended = sharpP * (1.0 - ease) + smoothP * ease
            newPts[idx] = toOp * blended

        op.SetAllPoints(newPts)
        return True


def load_icon():
    # Loaded explicitly rather than relying on filename-convention
    # auto-discovery, which has not been reliable for Python plugins
    # elsewhere in this file (see the description= resource lessons).
    path = os.path.join(os.path.dirname(__file__), "res", "oeaseffd.tif")
    if not os.path.isfile(path):
        return None
    bmp = c4d.bitmaps.BaseBitmap()
    if bmp.InitWith(path)[0] != c4d.IMAGERESULT_OK:
        return None
    return bmp


if __name__ == '__main__':
    plugins.RegisterObjectPlugin(
        id=PLUGIN_ID,
        str="Ease FFD",
        g=EaseFFDData,
        description="oeaseffd",  # matches res/description/oeaseffd.res
        icon=load_icon(),
        info=c4d.OBJECT_MODIFIER,
    )
