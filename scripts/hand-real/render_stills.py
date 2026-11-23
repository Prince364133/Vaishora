# Renders the photographic palm/back stills used by HandIllustration (thumbnails + WebGL fallback).
#
#   blender -b --factory-startup --python scripts/hand-real/render_stills.py -- <repo_root> <out_dir> [size]
#       [--palm-photo <rgba.webp>] [--side palm|back] [--zoom <factor>] [--name <file stem>]
#   --palm-photo applies a "palm_photo" asset as albedo exactly like the realtime shader (palm projection frame,
#   alpha x palm-facing weight) — used to verify scripts/hand-real/photo_transfer.py without a running site.
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
SIZE = int(argv[2]) if len(argv) > 2 and not argv[2].startswith("--") else 1000


def opt(name, default=None):
    return argv[argv.index(name) + 1] if name in argv else default


PALM_PHOTO = opt("--palm-photo")
SIDES = [opt("--side")] if opt("--side") else ["palm", "back"]
ZOOM = float(opt("--zoom", "1"))
NAME = opt("--name")
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
# palm/back tone balance is baked into the composed albedo (postprocess.py); kept neutral here
geo = N.new("ShaderNodeNewGeometry")
sep = N.new("ShaderNodeSeparateXYZ")
L.new(geo.outputs["Normal"], sep.inputs[0])
rng = N.new("ShaderNodeMapRange")
rng.inputs["From Min"].default_value = -0.5
rng.inputs["From Max"].default_value = 0.2
L.new(sep.outputs["X"], rng.inputs["Value"])
tone = N.new("ShaderNodeMix")
tone.data_type = "RGBA"
tone.inputs["A"].default_value = (1.0, 1.0, 1.0, 1)
tone.inputs["B"].default_value = (1.0, 1.0, 1.0, 1)
L.new(rng.outputs["Result"], tone.inputs["Factor"])
mul = N.new("ShaderNodeMix")
mul.data_type = "RGBA"
mul.blend_type = "MULTIPLY"
mul.inputs["Factor"].default_value = 1.0
L.new(alb.outputs["Color"], mul.inputs["A"])
L.new(tone.outputs["Result"], mul.inputs["B"])
hsv = N.new("ShaderNodeHueSaturation")
hsv.inputs["Saturation"].default_value = 1.0
hsv.inputs["Value"].default_value = 1.0
L.new(mul.outputs["Result"], hsv.inputs["Color"])
skin_out = hsv.outputs["Color"]
if PALM_PHOTO:
    # projection exactly as in mehndiMaterial.ts: u = 0.5 - (z - cu)/S, v = 0.5 + (cv - y)/S (v = 1 at the top row)
    pg = N.new("ShaderNodeNewGeometry")
    ps = N.new("ShaderNodeSeparateXYZ")
    L.new(pg.outputs["Position"], ps.inputs[0])
    mu = N.new("ShaderNodeMath")
    mu.operation = "MULTIPLY_ADD"
    mu.inputs[1].default_value = -1.0 / fr["size"]
    mu.inputs[2].default_value = 0.5 + fr["centerU"] / fr["size"]
    L.new(ps.outputs["Z"], mu.inputs[0])
    mv = N.new("ShaderNodeMath")
    mv.operation = "MULTIPLY_ADD"
    mv.inputs[1].default_value = -1.0 / fr["size"]
    mv.inputs[2].default_value = 0.5 + fr["centerV"] / fr["size"]
    L.new(ps.outputs["Y"], mv.inputs[0])
    cmb = N.new("ShaderNodeCombineXYZ")
    L.new(mu.outputs[0], cmb.inputs["X"])
    L.new(mv.outputs[0], cmb.inputs["Y"])
    ptex = N.new("ShaderNodeTexImage")
    ptex.image = bpy.data.images.load(str(pathlib.Path(PALM_PHOTO).resolve()))
    ptex.image.alpha_mode = "STRAIGHT"
    ptex.interpolation = "Cubic"
    ptex.extension = "CLIP"
    L.new(cmb.outputs[0], ptex.inputs["Vector"])
    nsep = N.new("ShaderNodeSeparateXYZ")
    L.new(pg.outputs["Normal"], nsep.inputs[0])
    face = N.new("ShaderNodeMapRange")
    face.inputs["From Min"].default_value = -0.04
    face.inputs["From Max"].default_value = -0.4
    face.interpolation_type = "SMOOTHSTEP"
    L.new(nsep.outputs["X"], face.inputs["Value"])
    wgt = N.new("ShaderNodeMath")
    wgt.operation = "MULTIPLY"
    L.new(ptex.outputs["Alpha"], wgt.inputs[0])
    L.new(face.outputs["Result"], wgt.inputs[1])
    mixp = N.new("ShaderNodeMix")
    mixp.data_type = "RGBA"
    L.new(wgt.outputs[0], mixp.inputs["Factor"])
    L.new(skin_out, mixp.inputs["A"])
    L.new(ptex.outputs["Color"], mixp.inputs["B"])
    skin_out = mixp.outputs["Result"]
