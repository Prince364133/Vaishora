# Renders the photographic palm/back stills used by HandIllustration (thumbnails + WebGL fallback).
#
#   blender -b --factory-startup --python scripts/hand-real/render_stills.py -- <repo_root> <out_dir> [size]
#
# The orthographic camera covers exactly the mehndi projection frame from src/lib/mehndi/hand-landmarks.json, so a
# 1000x1000 artwork (built-in SVG or an uploaded PNG/WebP aligned to these stills) overlays the still pixel-perfectly,
# the same way the 3D shader projects it. Output: <out_dir>/palm.png, back.png (RGBA, transparent background).

import json
import pathlib
import sys

import bpy
from mathutils import Matrix

argv = sys.argv[sys.argv.index("--") + 1 :]
ROOT = pathlib.Path(argv[0])
OUT = pathlib.Path(argv[1])
SIZE = int(argv[2]) if len(argv) > 2 else 1000
OUT.mkdir(parents=True, exist_ok=True)
lm = json.loads((ROOT / "src/lib/mehndi/hand-landmarks.json").read_text())
fr = lm["frame"]

for o in list(bpy.data.objects):
    bpy.data.objects.remove(o)
bpy.ops.import_scene.gltf(filepath=str(ROOT / "public/models/hand-hq.glb"))
hand = next(o for o in bpy.context.scene.objects if o.type == "MESH")
# The GLB stores Blender-native Z-up coordinates (exported with export_yup=False); the importer assumed glTF Y-up
# and converted (x, y, z) -> (x, -z, y). Undo that so we are back in the model / shader convention.
bpy.context.view_layer.update()
hand.data.transform(hand.matrix_world)
hand.matrix_world = Matrix.Identity(4)
hand.data.transform(Matrix(((1, 0, 0, 0), (0, 0, 1, 0), (0, -1, 0, 0), (0, 0, 0, 1))))
ys = [v.co.y for v in hand.data.vertices]
zs = [v.co.z for v in hand.data.vertices]
print("bounds y", min(ys), max(ys), "z", min(zs), max(zs))
for o in bpy.context.scene.objects:
    if o.type == "EMPTY":
        o.hide_render = True
for p in hand.data.polygons:
    p.use_smooth = True

# ------------------------------------------------------------------ skin material
mat = bpy.data.materials.new("skin")
mat.use_nodes = True
nt = mat.node_tree
N = nt.nodes
L = nt.links
bsdf = N["Principled BSDF"]


def img(name, colorspace):
    i = bpy.data.images.load(str(ROOT / "public/models" / name))
    i.colorspace_settings.name = colorspace
    t = N.new("ShaderNodeTexImage")
    t.image = i
    t.interpolation = "Cubic"
    return t


alb = img("hand-albedo-2k.jpg", "sRGB")
nrm = img("hand-normal-2k.jpg", "Non-Color")
det = img("hand-detail-1k.jpg", "Non-Color")
# palm/back tone balance (same as the realtime shader): back of the hand slightly lighter, less red
geo = N.new("ShaderNodeNewGeometry")
sep = N.new("ShaderNodeSeparateXYZ")
L.new(geo.outputs["Normal"], sep.inputs[0])
rng = N.new("ShaderNodeMapRange")
rng.inputs["From Min"].default_value = -0.5
rng.inputs["From Max"].default_value = 0.2
L.new(sep.outputs["X"], rng.inputs["Value"])
tone = N.new("ShaderNodeMix")
tone.data_type = "RGBA"
tone.inputs["A"].default_value = (1.0, 0.95, 0.92, 1)
tone.inputs["B"].default_value = (0.95, 0.9, 0.86, 1)
L.new(rng.outputs["Result"], tone.inputs["Factor"])
mul = N.new("ShaderNodeMix")
mul.data_type = "RGBA"
mul.blend_type = "MULTIPLY"
mul.inputs["Factor"].default_value = 1.0
L.new(alb.outputs["Color"], mul.inputs["A"])
L.new(tone.outputs["Result"], mul.inputs["B"])
hsv = N.new("ShaderNodeHueSaturation")
hsv.inputs["Saturation"].default_value = 1.0
hsv.inputs["Value"].default_value = 0.86
L.new(mul.outputs["Result"], hsv.inputs["Color"])
L.new(hsv.outputs["Color"], bsdf.inputs["Base Color"])
nmap = N.new("ShaderNodeNormalMap")
nmap.inputs["Strength"].default_value = 0.9
L.new(nrm.outputs["Color"], nmap.inputs["Color"])
L.new(nmap.outputs["Normal"], bsdf.inputs["Normal"])
dsep = N.new("ShaderNodeSeparateColor")
L.new(det.outputs["Color"], dsep.inputs[0])
rough = N.new("ShaderNodeMapRange")
rough.inputs["To Min"].default_value = 0.5
rough.inputs["To Max"].default_value = 0.22
L.new(dsep.outputs["Red"], rough.inputs["Value"])
L.new(rough.outputs["Result"], bsdf.inputs["Roughness"])
bsdf.inputs["Subsurface Weight"].default_value = 0.22
bsdf.inputs["Subsurface Radius"].default_value = (1.0, 0.35, 0.2)
bsdf.inputs["Subsurface Scale"].default_value = 0.004
bsdf.inputs["Specular IOR Level"].default_value = 0.45
bsdf.inputs["Coat Weight"].default_value = 0.05
bsdf.inputs["Coat Roughness"].default_value = 0.4
bsdf.inputs["Sheen Weight"].default_value = 0.15
# forearm cut: fade the last few centimetres to transparent
pos = N.new("ShaderNodeNewGeometry")
psep = N.new("ShaderNodeSeparateXYZ")
L.new(pos.outputs["Position"], psep.inputs[0])
fade = N.new("ShaderNodeMapRange")
fade.inputs["From Min"].default_value = fr["maxY"] - 0.05
fade.inputs["From Max"].default_value = fr["maxY"] - 0.002
fade.inputs["To Min"].default_value = 1.0
fade.inputs["To Max"].default_value = 0.0
fade.interpolation_type = "SMOOTHSTEP"
L.new(psep.outputs["Y"], fade.inputs["Value"])
L.new(fade.outputs["Result"], bsdf.inputs["Alpha"])
hand.data.materials.clear()
hand.data.materials.append(mat)

