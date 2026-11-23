# Builds the VAISHORA realistic female hand from CC0 MakeHuman assets, headless in Blender.
#
#   blender -b --python scripts/hand-real/build_hand.py -- <out_dir> <mpfb_root> <skin_png> [--preview]
#
# Inputs (all CC0, see public/models/LICENSE.md and docs/HAND_REALISM.md):
#   * MakeHuman base mesh + macro targets, shipped inside the MPFB2 add-on (GPL code, CC0 data)
#   * "Hands 01" realistic hand targets (Mindfront / jujube, CC0)
#   * "cutoff3d_indian_female_enhanced" skin texture from the "Skins 01" pack (CutOff3D, CC0)
#
# Output (in <out_dir>):
#   hand-hq.glb / hand-lq.glb  static meshes (POSITION, NORMAL, TEXCOORD_0) + joint empties named like the
#                              WebXR hand joints, in the viewer convention: metres, palm faces -X, fingers -Y.
#   albedo.png                 2048^2 skin colour baked from the body atlas into a hand-only UV layout
#   nails.png                  2048^2 fingernail mask (from the base mesh "fingernails" vertex group)
#   preview-*.png              (with --preview) quick workbench renders of palm and back
#
# Post-processing (tone, normal/detail maps, JPEG/WebP sizes) is done by scripts/hand-real/postprocess.py.

import math
import os
import pathlib
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

argv = sys.argv[sys.argv.index("--") + 1 :]
OUT = pathlib.Path(argv[0])
MPFB_ROOT = pathlib.Path(argv[1])
SKIN_PNG = argv[2]
PREVIEW = "--preview" in argv
OUT.mkdir(parents=True, exist_ok=True)

from bl_ext.user_default.mpfb.services.locationservice import LocationService  # noqa: E402

# MPFB resolves its own folder with Path.resolve(); on Windows that can exceed MAX_PATH when Blender lives in a
# deep temp folder mapped through `subst`. Point it at the short path we were started from.
LocationService._mpfb_root = MPFB_ROOT
LocationService._mpfb_data = str(MPFB_ROOT / "data")

from bl_ext.user_default.mpfb.services.humanservice import HumanService  # noqa: E402
from bl_ext.user_default.mpfb.services.targetservice import TargetService  # noqa: E402

for o in list(bpy.data.objects):
    bpy.data.objects.remove(o)

# ---------------------------------------------------------------- 1. human
macro = TargetService.get_default_macro_info_dict()
# Young adult woman, slim, natural proportions. MakeHuman has no "South Asian" macro, so the ethnic mix is a blend;
# the hand shape is barely affected by it, the skin texture carries the tone.
macro.update(gender=0.0, age=0.5, muscle=0.42, weight=0.38, proportions=0.8, height=0.45)
macro["race"] = {"asian": 0.45, "caucasian": 0.35, "african": 0.20}
human = HumanService.create_human(scale=0.1, macro_detail_dict=macro)

user_targets = pathlib.Path(LocationService.get_user_data("targets")) / "hands"
for name, w in [
    ("mindfront_hand_fingers_correction", 1.0),
    ("mindfront_hand_thenar_eminence", 0.6),
    ("mindfront_hand_hypothenar", 0.5),
    # (no "knobby knuckles": hand-model castings ask for smooth, non-prominent knuckles)
]:
    p = user_targets / f"{name}.target"
    if p.exists():
        TargetService.load_target(human, str(p), weight=w, name=name)
    else:
        print("WARN missing target", p)
# Slim, long fingers (hand-model proportions; see docs/HAND_REALISM.md §5). Extra tip taper is applied below.
for name, w in [("r-hand-fingers-diameter-decr", 0.45), ("r-hand-fingers-length-incr", 0.35), ("r-hand-scale-decr", 0.1)]:
    p = MPFB_ROOT / "data" / "targets" / "hands" / f"{name}.target.gz"
    TargetService.load_target(human, str(p), weight=w, name=name)

rig = HumanService.add_builtin_rig(human, "default")

# Nail mask as a point attribute so it survives evaluation and subdivision.
nail_attr = human.data.attributes.new("nail", "FLOAT", "POINT")
gi = human.vertex_groups["fingernails"].index
for v in human.data.vertices:
    w = 0.0
    for g in v.groups:
        if g.group == gi:
            w = g.weight
    nail_attr.data[v.index].value = w

