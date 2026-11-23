// Skin material with a projected, photographic-looking henna stain.
//
// Skin: CC0 MakeHuman skin (baked into a hand-only UV layout) as albedo, a normal map derived from the photo
// texture (creases, knuckle wrinkles, pores) and a detail map (R = fingernail mask, G = crease cavity).
// A wrap-lighting term adds the warm light bleed of subsurface scattering so skin never looks like plastic.
//
// Henna: the artwork is projected in the hand's bind-pose object space (palm projection on palm-facing surfaces,
// back projection on the back), so it stays glued to the skin. The stain is applied *multiplicatively* to the skin
// albedo — like a dye in the outer skin layer — so creases, pores and tone variation stay visible through it.
// Stain character (see docs/HAND_REALISM.md for the photo study):
//   * soft bleed halo around lines (mask sampled at several blur levels)
//   * density-dependent colour: thin lines warmer and lighter, dense fills deep maroon-brown
//   * palm side darker than the back of the hand and the wrist; slightly darker towards the fingertips
//   * low-frequency blotchiness and tiny breaks in deep creases
// Two texture slots per side allow a GPU crossfade when the design changes.

import * as THREE from "three";
import landmarks from "@/lib/mehndi/hand-landmarks.json";

export interface MehndiUniforms {
  uPalmA: { value: THREE.Texture };
  uPalmB: { value: THREE.Texture };
  uBackA: { value: THREE.Texture };
  uBackB: { value: THREE.Texture };
  uDetail: { value: THREE.Texture };
  uMicro: { value: THREE.Texture };
  uMix: { value: number };
  /**
   * Photo albedo per side ("palm_photo" / "back_photo" design assets): square RGBA in the same projection frame
   * as the artwork, sRGB colour, alpha = hand coverage. Uploaded premultiplied (no dark fringes when filtered).
   * Slots A/B crossfade with uMix like the artwork.
   */
  uPhotoPalmA: { value: THREE.Texture };
  uPhotoPalmB: { value: THREE.Texture };
  uPhotoBackA: { value: THREE.Texture };
  uPhotoBackB: { value: THREE.Texture };
  uStrength: { value: number };
}

const empty = (() => {
  const t = new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1);
  t.needsUpdate = true;
  return t;
})();
export const EMPTY_TEXTURE = empty;

export interface SkinMaps {
  albedo: THREE.Texture;
  normal: THREE.Texture;
  detail: THREE.Texture;
  /** Tileable micro normal (pores, fine skin relief), repeated at ≈ 1.4 cm. */
  micro: THREE.Texture;
}

