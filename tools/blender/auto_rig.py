"""
Rig an unrigged A-pose humanoid (e.g. a Meshy model) with our own skeleton, including fingers.

    Blender -b --python tools/blender/auto_rig.py -- IN.glb OUT.glb [--ref REF_RIGGED.glb] [--height 1.85]

Assumes the mesh stands in an A-pose on the ground, facing -Y (glTF +Z), origin at the feet — which is
what our concept prompt + Meshy produce (docs/art-bible.md).

Skeleton: Meshy/Mixamo-style bone names (Hips, Spine02, LeftArm, ...) so Meshy's library animations can
be retargeted onto it, plus 3-joint fingers and thumbs (LeftHandIndex1..3, LeftHandThumb1..3, ...).
Joints come from the mesh: torso and limb cross-sections for the body, the arm's principal axis and its
far end for the wrists, and a hand frame (length / width / palm normal from PCA) for finger placement.
Weights: Blender's automatic (bone heat) weights, solved on a watertight voxel proxy and transferred;
hand vertices re-weighted to the nearest finger bone; for robes (no gap between the legs at shin height)
legs drop straight under the robe and leg weights are evened out across the centre line so the hem
swings as one piece (set NO_ROBE_BLEND=1 to skip that, e.g. to compare).

--ref prints the distance from each joint to the same joint in a reference rig (e.g. Meshy's rig of the
same mesh) as a sanity check.
"""
import bpy, sys, os, math
import numpy as np
from mathutils import Vector, Matrix

argv = sys.argv[sys.argv.index('--') + 1:]
src, out = argv[0], argv[1]
ref_path = argv[argv.index('--ref') + 1] if '--ref' in argv else None
preview = argv[argv.index('--preview') + 1] if '--preview' in argv else None

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
mesh = next(o for o in bpy.context.scene.objects if o.type == 'MESH')
# Bake the import transform so mesh space == world space (metres, Z up, facing -Y).
mesh.data.transform(mesh.matrix_world)
mesh.matrix_world = Matrix.Identity(4)
# Normalise: feet on the ground, centred, scaled to --height metres (Meshy's raw output is centred on
# the origin; remeshed output already stands on it).
V = np.array([tuple(v.co) for v in mesh.data.vertices])
target_h = float(argv[argv.index('--height') + 1]) if '--height' in argv else 1.85
lo, hi = V.min(0), V.max(0)
k = target_h / (hi[2] - lo[2])
mesh.data.transform(Matrix.Scale(k, 4) @ Matrix.Translation((-(lo[0] + hi[0]) / 2, -(lo[1] + hi[1]) / 2, -lo[2])))
V = np.array([tuple(v.co) for v in mesh.data.vertices])
H = V[:, 2].max()


def band(z, half=None, sel=None):
    half = half or H / 80
    m = np.abs(V[:, 2] - z) < half
    return V[m & sel] if sel is not None else V[m]


def centroid(pts):
    return Vector(pts.mean(0)) if len(pts) else None


def limb_point(a, b, t, radius, iters=3):
    """Centre of the limb between joints a and b at fraction t: the centroid of vertices in a thin slab
    perpendicular to a->b that lie within `radius` of the axis. Re-centres a few times so hanging armour,
    skirts or fur off to the side of the limb don't pull the joint."""
    A, B = np.array(a), np.array(b)
    d = B - A; Ln = np.linalg.norm(d); d = d / Ln
    p = A + d * Ln * t
    for _ in range(iters):
        rel = V - p
        along = rel @ d
        off = rel - np.outer(along, d)
        m = (np.abs(along) < 0.04 * Ln) & (np.linalg.norm(off, axis=1) < radius)
        if m.sum() < 8:
            break
        p = p + off[m].mean(0)
    return Vector(p)