# Per-finger skin weights as point attributes (used to taper the fingers after posing).
for k in range(1, 6):
    idx = {human.vertex_groups[f"finger{k}-{j}.R"].index for j in (1, 2, 3)}
    at = human.data.attributes.new(f"f{k}", "FLOAT", "POINT")
    for v in human.data.vertices:
        at.data[v.index].value = min(1.0, sum(g.weight for g in v.groups if g.group in idx))

# ---------------------------------------------------------------- 2. pose (open, relaxed, slightly spread)
bpy.context.view_layer.objects.active = rig
bpy.ops.object.mode_set(mode="POSE")
pb = rig.pose.bones


def rot(bone, axis, deg):
    b = pb[bone]
    b.rotation_mode = "XYZ"
    r = list(b.rotation_euler)
    r["XYZ".index(axis)] += math.radians(deg)
    b.rotation_euler = r


# Elegant relaxed pose (jewellery / mehndi photography): a gentle cascade of curl from index to pinky, fingers
# softly fanned, thumb relaxed towards the palm. Kept moderate so palm and back stay readable for the artwork.
for f, (a1, a2, a3) in {
    "finger2": (-4, 2, 2),
    "finger3": (-3, 4, 3),
    "finger4": (0, 6, 5),
    "finger5": (3, 9, 7),
}.items():
    rot(f"{f}-1.R", "X", a1)
    rot(f"{f}-2.R", "X", a2)
    rot(f"{f}-3.R", "X", a3)
for f, s in {"finger2": 5, "finger3": 0, "finger4": -5, "finger5": -11}.items():
    rot(f"{f}-1.R", "Z", s)
rot("finger1-2.R", "X", 4)
rot("finger1-3.R", "X", 6)
bpy.ops.object.mode_set(mode="OBJECT")
bpy.context.view_layer.update()


def J(bone, tail=False):
    b = rig.pose.bones[bone]
    return rig.matrix_world @ (b.tail if tail else b.head)


# ---------------------------------------------------------------- 3. orientation frame
W = J("wrist.R")
M = J("finger3-1.R")
I = J("finger2-1.R")
Pk = J("finger5-1.R")
T = J("finger1-3.R", tail=True)
E = J("lowerarm01.R")
d = (M - W).normalized()
a = I - Pk
a = (a - d * a.dot(d)).normalized()
n = d.cross(a).normalized()
if (T - W).dot(d.cross(n)) < 0:
    n = -n
# Source basis [d, n, d x n] -> target [(0,-1,0), (-1,0,0), (0,0,-1)] (palm faces -X, fingers point -Y).
B = Matrix((d, n, d.cross(n))).transposed()
Tm = Matrix(((0, -1, 0), (-1, 0, 0), (0, 0, -1))).transposed()
R3 = Tm @ B.transposed()
R = R3.to_4x4() @ Matrix.Translation(-W)

# ---------------------------------------------------------------- 4. evaluate, cut at mid-forearm, isolate the hand
dg = bpy.context.evaluated_depsgraph_get()
me = bpy.data.meshes.new_from_object(human.evaluated_get(dg), preserve_all_data_layers=True, depsgraph=dg)
bm = bmesh.new()
bm.from_mesh(me)
arm_dir = (W - E).normalized()
cut = E.lerp(W, 0.22)  # most of the forearm: the end is always out of frame (no fade, no visible cut)
bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], plane_co=cut, plane_no=arm_dir, clear_inner=True)
# keep only the connected piece that contains the middle fingertip
tip = J("finger3-3.R", tail=True)
bm.verts.ensure_lookup_table()
seed = min(bm.verts, key=lambda v: (v.co - tip).length)
keep = {seed}
stack = [seed]
while stack:
    v = stack.pop()
    for e in v.link_edges:
        o = e.other_vert(v)
        if o not in keep:
            keep.add(o)
            stack.append(o)
bmesh.ops.delete(bm, geom=[v for v in bm.verts if v not in keep], context="VERTS")

