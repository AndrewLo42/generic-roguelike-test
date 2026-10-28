"""
Turn Meshy downloads (rigged mesh + animation GLBs) into one game-ready GLB.

    Blender -b --python tools/blender/import_meshy.py -- assets-src/meshy/warrior/import.json [--preview DIR]

The JSON config (see assets-src/meshy/warrior/import.json) lists:
  rigged    the rigged character GLB (mesh + skeleton)
  anims     GLBs whose actions we take clips from (Meshy names, e.g. "Charged_Slash")
  clips     canonical clip name -> {src, start?, end? (seconds), reverse?, mirror?, hold?}
            hold: freeze the pose at that time (static loop, e.g. an in-air pose); hold_root: time
            whose hips location to keep (0 = standing height, so the game's physics owns the jump);
            hold_upper / hold_upper_t: take spine, arms and head from another clip (keep the weapon guard)
            Canonical names are the KayKit-style names the game already uses (Idle, Dodge_Forward,
            2H_Melee_Attack_Slice, ...); src matches a Meshy action name.
  textures  max size per texture role (baseColor / normal / metallicRoughness)
  props     weapon meshes borrowed from another GLB, parented to hand bones, scaled to `length`
            metres; optional per-item `rot` (deg, bone space) and `offset` (m, bone space)
Everything is exported with one animation per canonical clip; non-canonical actions are dropped.
"""
import bpy, sys, json, math, os, re
from mathutils import Matrix, Vector, Euler

argv = sys.argv[sys.argv.index('--') + 1:]
cfg_path = argv[0]
preview = argv[argv.index('--preview') + 1] if '--preview' in argv else None
cfg = json.load(open(cfg_path))
if '--out' in argv:
    cfg['out'] = argv[argv.index('--out') + 1]
if '--selfrig' in argv:  # use our own rig (tools/blender/auto_rig.py) instead of Meshy's
    cfg['selfrig'] = argv[argv.index('--selfrig') + 1]

bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
FPS = sc.render.fps / sc.render.fps_base


def fcurves(act):
    """All F-curves of a (Blender 4.4+ layered) action."""
    out = []
    for layer in act.layers:
        for strip in layer.strips:
            for cb in strip.channelbags:
                out.extend(cb.fcurves)
    return out


def assign(arm, act):
    arm.animation_data.action = act
    if act.slots:
        arm.animation_data.action_slot = act.slots[0]


def new_objects(before):
    return [o for o in bpy.data.objects if o.name not in before]


# ---------------- character ----------------
before = {o.name for o in bpy.data.objects}
bpy.ops.import_scene.gltf(filepath=cfg['rigged'])
char_objs = new_objects(before)
arm = next(o for o in char_objs if o.type == 'ARMATURE')
mesh = next(o for o in char_objs if o.type == 'MESH')
if not arm.animation_data:
    arm.animation_data_create()
for a in list(bpy.data.actions):  # the rig's bind-pose clip
    bpy.data.actions.remove(a)

# ---------------- source clips ----------------
for path in cfg['anims']:
    before = {o.name for o in bpy.data.objects}
    bpy.ops.import_scene.gltf(filepath=path)
    for o in new_objects(before):
        bpy.data.objects.remove(o, do_unlink=True)
for a in bpy.data.actions:
    a.use_fake_user = True


def find_src(name):
    for a in bpy.data.actions:
        parts = a.name.split('|')
        if a.name == name or name in parts:
            return a
    raise SystemExit(f'no source action "{name}" in {[a.name for a in bpy.data.actions]}')


def rebuild(fc, pts):
    """Replace an F-curve's keys with (frame, value) pairs, linearly interpolated (Meshy clips are densely sampled)."""
    fc.keyframe_points.clear()
    fc.keyframe_points.add(len(pts))
    for kp, (x, y) in zip(fc.keyframe_points, pts):
        kp.co = (x, y)
        kp.interpolation = 'LINEAR'
    fc.update()


def trim(act, start, end):
    a, b = start * FPS, end * FPS
    for fc in fcurves(act):
        inner = [(k.co.x, k.co.y) for k in fc.keyframe_points if a + 1e-4 < k.co.x < b - 1e-4]
        pts = [(a, fc.evaluate(a)), *inner, (b, fc.evaluate(b))]
        rebuild(fc, [(x - a, y) for x, y in pts])
    act.frame_range = (0, b - a)


def reverse(act):
    f0, f1 = act.frame_range
    for fc in fcurves(act):
        pts = [(f0 + f1 - k.co.x, k.co.y) for k in fc.keyframe_points]
        rebuild(fc, sorted(pts))


UPPER = re.compile(r'^(Spine|neck|Head|head|Left(Shoulder|Arm|ForeArm|Hand)|Right(Shoulder|Arm|ForeArm|Hand))')


def hold(act, t, root_t, root_bone, upper_src=None, upper_t=0):
    """Turn a clip into a static 1s pose: every channel frozen at `t` seconds, except the root bone's
    location, frozen at `root_t` (e.g. standing height) so in-air poses don't add their own jump height
    on top of the game's physics. With `upper_src`, spine/arms/head come from that action at `upper_t`
    (e.g. keep the weapon guard while the legs tuck)."""
    root_path = f'pose.bones["{root_bone}"].location'
    upper_fc = {}
    if upper_src:
        upper_fc = {(fc.data_path, fc.array_index): fc for fc in fcurves(upper_src)}
    for fc in fcurves(act):
        bone = fc.data_path.split('"')[1] if '"' in fc.data_path else ''
        src = upper_fc.get((fc.data_path, fc.array_index)) if UPPER.match(bone) else None
        if src:
            v = src.evaluate(upper_t * FPS)
        else:
            v = fc.evaluate((root_t if fc.data_path == root_path else t) * FPS)
        rebuild(fc, [(0, v), (FPS, v)])
    act.frame_range = (0, FPS)


def flip_name(n):
    return n.replace('Left', '\0').replace('Right', 'Left').replace('\0', 'Right')


def mirror(act, name):
    """Bake a left/right mirrored copy (mirror across the armature's X axis)."""
    assign(arm, act)
    f0, f1 = (int(round(x)) for x in act.frame_range)
    S = Matrix.Scale(-1, 4, Vector((1, 0, 0)))
    frames = {}
    for f in range(f0, f1 + 1):
        sc.frame_set(f)
        frames[f] = {pb.name: pb.matrix.copy() for pb in arm.pose.bones}
    out = bpy.data.actions.new(name)
    out.use_fake_user = True
    assign(arm, out)
    order = sorted(arm.pose.bones, key=lambda pb: len(pb.parent_recursive))
    for f, mats in frames.items():
        for pb in order:
            src = mats.get(flip_name(pb.name), mats[pb.name])
            pb.matrix = S @ src @ S
            bpy.context.view_layer.update()
        for pb in order:
            pb.keyframe_insert('location', frame=f)
            pb.keyframe_insert('rotation_quaternion', frame=f)
    return out