# ---------------- torso / head ----------------
core = np.abs(V[:, 0]) < 0.12 * H
def spine_pt(f):
    # Mid-range front-to-back (not the vertex mean, which belt buckles and tassets pull forward).
    b = band(f * H, H / 40, core)
    return Vector((0.0, (b[:, 1].min() + b[:, 1].max()) / 2, f * H))

J = {}
J['Hips'] = spine_pt(0.566)
J['Spine02'] = spine_pt(0.634)
J['Spine01'] = spine_pt(0.702)
J['Spine'] = spine_pt(0.771)
J['neck'] = spine_pt(0.819)
J['Head'] = spine_pt(0.859)
J['head_end'] = Vector((0.0, J['Head'].y, H))
J['headfront'] = J['Head'] + Vector((0, -0.09 * H, 0))

# Torso half-width just below the armpit: the first empty gap in |x| at 0.70H (arms hang away from the body).
def torso_half_width(z):
    xs = np.sort(np.abs(band(z)[:, 0]))
    gaps = np.where(np.diff(xs) > 0.02 * H)[0]
    return xs[gaps[0]] if len(gaps) else 0.13 * H

shoulder_z = 0.809 * H
tw = torso_half_width(0.70 * H)

hand_frames = {}
robed_sides = {}
for side, pre in ((1, 'Left'), (-1, 'Right')):
    # ---------------- arm ----------------
    arm_sel = (V[:, 0] * side > tw + 0.02 * H) & (V[:, 2] > 0.45 * H) & (V[:, 2] < 0.80 * H)
    arm = V[arm_sel]
    c = arm.mean(0)
    u = np.linalg.svd(arm - c)[2][0]
    if u[0] * side < 0:
        u = -u  # point down the arm, toward the hand
    tip = arm[np.argmax((arm - c) @ u)]
    L = 0.113 * H  # hand length (wrist -> fingertip)
    wrist = Vector(tip - u * L)
    sh = Vector((side * tw, J['Spine'].y, shoulder_z))
    elbow = limb_point(sh, wrist, 0.52, 0.05 * H)
    J[f'{pre}Shoulder'] = Vector((side * 0.025 * H, J['Spine'].y, shoulder_z))
    J[f'{pre}Arm'] = sh
    J[f'{pre}ForeArm'] = elbow
    J[f'{pre}Hand'] = wrist

    # ---------------- hand frame + fingers ----------------
    W = np.array(wrist)
    rel = V - W
    along = rel @ u
    radial = np.linalg.norm(rel - np.outer(along, u), axis=1)
    hand = V[(along > -0.01) & (radial < 0.065 * H)]
    hc = hand.mean(0)
    n = np.linalg.svd(hand - hc)[2][2]  # thinnest direction = palm normal (either sign)
    n -= u * (n @ u); n /= np.linalg.norm(n)
    if n[0] * side > 0:
        n = -n  # palm faces the body in the A-pose
    w = np.cross(u, n); w /= np.linalg.norm(w)
    if w[1] > 0:
        w = -w  # thumb side faces forward (-Y) in the A-pose
    P = hand - W
    pu, pw, pn = P @ u, P @ w, P @ n
    u0 = 0.5 * L  # knuckle line
    distal = pu > u0
    w_lo, w_hi = np.quantile(pw[distal], 0.12), np.quantile(pw[distal], 0.88)
    n_c = float(np.median(pn[distal]))
    flen = L - u0
    U, Wv, N = Vector(u), Vector(w), Vector(n)
    spacing = (w_hi - w_lo) / 3
    for i, name in enumerate(['Pinky', 'Ring', 'Middle', 'Index']):  # from the -w (little finger) side
        wi = w_lo + spacing * i
        base = wrist + U * u0 + Wv * wi + N * n_c
        # Aim along the actual finger: A-pose hands are fanned open, so fingers aren't parallel to the hand.
        # Fingertip region = this finger's lane (by width at the knuckles) in the outer 40% of its length.
        lane = distal & (np.abs(pw - wi) < spacing * 0.6) & (pu > u0 + 0.6 * flen)
        if lane.sum() >= 5:
            tipc = Vector(hand[lane].mean(0))
            d = (tipc - base).normalized()
        else:
            d = U
        seg = [0.4, 0.33, 0.27]
        p = base
        for k, s in enumerate(seg, 1):
            J[f'{pre}Hand{name}{k}'] = p
            p = p + d * flen * s
        J[f'{pre}Hand{name}4'] = p  # tail marker (not a bone)
    # Thumb: from the base of the palm on the thumb side, angled out toward the index finger.
    tb = wrist + U * (0.18 * L) + Wv * (w_hi + 0.15 * (w_hi - w_lo)) + N * (n_c + 0.01 * H)
    tdir = (U * 0.75 + Wv * 0.45 + N * 0.35).normalized()
    p = tb
    for k, s in enumerate([0.035, 0.03, 0.025], 1):
        J[f'{pre}HandThumb{k}'] = p
        p = p + tdir * s * H / 1.85
    J[f'{pre}HandThumb4'] = p
    hand_frames[pre] = (U, Wv, N, wrist, L)

    # ---------------- leg ----------------
    leg_sel = V[:, 0] * side > 0.01 * H
    hip = Vector((side * 0.068 * H, J['Hips'].y, 0.51 * H))
    # Shin centreline from the leg's outline (mid-range in x and y) at heights below any skirt or tassets,
    # fitted as a line and evaluated at the ankle and knee heights.
    # Robes / long skirts hide the legs: separate legs leave an empty gap down the middle at shin height,
    # a robe doesn't. Then the shin outline is the robe's hem flare, so drop the legs straight down
    # from the hips instead, with the feet where the boot tips poke out at the hem.
    shins = band(0.17 * H, H / 20)
    robed = (np.abs(shins[:, 0]) < 0.02 * H).sum() > 3
    if robed:
        feet = V[(V[:, 2] < 0.04 * H) & leg_sel]
        fx = float(np.median(feet[:, 0])) if len(feet) > 5 else hip.x
        ankle = Vector((fx, hip.y, 0.087 * H))
        knee = Vector(((hip.x + fx) / 2, hip.y, 0.289 * H))
        print(f'LEGS {pre}: robe detected, straight legs under it (feet at x={fx:+.3f})')
    robed_sides[pre] = robed
    zs = np.array([0.11, 0.15, 0.19, 0.23]) * H
    mids = []
    for z in zs:
        b = band(z, H / 70, leg_sel)
        mids.append(((b[:, 0].min() + b[:, 0].max()) / 2, (b[:, 1].min() + b[:, 1].max()) / 2))
    mids = np.array(mids)
    fx, fy = np.polyfit(zs, mids[:, 0], 1), np.polyfit(zs, mids[:, 1], 1)
    at = lambda z: Vector((np.polyval(fx, z), np.polyval(fy, z), z))
    if not robed:
        ankle = at(0.087 * H)
        knee = at(0.289 * H)
    J[f'{pre}UpLeg'] = hip
    J[f'{pre}Leg'] = knee
    J[f'{pre}Foot'] = ankle
    foot = V[(V[:, 2] < 0.06 * H) & leg_sel]
    toe_y = np.quantile(foot[:, 1], 0.02)
    J[f'{pre}ToeBase'] = Vector((ankle.x + side * 0.02 * H, ankle.y + (toe_y - ankle.y) * 0.6, 0.025 * H))
    J[f'{pre}Toe_End'] = Vector((J[f'{pre}ToeBase'].x, toe_y, 0.02 * H))

