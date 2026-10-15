import test from 'node:test';
import assert from 'node:assert/strict';
import { encodePacket, decodePacket, toQrText, fromQrText, encodeManifest, randomTransferId } from '../src/protocol.js';
import { Receiver } from '../src/receiver.js';
import { createHash } from 'node:crypto';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function manifest(bytes, chunks, name='payload.bin') { return { protocol:1,name,type:'application/octet-stream',size:bytes.length,chunks,sha256:hash(bytes) }; }
function packets(bytes, chunkSize=4) {
 const id=randomTransferId(), total=Math.ceil(bytes.length/chunkSize), frames=[];
 frames.push(encodePacket({transferId:id,type:0,payload:encodeManifest(manifest(bytes,total))}));
 for(let i=0;i<total;i++)frames.push(encodePacket({transferId:id,type:1,index:i,total,payload:bytes.slice(i*chunkSize,(i+1)*chunkSize)}));
 return frames;
}
test('binary packet round trips with QR text wrapper',()=>{const p=encodePacket({transferId:'0102030405060708',type:1,index:9,total:13,payload:Uint8Array.from([0,1,128,255])});assert.deepEqual(fromQrText(toQrText(p)).payload,Uint8Array.from([0,1,128,255]));assert.equal(decodePacket(p).index,9)});
test('corruption, malformed length and unsupported versions are rejected',()=>{
 const p=encodePacket({transferId:'0102030405060708',type:1,index:0,total:1,payload:Uint8Array.of(3)});
 const corrupt=p.slice();corrupt[26]^=1;assert.throws(()=>decodePacket(corrupt),/checksum/);
 const trunc=p.slice(0,-1);assert.throws(()=>decodePacket(trunc),/length/);
 const version=p.slice();version[2]=9;assert.throws(()=>decodePacket(version),/version/);
});
test('reconstructs empty file and verifies its SHA-256',async()=>{const r=new Receiver();for(const p of packets(new Uint8Array()))r.accept(decodePacket(p));const done=await r.finish();assert.equal(done.blob.size,0);assert.equal(done.sha256,hash(new Uint8Array()))});
test('out-of-order and duplicate frames reconstruct the exact bytes',async()=>{const bytes=Uint8Array.from({length:37},(_,i)=>(i*31)&255), ps=packets(bytes,5), r=new Receiver();
 for(const p of [ps[0],ps[3],ps[2],ps[3],ps[1],...ps.slice(4).reverse()])r.accept(decodePacket(p));
 const done=await r.finish();assert.deepEqual(new Uint8Array(await done.blob.arrayBuffer()),bytes);assert.equal(done.sha256,hash(bytes));assert.equal(r.status().received,r.status().total);
});
test('a dropped chunk recovered on a repeated cycle completes the file',async()=>{const bytes=Uint8Array.from({length:25},(_,i)=>i+1),ps=packets(bytes,5),r=new Receiver();const first=ps.filter((_,i)=>i!==3);for(const p of first)r.accept(decodePacket(p));assert.equal(r.status().ready,false);for(const p of ps)r.accept(decodePacket(p));assert.equal(r.status().ready,true);assert.deepEqual(new Uint8Array(await (await r.finish()).blob.arrayBuffer()),bytes)});
test('missing chunks are incomplete and restart clears prior transfer state',async()=>{const r=new Receiver(),ps=packets(Uint8Array.of(1,2,3,4,5),2);r.accept(decodePacket(ps[0]));r.accept(decodePacket(ps[1]));assert.equal(r.status().ready,false);await assert.rejects(r.finish(),/incomplete/);r.reset();assert.equal(r.status().transferId,null)});
test('rejects transfer ID mismatch and a manifest hash that does not match file bytes',async()=>{const r=new Receiver(),id=randomTransferId(),badManifest={protocol:1,name:'x',type:'application/octet-stream',size:1,chunks:1,sha256:'0'.repeat(64)};r.accept(decodePacket(encodePacket({transferId:id,type:0,payload:encodeManifest(badManifest)})));assert.throws(()=>r.accept(decodePacket(encodePacket({transferId:'ffffffffffffffff',type:1,index:0,total:1,payload:Uint8Array.of(1)}))),/different transfer/);r.accept(decodePacket(encodePacket({transferId:id,type:1,index:0,total:1,payload:Uint8Array.of(1)})));await assert.rejects(r.finish(),/SHA-256/)});
test('enforces file size limit before accumulating chunks',()=>{const r=new Receiver({maxFileBytes:2}),id=randomTransferId(),m={protocol:1,name:'x',size:3,chunks:1,sha256:'0'.repeat(64)};const frame=encodePacket({transferId:id,type:0,payload:encodeManifest(m)});assert.throws(()=>r.accept(decodePacket(frame)),/limit/)});
test('does not retain unique chunk bytes beyond the configured memory bound',()=>{const r=new Receiver({maxFileBytes:3}),id=randomTransferId(),m={protocol:1,name:'x',type:'application/octet-stream',size:3,chunks:2,sha256:'0'.repeat(64)};r.accept(decodePacket(encodePacket({transferId:id,type:0,payload:encodeManifest(m)})));r.accept(decodePacket(encodePacket({transferId:id,type:1,index:0,total:2,payload:Uint8Array.of(1,2)})));assert.throws(()=>r.accept(decodePacket(encodePacket({transferId:id,type:1,index:1,total:2,payload:Uint8Array.of(3,4)}))),/exceeds/);assert.equal(r.bytes,2)});