canon = []
for cname, spec in cfg['clips'].items():
    src = find_src(spec['src'])
    act = src.copy()
    act.name = cname
    act.use_fake_user = True
    if 'hold' in spec:
        hold(act, spec['hold'], spec.get('hold_root', 0), spec.get('root_bone', 'Hips'),
             find_src(spec['hold_upper']) if spec.get('hold_upper') else None, spec.get('hold_upper_t', 0))
    elif 'start' in spec or 'end' in spec:
        trim(act, spec.get('start', 0), spec.get('end', (src.frame_range[1]) / FPS))
    if spec.get('reverse'):
        reverse(act)
    if spec.get('mirror'):
        m = mirror(act, cname + '_m')
        bpy.data.actions.remove(act)
        m.name = cname
        act = m
    canon.append(act)
    print(f'CLIP {cname:32s} <- {spec["src"]:26s} {(act.frame_range[1] - act.frame_range[0]) / FPS:.2f}s')

keep = {a.name for a in canon}
for a in list(bpy.data.actions):
    if a.name not in keep:
        bpy.data.actions.remove(a)

# ---------------- retarget onto our own rig ----------------
# With `selfrig` (an auto_rig.py output: same body bone names + fingers), the clips built above on Meshy's
# rig are re-baked onto ours: each bone gets the same world-space rotation *change from its rest pose* as
# on the source (so differing rest orientations don't matter), and the hips the same translation change.
if cfg.get('selfrig'):
    src_arm, src_mesh = arm, mesh
    before = {o.name for o in bpy.data.objects}
    acts_before = set(bpy.data.actions.keys())
    bpy.ops.import_scene.gltf(filepath=cfg['selfrig'])
    for a in [a for a in bpy.data.actions if a.name not in acts_before]:
        bpy.data.actions.remove(a)
    new = new_objects(before)
    tgt = next(o for o in new if o.type == 'ARMATURE')
    tgt_mesh = next(o for o in new if o.type == 'MESH')
    if not tgt.animation_data:
        tgt.animation_data_create()

    def rot_of(m):
        return m.to_3x3().normalized().to_quaternion()

    src_rest = {b.name: rot_of(src_arm.matrix_world @ b.matrix_local) for b in src_arm.data.bones}
    tgt_rest_w = {b.name: rot_of(tgt.matrix_world @ b.matrix_local) for b in tgt.data.bones}
    src_hips0 = src_arm.matrix_world @ src_arm.data.bones['Hips'].head_local
    tgt_hips0 = tgt.matrix_world @ tgt.data.bones['Hips'].head_local
    tgt_inv = tgt.matrix_world.inverted()
    order = sorted(tgt.data.bones, key=lambda b: len(b.parent_recursive))
    for pb in tgt.pose.bones:
        pb.rotation_mode = 'QUATERNION'
    retargeted = []
    for act in canon:
        assign(src_arm, act)
        f0, f1 = act.frame_range
        frames = list(range(int(f0), int(math.ceil(f1)) + 1))
        out = bpy.data.actions.new(act.name + '_rt')
        out.use_fake_user = True
        assign(tgt, out)
        for f in frames:
            sc.frame_set(f)
            pose = {}  # target armature-space pose matrices
            for b in order:
                spb = src_arm.pose.bones.get(b.name)
                rest = b.matrix_local
                if b.parent:
                    par = pose[b.parent.name]
                    rel = b.parent.matrix_local.inverted() @ rest
                    chain = par @ rel  # where the bone sits if it doesn't rotate relative to its parent
                else:
                    chain = rest
                if spb is not None:
                    delta = rot_of(src_arm.matrix_world @ spb.matrix) @ src_rest[b.name].inverted()
                    rw = delta @ tgt_rest_w[b.name]
                    r_arm = rot_of(tgt_inv) @ rw
                    loc = chain.to_translation()
                    if b.name == 'Hips':
                        dp = (src_arm.matrix_world @ spb.head) - src_hips0
                        loc = tgt_inv @ (tgt_hips0 + dp)
                    pose[b.name] = Matrix.LocRotScale(loc, r_arm, None)
                else:
                    pose[b.name] = chain  # fingers, leaf bones: follow the parent
                if spb is None:
                    continue  # fingers / leaf bones: no source motion; poses are added later (fists)
                pb = tgt.pose.bones[b.name]
                base = (b.parent.matrix_local.inverted() @ rest) if b.parent else rest
                parent_pose = pose[b.parent.name] if b.parent else Matrix.Identity(4)
                basis = base.inverted() @ parent_pose.inverted() @ pose[b.name]
                pb.rotation_quaternion = basis.to_quaternion()
                pb.keyframe_insert('rotation_quaternion', frame=f)
                if b.name == 'Hips':
                    pb.location = basis.to_translation()
                    pb.keyframe_insert('location', frame=f)
        name = act.name
        bpy.data.actions.remove(act)
        out.name = name
        retargeted.append(out)
    canon = retargeted
    for o in (src_mesh, src_arm):
        bpy.data.objects.remove(o, do_unlink=True)
    arm, mesh = tgt, tgt_mesh
    print(f'RETARGET {len(canon)} clips onto {cfg["selfrig"]}')

# ---------------- procedural aim clips ----------------
# `"aim": "Right"` (or "Left") on a clip: instead of a library clip, build a short shot from the source pose
# (e.g. the combat idle): that arm swings up to point straight ahead, kicks up a little recoil and settles.
# `"aim": "bow"`: a longbow draw: the left arm pushes the bow forward, the right hand draws to the cheek,
# snaps back on release, then both arms settle. Only the arms move, so firing doesn't throw the body around.
# Directions are in world space; the character faces -Y with her left on +X.
from mathutils import Quaternion
FWD = Vector((0, -1, 0.07))


TURN = {'Spine02': -8, 'Spine01': -10, 'Spine': -12, 'neck': 14, 'Head': 16}
BOW_ARM = (FWD + Vector((0.08, 0, 0))).normalized()
BOW_LOW = Vector((0.08, -1, -0.25)).normalized()


def aim_pose(mode, phase, pitch=0, u=0.0):
    """(bone -> target direction, bone -> turn about world Z in degrees, right-hand target spec) for a phase.
    The bow's drawing hand is placed by position (two-bone IK) so its path can go around the head."""
    if mode == 'bow':
        # A right-handed archer turns side-on: chest rotates right (clockwise from above), head stays on target.
        if phase == 'nock':  # bow coming up, drawing hand at the string just behind the bow hand
            return ({'LeftArm': BOW_LOW, 'LeftForeArm': BOW_LOW, 'LeftHand': BOW_LOW},
                    {k: v * 0.4 for k, v in TURN.items()}, ('nock', 0))
        if phase == 'path':  # drawing back: u = 0..1 from the string to the jaw anchor
            d = BOW_LOW.lerp(BOW_ARM, u).normalized()
            return ({'LeftArm': d, 'LeftForeArm': d, 'LeftHand': d},
                    {k: v * (0.4 + 0.6 * u) for k, v in TURN.items()}, ('path', u))
        if phase == 'draw':
            return ({'LeftArm': BOW_ARM, 'LeftForeArm': BOW_ARM, 'LeftHand': BOW_ARM}, TURN, ('anchor', 0))
        # release: a small follow-through, the hand slides back a few cm along the jaw toward the ear
        return ({'LeftArm': BOW_ARM, 'LeftForeArm': BOW_ARM, 'LeftHand': BOW_ARM},
                {k: v * 1.05 for k, v in TURN.items()}, ('release', 0))
    d = Vector((0, -1, math.tan(math.radians(4 + pitch))))
    return {f'{mode}Arm': d, f'{mode}ForeArm': d, f'{mode}Hand': d}, {}, None