# ---------------- skeleton ----------------
PARENT = {
    'Spine02': 'Hips', 'Spine01': 'Spine02', 'Spine': 'Spine01', 'neck': 'Spine', 'Head': 'neck',
    'head_end': 'Head', 'headfront': 'Head',
}
TAIL = {'Hips': 'Spine02', 'Spine02': 'Spine01', 'Spine01': 'Spine', 'Spine': 'neck', 'neck': 'Head', 'Head': 'head_end'}
for pre in ('Left', 'Right'):
    PARENT.update({f'{pre}Shoulder': 'Spine', f'{pre}Arm': f'{pre}Shoulder', f'{pre}ForeArm': f'{pre}Arm',
                   f'{pre}Hand': f'{pre}ForeArm', f'{pre}UpLeg': 'Hips', f'{pre}Leg': f'{pre}UpLeg',
                   f'{pre}Foot': f'{pre}Leg', f'{pre}ToeBase': f'{pre}Foot'})
    TAIL.update({f'{pre}Shoulder': f'{pre}Arm', f'{pre}Arm': f'{pre}ForeArm', f'{pre}ForeArm': f'{pre}Hand',
                 f'{pre}UpLeg': f'{pre}Leg', f'{pre}Leg': f'{pre}Foot', f'{pre}Foot': f'{pre}ToeBase',
                 f'{pre}ToeBase': f'{pre}Toe_End', f'{pre}Hand': f'{pre}HandMiddle1'})
    for f in ('Index', 'Middle', 'Ring', 'Pinky', 'Thumb'):
        for k in (1, 2, 3):
            PARENT[f'{pre}Hand{f}{k}'] = f'{pre}Hand' if k == 1 else f'{pre}Hand{f}{k - 1}'
            TAIL[f'{pre}Hand{f}{k}'] = f'{pre}Hand{f}{k + 1}'

