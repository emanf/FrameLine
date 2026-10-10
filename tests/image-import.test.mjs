import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { createRequire } from "node:module";
const { IMAGE_EXTENSIONS, importImages } = createRequire(import.meta.url)("../src/main/image-import.cjs");
const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="24"><rect x="8" y="6" width="16" height="12" fill="#2864c8" fill-opacity="0.5"/></svg>';
const inspect = paths => Promise.all(paths.map(async file => {
  const metadata = await sharp(file).metadata();
  return {path:file, width:metadata.width, height:metadata.height, format:metadata.format.toUpperCase()};
}));
async function workspace(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "frameline-image-import-"));
  t.after(() => fs.rm(root, {recursive:true, force:true}));
  return {root, directory:path.join(root, "imports")};
}

test("image filters include SVG and AVIF", () => {
  assert(IMAGE_EXTENSIONS.includes("svg"));
  assert(IMAGE_EXTENSIONS.includes("avif"));
});

test("SVG and AVIF imports produce editable PNGs, preserve alpha, names and ordering", async t => {
  const {root, directory} = await workspace(t);
  const vector = path.join(root, "Character.SVG");
  const avif = path.join(root, "Character.AVIF");
  const png = path.join(root, "existing.png");
  await fs.writeFile(vector, svg);
  await sharp(Buffer.from(svg)).avif({lossless:true, effort:0, chromaSubsampling:"4:4:4"}).toFile(avif);
  await sharp(Buffer.from(svg)).png().toFile(png);
  const originals = await Promise.all([vector, avif, png].map(file => fs.readFile(file)));
  const progress = [];
  const imported = await importImages([vector, avif, png], directory, inspect, event => progress.push(event));
  assert.deepEqual(imported.map(image => image.name), ["Character.SVG", "Character.AVIF", "existing.png"]);
  assert.equal(new Set(imported.map(image => image.path)).size, 3);
  for (const image of imported) {
    assert.equal(path.extname(image.path), ".png");
    assert.deepEqual([image.width, image.height, image.format], [32, 24, "PNG"]);
    const {data, info} = await sharp(image.path).ensureAlpha().raw().toBuffer({resolveWithObject:true});
    assert.equal(data[3], 0, "transparent background survives");
    assert.equal(data[(8 + 6 * info.width) * 4 + 3], 128, "half-transparent content survives");
  }
  assert.deepEqual(await Promise.all([vector, avif, png].map(file => fs.readFile(file))), originals);
  assert.deepEqual(progress.at(-1), {current:3, total:3, message:"Images imported"});
  assert(progress.some(event => /Converting Character.SVG/.test(event.message)));
  assert(progress.some(event => /Converting Character.AVIF/.test(event.message)));
});

test("SVG viewBox-only and physical-unit documents keep their canvas dimensions", async t => {
  const {root, directory} = await workspace(t);
  for (const [attributes, size] of [['viewBox="0 0 19 13"', [19,13]], ['width="1in" height="0.5in" viewBox="0 0 19 13"', [72,36]]]) {
    const source = path.join(root, "shape.svg");
    await fs.writeFile(source, `<svg xmlns="http://www.w3.org/2000/svg" ${attributes}><circle cx="9" cy="6" r="4" fill="red"/></svg>`);
    const [image] = await importImages([source], directory, inspect);
    assert.deepEqual([image.width, image.height], size);
  }
});

test("invalid or oversized SVG/AVIF cleans every incomplete batch asset", async t => {
  const {root, directory} = await workspace(t);
  const valid = path.join(root, "valid.svg");
  await fs.writeFile(valid, svg);
  for (const [name, content] of [["broken.svg", "<svg>"], ["broken.avif", "not an AVIF"], ["large.svg", '<svg xmlns="http://www.w3.org/2000/svg" width="40000" height="1"/>']]) {
    const invalid = path.join(root, name);
    await fs.writeFile(invalid, content);
    await assert.rejects(importImages([valid, invalid], directory, inspect));
    assert.deepEqual(await fs.readdir(directory), [], "no partial imports remain");
    assert.equal(await fs.readFile(invalid, "utf8"), content, "the source is never changed");
  }
});

test("backend inspection failure rolls back converted assets, empty imports are a no-op", async t => {
  const {root, directory} = await workspace(t);
  const source = path.join(root, "shape.svg");
  await fs.writeFile(source, svg);
  await assert.rejects(importImages([source], directory, () => {throw new Error("inspection failed");}), /inspection failed/);
  assert.deepEqual(await fs.readdir(directory), []);
  assert.deepEqual(await importImages([], directory, inspect), []);
});