AIM_KEYS = {  # (time s, weight, phase, recoil pitch deg or path fraction)
    'pistol': [(0.0, 0, 'aim', 0), (0.12, 1, 'aim', 0), (0.3, 1, 'aim', 9), (0.45, 1, 'aim', 0), (0.62, 1, 'aim', 0), (0.85, 0, 'aim', 0)],
    # nock -> draw (along a path around the face) -> release lands at ~0.4 of the clip (the skill's impact)
    'bow': [(0.0, 0, 'nock', 0), (0.14, 1, 'nock', 0)]
           + [(0.14 + 0.2 * k / 5, 1, 'path', k / 5) for k in range(1, 5)]
           + [(0.34, 1, 'draw', 0), (0.39, 1, 'release', 0), (0.58, 1, 'release', 0), (0.95, 0, 'release', 0)],
}
POLE = Vector((-1, 0.5, -0.35)).normalized()  # drawing elbow points out to the right, back and a bit down


def hand_target(spec, head, bow_hand):
    """World position of the drawing hand. Offsets are in world space (she faces -Y, her right is -X)."""
    nock = bow_hand + Vector((-0.04, 0.10, 0.02))
    anchor = head + Vector((-0.08, -0.04, -0.09))  # corner of the jaw, on her right
    kind, u = spec
    if kind == 'nock':
        return nock
    if kind == 'anchor':
        return anchor
    if kind == 'release':
        return anchor + Vector((-0.03, 0.07, 0.0))
    # quadratic Bezier bulging out to her right and in front of the face, so the hand never cuts through it
    ctrl = (nock + anchor) / 2 + Vector((-0.16, -0.08, 0.04))
    return nock * (1 - u) ** 2 + ctrl * 2 * u * (1 - u) + anchor * u * u


def two_bone_ik(S, T, l1, l2, pole):
    """Elbow position for shoulder S reaching target T with bone lengths l1, l2, elbow bending toward pole."""
    v = T - S
    d = max(1e-4, min(v.length, (l1 + l2) * 0.999))
    n = v.normalized()
    a = math.acos(max(-1, min(1, (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d))))
    p = (pole - n * pole.dot(n)).normalized()
    return S + n * (l1 * math.cos(a)) + p * (l1 * math.sin(a))


def build_aim(act, mode, name):
    assign(arm, act)
    sc.frame_set(int(act.frame_range[0]))
    bpy.context.view_layer.update()
    order = sorted(arm.pose.bones, key=lambda pb: len(pb.parent_recursive))
    base = {pb.name: pb.matrix.copy() for pb in order}  # armature-space rest-of-body pose
    Mw = arm.matrix_world
    to_arm = Mw.to_3x3().inverted()
    up_axis = (to_arm @ Vector((0, 0, 1))).normalized()
    bl = lambda n: (Mw @ arm.data.bones[n].tail_local - Mw @ arm.data.bones[n].head_local).length
    out = bpy.data.actions.new(name)
    out.use_fake_user = True
    assign(arm, out)
    prev = {}
    clearance = []

    def aim_bone(pb, world_dir, w, up=None):
        m = pb.matrix.copy()
        tgt = (to_arm @ world_dir.normalized()).normalized()
        full = m.col[1].xyz.normalized().rotation_difference(tgt)
        if up is not None:
            # Also roll about the aimed axis so the bone's Z (the thumb side) points along `up`.
            z = (full.to_matrix() @ m.to_3x3().normalized()).col[2]
            upa = to_arm @ up
            upa = (upa - tgt * upa.dot(tgt)).normalized()
            z = (z - tgt * z.dot(tgt)).normalized()
            full = z.rotation_difference(upa) @ full
        loc, rot, scl = m.decompose()
        pb.matrix = Matrix.LocRotScale(loc, Quaternion((1, 0, 0, 0)).slerp(full, w) @ rot, scl)
        bpy.context.view_layer.update()

    for t, w, phase, extra in AIM_KEYS['bow' if mode == 'bow' else 'pistol']:
        for pb in order:
            pb.matrix = base[pb.name]
            bpy.context.view_layer.update()
        targets, turns, hand_spec = aim_pose(mode, phase, pitch=extra, u=extra)
        for pb in order:  # pass 1, parents first: torso turns and direction aims
            if pb.name in turns:
                m = pb.matrix.copy(); loc, rot, scl = m.decompose()
                q = Quaternion((1, 0, 0, 0)).slerp(Quaternion(up_axis, math.radians(turns[pb.name])), w)
                pb.matrix = Matrix.LocRotScale(loc, q @ rot, scl)
                bpy.context.view_layer.update()
            elif pb.name in targets:
                aim_bone(pb, targets[pb.name], w, Vector((0, 0, 1)) if (mode == 'bow' and pb.name == 'LeftHand') else None)
        if hand_spec:  # pass 2: place the drawing hand by IK
            P = lambda n: Mw @ arm.pose.bones[n].head
            T = hand_target(hand_spec, P('Head'), P('LeftHand') + (Mw.to_3x3() @ arm.pose.bones['LeftHand'].y_axis).normalized() * 0.08)
            S = P('RightArm')
            E = two_bone_ik(S, T, bl('RightArm'), bl('RightForeArm'), POLE)
            aim_bone(arm.pose.bones['RightArm'], E - S, w)
            aim_bone(arm.pose.bones['RightForeArm'], T - E, w)
            aim_bone(arm.pose.bones['RightHand'], T - E, w)
            head = P('Head') + Vector((0, 0, 0.09))  # roughly the centre of the skull
            segs = [(P('RightForeArm'), P('RightHand')), (P('RightHand'), Mw @ arm.pose.bones['RightHand'].tail)]
            dmin = min(((a + (b - a) * k / 8) - head).length for a, b in segs for k in range(9))
            clearance.append((t, dmin))
        for pb in order:
            pb.rotation_mode = 'QUATERNION'
            q = pb.rotation_quaternion.copy()
            # q and -q are the same rotation; keep neighbouring keys in the same hemisphere so the
            # interpolation takes the short way round (otherwise a limb can whip through a full turn).
            if pb.name in prev and q.dot(prev[pb.name]) < 0:
                q.negate()
                pb.rotation_quaternion = q
            prev[pb.name] = q
            pb.keyframe_insert('rotation_quaternion', frame=t * FPS)
            if pb.name == 'Hips':
                pb.keyframe_insert('location', frame=t * FPS)
    if clearance:
        print('  arm-to-head clearance (cm): ' + ', '.join(f'{t:.2f}s {d * 100:.0f}' for t, d in clearance))
    return out