arm_data = bpy.data.armatures.new('Armature')
arm = bpy.data.objects.new('Armature', arm_data)
bpy.context.collection.objects.link(arm)
bpy.context.view_layer.objects.active = arm
bpy.ops.object.mode_set(mode='EDIT')
eb = arm_data.edit_bones
bone_names = ['Hips'] + [n for n in PARENT]
for name in bone_names:
    b = eb.new(name)
    b.head = J[name]
    if name in TAIL:
        b.tail = J[TAIL[name]]
    elif name == 'head_end':
        b.tail = J['head_end'] + Vector((0, 0, 0.03 * H))
    elif name == 'headfront':
        b.tail = J['headfront'] + Vector((0, -0.03 * H, 0))
for name, par in PARENT.items():
    eb[name].parent = eb[par]
    eb[name].use_connect = False
# Hand and finger rolls: bone X = toward the back of the hand (right) / the palm (left), matching the Meshy
# convention our grip config uses (palm -X right, +X left); bone Z then points to the thumb side.
for pre, side in (('Left', 1), ('Right', -1)):
    U, Wv, N, _, _ = hand_frames[pre]
    x_axis = -N if pre == 'Right' else N
    for name in [f'{pre}Hand'] + [f'{pre}Hand{f}{k}' for f in ('Index', 'Middle', 'Ring', 'Pinky', 'Thumb') for k in (1, 2, 3)]:
        b = eb[name]
        y = (b.tail - b.head).normalized()
        b.align_roll(x_axis.cross(y))  # align_roll sets the Z axis; Z = X x Y gives the X axis we want
bpy.ops.object.mode_set(mode='OBJECT')
print(f'BONES {len(arm_data.bones)}')

# ---------------- skin ----------------
# Bone heat fails to solve on small (metre-scale) meshes, so skin at 100x and scale back afterwards.
def scale_all(k):
    for o in (mesh, arm):
        bpy.ops.object.select_all(action='DESELECT')
        o.select_set(True)
        bpy.context.view_layer.objects.active = o
        o.scale = (k, k, k)
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)