# Taper the fingers: shrink the radial distance from each finger's axis progressively towards the tip, giving the
# slender, tapered fingers of hand models (base 1.0 -> tip 0.89 of the MakeHuman width).
chains = {1: ("finger1-2.R", "finger1-3.R"), 2: ("finger2-1.R", "finger2-3.R"), 3: ("finger3-1.R", "finger3-3.R"),
          4: ("finger4-1.R", "finger4-3.R"), 5: ("finger5-1.R", "finger5-3.R")}
flayers = {k: bm.verts.layers.float.get(f"f{k}") for k in chains}
nail_l = bm.verts.layers.float.get("nail")
free_l = bm.verts.layers.float.new("freeedge")
for v in bm.verts:
    for k, (b0, b1) in chains.items():
        w = v[flayers[k]]
        if w <= 0.02:
            continue
        a0 = J(b0)
        a1 = J(b1, tail=True)
        ax = a1 - a0
        L = ax.length
        t = max(0.0, min(1.0, (v.co - a0).dot(ax) / (L * L)))
        c = a0 + ax * t
        radial = v.co - c
        scale = 1.0 - 0.11 * t
        v.co = v.co - radial * (1.0 - scale) * min(1.0, w * 1.2)
    # nail free edge: the part of the nail plate within ~3.5 mm of the fingertip
    if v[nail_l] > 0.05:
        dmin = min((v.co - J(b1, tail=True)).length for (_, b1) in chains.values())
        v[free_l] = max(0.0, min(1.0, (0.0045 - dmin) / 0.002)) * v[nail_l]
# Close the forearm end (a rounded cap after subdivision) so no rotation ever reveals an open tube.
boundary = [e for e in bm.edges if e.is_boundary]
if boundary:
    bmesh.ops.holes_fill(bm, edges=boundary, sides=0)
bm.transform(R)
bm.to_mesh(me)
bm.free()
for uv in list(me.uv_layers):
    uv.name = "body"
hand = bpy.data.objects.new("hand", me)
bpy.context.scene.collection.objects.link(hand)
human.hide_render = rig.hide_render = True
human.hide_set(True)
rig.hide_set(True)

# ---------------------------------------------------------------- 5. hand-only UV layout (for baking)
bpy.context.view_layer.objects.active = hand
hand.select_set(True)
uv = me.uv_layers.new(name="hand")
me.uv_layers.active = uv
# The hand (fingertips → ~8 cm below the wrist) gets most of the texture; the long forearm, which is mostly out of
# frame, is unwrapped separately and shrunk so it does not dilute the hand's texel density.
ARM_Y = 0.08  # model space: wrist joint at y = 0, forearm towards +y
for poly in me.polygons:
    poly.select = poly.center.y <= ARM_Y
bpy.ops.object.mode_set(mode="EDIT")
bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=0.006, area_weight=0.0, scale_to_bounds=False)
bpy.ops.object.mode_set(mode="OBJECT")
for poly in me.polygons:
    poly.select = poly.center.y > ARM_Y
bpy.ops.object.mode_set(mode="EDIT")
bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=0.006, area_weight=0.0, scale_to_bounds=False)
bpy.ops.object.mode_set(mode="OBJECT")
uvd = me.uv_layers["hand"].data
arm_loops = [li for poly in me.polygons if poly.center.y > ARM_Y for li in poly.loop_indices]
hand_loops = [li for poly in me.polygons if poly.center.y <= ARM_Y for li in poly.loop_indices]
# match texel density between the two unwraps first (smart_project normalises each call), then shrink the arm


def uv_area(polys):
    a = 0.0
    for poly in polys:
        pts = [uvd[li].uv for li in poly.loop_indices]
        for k in range(1, len(pts) - 1):
            a += abs((pts[k] - pts[0]).cross(pts[k + 1] - pts[0])) / 2
    return a


hp = [pl for pl in me.polygons if pl.center.y <= ARM_Y]
apl = [pl for pl in me.polygons if pl.center.y > ARM_Y]
dens_h = uv_area(hp) / sum(pl.area for pl in hp)
dens_a = uv_area(apl) / sum(pl.area for pl in apl)
k = math.sqrt(dens_h / dens_a) * 0.35
for li in arm_loops:
    uvd[li].uv = uvd[li].uv * k