for cname, spec in cfg['clips'].items():
    if not spec.get('aim'):
        continue
    i = next(k for k, a in enumerate(canon) if a.name == cname)
    new = build_aim(canon[i], spec['aim'], cname + '_aim')
    bpy.data.actions.remove(canon[i])
    new.name = cname
    canon[i] = new
    print(f'AIM {cname}: {spec["aim"]}')
arm.animation_data.action = None

# ---------------- textures ----------------
for img in bpy.data.images:
    n = img.name.lower()
    role = 'normal' if 'normal' in n else 'metallicRoughness' if 'metal' in n or 'rough' in n else 'baseColor'
    cap = cfg.get('textures', {}).get(role)
    if cap and img.size[0] > cap:
        print(f'TEX {img.name} {tuple(img.size)} -> {cap}')
        img.scale(cap, cap)

# ---------------- props (weapons) ----------------
props = []
arm.animation_data.action = None  # rest pose for placing props
for pb in arm.pose.bones:
    pb.matrix_basis = Matrix.Identity(4)
bpy.context.view_layer.update()


def hand_frame(name):
    """World transform of a hand bone at rest, without the rig's centimetre scale (metres, bone axes)."""
    t, r, _ = (arm.matrix_world @ arm.data.bones[name].matrix_local).decompose()
    return Matrix.LocRotScale(t, r, None)


def import_glb(path):
    """Import a GLB, dropping any actions it brings. Returns the new objects."""
    before = {o.name for o in bpy.data.objects}
    acts_before = {a.name for a in bpy.data.actions}
    bpy.ops.import_scene.gltf(filepath=path)
    for a in list(bpy.data.actions):
        if a.name not in acts_before:
            bpy.data.actions.remove(a)
    return new_objects(before)


# ---------------- props, pass 1: prepare & measure ----------------
# Props are prepared (normalised, scaled, oriented) and their handles measured *before* the fingers are
# posed, so each fist can be shaped around what it actually holds; they're attached after (pass 2).
prepared = []  # (name, spec, object, info)
imported = []
if cfg.get('props'):
    # Props come from a shared GLB (`props.from`, e.g. KayKit's Knight, looked up by node name) or
    # from their own file (`file`, e.g. a Meshy weapon: its single mesh is used).
    imported = import_glb(cfg['props']['from']) if cfg['props'].get('from') else []
    for pname, spec in cfg['props']['items'].items():
        if spec.get('file'):
            objs = import_glb(spec['file'])
            imported += objs
            src = next(o for o in objs if o.type == 'MESH')
            for img in {n.image for m in src.data.materials if m and m.use_nodes
                        for n in m.node_tree.nodes if n.type == 'TEX_IMAGE' and n.image}:
                cap = spec.get('tex', 1024)
                if img.size[0] > cap:
                    img.scale(cap, cap)
        else:
            src = next(o for o in imported if o.name == pname or o.name.startswith(pname + '.'))
        o = src.copy()
        o.data = src.data.copy()
        # Bake the source's rotation/scale only: props inside a character file (KayKit) sit at that character's
        # hand, and baking the translation would shift the geometry ~0.5 m away from the grip.
        o.data.transform(src.matrix_world.to_3x3().to_4x4())
        bpy.context.collection.objects.link(o)
        o.parent = None
        o.matrix_world = Matrix.Identity(4)
        # Normalise the prop's axes: longest extent -> Z (blade / shaft), widest remaining -> X (crossguard),
        # thinnest -> Y. Different sources model props lying along different axes.
        # Measure from vertices: the cached bound_box is stale right after data.transform().
        def extents():
            vs = [v.co for v in o.data.vertices]
            return Vector((max(v[i] for v in vs) - min(v[i] for v in vs) for i in range(3)))
        ext = extents()
        if spec.get('grip') in ('fist', 'shield', 'palm', 'pistol'):
            order = sorted(range(3), key=lambda i: ext[i])  # thinnest .. longest
            ax_z, ax_x = order[2], order[1]
            ax_y = 3 - ax_z - ax_x
            if spec.get('grip') == 'shield':  # a shield: thinnest axis is Y (face normal), keep X/Z as they are
                ax_y = order[0]; ax_x, ax_z = sorted(i for i in range(3) if i != ax_y)
            rows = [[1.0 if c == a else 0.0 for c in range(3)] for a in (ax_x, ax_y, ax_z)]
            R = Matrix(rows)
            if R.determinant() < 0:
                R[1] = -R[1]
            o.data.transform(R.to_4x4())
            if spec.get('grip') == 'fist':
                # Centre the shaft on the grip axis (X/Y), so the handle really passes through the fist.
                vs = [v.co for v in o.data.vertices]
                cx = (min(v.x for v in vs) + max(v.x for v in vs)) / 2
                cy = (min(v.y for v in vs) + max(v.y for v in vs)) / 2
                o.data.transform(Matrix.Translation((-cx, -cy, 0)))
            ext = extents()
        k = spec['length'] / max(ext)
        o.data.transform(Matrix.Scale(k, 4))
        info = {'k': k}
        if spec.get('grip') == 'fist':
            # Handle through the fist; blade (or a staff's wide `head`) out of the thumb side (+Z). The grip
            # centre is midway between the pommel and the crossguard (the widest slice along Z), or `grip_at`.
            vs = [v.co for v in o.data.vertices]
            zmin, zmax = min(v.z for v in vs), max(v.z for v in vs)
            slices = {}
            for v in vs:
                b = round((v.z - zmin) / (zmax - zmin) * 40)
                slices[b] = max(slices.get(b, 0), abs(v.x))
            guard_z = zmin + max(slices, key=slices.get) / 40 * (zmax - zmin)
            wide_up = spec.get('head') == 'wide'
            if (guard_z > (zmin + zmax) / 2) != wide_up:
                o.data.transform(Matrix.Rotation(math.pi, 4, 'X'))
                vs = [v.co for v in o.data.vertices]
                zmin, zmax = min(v.z for v in vs), max(v.z for v in vs)
                guard_z = zmin + zmax - guard_z
            grip_z = (zmin + guard_z) / 2
            def ring_at(z):
                """Cross-section of the handle at height z: (centre x, centre y, radius), or None."""
                ring = [v for v in vs if abs(v.z - z) < 0.015]
                if len(ring) < 4:
                    return None
                cx = (min(v.x for v in ring) + max(v.x for v in ring)) / 2
                cy = (min(v.y for v in ring) + max(v.y for v in ring)) / 2
                return cx, cy, max(math.hypot(v.x - cx, v.y - cy) for v in ring)
            if 'grip_at' in spec:  # staffs / wands: hold near a fraction of the length from the butt end,
                # sliding to the slimmest section within +-10% of the length (where a hand naturally holds)
                L = zmax - zmin
                base = zmin + spec['grip_at'] * L
                span = 0.1 if spec.get('slide', True) else 0.0  # "slide": false = hold exactly at grip_at
                cands = [(r[2], z) for z in [base + L * span * (i / 4 - 1) for i in range(9)] if (r := ring_at(z))]
                grip_z = min(cands)[1] if cands else base
            # Centre the handle on the grip axis *at the grip* (a lopsided head or crossguard would otherwise
            # put the shaft off-centre in the fist), and measure its radius there (the fist is sized to fit).
            cx, cy, radius = ring_at(grip_z) or (0.0, 0.0, 0.015)
            radius = spec.get('grip_radius', radius)  # override when other parts (a bowstring) share the slice
            o.data.transform(Matrix.Translation((-cx, -cy, 0)))
            info.update(zmin=zmin, guard_z=guard_z, grip_z=grip_z, radius=radius)
        if spec.get('grip') == 'pistol':
            # Hand crossbows / pistols: the front is the end nearer the bow (the widest slice); put it at +Z.
            # Width is measured across each slice (max - min), not from the origin: props' pivots are off-centre.
            vs = [v.co for v in o.data.vertices]
            zmin, zmax = min(v.z for v in vs), max(v.z for v in vs)
            lo_x, hi_x = {}, {}
            for v in vs:
                b = min(19, int((v.z - zmin) / (zmax - zmin) * 20))
                lo_x[b] = min(lo_x.get(b, 1e9), v.x); hi_x[b] = max(hi_x.get(b, -1e9), v.x)
            widest = max(lo_x, key=lambda b: hi_x[b] - lo_x[b])
            front_up = spec.get('front', 'auto')
            if (front_up == 'auto' and widest < 10) or front_up == 'flip':
                o.data.transform(Matrix.Rotation(math.pi, 4, 'X'))
            print(f'  {pname}: bow at {(widest + 0.5) / 20:.2f} of its length from the {"low" if widest < 10 else "high"} end')
            vs = [v.co for v in o.data.vertices]
            info['zmin'], info['zmax'] = min(v.z for v in vs), max(v.z for v in vs)
            info['ymin'] = min(v.y for v in vs)
        prepared.append((pname, spec, o, info))
    for o in imported:
        bpy.data.objects.remove(o, do_unlink=True)