scale_all(100)
# AI meshes are many overlapping shells (fur cards, armour plates over the body), which bone heat can't
# solve. Skin a watertight voxel-remeshed proxy instead, then transfer its weights to the real mesh.
proxy = mesh.copy()
proxy.data = mesh.data.copy()
bpy.context.collection.objects.link(proxy)
rm = proxy.modifiers.new('voxel', 'REMESH')
rm.mode = 'VOXEL'
rm.voxel_size = float(os.environ.get('VOXEL', 0.012)) * 100 * H / 1.85  # ~1.2 cm at character scale
bpy.ops.object.select_all(action='DESELECT')
proxy.select_set(True)
bpy.context.view_layer.objects.active = proxy
bpy.ops.object.modifier_apply(modifier='voxel')
print(f'PROXY {len(proxy.data.vertices)} verts')
bpy.ops.object.select_all(action='DESELECT')
proxy.select_set(True)
arm.select_set(True)
bpy.context.view_layer.objects.active = arm
bpy.ops.object.parent_set(type='ARMATURE_AUTO')
proxy_unweighted = sum(1 for v in proxy.data.vertices if not any(g.weight > 0 for g in v.groups))
print(f'PROXY unweighted {proxy_unweighted}')
# Transfer: every vertex group, from the nearest proxy surface point.
for vg in proxy.vertex_groups:
    mesh.vertex_groups.new(name=vg.name)
dt = mesh.modifiers.new('weights', 'DATA_TRANSFER')
dt.object = proxy
dt.use_vert_data = True
dt.data_types_verts = {'VGROUP_WEIGHTS'}
dt.vert_mapping = 'POLYINTERP_NEAREST'
dt.layers_vgroup_select_src = 'ALL'
dt.layers_vgroup_select_dst = 'NAME'
bpy.ops.object.select_all(action='DESELECT')
mesh.select_set(True)
bpy.context.view_layer.objects.active = mesh
bpy.ops.object.modifier_apply(modifier='weights')
bpy.data.objects.remove(proxy, do_unlink=True)
mod = mesh.modifiers.new('Armature', 'ARMATURE')
mod.object = arm
scale_all(0.01)  # mesh isn't parented yet, so it isn't scaled twice through the armature
mesh.parent = arm
mesh.matrix_parent_inverse = Matrix.Identity(4)

# ---------------- finger weights ----------------
# The voxel proxy fuses low-poly fingers into a mitten, so transferred finger weights smear across
# neighbouring fingers (curled fingers then splay like claws). Re-weight every hand vertex directly:
# split its hand-side weight between the palm bone and the nearest finger / thumb bone by inverse
# distance to each bone segment. The mesh's fingers are separate, so nearest-bone is reliable there.
def seg_dist(p, a, b):
    ab = b - a
    t = max(0.0, min(1.0, (p - a).dot(ab) / max(ab.length_squared, 1e-12)))
    return (p - (a + ab * t)).length

bones = arm.data.bones
for pre in ('Left', 'Right'):
    U, Wv, N, wrist, L = hand_frames[pre]
    hand_side = [f'{pre}Hand'] + [f'{pre}Hand{f}{k}' for f in ('Index', 'Middle', 'Ring', 'Pinky', 'Thumb') for k in (1, 2, 3)]
    gidx = {mesh.vertex_groups[n].index: n for n in hand_side}
    segs = {n: (arm.matrix_world @ bones[n].head_local, arm.matrix_world @ bones[n].tail_local) for n in hand_side}
    fingers = [n for n in hand_side if n != f'{pre}Hand' and 'Thumb' not in n]
    thumbs = [n for n in hand_side if 'Thumb' in n]
    changed = 0
    for v in mesh.data.vertices:
        share = sum(g.weight for g in v.groups if g.group in gidx)
        if share < 1e-3:
            continue
        p = mesh.matrix_world @ v.co
        if (p - wrist).dot(U) < 0.12 * L:  # leave the wrist blend to the transferred weights
            continue
        d = {n: seg_dist(p, *segs[n]) for n in [f'{pre}Hand'] + fingers + thumbs}
        cands = [f'{pre}Hand', min(fingers, key=d.get), min(thumbs, key=d.get)]
        raw = {n: 1.0 / (d[n] + 0.002) ** 4 for n in cands}
        tot = sum(raw.values())
        for n in hand_side:
            mesh.vertex_groups[n].remove([v.index])
        for n, x in raw.items():
            if x / tot > 0.01:
                mesh.vertex_groups[n].add([v.index], share * x / tot, 'REPLACE')
        changed += 1
    print(f'FINGERS {pre}: re-weighted {changed} hand vertices')

