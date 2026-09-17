import {writeFile} from 'node:fs/promises';
import {deflateSync} from 'node:zlib';
function crc(b){let c=0xffffffff;for(const v of b){c^=v;for(let i=0;i<8;i++)c=(c>>>1)^((c&1)?0xedb88320:0);}return (c^0xffffffff)>>>0;}
function chunk(type,data){const t=Buffer.from(type),size=Buffer.alloc(4),check=Buffer.alloc(4);size.writeUInt32BE(data.length);check.writeUInt32BE(crc(Buffer.concat([t,data])));return Buffer.concat([size,t,data,check]);}
for(const [size,name] of [[192,'icon-192.png'],[512,'icon-512.png'],[180,'apple-touch-icon.png']]){
 const rows=Buffer.alloc(size*(size*4+1));
 for(let y=0;y<size;y++)for(let x=0;x<size;x++){
  const u=x/size*512,v=y/size*512;
  const letter=(u>=161&&u<=223&&v>=128&&v<=384)||(u>=161&&u<=365&&v>=128&&v<=186)||(u>=161&&u<=342&&v>=243&&v<=300);
  const dot=(u-352)**2+(v-359)**2<=29**2;
  const color=letter?245:dot?168:Math.round(12+14*(1-y/size));
  const p=y*(size*4+1)+1+x*4;rows[p]=color;rows[p+1]=color;rows[p+2]=color;rows[p+3]=255;
 }
 const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(size);ihdr.writeUInt32BE(size,4);ihdr[8]=8;ihdr[9]=6;
 await writeFile('public/'+name,Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',deflateSync(rows)),chunk('IEND',Buffer.alloc(0))]));
}
console.log('Ícones PWA preparados.');