# Per hand: the thickest handle it holds (fists are a fixed pose per character, so fit the thickest).
hand_grip_r = {}
for pname, spec, o, info in prepared:
    if 'radius' in info:
        hand_grip_r[spec['hand']] = max(hand_grip_r.get(spec['hand'], 0), info['radius'])

# ---------------- fists ----------------
# Meshy rigs have no finger bones and A-pose concepts give open hands, so weapons can't be gripped.
# Bend the finger vertices (past the knuckle line, thumb excluded) along an arc toward the palm, wrapping
# a grip of `radius` metres. Bone space: +Y wrist->fingertips, palm on -X (right) / +X (left), thumb on +Z
# (it points forward in the A-pose). The thumb curls too, which reads as a thumb wrapped over the fingers.
# Records each fist's grip axis centre (bone space) for placing weapons.
fists = {}
FINGERS = ('Index', 'Middle', 'Ring', 'Pinky')
if cfg.get('selfrig'):
    # Real finger bones: key a fist into every clip (Meshy clips never move fingers) and derive each fist's
    # grip centre from the finger bones instead of bending the mesh.
    fcfg = cfg.get('fingers', {})
    curl = [math.radians(a) for a in fcfg.get('curl', [70, 80, 60])]
    # Thumb joints: [x, z] degrees — x folds it across the fingers (toward -Z), z curls it toward the palm.
    thumb = [(math.radians(x), math.radians(z)) for x, z in fcfg.get('thumb', [[0, 15], [0, 25], [0, 20]])]
    for hand, spec in (cfg.get('fists') or {}).items():
        palm = Vector(spec['palm'])
        sign = 1 if palm.x < 0 else -1  # rotating about +Z moves +Y toward -X
        H = hand_frame(hand); Hi = H.inverted()
        b1 = {f: Hi @ (arm.matrix_world @ arm.data.bones[f'{hand}{f}1'].head_local) for f in FINGERS}
        length = sum((arm.data.bones[f'{hand}Middle{k}'].length for k in (1, 2, 3))) * arm.matrix_world.to_scale().x
        R = length / sum(curl)
        hc = fcfg.get(hand, {})
        h_curl = [math.radians(x) for x in hc['curl']] if 'curl' in hc else curl
        if hand in hand_grip_r and 'curl' not in hc:
            # Wrap the fingers around the thickest handle this hand holds: the finger centreline sits one
            # finger-half-thickness outside the handle, and the curl spreads over the joints in the
            # configured proportions. Thick staves get a looser grip, slim sword handles a tight one.
            R = hand_grip_r[hand] + fcfg.get('finger_half', 0.009)
            total = min(length / R, math.radians(fcfg.get('max_wrap', 260)))
            h_curl = [c * total / sum(curl) for c in curl]
            print(f'FIT {hand}: handle radius {hand_grip_r[hand] * 100:.1f} cm -> fingers wrap {math.degrees(total):.0f} deg')
        y0 = b1['Middle'].y
        s_c = b1['Middle'].dot(palm)
        z_c = (b1['Index'].z + b1['Pinky'].z) / 2
        fists[hand] = palm * (s_c + R) + Vector((0, y0, z_c))
        # Close the fan first: rotate each finger's base in the palm plane (about its X, the palm normal)
        # by its rest angle from the hand's length axis, so the curled fingers sit together.
        # Per-hand overrides, e.g. "LeftHand": {"curl": [...]} for an open hand holding a book.
        h_thumb = [(math.radians(x), math.radians(z)) for x, z in hc['thumb']] if 'thumb' in hc else thumb
        poses = {}
        for f in FINGERS:
            b = arm.data.bones[f'{hand}{f}1']
            d = (Hi.to_3x3() @ (arm.matrix_world.to_3x3() @ (b.tail_local - b.head_local))).normalized()
            fan = math.atan2(d.z, d.y) * fcfg.get('close', 0.9)
            for k in (1, 2, 3):
                adduct = Euler((-fan if k == 1 else 0, 0, 0)).to_quaternion()
                poses[f'{hand}{f}{k}'] = Euler((0, 0, sign * h_curl[k - 1])).to_quaternion() @ adduct
        poses.update({f'{hand}Thumb{k}': Euler((h_thumb[k - 1][0], 0, sign * h_thumb[k - 1][1])).to_quaternion() for k in (1, 2, 3)})
        for act in canon:
            assign(arm, act)
            for name, q in poses.items():
                pb = arm.pose.bones[name]
                pb.rotation_mode = 'QUATERNION'
                pb.rotation_quaternion = q
                for f in (act.frame_range[0], act.frame_range[1]):
                    pb.keyframe_insert('rotation_quaternion', frame=f)
        print(f'FINGERS {hand}: fist keyed into {len(canon)} clips, grip centre {tuple(round(x, 3) for x in fists[hand])}')
    arm.animation_data.action = None
    for pb in arm.pose.bones:
        pb.matrix_basis = Matrix.Identity(4)
    bpy.context.view_layer.update()