# ---------------- robe weights ----------------
# Bone heat binds robe cloth to whichever leg is nearest, so a long robe splits up the front like trousers
# when the legs stride. Even out the left/right leg influence by distance from the centre line: cloth at
# the centre follows both legs equally (the hem swings as one piece), cloth out at the sides follows its
# own leg, with a smooth blend between. Per leg level (thigh / shin / foot) so the total stays the same.
if robed_sides and all(robed_sides.values()) and not os.environ.get('NO_ROBE_BLEND'):
    width = 0.12 * H  # full own-side influence beyond this distance from the centre
    levels = ['UpLeg', 'Leg', 'Foot', 'ToeBase']
    grp = {f'{pre}{lv}': mesh.vertex_groups[f'{pre}{lv}'] for pre in ('Left', 'Right') for lv in levels}
    gi = {g.index: n for n, g in grp.items()}
    hip_z = 0.51 * H
    blended = 0
    for v in mesh.data.vertices:
        p = mesh.matrix_world @ v.co
        if p.z > hip_z:
            continue
        cur = {gi[g.group]: g.weight for g in v.groups if g.group in gi}
        if not cur:
            continue
        t = max(-1.0, min(1.0, p.x / width))
        t = t * t * (3 - 2 * abs(t)) * (1 if t >= 0 else -1) if t else 0.0  # smoothstep, keeps sign
        f_left = 0.5 + 0.5 * t  # +x is the character's left
        for lv in levels:
            tot = cur.get(f'Left{lv}', 0) + cur.get(f'Right{lv}', 0)
            if tot <= 0:
                continue
            for side, frac in (('Left', f_left), ('Right', 1 - f_left)):
                g = grp[f'{side}{lv}']
                if frac * tot > 1e-4:
                    g.add([v.index], frac * tot, 'REPLACE')
                else:
                    g.remove([v.index])
        blended += 1
    print(f'ROBE blended left/right leg weights on {blended} vertices')

unweighted = sum(1 for v in mesh.data.vertices if not any(g.weight > 0 for g in v.groups))
print(f'SKIN groups {len(mesh.vertex_groups)}, unweighted verts {unweighted}')

# ---------------- reference check ----------------
if ref_path:
    before = set(bpy.data.objects.keys())
    bpy.ops.import_scene.gltf(filepath=ref_path)
    ref_arm = next(o for o in bpy.data.objects if o.name not in before and o.type == 'ARMATURE')
    errs = []
    for b in ref_arm.data.bones:
        if b.name in arm_data.bones:
            d = ((ref_arm.matrix_world @ b.head_local) - (arm.matrix_world @ arm_data.bones[b.name].head_local)).length
            errs.append((d, b.name))
            print(f'POS {b.name:14s} ours {tuple(round(x, 3) for x in arm.matrix_world @ arm_data.bones[b.name].head_local)} ref {tuple(round(x, 3) for x in ref_arm.matrix_world @ b.head_local)}')
    for d, n in sorted(errs, reverse=True):
        print(f'REF {n:16s} off by {d * 100:5.1f} cm')
    for o in [o for o in bpy.data.objects if o.name not in before]:
        bpy.data.objects.remove(o, do_unlink=True)

# ---------------- export ----------------
os.makedirs(os.path.dirname(out) or '.', exist_ok=True)
bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', export_animation_mode='ACTIONS', export_image_format='AUTO')
print('EXPORTED', out)
