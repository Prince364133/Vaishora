// Encodes raw RGBA images to KTX2 (Basis Universal) with the pure-wasm `ktx2-encoder` package (MIT, BinomialLLC
// basis_universal compiled to WebAssembly — no native binary is downloaded or executed).
//
//   node scripts/hand-real/encode_ktx2.mjs <ktx2-encoder package dir> <job.json>
//
// job.json: [{ "in": "x.rgba", "out": "x.ktx2", "mode": "etc1s" | "uastc", "srgb": true, "normal": false,
//              "quality": 160 }, ...]
// .rgba files: 8-byte header (uint32 LE width, height) followed by width*height*4 bytes (written by make_ktx2.py).
// The encoder package is NOT a project dependency: fetch it with `npm pack ktx2-encoder@0.6.0` into a scratch folder.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const [pkgDir, jobFile] = process.argv.slice(2);
const { encodeToKTX2 } = await import(pathToFileURL(path.join(pkgDir, "dist/node/index.js")).href);
const jobs = JSON.parse(fs.readFileSync(jobFile, "utf8"));

const imageDecoder = async (buf) => {
  const b = Buffer.from(buf);
  const width = b.readUInt32LE(0);
  const height = b.readUInt32LE(4);
  return { width, height, data: new Uint8Array(b.buffer, b.byteOffset + 8, width * height * 4) };
};

for (const j of jobs) {
  const t0 = Date.now();
  const opts =
    j.mode === "uastc"
      ? { isUASTC: true, needSupercompression: true, enableRDO: true, rdoQualityLevel: j.rdo ?? 1.5, qualityLevel: 255 }
      : { isUASTC: false, qualityLevel: j.quality ?? 160, compressionLevel: 4 };
  const data = await encodeToKTX2(new Uint8Array(fs.readFileSync(j.in)), {
    ...opts,
    generateMipmap: true,
    isKTX2File: true,
    isNormalMap: !!j.normal,
    isPerceptual: !!j.srgb && !j.normal,
    isSetKTX2SRGBTransferFunc: !!j.srgb,
    imageDecoder,
  });
  fs.writeFileSync(j.out, data);
  console.log(`${path.basename(j.out)} ${(data.byteLength / 1024).toFixed(0)} KB (${j.mode}) in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
}
