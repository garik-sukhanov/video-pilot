import zlib from 'node:zlib';
import { writeFileSync } from 'node:fs';

const S = 1024;          // canvas size
const SS = 3;            // supersampling factor per axis
const N = S * SS;        // hi-res size

// colors
const hex = (h) => [parseInt(h.slice(1,3),16), parseInt(h.slice(3,5),16), parseInt(h.slice(5,7),16)];
const cTop = hex('#7c5cff');   // purple
const cBot = hex('#4ec9ff');   // cyan
const lerp = (a,b,t) => a + (b-a)*t;
const mix = (c1,c2,t) => [lerp(c1[0],c2[0],t), lerp(c1[1],c2[1],t), lerp(c1[2],c2[2],t)];

// macOS-style squircle (superellipse) coverage
// normalized coords in [-1,1]; |x|^n + |y|^n <= 1  with n≈5 gives the Apple squircle feel
const nExp = 5;
const margin = 0.10;     // padding around the squircle (icon grid safe area)
const inner = 1 - margin;

function squircleCoverage(nx, ny) {
  // nx,ny in [-1,1]; scale to inner region
  const x = nx / inner, y = ny / inner;
  const v = Math.pow(Math.abs(x), nExp) + Math.pow(Math.abs(y), nExp);
  return v <= 1 ? 1 : 0;
}

// play triangle test (pointing right), in normalized [-1,1] space
function inTriangle(nx, ny) {
  // triangle vertices (slightly optically centered)
  const ax = -0.34, ay = -0.46;
  const bx = -0.34, by =  0.46;
  const cx =  0.46, cy =  0.0;
  const sign = (x1,y1,x2,y2,x3,y3) => (x1-x3)*(y2-y3) - (x2-x3)*(y1-y3);
  const d1 = sign(nx,ny, ax,ay, bx,by);
  const d2 = sign(nx,ny, bx,by, cx,cy);
  const d3 = sign(nx,ny, cx,cy, ax,ay);
  const neg = d1<0||d2<0||d3<0, pos = d1>0||d2>0||d3>0;
  return !(neg && pos);
}

const buf = Buffer.alloc(S * S * 4);

for (let py = 0; py < S; py++) {
  for (let px = 0; px < S; px++) {
    let r=0,g=0,b=0,a=0;
    for (let sy=0; sy<SS; sy++) for (let sx=0; sx<SS; sx++) {
      const fx = (px + (sx+0.5)/SS) / S;   // 0..1
      const fy = (py + (sy+0.5)/SS) / S;
      const nx = fx*2 - 1;                  // -1..1
      const ny = fy*2 - 1;
      if (!squircleCoverage(nx, ny)) continue;
      // background gradient (diagonal-ish: top-left purple -> bottom-right cyan)
      const t = Math.min(1, Math.max(0, (fx*0.45 + fy*0.55)));
      let col = mix(cTop, cBot, t);
      // subtle top sheen
      const sheen = Math.max(0, 0.18*(1 - fy*1.6));
      col = [Math.min(255,col[0]+sheen*255*0.4), Math.min(255,col[1]+sheen*255*0.4), Math.min(255,col[2]+sheen*255*0.4)];
      // play triangle in white with slight transparency for depth
      if (inTriangle(nx, ny)) {
        col = [255,255,255];
      }
      r+=col[0]; g+=col[1]; b+=col[2]; a+=255;
    }
    const samples = SS*SS;
    const idx = (py*S+px)*4;
    buf[idx]   = Math.round(r/samples);
    buf[idx+1] = Math.round(g/samples);
    buf[idx+2] = Math.round(b/samples);
    buf[idx+3] = Math.round(a/samples);
  }
}

// encode PNG (truecolor + alpha, no filter)
function crc32(b){let c=~0;for(let i=0;i<b.length;i++){c^=b[i];for(let k=0;k<8;k++)c=(c>>>1)^(0xEDB88320&-(c&1));}return ~c>>>0;}
function chunk(type, data){
  const len=Buffer.alloc(4); len.writeUInt32BE(data.length,0);
  const t=Buffer.from(type,'ascii');
  const crc=Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t,data])),0);
  return Buffer.concat([len,t,data,crc]);
}
const sig=Buffer.from([137,80,78,71,13,10,26,10]);
const ihdr=Buffer.alloc(13);
ihdr.writeUInt32BE(S,0); ihdr.writeUInt32BE(S,4); ihdr[8]=8; ihdr[9]=6; // 8-bit, RGBA
// add filter byte 0 per row
const raw=Buffer.alloc(S*(S*4+1));
for(let y=0;y<S;y++){ raw[y*(S*4+1)]=0; buf.copy(raw, y*(S*4+1)+1, y*S*4, (y+1)*S*4); }
const idat=zlib.deflateSync(raw,{level:9});
const png=Buffer.concat([sig, chunk('IHDR',ihdr), chunk('IDAT',idat), chunk('IEND',Buffer.alloc(0))]);
writeFileSync(process.argv[2]||'icon-1024.png', png);
console.log('wrote', process.argv[2], png.length, 'bytes');
