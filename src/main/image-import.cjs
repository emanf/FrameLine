const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");

const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "webp", "bmp", "gif", "tif", "tiff", "svg", "avif"];

// Normalize vector/AVIF inputs once so the renderer and Pillow edit the same pixels.
async function importImages(paths, directory, inspectImages, onProgress = () => {}) {
  await fs.mkdir(directory, { recursive: true });
  const imported = [];
  try {
    for (const [index, source] of paths.entries()) {
      const extension = path.extname(source).toLowerCase();
      const convert = extension === ".svg" || extension === ".avif";
      const output = path.join(directory, `${crypto.randomUUID()}${convert ? ".png" : extension}`);
      imported.push(output);
      onProgress({ current: index, total: paths.length, message: `${convert ? "Converting" : "Copying"} ${path.basename(source)}…` });
      if (convert) {
        const sharp = require("sharp");
        // Decode asynchronously; never block Electron's main thread with rasterization.
        // Buffer input keeps SVG references from resolving relative to a local file.
        const image = sharp(await fs.readFile(source), { limitInputPixels: 100000000 });
        const metadata = await image.metadata();
        if (!metadata.width || !metadata.height || metadata.width > 32767 || metadata.height > 32767
          || metadata.width * metadata.height > 100000000) throw new Error("Image dimensions are too large.");
        await image.rotate().toColourspace("srgb").png({ compressionLevel: 1 }).toFile(output);
      } else {
        await fs.copyFile(source, output);
      }
      onProgress({ current: index + 0.9, total: paths.length, message: `Reading ${path.basename(source)}…` });
    }
    const images = await inspectImages(imported);
    onProgress({ current: paths.length, total: paths.length, message: "Images imported" });
    return images.map((image, index) => ({ ...image, name: path.basename(paths[index]) }));
  } catch (error) {
    await Promise.all(imported.map(file => fs.rm(file, { force: true })));
    throw error;
  }
}

module.exports = { IMAGE_EXTENSIONS, importImages };