for hand, spec in ({} if cfg.get('selfrig') else (cfg.get('fists') or {})).items():
    H = hand_frame(hand); Hi = H.inverted()
    Mw, Mwi = mesh.matrix_world, mesh.matrix_world.inverted()
    gi = mesh.vertex_groups[hand].index
    palm = Vector(spec['palm'])  # unit vector toward the palm, bone space
    y0, R, wrap = spec['knuckle'], spec['radius'], math.radians(spec.get('wrap', 230))
    verts = [(v, Hi @ (Mw @ v.co)) for v in mesh.data.vertices
             if next((g.weight for g in v.groups if g.group == gi), 0) > 0.5]
    fingers = [(v, p) for v, p in verts if p.y > y0]
    s_c = sum(p.dot(palm) for _, p in fingers) / len(fingers)  # finger centreline depth along the palm axis
    z_c = sum(p.z for _, p in fingers) / len(fingers)
    axis_s = s_c + R  # grip axis sits R inside the palm from the finger centreline
    for v, p in fingers:
        s = p.dot(palm)  # depth toward the palm (palm is ±X, so this is ±p.x)
        rho = axis_s - s  # distance from the grip axis
        phi = min((p.y - y0) / R, wrap)  # arc length past the knuckle -> wrap angle
        q = palm * (axis_s - rho * math.cos(phi)) + Vector((0, y0 + rho * math.sin(phi), p.z))
        v.co = Mwi @ (H @ q)
    mesh.data.update()
    fists[hand] = palm * axis_s + Vector((0, y0, z_c))
    print(f'FIST {hand}: curled {len(fingers)} verts, grip centre {tuple(round(x, 3) for x in fists[hand])}')

# ---------------- two-handed grips ----------------
# `"two_hand": {"along": -0.13}` on a clip: every frame, the left hand is placed on the right hand's weapon
# handle, `along` metres from the right fist along the handle (negative = toward the pommel), by two-bone IK.
# The left hand takes the right hand's orientation: for two hands on one handle the knuckles face the same
# way and (with the mirrored hand rigs) the palms wrap from opposite sides, like a bat grip.
two_hand = [(n, spec['two_hand']) for n, spec in cfg['clips'].items() if spec.get('two_hand')]
if two_hand:
    Mw = arm.matrix_world
    to_arm = Mw.to_3x3().inverted()
    lenL = lambda n: (Mw @ arm.data.bones[n].tail_local - Mw @ arm.data.bones[n].head_local).length
    l1, l2 = lenL('LeftArm'), lenL('LeftForeArm')
    POLE_L = Vector((1, 0.3, -0.6)).normalized()  # left elbow out to her left and down
    POLE_R = Vector((-1, 0.3, -0.6)).normalized()
    lR1, lR2 = lenL('RightArm'), lenL('RightForeArm')
    for cname, th in two_hand:
        act = next(a for a in canon if a.name == cname)
        assign(arm, act)
        f0, f1 = (int(round(x)) for x in act.frame_range)
        prev, worst = {}, 0.0
        for f in range(f0, f1 + 1):
            sc.frame_set(f)
            bpy.context.view_layer.update()
            def left_wrist():
                R = arm.pose.bones['RightHand']
                t, rq, _ = (Mw @ R.matrix).decompose()
                target = Matrix.LocRotScale(t, rq, None) @ (fists['RightHand'] + Vector((0, 0, th.get('along', -0.13))))
                # Left wrist so the left fist's grip centre lands on the target with the right hand's rotation.
                return target - rq.to_matrix() @ fists['LeftHand'], rq, t
            if th.get('guard', {}).get('square', True) and 'guard' in th:
                # Square up first: borrowed stances (e.g. a fencer's combat stance) turn the hips and chest
                # ~50 degrees to the side and shift them off-centre. Turn the hips back to face forward (-Y)
                # and re-centre them, so a guard placed "in front" really is in front of the chest.
                hp = arm.pose.bones['Hips']
                sp = arm.pose.bones['Spine']
                rest_q = (Mw @ arm.data.bones['Spine'].matrix_local).to_quaternion()
                cur_q = (Mw @ sp.matrix).to_quaternion()
                fwd = (cur_q @ rest_q.inverted()) @ Vector((0, -1, 0))
                yaw = math.atan2(-fwd.x, -fwd.y)
                hm = hp.matrix.copy(); loc, rot, scl = hm.decompose()
                q = Quaternion((to_arm @ Vector((0, 0, 1))).normalized(), yaw)
                rest_head = arm.data.bones['Hips'].head_local
                loc = Vector((rest_head.x, rest_head.y, loc.z))
                hp.matrix = Matrix.LocRotScale(loc, q @ rot, scl)
                bpy.context.view_layer.update()
                hp.rotation_mode = 'QUATERNION'
                hp.keyframe_insert('rotation_quaternion', frame=f)
                hp.keyframe_insert('location', frame=f)
            if 'guard' in th:
                # Guard pose (idles): the right fist goes to `pos` (metres from the hips, world axes; she/he
                # faces -Y) with the blade pitched `pitch` degrees up from horizontal-forward, knuckles forward.
                g = th['guard']
                hips = Mw @ arm.pose.bones['Hips'].head
                grip = hips + Vector(g.get('pos', (0.0, -0.3, 0.05)))
                pitch = math.radians(g.get('pitch', 60))
                Z = Vector((0, -math.cos(pitch), math.sin(pitch)))          # blade
                Yk = Vector((0, -1, 0)); Yk = (Yk - Z * Yk.dot(Z)).normalized()  # knuckles, forward
                X = Yk.cross(Z)
                rq_g = Matrix((X, Yk, Z)).transposed().to_quaternion()
                rw = grip - rq_g.to_matrix() @ fists['RightHand']
                SR = Mw @ arm.pose.bones['RightArm'].head
                pole = Vector(g.get('elbow', (-1, 0.15, -0.55))).normalized()  # right elbow: out to the side
                ER = two_bone_ik(SR, rw, lR1, lR2, pole)
                for bn, d in (('RightArm', ER - SR), ('RightForeArm', rw - ER)):
                    pb = arm.pose.bones[bn]
                    m = pb.matrix.copy(); loc, rot, scl = m.decompose()
                    dq = m.col[1].xyz.normalized().rotation_difference((to_arm @ d).normalized())
                    pb.matrix = Matrix.LocRotScale(loc, dq @ rot, scl)
                    bpy.context.view_layer.update()
                Rb = arm.pose.bones['RightHand']
                rm = Rb.matrix.copy()
                Rb.matrix = Matrix.LocRotScale(rm.to_translation(), to_arm.to_quaternion() @ rq_g, rm.to_scale())
                bpy.context.view_layer.update()
            S = Mw @ arm.pose.bones['LeftArm'].head
            wrist, rq, rwrist = left_wrist()
            excess = (wrist - S).length - (l1 + l2) * 0.97
            if excess > 0:
                # One-handed source clips hold the weapon out to the side: pull the whole grip toward the left
                # shoulder by the shortfall (re-solving the right arm, keeping the right hand's rotation so the
                # blade angle is unchanged), so both hands can hold it.
                shift = (S - wrist).normalized() * excess
                SR = Mw @ arm.pose.bones['RightArm'].head
                new_rw = rwrist + shift
                ER = two_bone_ik(SR, new_rw, lR1, lR2, POLE_R)
                for bn, d in (('RightArm', ER - SR), ('RightForeArm', new_rw - ER)):
                    pb = arm.pose.bones[bn]
                    m = pb.matrix.copy(); loc, rot, scl = m.decompose()
                    dq = m.col[1].xyz.normalized().rotation_difference((to_arm @ d).normalized())
                    pb.matrix = Matrix.LocRotScale(loc, dq @ rot, scl)
                    bpy.context.view_layer.update()
                Rb = arm.pose.bones['RightHand']
                rm = Rb.matrix.copy()
                Rb.matrix = Matrix.LocRotScale(rm.to_translation(), to_arm.to_quaternion() @ rq, rm.to_scale())
                bpy.context.view_layer.update()
                wrist, rq, _ = left_wrist()
            E = two_bone_ik(S, wrist, l1, l2, POLE_L)
            reach = (wrist - S).length - (l1 + l2)
            worst = max(worst, reach)
            for bn, d in (('LeftArm', E - S), ('LeftForeArm', wrist - E)):
                pb = arm.pose.bones[bn]
                m = pb.matrix.copy(); loc, rot, scl = m.decompose()
                dq = m.col[1].xyz.normalized().rotation_difference((to_arm @ d).normalized())
                pb.matrix = Matrix.LocRotScale(loc, dq @ rot, scl)
                bpy.context.view_layer.update()
            L = arm.pose.bones['LeftHand']
            lm = L.matrix.copy()
            L.matrix = Matrix.LocRotScale(lm.to_translation(), (to_arm.to_quaternion() @ rq), lm.to_scale())
            bpy.context.view_layer.update()
            for bn in ('RightArm', 'RightForeArm', 'RightHand', 'LeftArm', 'LeftForeArm', 'LeftHand'):
                pb = arm.pose.bones[bn]
                pb.rotation_mode = 'QUATERNION'
                q = pb.rotation_quaternion.copy()
                if bn in prev and q.dot(prev[bn]) < 0:
                    q.negate(); pb.rotation_quaternion = q
                prev[bn] = q
                pb.keyframe_insert('rotation_quaternion', frame=f)
        print(f'TWO-HAND {cname}: left hand on the handle {th.get("along", -0.13):+.2f} m from the right fist'
              + (f', short of reach by up to {worst * 100:.0f} cm' if worst > 0.005 else ''))
    arm.animation_data.action = None
    for pb in arm.pose.bones:
        pb.matrix_basis = Matrix.Identity(4)
    bpy.context.view_layer.update()