bpy.ops.object.mode_set(mode="EDIT")
bpy.ops.mesh.select_all(action="SELECT")
bpy.ops.uv.select_all(action="SELECT")
bpy.ops.uv.pack_islands(rotate=True, scale=True, margin=0.004)
bpy.ops.object.mode_set(mode="OBJECT")
print("uv density hand/arm", dens_h, dens_a, "arm scale", k, len(hand_loops))


def subdivided(levels, name):
    src = hand.copy()
    src.data = hand.data.copy()
    bpy.context.scene.collection.objects.link(src)
    if levels:
        mod = src.modifiers.new("sub", "SUBSURF")
        mod.levels = mod.render_levels = levels
        mod.uv_smooth = "PRESERVE_BOUNDARIES"
    dg2 = bpy.context.evaluated_depsgraph_get()
    m2 = bpy.data.meshes.new_from_object(src.evaluated_get(dg2), preserve_all_data_layers=True, depsgraph=dg2)
    bpy.data.objects.remove(src)
    ob = bpy.data.objects.new(name, m2)
    bpy.context.scene.collection.objects.link(ob)
    for p in m2.polygons:
        p.use_smooth = True
    return ob


hq = subdivided(2, "hand_hq")
lq = subdivided(1, "hand_lq")
print("tris HQ", sum(len(p.vertices) - 2 for p in hq.data.polygons), "LQ", sum(len(p.vertices) - 2 for p in lq.data.polygons))

# ---------------------------------------------------------------- 6. bake skin colour + nail mask into the hand UVs
scene = bpy.context.scene
scene.render.engine = "CYCLES"
scene.cycles.device = "CPU"
scene.cycles.samples = 1
scene.render.bake.margin = 24
scene.render.bake.use_clear = True

skin_img = bpy.data.images.load(SKIN_PNG)


def bake(kind, size=2048):
    img = bpy.data.images.new(kind, size, size, alpha=False)
    if kind != "albedo":
        img.colorspace_settings.name = "Non-Color"  # data maps: store values linearly
    mat = bpy.data.materials.new(kind)
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    em = nt.nodes.new("ShaderNodeEmission")
    nt.links.new(em.outputs[0], out.inputs[0])
    if kind == "albedo":
        tex = nt.nodes.new("ShaderNodeTexImage")
        tex.image = skin_img
        tex.interpolation = "Cubic"
        uvn = nt.nodes.new("ShaderNodeUVMap")
        uvn.uv_map = "body"
        nt.links.new(uvn.outputs[0], tex.inputs[0])
        nt.links.new(tex.outputs[0], em.inputs[0])
    elif kind == "normal_os":
        geo = nt.nodes.new("ShaderNodeNewGeometry")
        vm = nt.nodes.new("ShaderNodeVectorMath")
        vm.operation = "MULTIPLY_ADD"
        vm.inputs[1].default_value = (0.5, 0.5, 0.5)
        vm.inputs[2].default_value = (0.5, 0.5, 0.5)
        nt.links.new(geo.outputs["Normal"], vm.inputs[0])
        nt.links.new(vm.outputs[0], em.inputs[0])
    else:
        at = nt.nodes.new("ShaderNodeAttribute")
        at.attribute_name = "nail" if kind == "nails" else "freeedge"
        nt.links.new(at.outputs["Fac"], em.inputs[0])
    target = nt.nodes.new("ShaderNodeTexImage")
    target.image = img
    nt.nodes.active = target
    hq.data.materials.clear()
    hq.data.materials.append(mat)
    hq.data.uv_layers.active = hq.data.uv_layers["hand"]
    for o in scene.objects:
        o.select_set(False)
    hq.select_set(True)
    bpy.context.view_layer.objects.active = hq
    if kind == "ao":
        # only the HQ hand may occlude itself (the LQ / unsubdivided copies sit exactly on top of it)
        for o in scene.objects:
            if o is not hq:
                o.hide_render = True
        scene.cycles.samples = 96
        scene.render.bake.use_selected_to_active = False
        bpy.ops.object.bake(type="AO", margin=24)
        scene.cycles.samples = 1
    else:
        bpy.ops.object.bake(type="EMIT", margin=24)
    img.filepath_raw = str(OUT / f"{kind}.png")
    img.file_format = "PNG"
    img.save()
    return img


albedo = bake("albedo")
bake("nails")
bake("freeedge")
bake("normal_os")
bake("ao")  # ambient occlusion between the fingers / in the palm hollow (multiplied into the albedo)

