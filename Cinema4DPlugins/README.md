# Cinema 4D Plugins

- [Ease FFD](#ease-ffd) — `EaseFFD/`

## Ease FFD

`EaseFFD/EaseFFD.pyp` (Python object plugin)

Adds an **Ease** slider to a Free-Form Deformation cage that blends between a sharp, local, corner-for-corner deformation and the native FFD's smooth global Bernstein/Bezier result — something stock FFD can't do at any cage density.

![Ease FFD attributes](EaseFFD.png)

- **Ease = 0%** — sharp, exactly follows the cage (local trilinear interpolation across the nearest cell)
- **Ease = 100%** — identical to native FFD (same global Bernstein/Bezier math stock FFD always uses)
- **0–100%** — blend of the two
- **>100%** — allowed, extrapolates past native smoothness

Works correctly on animated geometry: it reads each frame's already-animated point cache fresh, so there's no risk of compounding deformation.

### Install

Drop the whole `EaseFFD` folder into Cinema 4D's plugins directory (**Edit > Preferences > Open Preferences Folder > plugins**), then restart Cinema 4D. It appears as **Ease FFD** wherever your plugin menu lands (e.g. Create > Object).

### Required hierarchy

**The FFD cage must be linked into the "FFD Cage" field on the Ease FFD object — that link is what matters, not where the FFD sits in the Object Manager.** Two hierarchy patterns both work:

**Simple (single object) — as pictured above:**

```
Cube
└── Ease FFD      <- child of the object it deforms
    └── FFD        <- parked here for tidy organization; linked via "FFD Cage"
```

Add **Ease FFD** as a direct child of the object you want deformed (the classic way native deformers like Bend/Twist/FFD are used), and park the FFD cage as a child of the Ease FFD object itself. Link the FFD into the **FFD Cage** field and set **Ease** to taste.

**Multi-object (siblings under a shared parent):**

```
Null
├── Tube
├── Object 1..30   <- any number of siblings, can be independently animated
└── Ease FFD       <- must be LAST, linked to the FFD below

FFD                 <- separate branch, NOT nested under the same Null
```

To deform multiple sibling objects at once (all combined, every frame, including their own animation — exactly like native FFD), put **Ease FFD** as the *last* child under a shared parent, after every object it should affect. In this pattern, keep the FFD cage in a **separate** location — its own Null, or parked at the root — rather than nested under that same parent. Keep the FFD fully **enabled**: with no preceding siblings of its own to act on, its native deformation has nothing to do, so it stays enabled (cage fully visible and live-editable) without ever double-deforming the geometry.

### Usage

1. Set up the hierarchy above and link the FFD cage into the **FFD Cage** field on the Ease FFD object.
2. Adjust **Ease** (0–300%) to blend between sharp and smooth.

### Notes

- `PLUGIN_ID` in `EaseFFD.pyp` is a personal-use placeholder. If it collides with another installed plugin, Cinema warns in the Console — pick a different ID ≥ 1000000, or register a real one at plugincafe.maxon.net before distributing.
- If deformation looks scrambled/spiky rather than smoothly wrong, the FFD's internal point ordering doesn't match the plugin's assumption — flip `FFD_ORDER` in `EaseFFD.pyp` from `0` to `1`.
- Pure Python, evaluated per-vertex per-grid-point. Keep the FFD's own grid resolution modest (5–15 points per axis) for interactive speed — the mesh resolution of the deformed object matters much less than the FFD grid size.
