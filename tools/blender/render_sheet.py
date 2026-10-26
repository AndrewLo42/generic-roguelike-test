"""
Render a rigged character's rest pose as a front | back orthographic sheet, for repainting with an
image-edit model and projecting back onto the same mesh (tools/blender/project_paint.py).

    Blender -b --python tools/blender/render_sheet.py -- CHARACTER.glb OUT.png [--px 768]

The camera setup is fixed and mirrored in project_paint.py: each half is an orthographic view 2.0 m tall
centred at z=0.95, front camera on -Y, back camera on +Y.
"""
import bpy, sys, math, os
import numpy as np
from mathutils import Vector, Matrix

argv = sys.argv[sys.argv.index('--') + 1:]
src, out = argv[0], argv[1]
PX = int(argv[argv.index('--px') + 1]) if '--px' in argv else 768
VIEW_H, CZ = 2.0, 0.95

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
sc = bpy.context.scene
for o in sc.objects:
    if o.type == 'ARMATURE':
        o.animation_data_clear() if o.animation_data else None
        for pb in o.pose.bones:
            pb.matrix_basis = Matrix.Identity(4)
    if o.type == 'MESH' and o.parent_type == 'BONE':
        o.hide_render = True
sc.render.engine = 'BLENDER_EEVEE_NEXT' if 'BLENDER_EEVEE_NEXT' in [e.identifier for e in bpy.types.RenderSettings.bl_rna.properties['engine'].enum_items] else 'BLENDER_EEVEE'
sc.render.resolution_x, sc.render.resolution_y = PX * 2 // 3, PX  # each half is 2:3
sc.render.film_transparent = False
sc.view_settings.view_transform = 'Standard'
w = bpy.data.worlds.new('w'); sc.world = w; w.use_nodes = True
w.node_tree.nodes['Background'].inputs[0].default_value = (0.82, 0.82, 0.82, 1)
w.node_tree.nodes['Background'].inputs[1].default_value = 1.0  # flat, even light: no strong baked shading
cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); sc.collection.objects.link(cam); sc.camera = cam
cam.data.type = 'ORTHO'; cam.data.ortho_scale = VIEW_H  # ortho_scale = the larger dimension (height)
halves = []
for name, loc, rot in [('front', (0, -6, CZ), (math.radians(90), 0, 0)), ('back', (0, 6, CZ), (math.radians(90), 0, math.radians(180)))]:
    cam.location = loc; cam.rotation_euler = rot
    f = out + f'.{name}.png'; sc.render.filepath = f; bpy.ops.render.render(write_still=True)
    im = bpy.data.images.load(f); halves.append(np.array(im.pixels[:]).reshape(PX, PX * 2 // 3, 4))
sheet = np.concatenate(halves, axis=1)
o = bpy.data.images.new('o', sheet.shape[1], sheet.shape[0]); o.pixels = sheet.ravel().tolist()
o.filepath_raw = out; o.file_format = 'PNG'; o.save()
for n in ('front', 'back'): os.remove(out + f'.{n}.png')
print('SHEET', out, sheet.shape[1], sheet.shape[0])
