import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import storage from "../src/main/project-storage.cjs";
import bridge from "../src/main/python-bridge.cjs";
import { createProject, validateProject } from "../src/renderer/model/project-model.mjs";
import { TimelineViewModel } from "../src/renderer/viewmodel/timeline-view-model.mjs";

test("atomic project saving replaces existing saves and keeps them on failure", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "frameline-save-test-"));
  try {
    const destination = path.join(directory, "project.frameline");
    await storage.saveProjectFile(destination, { name: "first" });
    await storage.saveProjectFile(destination, { name: "updated" });
    assert.deepEqual(JSON.parse(await fs.readFile(destination, "utf8")), { name: "updated" });
    const circular = {};
    circular.self = circular;
    await assert.rejects(storage.saveProjectFile(destination, circular));
    assert.deepEqual(JSON.parse(await fs.readFile(destination, "utf8")), { name: "updated" });
    // A destination directory forces replacement failure after the temp write.
    const blocked = path.join(directory, "blocked");
    await fs.mkdir(blocked);
    await assert.rejects(storage.saveProjectFile(blocked, {}));
    assert.deepEqual((await fs.readdir(directory)).sort(), ["blocked", "project.frameline"]);
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});

test("portable project saving and opening use the real Python bridge and preserve atomic saves", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "frameline-bundle-test-"));
  const python = new bridge.PythonBridge();
  try {
    const imagePath = path.join(directory, "original.bmp");
    const bitmap = Buffer.alloc(78);
    bitmap.write("BM"); bitmap.writeUInt32LE(78, 2); bitmap.writeUInt32LE(54, 10);
    bitmap.writeUInt32LE(40, 14); bitmap.writeInt32LE(3, 18); bitmap.writeInt32LE(2, 22);
    bitmap.writeUInt16LE(1, 26); bitmap.writeUInt16LE(24, 28);
    for (let y = 0; y < 2; y++) for (let x = 0; x < 3; x++) bitmap[54 + y * 12 + x * 3 + 2] = 255;
    await fs.writeFile(imagePath, bitmap);
    const project = createProject();
    project.name = "Walk cycle";
    project.images.push({
      id: "one", name: "original.bmp", path: imagePath, width: 3, height: 2,
      originalPath: imagePath, originalDimensions: { width: 3, height: 2 },
      crop: { left: 0, top: 0, right: 2 / 3, bottom: 1 },
      paintStrokes: [{ tool: "brush", color: "#0000ff", opacity: 1, size: 1, shape: "square", points: [[0.5, 0.5]] }]
    });
    project.clips.push({ id: "clip", imageId: "one", durationFrames: 24 });
    project.loopStartFrame = 4;
    project.loopEndFrame = 18;
    const destination = path.join(directory, "animation.frameline");
    const writeArchive = (output, snapshot) => python.request("save_project", { output, project: snapshot });
    await storage.saveProjectFile(destination, project, writeArchive);
    const archive = await fs.readFile(destination);
    assert.equal(archive.readUInt32LE(), 0x04034b50);
    await fs.rm(imagePath);
    await assert.rejects(storage.saveProjectFile(destination, project, writeArchive), /image is missing/);
    assert.deepEqual(await fs.readFile(destination), archive, "a missing source does not overwrite the saved bundle");
    const opened = await storage.readProjectFile(destination, async source => {
      const result = await python.request("open_project", { path: source, output: path.join(directory, "unpacked") });
      return result.project;
    });
    validateProject(opened);
    assert.equal(opened.name, "Walk cycle");
    assert.deepEqual(opened.clips, project.clips);
    assert.equal(opened.loopStartFrame, 4);
    assert.equal(opened.loopEndFrame, 18);
    assert.deepEqual(opened.images[0].paintStrokes, project.images[0].paintStrokes);
    assert.deepEqual(await fs.readFile(opened.images[0].originalPath), bitmap);
    const model = new TimelineViewModel();
    model.replaceProject(opened);
    assert.equal(model.dirty, false);
    assert.equal(model.clearImageEffects("one"), true);
    assert.equal(model.project.images[0].path, opened.images[0].originalPath);
    assert.equal(model.project.images[0].crop, undefined);
    model.undo();
    assert.deepEqual(model.project.images[0].crop, project.images[0].crop);
    const legacy = path.join(directory, "legacy.json");
    await fs.writeFile(legacy, JSON.stringify(opened));
    assert.deepEqual(await storage.readProjectFile(legacy, () => { throw new Error("JSON should not be treated as ZIP"); }), opened);
    assert.deepEqual((await fs.readdir(directory)).sort(), ["animation.frameline", "legacy.json", "unpacked"]);
  } finally {
    python.close();
    await new Promise(resolve => python.process.exitCode !== null ? resolve() : python.process.once("exit", resolve));
    await fs.rm(directory, { recursive: true, force: true });
  }
});
