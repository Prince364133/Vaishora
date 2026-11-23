# One-time setup of a PORTABLE Blender for the hand build (see docs/HAND_REALISM.md).
#   blender -b --factory-startup --python scripts/hand-real/setup_blender.py -- <mpfb_user_dir>
# Enables the MPFB2 extension (copied into <blender>/portable/extensions/user_default/mpfb)
# and points its user-data directory at the unpacked CC0 MakeHuman asset packs.
import sys
import bpy

user_dir = sys.argv[sys.argv.index("--") + 1]
bpy.ops.preferences.addon_enable(module="bl_ext.user_default.mpfb")
prefs = bpy.context.preferences.addons["bl_ext.user_default.mpfb"].preferences
prefs.mpfb_user_data = user_dir
bpy.context.preferences.use_preferences_save = True
bpy.ops.wm.save_userpref()
print("MPFB enabled; user data =", prefs.mpfb_user_data)
