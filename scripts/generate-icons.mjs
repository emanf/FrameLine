/** Encode the approved transparent artwork into desktop icon containers. */
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import sharp from 'sharp';

const directory = fileURLToPath(new URL('../src/assets/icons/', import.meta.url));
const source = path.join(directory, 'frameline.png');

/** Produce a PNG at the exact dimensions expected by each operating system. */
async function png(size) {
  return sharp(source).resize(size, size, {fit:'contain', background:{r:0,g:0,b:0,alpha:0}}).png().toBuffer();
}

/** Store multiple PNG resolutions in the Windows ICONDIR format. */
async function windowsIcon() {
  const sizes = [16,24,32,48,64,128,256];
  const images = await Promise.all(sizes.map(png));
  const header = Buffer.alloc(6 + 16 * sizes.length);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(sizes.length, 4);
  let offset = header.length;
  for (let index = 0; index < sizes.length; index++) {
    const entry = 6 + index * 16;
    header[entry] = header[entry + 1] = sizes[index] === 256 ? 0 : sizes[index];
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(images[index].length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += images[index].length;
  }
  await fs.writeFile(path.join(directory, 'frameline.ico'), Buffer.concat([header, ...images]));
}

/** Store standard and Retina representations in the macOS ICNS format. */
async function macIcon() {
  const types = [['icp4',16], ['icp5',32], ['icp6',64], ['ic07',128], ['ic08',256],
    ['ic09',512], ['ic10',1024], ['ic11',32], ['ic12',64], ['ic13',256], ['ic14',512]];
  const entries = await Promise.all(types.map(async ([type,size]) => {
    const data = await png(size);
    const header = Buffer.alloc(8);
    header.write(type, 0, 'ascii');
    header.writeUInt32BE(data.length + 8, 4);
    return Buffer.concat([header, data]);
  }));
  const header = Buffer.alloc(8);
  header.write('icns', 0, 'ascii');
  header.writeUInt32BE(8 + entries.reduce((sum, value) => sum + value.length, 0), 4);
  await fs.writeFile(path.join(directory, 'frameline.icns'), Buffer.concat([header, ...entries]));
}

await Promise.all([windowsIcon(), macIcon(), png(512).then(data => fs.writeFile(path.join(directory, 'frameline-512.png'), data))]);
console.log('Generated Windows ICO, macOS ICNS, and Linux PNG icons from frameline.png.');
