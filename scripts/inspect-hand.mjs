import fs from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
const buf = fs.readFileSync(process.argv[2]);
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
new GLTFLoader().parse(ab, '', (gltf) => {
  gltf.scene.updateMatrixWorld(true);
  const mesh = gltf.scene.getObjectByProperty('type', 'SkinnedMesh');
  console.log('mesh', mesh.name, 'bindMatrix identity?', mesh.bindMatrix.equals(new THREE.Matrix4()));
  console.log('mesh world', mesh.matrixWorld.elements.map(v=>+v.toFixed(3)).join(','));
  const g = mesh.geometry; g.computeBoundingBox(); console.log('bbox', g.boundingBox);
  // average normal of vertices grouped by sign of x normal
  const n = g.attributes.normal; let px=0,nx=0; for (let i=0;i<n.count;i++){ n.getX(i)>0?px++:nx++; } console.log('normal x+',px,'x-',nx);
  const out = {};
  gltf.scene.traverse(o => { if (o.isBone || /finger|thumb|wrist/.test(o.name)) { const p = new THREE.Vector3(); o.getWorldPosition(p); out[o.name] = p.toArray().map(v=>+v.toFixed(4)); } });
  console.log(JSON.stringify(out, null, 0));
  const uv = g.attributes.uv; let mn=[9,9],mx=[-9,-9]; for(let i=0;i<uv.count;i++){mn[0]=Math.min(mn[0],uv.getX(i));mn[1]=Math.min(mn[1],uv.getY(i));mx[0]=Math.max(mx[0],uv.getX(i));mx[1]=Math.max(mx[1],uv.getY(i));} console.log('uv range',mn,mx);
}, (e) => console.error(e));
