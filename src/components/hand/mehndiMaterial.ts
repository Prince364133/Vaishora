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
  uMix: { value: number };
  /** Photo palm (real skin + real henna, warped onto this hand by scripts/hand-real/photo_transfer.py). */
  uPhotoA: { value: THREE.Texture };
  uPhotoB: { value: THREE.Texture };
  uPhotoMask: { value: THREE.Texture };
  /** 1 when slot A / B holds a photo, 0 for the procedural look; crossfaded with uMix like the artwork. */
  uPhotoOnA: { value: number };
  uPhotoOnB: { value: number };
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
}

export function createMehndiMaterial(maps: SkinMaps) {
  const { frame } = landmarks;
  const uniforms: MehndiUniforms = {
    uPalmA: { value: empty },
    uPalmB: { value: empty },
    uBackA: { value: empty },
    uBackB: { value: empty },
    uDetail: { value: maps.detail },
    uMix: { value: 0 },
    uPhotoA: { value: empty },
    uPhotoB: { value: empty },
    uPhotoMask: { value: empty },
    uPhotoOnA: { value: 0 },
    uPhotoOnB: { value: 0 },
    uStrength: { value: 1 },
  };

  const mat = new THREE.MeshPhysicalMaterial({
    map: maps.albedo,
    normalMap: maps.normal,
    normalScale: new THREE.Vector2(0.7, 0.7),
    color: new THREE.Color(1, 1, 1),
    roughness: 0.58,
    metalness: 0,
    specularIntensity: 0.45,
    specularColor: new THREE.Color("#fff1ea"),
    sheen: 0.35,
    sheenRoughness: 0.6,
    sheenColor: new THREE.Color("#f3c7b0"),
    clearcoat: 0.02,
    clearcoatRoughness: 0.45,
    transparent: true,
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
        uniform float uMix;
        uniform sampler2D uPhotoA;
        uniform sampler2D uPhotoB;
        uniform sampler2D uPhotoMask;
        uniform float uPhotoOnA;
        uniform float uPhotoOnB;
        uniform float uStrength;
        const float FRAME_CU = ${frame.centerU.toFixed(6)};
        const float FRAME_CV = ${frame.centerV.toFixed(6)};
        const float FRAME_S = ${frame.size.toFixed(6)};
        const float CUT_Y = ${frame.maxY.toFixed(6)};
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
          return mix(texture2D(a, uv, bias).a, texture2D(b, uv, bias).a, uMix);
        }
        // x = sharp coverage, y = halo (bleed), z = local density, w = palm weight (0 back .. 1 palm)
        vec4 hennaSample() {
          vec3 n = normalize(vBindNormal);
          float v = 0.5 + (FRAME_CV - vBindPos.y) / FRAME_S;
          vec2 uvPalm = vec2(0.5 - (vBindPos.z - FRAME_CU) / FRAME_S, v);
          vec2 uvBack = vec2(0.5 + (vBindPos.z - FRAME_CU) / FRAME_S, v);
          float wPalm = smoothstep(0.05, 0.4, -n.x);
          float wBack = smoothstep(0.05, 0.4, n.x);
          // tiny wobble of the lookup = organic, slightly irregular edges
          vec2 wob = (vec2(vnoise(vBindPos * 2600.0), vnoise(vBindPos * 2600.0 + 7.1)) - 0.5) * 0.0011;
          float pS = sideMask(uPalmA, uPalmB, uvPalm + wob, -0.3);
          float pH = sideMask(uPalmA, uPalmB, uvPalm, 1.6);
          float pD = sideMask(uPalmA, uPalmB, uvPalm, 3.6);
          float bS = sideMask(uBackA, uBackB, uvBack + wob, -0.3);
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
          // Forearm cut: dissolve the last few centimetres into the stage. Only front faces of the forearm are
          // in this band, so plain alpha blending needs no sorting.
          diffuseColor.a *= smoothstep(CUT_Y - 0.002, CUT_Y - 0.05, vBindPos.y);

          // (palm/back tone balance is baked into the composed albedo — see scripts/hand-real/postprocess.py)
          // Natural pigment variation at two scales on top of the skin texture.
          float tone = vnoise(vBindPos * 55.0) * 0.6 + vnoise(vBindPos * 210.0) * 0.4;
          diffuseColor.rgb *= 0.985 + tone * 0.03;

          // ---- photo palm: real skin and real henna from a photograph, in the same palm projection frame.
          // Used on palm-facing surfaces inside the feathered photo mask; finger sides blend into our skin.
          {
            vec2 uvPh = vec2(0.5 - (vBindPos.z - FRAME_CU) / FRAME_S, 0.5 + (FRAME_CV - vBindPos.y) / FRAME_S);
            float facing = smoothstep(0.12, 0.5, -normalize(vBindNormal).x);
            float m = texture2D(uPhotoMask, uvPh).r * facing;
            photoW = m * mix(uPhotoOnA, uPhotoOnB, uMix);
            vec3 pa = texture2D(uPhotoA, uvPh).rgb;
            vec3 pb = texture2D(uPhotoB, uvPh).rgb;
            vec3 pc = mix(pa * uPhotoOnA, pb * uPhotoOnB, uMix) / max(mix(uPhotoOnA, uPhotoOnB, uMix), 1e-3);
            diffuseColor.rgb = mix(diffuseColor.rgb, pc, photoW);
          }
          // Nails: lighter, pinker, translucent-looking plate.
          // (nail bed / free-edge colours are in the albedo; gloss and translucency are handled below)

          // ---- henna stain
          vec4 hs = hennaSample();
          float blot = vnoise(vBindPos * 85.0) * 0.65 + vnoise(vBindPos * 330.0) * 0.35;
          float tipK = smoothstep(TIP_Y + 0.07, TIP_Y + 0.005, vBindPos.y); // darker towards fingertips
          float halo = smoothstep(0.02, 0.6, hs.y) * 0.2;
          // the halo is the lighter orange bleed, not the full stain colour
          vec3 haloMul = vec3(0.86, 0.62, 0.5);
          float cover = max(hs.x, halo);
          // breaks where paste skipped deep creases, and uneven take-up (blotchiness)
          cover *= 1.0 - smoothstep(0.35, 0.85, cavity) * 0.35;
          cover *= 0.86 + blot * 0.22;
          // depth of stain: dense fills and the palm stain deepest; back/wrist lighter and browner
          float depth = clamp(0.4 + hs.z * 0.8 + tipK * 0.3, 0.0, 1.0) * mix(0.8, 1.0, hs.w);
          vec3 thin = vec3(0.5, 0.2, 0.11);   // multiplier: warm red-brown for fine lines
          vec3 deep = vec3(0.27, 0.085, 0.055); // multiplier: deep maroon-brown for fills and fingertips
          vec3 hennaMul = mix(thin, deep, depth);
          hennaMul = mix(hennaMul, hennaMul * vec3(1.06, 0.95, 0.9), blot);
          hennaMul = mix(haloMul, hennaMul, smoothstep(0.0, 0.5, hs.x));
          float s = cover * uStrength * (1.0 - nailM * 0.85) * (1.0 - photoW);
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * hennaMul, s);
        }`,
      )
      .replace(
        "#include <roughnessmap_fragment>",
        `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.16, nailM);
        roughnessFactor = mix(roughnessFactor, 0.66, cavity * 0.5);
        roughnessFactor *= 0.96 + vnoise(vBindPos * 700.0) * 0.08;`,
      )
      .replace(
        "#include <normal_fragment_maps>",
        `#include <normal_fragment_maps>
        // the photo already carries the real palm creases: don't stack our sculpted crease normals on top
        normal = normalize(mix(normal, nonPerturbedNormal, photoW * 0.8));`,
      )
      .replace(
        "#include <lights_physical_fragment>",
        `#include <lights_physical_fragment>
        #ifdef USE_CLEARCOAT
          // healthy nails: glossy clear coat on the nail plate only
          material.clearcoat = mix(material.clearcoat, 1.0, nailM);
          material.clearcoatRoughness = mix(material.clearcoatRoughness, 0.05, nailM);
        #endif`,
      )
      .replace(
        "#include <opaque_fragment>",
        `{
          // Subsurface approximation: warm, red light bleeding into the shadowed side and the terminator.
          float l = dot(outgoingLight, vec3(0.2126, 0.7152, 0.0722));
          vec3 sss = diffuseColor.rgb * vec3(1.0, 0.45, 0.3) * (0.05 + 0.05 * (1.0 - smoothstep(0.0, 0.5, l)));
          outgoingLight += sss * (1.0 - nailM * 0.5) * (1.0 - cavity * 0.8);
          // translucency at thin silhouette edges (finger sides, web of the hand): warm glow, strongest at grazing view
          float edge = pow(1.0 - clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0), 2.2);
          outgoingLight += diffuseColor.rgb * vec3(1.0, 0.55, 0.38) * edge * 0.16;
          // free edge of the nail lets light through
          outgoingLight += vec3(1.0, 0.93, 0.88) * freeEdge * 0.05;
        }
        #include <opaque_fragment>`,
      );
  };
  mat.customProgramCacheKey = () => "vaishora-mehndi-skin-v4";
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