# ---------------- props, pass 2: attach ----------------
for pname, spec, o, info in prepared:
    # Meshy rigs are in centimetres (armature scale 0.01), so place in world space from the hand
    # bone's rest transform with scale removed, then parent keeping that world transform.
    H = hand_frame(spec['hand'])
    if spec.get('grip') == 'fist':
        # Columns = weapon axes in bone space: X (crossguard) -> +Y knuckles, Y -> -X, Z (blade) -> +Z thumb.
        Rb = Matrix(((0, -1, 0, 0), (1, 0, 0, 0), (0, 0, 1, 0), (0, 0, 0, 1)))
        twist = Euler([math.radians(x) for x in spec.get('rot', (0, 0, 0))]).to_matrix().to_4x4()
        o.matrix_world = H @ Matrix.Translation(fists[spec['hand']]) @ Rb @ twist @ Matrix.Translation((0, 0, -info['grip_z']))
        print(f"  grip {pname}: pommel {info['zmin']:.3f} guard {info['guard_z']:.3f} -> grip centre z {info['grip_z']:.3f}, handle radius {info['radius'] * 100:.1f} cm")
    elif spec.get('grip') == 'pistol':
        # Held like a pistol: stock along the knuckle direction (+Y, past the fist), bow horizontal across the
        # palm normal (X), resting on the thumb side of the fist (+Z). `grip_at`: fraction from the butt that
        # sits over the fist (default 0.25).
        Rb = Matrix(((1, 0, 0, 0), (0, 0, 1, 0), (0, 1, 0, 0), (0, 0, 0, 1)))  # prop X->X, Y->Z(up), Z->Y(fwd)
        if Rb.determinant() < 0:
            Rb = Matrix(((-1, 0, 0, 0), (0, 0, 1, 0), (0, 1, 0, 0), (0, 0, 0, 1)))
        L = info['zmax'] - info['zmin']
        at = info['zmin'] + spec.get('grip_at', 0.25) * L
        twist = Euler([math.radians(x) for x in spec.get('rot', (0, 0, 0))]).to_matrix().to_4x4()
        lift = Matrix.Translation(Vector((0, 0, spec.get('lift', 0.03))))  # sit on top of the fist
        o.matrix_world = H @ Matrix.Translation(fists[spec['hand']]) @ lift @ twist @ Rb @ Matrix.Translation((0, -info['ymin'], -at))
        print(f"  grip {pname}: pistol grip, stock over the fist at {spec.get('grip_at', 0.25):.2f} of its length")
    elif spec.get('grip') == 'palm':
        # Flat prop resting on the open palm (e.g. an open book): thinnest axis along the palm normal,
        # longest across the hand (bone Z), centred on the palm a little past the wrist.
        palm = Vector(cfg['fists'][spec['hand']]['palm'])
        vs = [v.co for v in o.data.vertices]
        ctr = sum(vs, Vector()) / len(vs)
        thick = max(v.y for v in vs) - min(v.y for v in vs)
        z_axis = Vector((0, 0, 1)); y_axis = palm
        x_axis = y_axis.cross(z_axis)
        Rb = Matrix((x_axis, y_axis, z_axis)).transposed().to_4x4()
        twist = Euler([math.radians(x) for x in spec.get('rot', (0, 0, 0))]).to_matrix().to_4x4()
        pos = Vector(spec.get('offset', (0, 0.07, 0))) + palm * (0.02 + thick / 2)
        o.matrix_world = H @ Matrix.Translation(pos) @ twist @ Rb @ Matrix.Translation(-ctr)
        print(f'  grip {pname}: on the palm, {thick:.3f} m thick')
    elif spec.get('grip') == 'shield':
        # Centre-grip shield: the handle is the small cluster sticking out furthest from the back
        # (along the thin axis, local Y). Handle -> through the fist (Z), face -> past the knuckles (+Y).
        vs = [v.co.copy() for v in o.data.vertices]
        ymin, ymax = min(v.y for v in vs), max(v.y for v in vs)
        def cluster(at_max):
            edge = ymax - 0.15 * (ymax - ymin) if at_max else ymin + 0.15 * (ymax - ymin)
            return [v for v in vs if (v.y >= edge if at_max else v.y <= edge)]
        def elongation(c):
            ex, ez = max(v.x for v in c) - min(v.x for v in c), max(v.z for v in c) - min(v.z for v in c)
            return max(ex, ez) / max(1e-6, min(ex, ez))
        hi, lo = cluster(True), cluster(False)
        for tag, c in (('+y', hi), ('-y', lo)):
            cc = sum(c, Vector()) / len(c)
            print(f'  {pname} {tag} cluster: {len(c)} verts, centre {tuple(round(x, 3) for x in cc)}, '
                  f'x-extent {max(v.x for v in c) - min(v.x for v in c):.3f}, z-extent {max(v.z for v in c) - min(v.z for v in c):.3f}')
        # The handle is a bar (elongated); a front boss is round. "handle_side": "+y" | "-y" overrides.
        side = spec.get('handle_side')
        if side:
            handle, back_sign = (hi, 1) if side == '+y' else (lo, -1)
        else:
            handle, back_sign = (hi, 1) if elongation(hi) > elongation(lo) else (lo, -1)
        hc = sum(handle, Vector()) / len(handle)
        along_x = (max(v.x for v in handle) - min(v.x for v in handle)) >= (max(v.z for v in handle) - min(v.z for v in handle))
        h_axis = Vector((1, 0, 0)) if along_x else Vector((0, 0, 1))
        front = Vector((0, -back_sign, 0))  # face normal, away from the handle
        # Bone-space targets for the weapon's local axes. "face": "back" (default) points the shield out from
        # the back of the hand/forearm, like a strapped shield: blocks then raise it in front of the face.
        # "knuckles" is a true centre grip (face past the knuckles), which reads oddly in our block clip.
        palm = Vector(cfg['fists'][spec['hand']]['palm'])
        face = -palm if spec.get('face', 'back') == 'back' else Vector((0, 1, 0))
        tgt = {'h': Vector((0, 0, 1)), 'front': face}
        src_m = Matrix((h_axis, front, h_axis.cross(front))).transposed()
        dst_m = Matrix((tgt['h'], tgt['front'], tgt['h'].cross(tgt['front']))).transposed()
        Rb = (dst_m @ src_m.inverted()).to_4x4()
        twist = Euler([math.radians(x) for x in spec.get('rot', (0, 0, 0))]).to_matrix().to_4x4()
        # "standoff": extra metres along the face direction so the forearm armour doesn't poke through.
        stand = Matrix.Translation(face * spec.get('standoff', 0.05))
        o.matrix_world = H @ Matrix.Translation(fists[spec['hand']]) @ stand @ twist @ Rb @ Matrix.Translation(-hc)
        print(f'  grip {pname}: handle at {tuple(round(x, 3) for x in hc)} axis {"X" if along_x else "Z"}, back side {"+" if back_sign > 0 else "-"}Y')
    else:
        o.matrix_world = (H
                          @ Matrix.Translation(Vector(spec.get('offset', (0, 0.08, 0))))
                          @ Euler([math.radians(x) for x in spec.get('rot', (0, 0, 0))]).to_matrix().to_4x4())
    world = o.matrix_world.copy()
    o.parent = arm
    o.parent_type = 'BONE'
    o.parent_bone = spec['hand']
    o.matrix_world = world
    props.append((pname, o))
    print(f'PROP {pname} scale {info["k"]:.3f} -> {spec["hand"]}')