# ------------------------------------------------------------------ scene
scene = bpy.context.scene
scene.render.engine = "CYCLES"
scene.cycles.device = "CPU"
scene.cycles.samples = 96
scene.cycles.use_denoising = True
scene.render.film_transparent = True
scene.render.resolution_x = scene.render.resolution_y = SIZE
scene.render.image_settings.file_format = "PNG"
scene.render.image_settings.color_mode = "RGBA"
scene.view_settings.view_transform = "AgX"
scene.view_settings.look = "AgX - Base Contrast"
scene.world = bpy.data.worlds.new("w")
scene.world.use_nodes = True
scene.world.node_tree.nodes["Background"].inputs[0].default_value = (0.42, 0.33, 0.36, 1)
scene.world.node_tree.nodes["Background"].inputs[1].default_value = 0.35

cam_data = bpy.data.cameras.new("cam")
cam_data.type = "ORTHO"
cam_data.ortho_scale = fr["size"]
cam = bpy.data.objects.new("cam", cam_data)
scene.collection.objects.link(cam)
scene.camera = cam


def area(name, loc, energy, size, color):
    ld = bpy.data.lights.new(name, "AREA")
    ld.energy = energy
    ld.size = size
    ld.color = color
    lo = bpy.data.objects.new(name, ld)
    lo.location = loc
    scene.collection.objects.link(lo)
    return lo


def aim(obj, target=(0, fr["centerV"], fr["centerU"])):
    from mathutils import Vector

    d = Vector(target) - obj.location
    obj.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()


for side, sx in (("palm", -1.0), ("back", 1.0)):
    for o in [o for o in scene.objects if o.type == "LIGHT"]:
        bpy.data.objects.remove(o)
    # key: large soft box above-front-left of the camera; fill opposite; warm rim from behind
    k = area("key", (sx * 0.55, fr["centerV"] - 0.35, fr["centerU"] + 0.25), 9.0, 0.6, (1.0, 0.96, 0.92))
    fl = area("fill", (sx * 0.6, fr["centerV"] + 0.25, fr["centerU"] - 0.35), 3.0, 0.8, (1.0, 0.92, 0.94))
    rim = area("rim", (-sx * 0.4, fr["centerV"] - 0.2, fr["centerU"] + 0.45), 5.0, 0.4, (1.0, 0.86, 0.72))
    for o in (k, fl, rim):
        aim(o)
    cam.location = (sx * 1.0, fr["centerV"], fr["centerU"])
    cols = ((0, 0, -1), (0, -1, 0), (-1, 0, 0)) if sx < 0 else ((0, 0, 1), (0, -1, 0), (1, 0, 0))
    cam.rotation_euler = Matrix(cols).transposed().to_euler()
    scene.render.filepath = str(OUT / f"{side}.png")
    bpy.ops.render.render(write_still=True)
print("STILLS_OK")
