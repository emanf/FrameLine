const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");

async function saveProjectFile(destination, project, writeArchive = null) {
  // Serialize before touching the existing save; replace it only after the
  // complete temporary file has reached disk.
  const contents = JSON.stringify(project, null, 2);
  const temporary = path.join(path.dirname(destination), `.${path.basename(destination)}.${crypto.randomUUID()}.tmp`);
  try {
    if (writeArchive) await writeArchive(temporary, JSON.parse(contents));
    const file = await fs.open(temporary, writeArchive ? "r+" : "wx");
    try {
      if (!writeArchive) await file.writeFile(contents, "utf8");
      await file.sync();
    } finally { await file.close(); }
    await fs.rename(temporary, destination);
  } finally { await fs.rm(temporary, { force: true }); }
}

async function readProjectFile(source, readArchive) {
  const file = await fs.open(source, "r");
  let signature;
  try {
    const buffer = Buffer.alloc(4);
    await file.read(buffer, 0, 4, 0);
    signature = buffer.readUInt32LE();
  } finally { await file.close(); }
  if (signature === 0x04034b50) return readArchive(source);
  return JSON.parse(await fs.readFile(source, "utf8"));
}

module.exports = { saveProjectFile, readProjectFile };