# Name only after the originals are gone, so the game finds them by exact name (no ".001").
for pname, o in props:
    o.name = pname
props = [o for _, o in props]


# ---------------- preview ----------------
if preview:
    os.makedirs(preview, exist_ok=True)
    sc.render.engine = 'BLENDER_EEVEE_NEXT' if 'BLENDER_EEVEE_NEXT' in [e.identifier for e in bpy.types.RenderSettings.bl_rna.properties['engine'].enum_items] else 'BLENDER_EEVEE'
    sc.render.resolution_x, sc.render.resolution_y = 360, 420
    w = bpy.data.worlds.new('w'); sc.world = w; w.use_nodes = True
    w.node_tree.nodes['Background'].inputs[0].default_value = (0.35, 0.37, 0.4, 1)
    sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN')); sc.collection.objects.link(sun)
    sun.data.energy = 3; sun.rotation_euler = (math.radians(50), 0, math.radians(30))
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); sc.collection.objects.link(cam); sc.camera = cam
    cam.data.type = 'ORTHO'; cam.data.ortho_scale = 3.2
    a = math.radians(35)
    cam.location = Vector((math.sin(a) * 8, -math.cos(a) * 8, 1.2))
    cam.rotation_euler = (Vector((0, 0, 0.95)) - cam.location).to_track_quat('-Z', 'Y').to_euler()
    for pname in [p.name for p in props]:
        for p in props:
            p.hide_render = p.name != pname
        hand_name = next(s['hand'] for n, s in cfg['props']['items'].items() if n == pname)
        for clip, t in [('Idle', 0.3), ('2H_Melee_Attack_Slice', 0.5), ('Block', 0.5)]:
            act = bpy.data.actions[clip]
            assign(arm, act)
            sc.frame_set(int(act.frame_range[0] + (act.frame_range[1] - act.frame_range[0]) * t))
            # Close-up of the gripping hand from two sides, then the full body.
            hb = arm.pose.bones[hand_name]
            hm = arm.matrix_world @ hb.matrix
            hc = hm @ (Vector((0, 0.105, 0)) / hm.to_scale().x)  # knuckle area (Meshy bone space is in cm)
            cam.data.ortho_scale = 0.6
            for vi, d in enumerate([Vector((0, 0, -1)), Vector((-1, 0, 0))]):
                dw = (hm.to_3x3() @ d).normalized()
                cam.location = hc + dw * 3
                cam.rotation_euler = (hc - cam.location).to_track_quat('-Z', 'Y').to_euler()
                sc.render.filepath = os.path.join(preview, f'{pname}_{clip}_hand{vi}.png')
                bpy.ops.render.render(write_still=True)
            cam.data.ortho_scale = 3.2
            cam.location = Vector((math.sin(a) * 8, -math.cos(a) * 8, 1.2))
            cam.rotation_euler = (Vector((0, 0, 0.95)) - cam.location).to_track_quat('-Z', 'Y').to_euler()
            sc.render.filepath = os.path.join(preview, f'{pname}_{clip}.png')
            bpy.ops.render.render(write_still=True)
    for p in props:
        p.hide_render = False

# ---------------- export ----------------
arm.animation_data.action = None
for pb in arm.pose.bones:
    pb.matrix_basis = Matrix.Identity(4)
os.makedirs(os.path.dirname(cfg['out']), exist_ok=True)
bpy.ops.object.select_all(action='DESELECT')
bpy.ops.export_scene.gltf(
    filepath=cfg['out'], export_format='GLB', export_animation_mode='ACTIONS',
    export_image_format='WEBP', export_optimize_animation_size=True,
)
print('EXPORTED', cfg['out'], f'{os.path.getsize(cfg["out"]) / 1e6:.1f} MB', len(canon), 'clips')