export function createMehndiMaterial(maps: SkinMaps) {
  const { frame } = landmarks;
  const uniforms: MehndiUniforms = {
    uPalmA: { value: empty },
    uPalmB: { value: empty },
    uBackA: { value: empty },
    uBackB: { value: empty },
    uDetail: { value: maps.detail },
    uMicro: { value: maps.micro },
    uMix: { value: 0 },
    uPhotoPalmA: { value: empty },
    uPhotoPalmB: { value: empty },
    uPhotoBackA: { value: empty },
    uPhotoBackB: { value: empty },
    uStrength: { value: 1 },
  };

  const mat = new THREE.MeshPhysicalMaterial({
    map: maps.albedo,
    normalMap: maps.normal,
    normalScale: new THREE.Vector2(0.75, 0.75),
    color: new THREE.Color(1, 1, 1),
    // Dual-lobe skin specular: a broad base lobe (roughness ~0.55) plus a thin, sharper oily layer (clear coat).
    roughness: 0.55,
    metalness: 0,
    specularIntensity: 0.5,
    specularColor: new THREE.Color("#fff4ee"),
    sheen: 0.22,
    sheenRoughness: 0.55,
    sheenColor: new THREE.Color("#f0c4ad"),
    clearcoat: 0.14,
    clearcoatRoughness: 0.34,
  });

  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
        varying vec3 vBindPos;
        varying vec3 vBindNormal;`,
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        vBindPos = position;
        vBindNormal = normal;`,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
        varying vec3 vBindPos;
        varying vec3 vBindNormal;
        uniform sampler2D uPalmA;
        uniform sampler2D uPalmB;
        uniform sampler2D uBackA;
        uniform sampler2D uBackB;
        uniform sampler2D uDetail;
        uniform sampler2D uMicro;
        const float MICRO_TILE = 18.0;
        uniform float uMix;
        uniform sampler2D uPhotoPalmA;
        uniform sampler2D uPhotoPalmB;
        uniform sampler2D uPhotoBackA;
        uniform sampler2D uPhotoBackB;
        uniform float uStrength;
        const float FRAME_CU = ${frame.centerU.toFixed(6)};
        const float FRAME_CV = ${frame.centerV.toFixed(6)};
        const float FRAME_S = ${frame.size.toFixed(6)};
        const float TIP_Y = ${frame.minY.toFixed(6)};

        float vhash(vec3 p) {
          p = fract(p * 0.3183099 + 0.1);
          p *= 17.0;
          return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
        }
        float vnoise(vec3 x) {
          vec3 i = floor(x);
          vec3 f = fract(x);
          f = f * f * (3.0 - 2.0 * f);
          return mix(mix(mix(vhash(i + vec3(0,0,0)), vhash(i + vec3(1,0,0)), f.x),
                         mix(vhash(i + vec3(0,1,0)), vhash(i + vec3(1,1,0)), f.x), f.y),
                     mix(mix(vhash(i + vec3(0,0,1)), vhash(i + vec3(1,0,1)), f.x),
                         mix(vhash(i + vec3(0,1,1)), vhash(i + vec3(1,1,1)), f.x), f.y), f.z);
        }
        // Mask at a given blur level (mip bias) for one side, crossfaded between slots A and B.
        float sideMask(sampler2D a, sampler2D b, vec2 uv, float bias) {
          // artwork exists only inside the projection frame (the long forearm beyond it stays bare)
          float inF = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
          return mix(texture2D(a, uv, bias).a, texture2D(b, uv, bias).a, uMix) * inF;
        }
        // x = sharp coverage, y = halo (bleed), z = local density, w = palm weight (0 back .. 1 palm)
        vec4 hennaSample() {
          vec3 n = normalize(vBindNormal);
          float v = 0.5 + (FRAME_CV - vBindPos.y) / FRAME_S;
          vec2 uvPalm = vec2(0.5 - (vBindPos.z - FRAME_CU) / FRAME_S, v);
          vec2 uvBack = vec2(0.5 + (vBindPos.z - FRAME_CU) / FRAME_S, v);
          float wPalm = smoothstep(0.05, 0.4, -n.x);
          float wBack = smoothstep(0.05, 0.4, n.x);
          // two-octave wobble of the lookup: bled, irregular edges instead of vector-clean ones
          vec2 wob = (vec2(vnoise(vBindPos * 2600.0), vnoise(vBindPos * 2600.0 + 7.1)) - 0.5) * 0.0005
                   + (vec2(vnoise(vBindPos * 650.0 + 3.3), vnoise(vBindPos * 650.0 + 9.7)) - 0.5) * 0.0019;
          float pS = sideMask(uPalmA, uPalmB, uvPalm + wob, 0.2);
          float pH = sideMask(uPalmA, uPalmB, uvPalm, 1.6);
          float pD = sideMask(uPalmA, uPalmB, uvPalm, 3.6);
          float bS = sideMask(uBackA, uBackB, uvBack + wob, 0.2);
          float bH = sideMask(uBackA, uBackB, uvBack, 1.6);
          float bD = sideMask(uBackA, uBackB, uvBack, 3.6);
          float wsum = max(wPalm + wBack, 1e-4);
          return vec4(
            clamp(pS * wPalm + bS * wBack, 0.0, 1.0),
            clamp(pH * wPalm + bH * wBack, 0.0, 1.0),
            clamp(pD * wPalm + bD * wBack, 0.0, 1.0),
            wPalm / wsum
          );
        }`,
      )
      .replace(
        "#include <map_fragment>",
        `#include <map_fragment>
        vec4 skinDetail = texture2D(uDetail, vMapUv);
        float nailM = smoothstep(0.25, 0.7, skinDetail.r);
        float freeEdge = skinDetail.b * nailM;
        float cavity = skinDetail.g;
        float photoW = 0.0;
        {
          // (palm/back tone balance is baked into the composed albedo — see scripts/hand-real/postprocess.py)
          // Very gentle micro-tonal variation without blotchy low-frequency patches.
          float tone = vnoise(vBindPos * 320.0);
          diffuseColor.rgb *= 0.995 + tone * 0.01;

          // ---- photo albedo: real skin and real henna from a photograph, in the artwork projection frame.
          // Palm photo on palm-facing surfaces, back photo on the back; alpha feathers into our skin, and finger
          // sides blend by the surface normal.
          {
            vec3 nB = normalize(vBindNormal);
            float v = 0.5 + (FRAME_CV - vBindPos.y) / FRAME_S;
            vec2 uvP = vec2(0.5 - (vBindPos.z - FRAME_CU) / FRAME_S, v);
            vec2 uvB = vec2(0.5 + (vBindPos.z - FRAME_CU) / FRAME_S, v);
            // premultiplied samples: rgb already weighted by alpha
            float inF = step(0.0, uvP.x) * step(uvP.x, 1.0) * step(0.0, v) * step(v, 1.0);
            vec4 pp = mix(texture2D(uPhotoPalmA, uvP), texture2D(uPhotoPalmB, uvP), uMix) * smoothstep(0.04, 0.4, -nB.x) * inF;
            vec4 pk = mix(texture2D(uPhotoBackA, uvB), texture2D(uPhotoBackB, uvB), uMix) * smoothstep(0.04, 0.4, nB.x) * inF;
            vec4 ph = pp + pk;
            photoW = clamp(ph.a, 0.0, 1.0);
            diffuseColor.rgb = mix(diffuseColor.rgb, ph.rgb / max(ph.a, 1e-4), photoW);
          }
          // Nails: lighter, pinker, translucent-looking plate.
          // (nail bed / free-edge colours are in the albedo; gloss and translucency are handled below)

          // ---- henna stain
          // Henna as a dye in the skin, calibrated on the owner's stain photographs (linear-light multipliers of
          // the skin colour measured at light / mid / dense stain): see docs/HAND_REALISM.md §8.
          vec4 hs = hennaSample();
          float blot = vnoise(vBindPos * 85.0) * 0.65 + vnoise(vBindPos * 330.0) * 0.35;   // uneven take-up
          float grain = vnoise(vBindPos * 3800.0) * 0.6 + vnoise(vBindPos * 1500.0) * 0.4; // paste grain ~0.3 mm
          float tipK = smoothstep(TIP_Y + 0.06, TIP_Y + 0.004, vBindPos.y);                 // dipped tips: darker at the end
          float cov = smoothstep(0.06, 0.8, hs.x);                                           // soft, slightly bled edge
          float halo = smoothstep(0.03, 0.55, hs.y) * (1.0 - cov) * 0.32;                    // light orange bleed around lines
          float edge = clamp(hs.x - hs.z * 1.15, 0.0, 1.0);                                  // paste pools at shape edges
          cov *= 1.0 - smoothstep(0.35, 0.85, cavity) * 0.3;                                 // skips deep creases
          float dens = clamp(0.24 + hs.z * 1.05 + edge * 0.3, 0.0, 1.0);
          // dipped fingertips: darkest at the very tip, lighter and warmer towards the cap's edge
          dens = mix(dens * 0.8, min(1.0, dens + 0.2), tipK);
          vec3 lightM = vec3(0.66, 0.34, 0.2);
          vec3 midM = vec3(0.44, 0.12, 0.06);
          vec3 deepM = vec3(0.21, 0.048, 0.024);
          vec3 mulS = dens < 0.5 ? mix(lightM, midM, dens * 2.0) : mix(midM, deepM, dens * 2.0 - 1.0);
          // back of the hand / wrist: thinner keratin takes less dye → lighter and browner
          mulS = mix(mix(mulS, lightM, 0.3) * vec3(1.0, 1.1, 1.15), mulS, hs.w);
          float along = vnoise(vBindPos * 420.0);                                            // ~2.5 mm: paste thickness along a line
          float take = 0.74 + blot * 0.24 + (grain - 0.5) * 0.3 + (along - 0.5) * 0.34;
          mulS = pow(mulS, vec3(take));
          float s = cov * uStrength * (1.0 - nailM * 0.85) * (1.0 - photoW);
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * mulS, s);
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.9, 0.72, 0.62), halo * uStrength * (1.0 - photoW));
        }`,
      )
      .replace(
        "#include <roughnessmap_fragment>",
        `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.16, nailM);
        roughnessFactor = mix(roughnessFactor, 0.68, cavity * 0.5);
        {
          // micro-roughness: pores and grooves are rougher than the plateaus between them
          vec3 micR = texture2D(uMicro, vMapUv * MICRO_TILE).xyz * 2.0 - 1.0;
          roughnessFactor *= 0.9 + (1.0 - micR.z) * 2.5 + vnoise(vBindPos * 700.0) * 0.08;
        }`,
      )
      .replace(
        "#include <normal_fragment_maps>",
        `#include <normal_fragment_maps>
        // the photo already carries the real palm creases: don't stack our sculpted crease normals on top
        normal = normalize(mix(normal, nonPerturbedNormal, photoW * 0.6));
        #ifdef USE_NORMALMAP_TANGENTSPACE
          // micro detail (pores, fine relief) on top of the hand's own normal map — holds up at maximum zoom
          vec3 mic = texture2D(uMicro, vNormalMapUv * MICRO_TILE).xyz * 2.0 - 1.0;
          normal = normalize(normal + tbn * vec3(mic.xy * 0.9 * (1.0 - nailM), 0.0));
        #endif`,
      )
      .replace(
        "#include <lights_physical_fragment>",
        `#include <lights_physical_fragment>
        #ifdef USE_CLEARCOAT
          // healthy nails: soft satin clear coat on the nail plate without harsh glare blobs
          material.clearcoat = mix(material.clearcoat, 0.42, nailM);
          material.clearcoatRoughness = mix(material.clearcoatRoughness, 0.22, nailM);
        #endif`,
      )
      .replace(
        "#include <opaque_fragment>",
        `{
          // Subsurface approximation: warm, golden-red light bleeding into the shadowed side and the terminator.
          float l = dot(outgoingLight, vec3(0.2126, 0.7152, 0.0722));
          vec3 sss = diffuseColor.rgb * vec3(1.0, 0.38, 0.24) * (0.03 + 0.05 * (1.0 - smoothstep(0.0, 0.45, l)));
          outgoingLight += sss * (1.0 - nailM * 0.5) * (1.0 - cavity * 0.8);
          // translucency at thin silhouette edges (finger sides, web of the hand): warm glow, strongest at grazing view
          float edge = pow(1.0 - clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0), 2.2);
          outgoingLight += diffuseColor.rgb * vec3(1.0, 0.5, 0.34) * edge * 0.07;
        }
        #include <opaque_fragment>`,
      );
  };
  mat.customProgramCacheKey = () => "vaishora-mehndi-skin-v5";
  return { material: mat, uniforms };
}

