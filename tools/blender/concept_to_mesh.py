"""
A textured character mesh straight from a front + back concept image (no 3D generation service).

    Blender -b --python tools/blender/concept_to_mesh.py -- FRONT.png BACK.png OUT.glb [--step 2] [--depth 0.8] [--open 2]

  - silhouette from the front image's alpha, with thin bits trimmed (--open N cells: a morphological
    opening) so hands touching hanging blades or belts don't fuse into one shape
  - "inflation": depth at each point grows with its distance from the silhouette edge (round limbs,
    fuller torso), like sketch-to-3D tools
  - front image projected on the front surface, back image (mirrored, bbox-aligned) on the back

Good from the front, back and three-quarter views; thin from the pure side (depth is a guess and nothing
is painted there), and hoods/capes/belts are painted on rather than modelled. A free placeholder until a
real model (e.g. Meshy image-to-3D) replaces it. Output is A-pose, feet at 0, facing -Y: ready for
tools/blender/auto_rig.py.
"""
import bpy, sys, os, math
import numpy as np

argv = sys.argv[sys.argv.index('--') + 1:]
front_p, back_p, out = argv[0], argv[1], argv[2]
step = int(argv[argv.index('--step') + 1]) if '--step' in argv else 2
depth_k = float(argv[argv.index('--depth') + 1]) if '--depth' in argv else 0.8
open_r = int(argv[argv.index('--open') + 1]) if '--open' in argv else 2
HEIGHT = 1.85

bpy.ops.wm.read_factory_settings(use_empty=True)


def load(p):
    im = bpy.data.images.load(p)
    w, h = im.size
    a = np.array(im.pixels[:]).reshape(h, w, 4)[::-1]  # rows top -> bottom
    return im, a


fim, F = load(front_p)
bim, Bk = load(back_p)
fm, bm = F[:, :, 3] > 0.5, Bk[:, :, 3] > 0.5


def bbox(m):
    ys, xs = np.nonzero(m)
    return xs.min(), xs.max(), ys.min(), ys.max()


fx0, fx1, fy0, fy1 = bbox(fm)
bx0, bx1, by0, by1 = bbox(bm)
mpp = HEIGHT / (fy1 - fy0)  # metres per front pixel
fcx = (fx0 + fx1) / 2

# ---------------- grid + distance transform ----------------
mask = fm[::step, ::step]
gh, gw = mask.shape
# Trim thin parts (opening = erode then dilate by open_r cells): sheathed blades and straps that bridge a
# hand to the hip would otherwise fuse arm and body, and stretch into "wires" when the arm moves.
def morph(m, r, op):
    out = m.copy()
    for dy in range(-r, r + 1):
        for dx in range(-r, r + 1):
            if dx * dx + dy * dy <= r * r:
                sh = np.roll(np.roll(m, dy, 0), dx, 1)
                out = (out & sh) if op == 'erode' else (out | sh)
    return out
if open_r > 0:
    before = mask.sum()
    mask = morph(morph(mask, open_r, 'erode'), open_r, 'dilate') & mask
    # keep only the largest connected piece (drop crumbs the opening leaves behind)
    lab = np.zeros(mask.shape, int); cur = 0; sizes = {}
    for sy, sx in zip(*np.nonzero(mask)):
        if lab[sy, sx]:
            continue
        cur += 1; stack = [(sy, sx)]; lab[sy, sx] = cur; cnt = 0
        while stack:
            y, x = stack.pop(); cnt += 1
            for ny, nx in ((y + 1, x), (y - 1, x), (y, x + 1), (y, x - 1)):
                if 0 <= ny < gh and 0 <= nx < gw and mask[ny, nx] and not lab[ny, nx]:
                    lab[ny, nx] = cur; stack.append((ny, nx))
        sizes[cur] = cnt
    mask = lab == max(sizes, key=sizes.get)
    print(f'TRIM removed {before - mask.sum()} thin/stray cells of {before}')
ii, jj = np.nonzero(mask)
inside = np.zeros_like(mask, bool); inside[ii, jj] = True
pad = np.pad(inside, 1)
edge = inside & ~(pad[:-2, 1:-1] & pad[2:, 1:-1] & pad[1:-1, :-2] & pad[1:-1, 2:])
by_, bx_ = np.nonzero(edge)
B = np.stack([by_, bx_], 1).astype(float)
P = np.stack([ii, jj], 1).astype(float)
dt = np.empty(len(P))
for s in range(0, len(P), 2000):
    d = np.sqrt(((P[s:s + 2000, None, :] - B[None]) ** 2).sum(-1))
    dt[s:s + 2000] = d.min(1)
