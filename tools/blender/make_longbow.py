"""
Model a stylized longbow procedurally (no generation service), matching the Warrior's dark-wood-and-bronze
gear: a tapered, gently curved wooden stave, a leather-wrapped grip, bronze nock caps and a bowstring.

    Blender -b --python tools/blender/make_longbow.py -- OUT.glb [--length 1.7]

Built standing along Z (grip at the origin), the stave bowing toward +X and the string on -X, so
import_meshy.py's "fist" grip puts the grip in the fist with the bow upright.
"""
import bpy, bmesh, sys, math
from mathutils import Vector, Matrix

argv = sys.argv[sys.argv.index('--') + 1:]
out = argv[0]
L = float(argv[argv.index('--length') + 1]) if '--length' in argv else 1.7
half = L / 2

bpy.ops.wm.read_factory_settings(use_empty=True)


def mat(name, rgb, rough=0.75, metal=0.0):
    m = bpy.data.materials.new(name); m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*rgb, 1)
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    return m


# Colours are linear (glTF base colour): dark walnut, near-black leather, bronze, waxed linen string.
MATS = [mat('wood', (0.075, 0.032, 0.014)), mat('leather', (0.022, 0.011, 0.007), 0.85),
        mat('bronze', (0.40, 0.19, 0.06), 0.45, 0.6), mat('string', (0.55, 0.50, 0.38), 0.9)]
WOOD, LEATHER, BRONZE, STRING = range(4)

bm = bmesh.new()


def tube(points, radii, depth_scale, mat_idx, sides=10):
    """Loft rings along a polyline. depth_scale squashes the cross-section along X (a flat-ish stave)."""
    rings = []
    for i, (p, r) in enumerate(zip(points, radii)):
        t = (points[min(i + 1, len(points) - 1)] - points[max(i - 1, 0)]).normalized()
        a = Vector((1, 0, 0)) - t * t.x
        a.normalize()
        b = t.cross(a)
        ring = [bm.verts.new(p + a * math.cos(2 * math.pi * k / sides) * r * depth_scale
                             + b * math.sin(2 * math.pi * k / sides) * r) for k in range(sides)]
        rings.append(ring)
    for r0, r1 in zip(rings, rings[1:]):
        for k in range(sides):
            f = bm.faces.new((r0[k], r0[(k + 1) % sides], r1[(k + 1) % sides], r1[k]))
            f.material_index = mat_idx
    for ring, flip in ((rings[0], True), (rings[-1], False)):
        f = bm.faces.new(ring[::-1] if flip else ring)
        f.material_index = mat_idx


def stave_x(z):
    """Bend: the limbs curve back toward -X, with a slight reflex at the tips."""
    u = abs(z) / half
    return -0.11 * u ** 2 + 0.025 * max(0.0, u - 0.85) / 0.15


N = 48
zs = [-half + L * i / N for i in range(N + 1)]
# Stave: thick at the grip, tapering to the tips.
for lo, hi in ((-half, -0.09), (0.09, half)):
    seg = [z for z in zs if lo <= z <= hi] or [lo, hi]
    seg = [lo] + [z for z in seg if lo < z < hi] + [hi]
    pts = [Vector((stave_x(z), 0, z)) for z in seg]
    rad = [0.021 - 0.012 * (abs(z) / half) ** 1.2 for z in seg]
    tube(pts, rad, 0.75, WOOD)
# Leather grip wrap (slightly thicker) with bronze collars at each end.
gz = [-0.1 + 0.2 * i / 8 for i in range(9)]
tube([Vector((stave_x(z), 0, z)) for z in gz], [0.025] * 9, 0.85, LEATHER)
for z0 in (-0.1, 0.1):
    tube([Vector((stave_x(z0) , 0, z0 - 0.008)), Vector((stave_x(z0), 0, z0 + 0.008))], [0.028, 0.028], 0.9, BRONZE)
# Bronze nock caps on the tips.
tips = []
for s in (-1, 1):
    z0, z1 = s * (half - 0.05), s * half
    tube([Vector((stave_x(z0), 0, z0)), Vector((stave_x(z1) + 0.012, 0, z1 + s * 0.02))], [0.012, 0.006], 0.9, BRONZE, 8)
    tips.append(Vector((stave_x(z1 - s * 0.03) - 0.008, 0, z1 - s * 0.03)))
# Bowstring between the nocks.
tube([tips[0] + (tips[1] - tips[0]) * i / 4 for i in range(5)], [0.0025] * 5, 1.0, STRING, 6)

me = bpy.data.meshes.new('Longbow')
bm.normal_update()
bm.to_mesh(me); bm.free()
for m in MATS:
    me.materials.append(m)
obj = bpy.data.objects.new('Longbow', me)
bpy.context.collection.objects.link(obj)
bpy.context.view_layer.objects.active = obj; obj.select_set(True)
bpy.ops.object.shade_smooth()
me.calc_loop_triangles()
print(f'LONGBOW {L:.2f} m, {len(me.loop_triangles)} tris')
bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', use_selection=True)
print('EXPORTED', out)
