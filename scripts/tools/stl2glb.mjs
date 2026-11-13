// 二进制 STL → GLB（按位置合并顶点）
import fs from 'fs';
import { Document, NodeIO } from '@gltf-transform/core';
const [, , IN, OUT] = process.argv;
const b = fs.readFileSync(IN);
const nt = b.readUInt32LE(80);
console.log('三角形', nt, '文件头', b.slice(0, 40).toString('latin1').replace(/[^\x20-\x7e]/g, '').trim());
const map = new Map(), pos = [], idx = new Uint32Array(nt * 3);
let min = [1e9, 1e9, 1e9], max = [-1e9, -1e9, -1e9];
for (let t = 0; t < nt; t++) {
  const o = 84 + t * 50;
  for (let k = 0; k < 3; k++) {
    const x = b.readFloatLE(o + 12 + k * 12), y = b.readFloatLE(o + 16 + k * 12), z = b.readFloatLE(o + 20 + k * 12);
    const key = x + ',' + y + ',' + z;
    let i = map.get(key);
    if (i === undefined) { i = pos.length / 3; map.set(key, i); pos.push(x, y, z); min = [Math.min(min[0], x), Math.min(min[1], y), Math.min(min[2], z)]; max = [Math.max(max[0], x), Math.max(max[1], y), Math.max(max[2], z)]; }
    idx[t * 3 + k] = i;
  }
}
console.log('顶点', pos.length / 3, '包围盒', min.map((v) => +v.toFixed(3)), max.map((v) => +v.toFixed(3)), '尺寸', max.map((v, i) => +(v - min[i]).toFixed(3)));
const doc = new Document(), buf = doc.createBuffer();
const prim = doc.createPrimitive().setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array(pos)).setBuffer(buf)).setIndices(doc.createAccessor().setType('SCALAR').setArray(idx).setBuffer(buf));
doc.createScene().addChild(doc.createNode('egretFly').setMesh(doc.createMesh().addPrimitive(prim)));
await new NodeIO().write(OUT, doc);