# ---------------------------------------------------------------- 7. joints (WebXR names) + export
JOINTS = {"wrist": ("wrist.R", False)}
for wx, mh in [("index-finger", ("metacarpal1", "finger2")), ("middle-finger", ("metacarpal2", "finger3")),
               ("ring-finger", ("metacarpal3", "finger4")), ("pinky-finger", ("metacarpal4", "finger5"))]:
    mc, f = mh
    JOINTS[f"{wx}-metacarpal"] = (f"{mc}.R", False)
    JOINTS[f"{wx}-phalanx-proximal"] = (f"{f}-1.R", False)
    JOINTS[f"{wx}-phalanx-intermediate"] = (f"{f}-2.R", False)
    JOINTS[f"{wx}-phalanx-distal"] = (f"{f}-3.R", False)
    JOINTS[f"{wx}-tip"] = (f"{f}-3.R", True)
JOINTS.update({
    "thumb-metacarpal": ("finger1-1.R", False),
    "thumb-phalanx-proximal": ("finger1-2.R", False),
    "thumb-phalanx-distal": ("finger1-3.R", False),
    "thumb-tip": ("finger1-3.R", True),
})
empties = []
for name, (bone, tail) in JOINTS.items():
    e = bpy.data.objects.new(name, None)
    e.location = R @ J(bone, tail)
    scene.collection.objects.link(e)
    empties.append(e)


def export(ob, path):
    # internal UV-editor selection layers (".vs.*", ".es.*", ".pn.*") are not exportable data
    for name in [a.name for a in ob.data.attributes if a.name.startswith(".")]:
        try:
            ob.data.attributes.remove(ob.data.attributes[name])
        except (KeyError, RuntimeError):
            pass
    for name in [u.name for u in ob.data.uv_layers if u.name != "hand"]:
        try:
            ob.data.uv_layers.remove(ob.data.uv_layers[name])
        except (KeyError, RuntimeError):
            pass
    for at in [a.name for a in ob.data.attributes if a.name in ("nail", "freeedge", "f1", "f2", "f3", "f4", "f5")]:
        ob.data.attributes.remove(ob.data.attributes[at])
    ob.data.materials.clear()
    for o in scene.objects:
        o.select_set(False)
    ob.select_set(True)
    for e in empties:
        e.select_set(True)
    bpy.ops.export_scene.gltf(
        filepath=str(path), export_format="GLB", use_selection=True, export_texcoords=True, export_normals=True,
        export_materials="NONE", export_skins=False, export_animations=False, export_yup=False,
        export_attributes=False, export_apply=True,
    )


if PREVIEW:
    import addon_utils  # noqa: F401

    mat = bpy.data.materials.new("preview")
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    tex = mat.node_tree.nodes.new("ShaderNodeTexImage")
    tex.image = albedo
    mat.node_tree.links.new(tex.outputs[0], bsdf.inputs["Base Color"])
    hq.data.materials.clear()
    hq.data.materials.append(mat)
    lq.hide_render = True
    hand.hide_render = True
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.display.shading.light = "STUDIO"
    scene.display.shading.color_type = "TEXTURE"
    scene.render.resolution_x = scene.render.resolution_y = 900
    cam_data = bpy.data.cameras.new("cam")
    cam_data.type = "ORTHO"
    cam_data.ortho_scale = 0.30
    cam = bpy.data.objects.new("cam", cam_data)
    scene.collection.objects.link(cam)
    scene.camera = cam
    cy = sum(v.co.y for v in hq.data.vertices) / len(hq.data.vertices)
    for side, x in (("palm", -1.0), ("back", 1.0)):
        cam.location = (x, cy, 0)
        # camera looks along -x*X with fingers (-Y) pointing up in the image
        cols = ((0, 0, -1), (0, -1, 0), (-1, 0, 0)) if x < 0 else ((0, 0, 1), (0, -1, 0), (1, 0, 0))
        cam.rotation_euler = Matrix(cols).transposed().to_euler()
        scene.render.filepath = str(OUT / f"preview-{side}.png")
        bpy.ops.render.render(write_still=True)

export(hq, OUT / "hand-hq.glb")
export(lq, OUT / "hand-lq.glb")
print("BUILD_OK", OUT)