dt += 0.5
DT = np.zeros((gh, gw)); DT[ii, jj] = dt
# Local "limb radius": the largest distance-to-edge nearby (a sliding max), so a point near the edge of a
# thick torso still bulges like the torso, and thin limbs stay round.
R = DT.copy()
win = max(3, int(round(0.06 / (mpp * step))))  # ~6 cm
for dy in range(-win, win + 1):
    for dx in range(-win, win + 1):
        if dx * dx + dy * dy <= win * win:
            R = np.maximum(R, np.roll(np.roll(DT, dy, 0), dx, 1))
h = depth_k * np.sqrt(np.maximum(0, DT * (2 * R - DT))) * step * mpp  # metres

# ---------------- vertices ----------------
idx = -np.ones((gh, gw), int)
idx[ii, jj] = np.arange(len(ii))
X = (jj * step - fcx) * mpp
Z = (fy1 - ii * step) * mpp
H = h[ii, jj]
n = len(ii)
verts = np.concatenate([np.stack([X, -H, Z], 1), np.stack([X, H, Z], 1)])  # front (-Y), back (+Y)

# Texture atlas: front image | back image.
AW, AH = F.shape[1] + Bk.shape[1], max(F.shape[0], Bk.shape[0])
def uv_front(r, c):
    return (c + 0.5) / AW, 1 - (r + 0.5) / AH
# back image pixel for a world (x, z): mirror x, align by silhouette bbox
bs = (by1 - by0) / (fy1 - fy0)
bcx = (bx0 + bx1) / 2
def uv_back(x, z):
    c = bcx - (x / mpp) * bs
    r = by1 - (z / mpp) * bs
    return (F.shape[1] + c + 0.5) / AW, 1 - (r + 0.5) / AH

faces, ftype = [], []
for (r, c) in zip(ii, jj):
    if r + 1 >= gh or c + 1 >= gw:
        continue
    q = [idx[r, c], idx[r, c + 1], idx[r + 1, c + 1], idx[r + 1, c]]
    if min(q) < 0:
        continue
    faces.append(q[::-1]); ftype.append('F')          # front surface, facing -Y
    faces.append([v + n for v in q]); ftype.append('B')  # back surface, facing +Y
# side walls along the silhouette boundary, joining the front and back surfaces
edge_count = {}
for f, t in zip(faces, ftype):
    if t == 'F':
        for a_, b_ in zip(f, f[1:] + f[:1]):
            k = (min(a_, b_), max(a_, b_)); edge_count[k] = edge_count.get(k, 0) + 1
walls = [k for k, cnt in edge_count.items() if cnt == 1]
for a_, b_ in walls:
    faces.append([a_, b_, b_ + n, a_ + n]); ftype.append('W')

me = bpy.data.meshes.new('Rogue')
me.from_pydata(verts.tolist(), [], faces)
me.update()
uvl = me.uv_layers.new(name='UVMap')
grid_r, grid_c = ii * step, jj * step
for poly, t in zip(me.polygons, ftype):
    for li in poly.loop_indices:
        vi = me.loops[li].vertex_index
        v0 = vi % n
        if t == 'B':
            x, _, z = verts[vi]
            uvl.data[li].uv = uv_back(x, z)
        else:  # front surface and the thin side walls use the front painting
            uvl.data[li].uv = uv_front(grid_r[v0], grid_c[v0])

# atlas image
atlas = np.zeros((AH, AW, 4))
atlas[:F.shape[0], :F.shape[1]] = F
atlas[:Bk.shape[0], F.shape[1]:] = Bk
img = bpy.data.images.new('rogue_atlas', AW, AH, alpha=True)
img.pixels = atlas[::-1].ravel().tolist()
img.file_format = 'PNG'
img.pack()

mat = bpy.data.materials.new('RogueMat'); mat.use_nodes = True
bsdf = mat.node_tree.nodes['Principled BSDF']
tex = mat.node_tree.nodes.new('ShaderNodeTexImage'); tex.image = img
mat.node_tree.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
bsdf.inputs['Roughness'].default_value = 0.85
me.materials.append(mat)
obj = bpy.data.objects.new('Rogue', me)
bpy.context.collection.objects.link(obj)
bpy.context.view_layer.objects.active = obj; obj.select_set(True)
bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT')
bpy.ops.mesh.remove_doubles(threshold=0.0005); bpy.ops.mesh.normals_make_consistent(inside=False)
bpy.ops.object.mode_set(mode='OBJECT')
bpy.ops.object.shade_smooth()
dec = obj.modifiers.new('dec', 'DECIMATE'); dec.ratio = float(os.environ.get('DECIMATE', 0.35))
bpy.ops.object.modifier_apply(modifier='dec')
obj.data.calc_loop_triangles()
print(f'HULL verts {len(obj.data.vertices)} tris {len(obj.data.loop_triangles)} walls {len(walls)} max depth {H.max() * 2:.3f} m')
bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', use_selection=True, export_image_format='WEBP')
print('EXPORTED', out)
