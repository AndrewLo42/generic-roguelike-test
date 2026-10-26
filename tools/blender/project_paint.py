"""
Re-texture a rigged character by projecting a repainted front | back sheet onto its mesh.

    Blender -b --python tools/blender/project_paint.py -- CHARACTER.glb BASE_SHEET.png PAINTED_SHEET.png OUT.glb

BASE_SHEET is what tools/blender/render_sheet.py rendered from CHARACTER.glb; PAINTED_SHEET is an image-edit
model's repaint of it (same pose, new outfit). The edit may rescale / shift the figure, so each half is
aligned by the figure's outline (height and centre) before projecting. Faces facing the front camera take
the front painting, the rest the back. The original texture maps (normal, metal/rough) are dropped since
they belong to the old paint job. The rig and skin weights are kept, so OUT.glb drops straight into
tools/blender/import_meshy.py as `selfrig`.
"""
import bpy, sys, math
import numpy as np
from mathutils import Matrix, Vector

argv = sys.argv[sys.argv.index('--') + 1:]
char_p, base_p, paint_p, out = argv[:4]
VIEW_H, CZ = 2.0, 0.95  # must match render_sheet.py

bpy.ops.wm.read_factory_settings(use_empty=True)


def load(p):
    im = bpy.data.images.load(p)
    w, h = im.size
    return np.array(im.pixels[:]).reshape(h, w, 4)[::-1].copy()  # rows top -> bottom


def fg_mask(a):
    """Foreground = not background. Backgrounds are light, nearly colourless greys, and an edit model's
    background isn't perfectly flat (gradients, vignette), so test colour, not distance to one bg sample."""
    rgb = a[:, :, :3]
    corners = np.concatenate([rgb[:8, :8].reshape(-1, 3), rgb[:8, -8:].reshape(-1, 3)])
    lo = np.median(corners) - 0.12
    grey = (rgb.max(-1) - rgb.min(-1)) < 0.05
    return ~(grey & (rgb.min(-1) > lo))


def half_bbox(m, half):
    w = m.shape[1] // 2
    sub = m[:, :w] if half == 0 else m[:, w:]
    ys, xs = np.nonzero(sub)
    # robust extents (ignore stray specks)
    y0, y1 = np.percentile(ys, 0.2), np.percentile(ys, 99.8)
    x0, x1 = np.percentile(xs, 0.5), np.percentile(xs, 99.5)
    return (x0 + x1) / 2 + (0 if half == 0 else w), y0, y1


base, paint = load(base_p), load(paint_p)
bm, pm = fg_mask(base), fg_mask(paint)
BH, BW = base.shape[:2]
PH, PW = paint.shape[:2]
align = []
for half in (0, 1):
    bcx, by0, by1 = half_bbox(bm, half)
    pcx, py0, py1 = half_bbox(pm, half)
    s = (py1 - py0) / (by1 - by0)
    align.append((bcx, by0, pcx, py0, s))
    print(f'ALIGN {"front" if half == 0 else "back"}: scale {s:.3f}, shift x {pcx - bcx * s:+.1f}px')

# Bleed figure colours outward into the background so slightly-misaligned edges never sample grey.
tex = paint.copy()
# Shrink the figure mask past its soft, light anti-aliased edge first, or that pale halo is what bleeds.
known = pm.copy()
for _ in range(3):
    known = known & np.roll(known, 1, 0) & np.roll(known, -1, 0) & np.roll(known, 1, 1) & np.roll(known, -1, 1)
for _ in range(int(sys.argv[sys.argv.index("--bleed") + 1]) if "--bleed" in sys.argv else 90):
    if known.all():
        break
    acc = np.zeros_like(tex[:, :, :3]); cnt = np.zeros(known.shape)
    for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        k = np.roll(np.roll(known, dy, 0), dx, 1)
        acc += np.roll(np.roll(tex[:, :, :3], dy, 0), dx, 1) * k[..., None]
        cnt += k
    grow = (~known) & (cnt > 0)
    tex[grow, :3] = acc[grow] / cnt[grow][:, None]
    known |= grow
tex[:, :, 3] = 1.0

# ---------------- character ----------------
bpy.ops.import_scene.gltf(filepath=char_p)
arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
mesh = max((o for o in bpy.data.objects if o.type == 'MESH' and o.parent == arm and o.parent_type != 'BONE'),
           key=lambda o: len(o.data.polygons))  # the skinned body (add-ons may leave stray meshes)
if arm.animation_data:
    arm.animation_data.action = None
for pb in arm.pose.bones:
    pb.matrix_basis = Matrix.Identity(4)
bpy.context.view_layer.update()

ppm = BH / VIEW_H        # base-sheet pixels per metre
hw = BW / 2              # width of one half


def base_px(p, back):
    """World point -> base-sheet pixel (x, row from top) for the front or back camera."""
    row = BH / 2 - (p.z - CZ) * ppm
    col = hw / 2 + p.x * ppm if not back else hw + hw / 2 - p.x * ppm
    return col, row


def paint_uv(col, row, back):
    bcx, by0, pcx, py0, s = align[1 if back else 0]
    pc = pcx + (col - bcx) * s
    pr = py0 + (row - by0) * s
    return pc / PW, 1 - pr / PH


me = mesh.data
Mw = mesh.matrix_world
N3 = Mw.to_3x3().inverted().transposed()
uv = me.uv_layers.new(name='Paint')
front = back = 0
for poly in me.polygons:
    is_back = (N3 @ poly.normal).y > 0  # faces +Y look toward the back camera
    back += is_back; front += not is_back
    for li in poly.loop_indices:
        p = Mw @ me.vertices[me.loops[li].vertex_index].co
        uv.data[li].uv = paint_uv(*base_px(p, is_back), is_back)
for layer in [l for l in me.uv_layers if l.name != 'Paint']:
    me.uv_layers.remove(layer)
me.uv_layers['Paint'].active = True
me.uv_layers['Paint'].active_render = True

img = bpy.data.images.new('painted', PW, PH, alpha=False)
img.pixels = tex[::-1].ravel().tolist()
img.file_format = 'PNG'
img.pack()
mat = bpy.data.materials.new('Painted'); mat.use_nodes = True
bsdf = mat.node_tree.nodes['Principled BSDF']
t = mat.node_tree.nodes.new('ShaderNodeTexImage'); t.image = img
mat.node_tree.links.new(t.outputs['Color'], bsdf.inputs['Base Color'])
bsdf.inputs['Roughness'].default_value = 0.8
bsdf.inputs['Metallic'].default_value = 0.0
me.materials.clear(); me.materials.append(mat)
print(f'PROJECT {front} front faces, {back} back faces')

bpy.ops.object.select_all(action='DESELECT')
arm.select_set(True); mesh.select_set(True)
bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', use_selection=True, export_animation_mode='ACTIONS', export_image_format='AUTO')
print('EXPORTED', out)