const cache = new Map<string, Promise<THREE.Texture>>();
const order: string[] = [];
const MAX_CACHED = 8;

/** Rasterise an artwork image (SVG or transparent PNG/WebP) into a mask texture. */
export function loadArtTexture(url: string, size: number, anisotropy: number): Promise<THREE.Texture> {
  const key = `${url}@${size}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const p = new Promise<THREE.Texture>((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.decoding = "async";
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = size;
      const ctx = canvas.getContext("2d");
      if (!ctx) return reject(new Error("2D canvas unavailable"));
      ctx.drawImage(img, 0, 0, size, size);
      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.NoColorSpace;
      tex.anisotropy = anisotropy;
      tex.minFilter = THREE.LinearMipmapLinearFilter;
      tex.generateMipmaps = true;
      tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
      tex.needsUpdate = true;
      resolve(tex);
    };
    img.onerror = () => reject(new Error(`Could not load artwork ${url}`));
    img.src = url;
  });
  cache.set(key, p);
  order.push(key);
  while (order.length > MAX_CACHED) {
    const old = order.shift()!;
    const tp = cache.get(old);
    cache.delete(old);
    tp?.then((t) => t.dispose()).catch(() => {});
  }
  p.catch(() => cache.delete(key));
  return p;
}

const photoCache = new Map<string, Promise<THREE.Texture>>();
const photoOrder: string[] = [];
const MAX_PHOTOS = 3; // current + previous (crossfade) + one spare; evicted textures are disposed

/**
 * Load a photo albedo ("palm_photo" / "back_photo": RGBA, sRGB colour, alpha = coverage). Premultiplied on upload so
 * filtering at the feathered edge never pulls in dark transparent texels; full mip chain and maximum anisotropy so
 * it stays crisp when zoomed and at grazing angles.
 */
export function loadPhotoTexture(url: string, anisotropy: number): Promise<THREE.Texture> {
  const hit = photoCache.get(url);
  if (hit) return hit;
  const p = new THREE.TextureLoader().loadAsync(url).then((tex) => {
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.premultiplyAlpha = true;
    tex.anisotropy = anisotropy;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = true;
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.needsUpdate = true;
    return tex;
  });
  photoCache.set(url, p);
  photoOrder.push(url);
  while (photoOrder.length > MAX_PHOTOS) {
    const old = photoOrder.shift()!;
    const tp = photoCache.get(old);
    photoCache.delete(old);
    tp?.then((t) => t.dispose()).catch(() => {});
  }
  p.catch(() => photoCache.delete(url));
  return p;
}