L.new(skin_out, bsdf.inputs["Base Color"])
nmap = N.new("ShaderNodeNormalMap")
nmap.inputs["Strength"].default_value = 0.9
L.new(nrm.outputs["Color"], nmap.inputs["Color"])
L.new(nmap.outputs["Normal"], bsdf.inputs["Normal"])
dsep = N.new("ShaderNodeSeparateColor")
L.new(det.outputs["Color"], dsep.inputs[0])
rough = N.new("ShaderNodeMapRange")
rough.inputs["To Min"].default_value = 0.5
rough.inputs["To Max"].default_value = 0.12
L.new(dsep.outputs["Red"], rough.inputs["Value"])
L.new(rough.outputs["Result"], bsdf.inputs["Roughness"])
bsdf.inputs["Subsurface Weight"].default_value = 0.22
bsdf.inputs["Subsurface Radius"].default_value = (1.0, 0.35, 0.2)
bsdf.inputs["Subsurface Scale"].default_value = 0.004
bsdf.inputs["Specular IOR Level"].default_value = 0.45
bsdf.inputs["Coat Weight"].default_value = 0.05
L.new(dsep.outputs["Red"], bsdf.inputs["Coat Weight"])  # glossy nails
bsdf.inputs["Coat Roughness"].default_value = 0.08
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
scene.view_settings.view_transform = "Standard"  # matches the realtime sRGB look of the albedo targets
scene.view_settings.look = "None"
scene.view_settings.exposure = -0.35
scene.world = bpy.data.worlds.new("w")
scene.world.use_nodes = True
scene.world.node_tree.nodes["Background"].inputs[0].default_value = (0.42, 0.33, 0.36, 1)
scene.world.node_tree.nodes["Background"].inputs[1].default_value = 0.35

cam_data = bpy.data.cameras.new("cam")
cam_data.type = "ORTHO"
cam_data.ortho_scale = fr["size"] / ZOOM
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


for side, sx in [(s_, -1.0 if s_ == "palm" else 1.0) for s_ in SIDES]:
    for o in [o for o in scene.objects if o.type == "LIGHT"]:
        bpy.data.objects.remove(o)
    # key: large soft box above-front-left of the camera; fill opposite; warm rim from behind
    k = area("key", (sx * 0.55, fr["centerV"] - 0.35, fr["centerU"] + 0.25), 9.0, 0.6, (1.0, 0.96, 0.92))
    fl = area("fill", (sx * 0.6, fr["centerV"] + 0.25, fr["centerU"] - 0.35), 3.0, 0.8, (1.0, 0.92, 0.94))
    rim = area("rim", (-sx * 0.4, fr["centerV"] - 0.2, fr["centerU"] + 0.45), 5.0, 0.4, (1.0, 0.86, 0.72))
    for o in (k, fl, rim):
        aim(o)
    # zoomed views look at the palm centre (between the wrist and the middle knuckle)
    cy = fr["centerV"] if ZOOM == 1 else fr["centerV"] - 0.012
    cam.location = (sx * 1.0, cy, fr["centerU"])
    cols = ((0, 0, -1), (0, -1, 0), (-1, 0, 0)) if sx < 0 else ((0, 0, 1), (0, -1, 0), (1, 0, 0))
    cam.rotation_euler = Matrix(cols).transposed().to_euler()
    scene.render.filepath = str(OUT / f"{NAME or side}.png")
    bpy.ops.render.render(write_still=True)
print("STILLS_OK")
