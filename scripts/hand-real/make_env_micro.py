# Small runtime assets for the realistic hand (no third-party code is executed; the HDRI is a CC0 data file).
#
#   python scripts/hand-real/make_env_micro.py <studio_small_09_1k.hdr> public/models
#
# 1. studio-256.hdr  — Poly Haven "Studio Small 09" (Sergej Majboroda, CC0) down-sampled to 256x128 RGBE (≈ 130 KB):
#    image-based lighting for the skin (soft studio reflections, natural fill), cheap enough for phones.
# 2. skin-micro-normal.jpg — 512² tileable tangent-space micro normal generated here (CC0): pores and the fine
#    criss-cross micro-relief ("skin glyphs") of real skin, tiled at ≈ 1.4 cm so it holds up at maximum zoom.
import pathlib
import sys

import cv2
import numpy as np

hdr_in = sys.argv[1]
out = pathlib.Path(sys.argv[2])
out.mkdir(parents=True, exist_ok=True)

env = cv2.imread(hdr_in, cv2.IMREAD_UNCHANGED)  # float32 BGR, linear
env = cv2.resize(env, (256, 128), interpolation=cv2.INTER_AREA)
cv2.imwrite(str(out / "studio-256.hdr"), env)
print("studio-256.hdr", (out / "studio-256.hdr").stat().st_size // 1024, "KB")

N = 512
rng = np.random.default_rng(3)


def periodic_noise(aniso_angle=None, freq=40.0, bw=0.5, elong=1.0):
    """Band-limited periodic noise via random phases in the Fourier domain (tiles seamlessly)."""
    fy, fx = np.meshgrid(np.fft.fftfreq(N) * N, np.fft.fftfreq(N) * N, indexing="ij")
    if aniso_angle is not None:
        c, s = np.cos(aniso_angle), np.sin(aniso_angle)
        u = fx * c + fy * s
        v = -fx * s + fy * c
        r = np.sqrt((u * elong) ** 2 + (v / elong) ** 2)
    else:
        r = np.sqrt(fx * fx + fy * fy)
    amp = np.exp(-(((r - freq) / (freq * bw)) ** 2))
    amp[0, 0] = 0
    ph = np.exp(2j * np.pi * rng.random((N, N)))
    f = np.real(np.fft.ifft2(amp * ph))
    return f / (f.std() + 1e-9)


# criss-cross micro relief: two families of elongated grooves at roughly ±40°
glyph = np.abs(periodic_noise(np.radians(40), 26, 0.35, 3.0)) + np.abs(periodic_noise(np.radians(-40), 26, 0.35, 3.0))
glyph = -(glyph - glyph.mean())  # grooves are valleys
fine = periodic_noise(None, 110, 0.6) * 0.25

# pores: small pits, wrapped at the tile edges
pores = np.zeros((N, N), np.float32)
pts = rng.random((2600, 2)) * N
rad = rng.uniform(0.9, 2.2, 2600)
yy, xx = np.mgrid[-6:7, -6:7]
for (x, y), r in zip(pts, rad):
    k = np.exp(-(xx ** 2 + yy ** 2) / (2 * r * r))
    xi, yi = int(x), int(y)
    ys = (np.arange(yi - 6, yi + 7) % N)[:, None]
    xs = (np.arange(xi - 6, xi + 7) % N)[None, :]
    pores[ys, xs] -= k
height = glyph * 0.55 + fine + pores * 0.9
height = (height - height.mean()) / height.std()

gx = (np.roll(height, -1, 1) - np.roll(height, 1, 1)) * 0.5
gy = (np.roll(height, -1, 0) - np.roll(height, 1, 0)) * 0.5
strength = 0.35
n = np.dstack([-gx * strength, gy * strength, np.ones_like(gx)])
n /= np.linalg.norm(n, axis=2, keepdims=True)
img = ((n * 0.5 + 0.5) * 255 + 0.5).clip(0, 255).astype(np.uint8)
cv2.imwrite(str(out / "skin-micro-normal.jpg"), cv2.cvtColor(img, cv2.COLOR_RGB2BGR), [cv2.IMWRITE_JPEG_QUALITY, 90])
print("skin-micro-normal.jpg", (out / "skin-micro-normal.jpg").stat().st_size // 1024, "KB")
