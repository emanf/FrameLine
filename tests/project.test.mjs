import test from "node:test";
import assert from "node:assert/strict";
import { createProject, totalFrames, validateProject, loopRange } from "../src/renderer/model/project-model.mjs";
import { advancePlayback } from "../src/renderer/model/playback-clock.mjs";
import { TimelineViewModel } from "../src/renderer/viewmodel/timeline-view-model.mjs";
import { captureToolSource, matchesToolSource } from "../src/renderer/model/tool-draft.mjs";

globalThis.window = {
  frameLine: {
    inspectImages: async (paths) => paths.map((path, index) => ({
      path,
      name: path.split(/[\\/]/).at(-1),
      width: 100 + index,
      height: 80,
      format: "PNG"
    })),
    removeBackground: async ({ path }) => ({ path: `processed:${path}`, width: 100, height: 80 }),
    applyImageOutline: async ({ path, outline }) => ({
      path: `outlined:${path}`, width: 100 + outline.size * 2, height: 80 + outline.size * 2
    })
  }
};

function makeModel() {
  return new TimelineViewModel();
}

test("tool drafts survive unrelated settings, timeline edits, and their undo/redo", async () => {
  const model = makeModel();
  await model.addImages(["first.png", "second.png"]);
  const image = model.previewImage;
  const source = captureToolSource(model.project, image);
  const firstRevision = model.editRevision;
  const compatible = () => matchesToolSource(source, model.project, model.project.images.find(item => item.id === image.id));
  for (const change of [
    () => model.setFps(30), () => model.setSpeed(2), () => model.setDefaultDuration(12),
    () => model.setProjectName("Draft test"), () => model.setLoop(false),
    () => model.resizeSelectedClips(48)
  ]) {
    change();
    assert.equal(compatible(), true);
    model.undo();
    assert.equal(compatible(), true, "undo replaces image objects without changing their content");
    model.redo();
    assert.equal(compatible(), true);
  }
  assert(model.editRevision > firstRevision, "the global project revision changes during these edits");
  const other = model.project.images.find(item => item.id !== image.id);
  model.setImageCrop(other.id, {left:0, top:0, right:0.5, bottom:1});
  assert.equal(compatible(), true, "an edit to another asset leaves this draft valid");
  const renamed = {...model.project.images.find(item => item.id === image.id), name:"Renamed"};
  assert.equal(matchesToolSource(source, model.project, renamed), true);
});

test("tool drafts invalidate when their source pixels, sampling reference, or project change", async () => {
  const model = makeModel();
  await model.addImages(["first.png"]);
  const image = model.previewImage;
  const source = captureToolSource(model.project, image);
  const stroke = {tool:"brush", color:"#123456", size:3, opacity:1, shape:"round", feather:0, points:[[0.5,0.5]]};
  for (const change of [
    {path:"replaced.png"}, {width:200}, {height:200}, {paintStrokes:[stroke]},
    {crop:{left:0, top:0, right:0.5, bottom:1}}, {outline:{size:2, color:"#ffffff"}},
    {originalPath:"another-original.png"}, {sourcePath:"another-source.png"},
    {outlineSourcePath:"outline-source.png"}, {id:"another-image"}
  ]) assert.equal(matchesToolSource(source, model.project, {...image, ...change}), false);
  assert.equal(matchesToolSource(source, model.project, undefined), false);
  model.replaceProject(structuredClone(model.project));
  assert.equal(matchesToolSource(source, model.project, model.previewImage), false,
    "opening a project invalidates old drafts even when its serialized images match");
});

test("import-list image selection previews assets with or without clips and does not dirty the project", async () => {
  const model = makeModel();
  await model.addImages(["first.png", "second.png"]);
  model.markSaved();
  const history = model.undoStack.length;
  const [first, second] = model.project.images;
  assert.equal(model.selectImage(second.id), true);
  assert.equal(model.previewImage.id, second.id);
  assert.equal(model.project.currentFrame, 24);
  assert.equal(model.selectedClipId, model.project.clips[1].id);
  assert.equal(model.undoStack.length, history);
  assert.equal(model.dirty, false);
  model.deleteSelected();
  model.markSaved();
  model.selectImage(second.id);
  assert.equal(model.previewImage.id, second.id, "an imported asset remains editable after its clip is removed");
  assert.equal(model.selectedClipId, null);
  assert.equal(model.dirty, false);
  model.setFrame(0);
  assert.equal(model.previewImage.id, first.id, "timeline navigation restores frame-based preview");
  model.selectImage(second.id);
  model.addImageDetails([{path:"third.png",name:"Image 003",width:12,height:8}],null,null,null);
  assert.equal(model.previewImage.name, "Image 003", "adding an image focuses the added clip");
  model.replaceProject(createProject());
  assert.equal(model.previewImage, undefined);
});

test("healing brush strokes keep their colors and mixture settings through save, undo, and reopen", async () => {
  const model = makeModel();
  await model.addImages(["/healing.png"]);
  const id = model.project.images[0].id;
  const stroke = {tool:"healing", color:"#000000", backgroundColor:"#04f404", tolerance:24,
    opacity:1, size:8, shape:"square", feather:0, points:[[.5,.5]]};
  model.addPaintStroke(id, stroke);
  const saved = JSON.parse(JSON.stringify(model.project));
  validateProject(saved);
  model.undo();
  assert.equal(model.project.images[0].paintStrokes, undefined);
  model.redo();
  assert.deepEqual(model.project.images[0].paintStrokes, [stroke]);
  const reopened = makeModel();
  reopened.replaceProject(saved);
  assert.deepEqual(reopened.project.images[0].paintStrokes, [stroke]);
});

test("new project defaults to 24 FPS, one-second images, and looping", () => {
  const project = createProject();
  assert.equal(project.fps, 24);
  assert.equal(project.defaultDurationFrames, 24);
  assert.equal(project.playbackSpeed, 1);
  assert.equal(project.loopEnabled, true);
  assert.equal(project.loopStartFrame, 0);
  assert.equal(project.loopEndFrame, null);
});

test("batch background cleanup preserves originals and commits as one undoable edit", async () => {
  const model = makeModel(); await model.addImages(["first.png","second.png"]);
  const before = structuredClone(model.project.images), revision = model.editRevision;
  const results = before.map((image,index)=>({imageId:image.id,path:`clean-${index}.png`,width:40,height:50}));
  const history = model.undoStack.length;
  assert.equal(model.setImageBackgroundResults(results,revision),true);
  assert.equal(model.undoStack.length,history+1);
  assert.deepEqual(model.project.images.map(image=>image.sourcePath),before.map(image=>image.path));
  const saved = structuredClone(model.project); validateProject(saved);
  model.undo(); assert.deepEqual(model.project.images,before);
  model.redo(); assert.deepEqual(model.project.images,saved.images);
  assert.equal(model.setImageBackgroundResults(results,revision),false,'obsolete batches cannot overwrite newer edits');
  model.clearImageEffects(before[0].id,true); assert.deepEqual(model.project.images.map(image=>image.path),before.map(image=>image.path));
});

test("mixed smooth and pixel strokes retain anti-aliasing through undo, redo, and project reopening", async () => {
  const model = makeModel();
  await model.addImages(["/brush.png"]);
  const id = model.project.images[0].id;
  const strokes = [true,false].map(antiAlias => ({tool:"brush",color:"#0000ff",opacity:.5,
    size:5,shape:"round",feather:0,antiAlias,points:[[.5,.5]]}));
  model.addPaintStrokes(id, strokes);
  const saved = JSON.parse(JSON.stringify(model.project));
  validateProject(saved);
  model.undo(); assert.equal(model.project.images[0].paintStrokes,undefined);
  model.redo(); assert.deepEqual(model.project.images[0].paintStrokes,strokes);
  const reopened = makeModel(); reopened.replaceProject(saved);
  assert.deepEqual(reopened.project.images[0].paintStrokes,strokes);
});

test("renaming a project commits one edit, supports undo, and persists on reopening", () => {
  const model = makeModel();
  const history = model.undoStack.length;
  assert.equal(model.setProjectName("  Walk cycle  "), true);
  assert.equal(model.project.name, "Walk cycle");
  assert.equal(model.undoStack.length, history + 1);
  assert.equal(model.dirty, true);
  assert.equal(model.setProjectName("Walk cycle"), false);
  assert.equal(model.undoStack.length, history + 1);
  const reopened = makeModel();
  reopened.replaceProject(JSON.parse(JSON.stringify(model.project)));
  assert.equal(reopened.project.name, "Walk cycle");
  model.undo();
  assert.equal(model.project.name, "Untitled project");
  assert.equal(model.dirty, false);
  model.redo();
  assert.equal(model.project.name, "Walk cycle");
  model.setProjectName("   ");
  assert.equal(model.project.name, "Untitled project");
});

test("imported images automatically become sequential 24-frame clips", async () => {
  const model = makeModel();
  await model.addImages(["a.png", "b.png", "c.png", "d.png", "e.png"]);
  assert.equal(model.project.clips.length, 5);
  assert.deepEqual(model.project.clips.map((clip) => clip.durationFrames), [24, 24, 24, 24, 24]);
  assert.equal(model.totalFrames, 120);
});

test("video frames become one-frame timeline clips at the target project FPS", () => {
  const model = makeModel();
  const images = Array.from({ length: 3 }, (_, index) => ({
    path: `frame-${index}.png`,
    name: `movie · frame-${index}`,
    width: 1920,
    height: 1080,
    duration_frames: 1
  }));
  const imported = model.addVideoFrames(images);
  assert.equal(imported.images.length, 3);
  assert.deepEqual(model.project.clips.map((clip) => clip.durationFrames), [1, 1, 1]);
  assert.equal(model.totalFrames, 3);
});

test("paint strokes are stored per image and support undo and redo", async () => {
  const model = makeModel();
  await model.addImages(["paint.png", "untouched.png"]);
  const [paintedId, untouchedId] = model.project.images.map((image) => image.id);
  const stroke = {
    tool: "brush",
    color: "#ff0000",
    opacity: 0.5,
    size: 12,
    shape: "square",
    feather: 35,
    points: [[0.2, 0.3], [0.4, 0.5]]
  };
  model.addPaintStroke(paintedId, stroke);
  assert.deepEqual(model.project.images[0].paintStrokes, [stroke]);
  assert.equal(model.project.images[1].paintStrokes, undefined);
  model.undo();
  assert.equal(model.project.images[0].paintStrokes, undefined);
  model.redo();
  assert.deepEqual(model.project.images[0].paintStrokes, [stroke]);
  const reopened = makeModel();
  reopened.replaceProject(JSON.parse(JSON.stringify(model.project)));
  assert.deepEqual(reopened.project.images[0].paintStrokes, [stroke]);
  assert.equal(untouchedId, reopened.project.images[1].id);
});

test("applying a paint draft commits multiple strokes as one undo step", async () => {
  const model = makeModel();
  await model.addImages(["subject.png"]);
  const imageId = model.project.images[0].id;
  const before = structuredClone(model.project);
  const history = model.undoStack.length;
  const strokes = [
    { tool: "brush", color: "#ff0000", opacity: .5, size: 4, points: [[.2, .2], [.4, .4]] },
    { tool: "eraser", color: "#000000", opacity: 1, size: 2, points: [[.3, .3]] }
  ];
  assert.equal(model.addPaintStrokes(imageId, strokes), true);
  assert.equal(model.undoStack.length, history + 1);
  assert.deepEqual(model.project.images[0].paintStrokes, strokes);
  const applied = structuredClone(model.project);
  model.undo();
  assert.deepEqual(model.project, before);
  model.redo();
  assert.deepEqual(model.project, applied);
  const state = structuredClone(model.project);
  assert.throws(() => model.addPaintStrokes(imageId, [strokes[0], { tool: "invalid" }]), /invalid paint stroke/i);
  assert.deepEqual(model.project, state, "invalid draft cannot partially commit");
});

test("background removal preserves the original for reset, undo, and redo", async () => {
  const model = makeModel();
  await model.addImages(["subject.png"]);
  const imageId = model.project.images[0].id;
  await model.removeImageBackground(imageId, { mode: "chroma" });
  assert.equal(model.project.images[0].path, "processed:subject.png");
  assert.equal(model.project.images[0].sourcePath, "subject.png");
  model.undo();
  assert.equal(model.project.images[0].path, "subject.png");
  assert.equal(model.project.images[0].sourcePath, undefined);
  model.redo();
  assert.equal(model.project.images[0].path, "processed:subject.png");
  const reopened = makeModel();
  reopened.replaceProject(JSON.parse(JSON.stringify(model.project)));
  assert.equal(reopened.project.images[0].sourcePath, "subject.png");
  await reopened.resetImageBackground(imageId);
  assert.equal(reopened.project.images[0].path, "subject.png");
  assert.equal(reopened.project.images[0].sourcePath, undefined);
});

test("clearing image effects restores the original and is undoable", async () => {
  const model = makeModel();
  await model.addImages(["effects.png"]);
  const imageId = model.project.images[0].id;
  await model.removeImageBackground(imageId, { mode: "chroma" });
  model.addPaintStroke(imageId, {
    tool: "brush", color: "#ff0000", opacity: 1, size: 4,
    shape: "round", feather: 0, points: [[0.5, 0.5]]
  });
  model.setImageCrop(imageId, { left: 0.1, top: 0.1, right: 0.9, bottom: 0.9 });

  assert.equal(model.clearImageEffects(imageId), true);
  assert.equal(model.project.images[0].path, "effects.png");
  assert.equal(model.project.images[0].sourcePath, undefined);
  assert.equal(model.project.images[0].paintStrokes, undefined);
  assert.equal(model.project.images[0].crop, undefined);
  assert.equal(model.clearImageEffects(imageId), false);

  model.undo();
  assert.equal(model.project.images[0].path, "processed:effects.png");
  assert.equal(model.project.images[0].paintStrokes.length, 1);
  assert.ok(model.project.images[0].crop);
  model.redo();
  assert.equal(model.project.images[0].path, "effects.png");
  assert.equal(model.project.images[0].paintStrokes, undefined);
  assert.equal(model.project.images[0].crop, undefined);
});

test("image crops can be applied to one or all images and support undo", async () => {
  const model = makeModel();
  await model.addImages(["first.png", "second.png"]);
  const [firstId, secondId] = model.project.images.map((image) => image.id);
  const crop = { left: 0.1, top: 0.2, right: 0.8, bottom: 0.9 };

  assert.equal(model.setImageCrop(firstId, crop), true);
  assert.deepEqual(model.project.images[0].crop, crop);
  assert.equal(model.project.images[1].crop, undefined);
  assert.equal(model.setImageCrop(secondId, crop, true), true);
  assert.deepEqual(model.project.images.map((image) => image.crop), [crop, crop]);
  model.undo();
  assert.equal(model.project.images[1].crop, undefined);
  model.redo();
  assert.deepEqual(model.project.images[1].crop, crop);
  assert.equal(model.setImageCrop(firstId, null, true), true);
  assert.equal(model.project.images.some((image) => image.crop), false);
  assert.throws(() => model.setImageCrop(firstId, { left: 0.8, top: 0, right: 0.2, bottom: 1 }), /Crop bounds/);
});

test("crop reset works for one or all images after applying without clearing other edits", async () => {
  const model = makeModel();
  await model.addImages(["first.png", "second.png"]);
  const [first, second] = model.project.images;
  const stroke = { tool: "brush", color: "#0000ff", opacity: 1, size: 3, points: [[0.5, 0.5]] };
  model.addPaintStroke(first.id, stroke);
  const crop = { left: 0.2, top: 0.1, right: 0.8, bottom: 0.9 };
  model.setImageCrop(first.id, crop, true);
  model.setImageCrop(first.id, null);
  assert.equal(first.crop, undefined);
  assert.deepEqual(second.crop, crop);
  assert.deepEqual(first.paintStrokes, [stroke]);
  model.undo();
  assert.deepEqual(model.project.images.map(image => image.crop), [crop, crop]);
  model.redo();
  assert.equal(model.project.images[0].crop, undefined);
  assert.deepEqual(model.project.images[1].crop, crop);
  model.setImageCrop(first.id, null, true);
  assert.equal(model.project.images.some(image => image.crop), false);
  assert.deepEqual(model.project.images[0].paintStrokes, [stroke]);
  model.undo();
  assert.deepEqual(model.project.images[1].crop, crop);
  assert.deepEqual(model.project.images[0].paintStrokes, [stroke]);
  model.redo();
  assert.equal(model.project.images.some(image => image.crop), false);
});

test("baked image outlines can apply to one or all images, reset, undo, and clear", async () => {
  const model = makeModel();
  await model.addImages(["outlined.png", "second.png"]);
  const [imageId, secondId] = model.project.images.map((image) => image.id);
  const outline = { color: "#ff00ff", size: 12, position: "outside", softness: 2, opacity: 0.75 };
  model.setImageOutlineResults([{ imageId, path: "outlined-result.png", width: 124, height: 104, outline }]);
  assert.equal(model.project.images[0].path, "outlined-result.png");
  assert.equal(model.project.images[0].outlineSourcePath, "outlined.png");
  assert.deepEqual(model.project.images[0].outlineSettings, outline);
  assert.equal(model.project.images[0].width, 124);
  assert.equal(model.project.images[1].outlineSettings, undefined);
  model.setImageOutlineResults([
    { imageId, path: "outlined-result-v2.png", width: 124, height: 104, outline },
    { imageId: secondId, path: "second-result.png", width: 104, height: 84, outline }
  ]);
  assert.equal(model.project.images[0].outlineSourcePath, "outlined.png");
  assert.equal(model.project.images[1].outlineSourcePath, "second.png");
  model.undo();
  assert.equal(model.project.images[1].outlineSourcePath, undefined);
  model.redo();
  assert.deepEqual(model.project.images[1].outlineSettings, outline);
  assert.equal(model.resetImageOutline([imageId]), true);
  assert.equal(model.project.images[0].path, "outlined.png");
  assert.equal(model.project.images[0].width, 100);
  assert.deepEqual(model.project.images[1].outlineSettings, outline);
  assert.equal(model.clearImageEffects(secondId), true);
  assert.equal(model.project.images[1].path, "second.png");
  assert.equal(model.project.images[1].outlineSettings, undefined);
});

test("dropping an image at a frame splits the existing clip and inserts without losing frames", async () => {
  const model = makeModel();
  await model.addImages(["a.png", "b.png"]);
  const source = model.project.images[0].id;
  model.insertImage(source, 30);
  assert.deepEqual(model.project.clips.map((clip) => clip.durationFrames), [24, 6, 24, 18]);
  assert.equal(model.totalFrames, 72);
  assert.equal(model.project.currentFrame, 30);
});

test("dropping image files on a list position inserts assets and clips in sequence order", async () => {
  const model = makeModel();
  await model.addImages(["a.png", "b.png"]);
  const target = model.project.images[1].id;
  await model.addImages(["inserted.png"], null, { imageId: target, after: false });
  assert.deepEqual(model.project.images.map((image) => image.name), ["a.png", "inserted.png", "b.png"]);
  assert.deepEqual(
    model.project.clips.map((clip) => model.project.images.find((image) => image.id === clip.imageId).name),
    ["a.png", "inserted.png", "b.png"]
  );
});

test("removing an imported image removes its clips and is undoable", async () => {
  const model = makeModel();
  await model.addImages(["a.png", "b.png", "c.png"]);
  const [first, removed, last] = model.project.images.map((image) => image.id);
  const removedClipId = model.project.clips[1].id;
  model.selectClip(removedClipId);
  model.removeImage(removed);
  assert.deepEqual(model.project.images.map((image) => image.id), [first, last]);
  assert.deepEqual(model.project.clips.map((clip) => clip.imageId), [first, last]);
  assert.equal(model.project.clips.some((clip) => clip.id === model.selectedClipId), true);
  model.undo();
  assert.deepEqual(model.project.images.map((image) => image.id), [first, removed, last]);
  assert.equal(model.project.clips[1].id, removedClipId);
});

test("removing an image removes every clip that uses it", async () => {
  const model = makeModel();
  await model.addImages(["a.png"]);
  const imageId = model.project.images[0].id;
  model.duplicateSelected();
  assert.equal(model.project.clips.length, 2);
  model.removeImage(imageId);
  assert.equal(model.project.images.length, 0);
  assert.equal(model.project.clips.length, 0);
  assert.equal(model.selectedClipId, null);
});

test("clearing imported images and timeline clips is undoable", async () => {
  const model = makeModel();
  await model.addImages(["a.png", "b.png"]);
  model.clearImages();
  assert.equal(model.project.images.length, 0);
  assert.equal(model.project.clips.length, 0);
  assert.equal(model.totalFrames, 0);
  model.undo();
  assert.equal(model.project.images.length, 2);
  assert.equal(model.project.clips.length, 2);
});

test("reordering images updates the timeline, and undo restores the prior sequence", async () => {
  const model = makeModel();
  await model.addImages(["a.png", "b.png", "c.png"]);
  const [a, b, c] = model.project.images.map((image) => image.id);
  model.reorderImages(c, b, false);
  assert.deepEqual(model.project.images.map((image) => image.id), [a, c, b]);
  assert.deepEqual(model.project.clips.map((clip) => clip.imageId), [a, c, b]);
  model.undo();
  assert.deepEqual(model.project.images.map((image) => image.id), [a, b, c]);
  model.redo();
  assert.deepEqual(model.project.images.map((image) => image.id), [a, c, b]);
});

test("clip move, integer resize, and split are undoable", async () => {
  const model = makeModel();
  await model.addImages(["a.png", "b.png", "c.png"]);
  const [a, b, c] = model.project.clips.map((clip) => clip.id);
  model.moveClip(c, b, false);
  assert.deepEqual(model.project.clips.map((clip) => clip.id), [a, c, b]);
  model.undo();
  model.resizeClip(a, 48);
  assert.equal(model.project.clips[0].durationFrames, 48);
  model.undo();
  assert.equal(model.project.clips[0].durationFrames, 24);
  model.selectClip(a);
  model.setFrame(10);
  model.splitSelected();
  assert.deepEqual(model.project.clips.slice(0, 2).map((clip) => clip.durationFrames), [10, 14]);
  model.undo();
  assert.equal(model.project.clips[0].durationFrames, 24);
});

test("live clip resizing pushes following clips and commits as one undo step", async () => {
  const model = makeModel();
  await model.addImages(["a.png", "b.png", "c.png"]);
  const [firstClip, secondClip] = model.project.clips;
  const before = model.snapshot();
  model.previewResizeClip(firstClip.id, 48);
  assert.equal(model.project.clips[0].durationFrames, 48);
  assert.equal(model.ranges[1].startFrame, 48);
  assert.equal(model.totalFrames, 96);
  model.previewResizeClip(firstClip.id, 60);
  assert.equal(model.ranges[1].startFrame, 60);
  model.commitClipResize(before);
  model.undo();
  assert.equal(model.project.clips[0].durationFrames, 24);
  assert.equal(model.project.clips[1].id, secondClip.id);
  assert.equal(model.ranges[1].startFrame, 24);
});

test("project validation rejects fractional clip durations", async () => {
  const model = makeModel();
  await model.addImages(["a.png"]);
  model.project.clips[0].durationFrames = 4.5;
  assert.throws(() => validateProject(model.project), /whole number/);
});

test("fps and speed settings stay independent of timeline duration", async () => {
  const model = makeModel();
  await model.addImages(["a.png"]);
  model.resizeClip(model.project.clips[0].id, 48);
  model.setFps(30);
  model.setSpeed(2);
  assert.equal(model.totalFrames, 48);
  assert.equal(model.project.fps, 30);
  assert.equal(model.project.playbackSpeed, 2);
});

test("timeline zoom is clamped from 1% to 5000%", () => {
  const model = makeModel();
  model.setZoom(-1);
  assert.equal(model.zoom, 1);
  model.setZoom(5001);
  assert.equal(model.zoom, 5000);
  model.setZoom(2500);
  assert.equal(model.zoom, 2500);
  model.setZoom(5.345);
  assert.equal(model.zoom, 5.3);
});

test("saving and reopening preserves ordered clips and frame durations", async () => {
  const model = makeModel();
  await model.addImages(["a.png", "b.png", "c.png"]);
  model.reorderImages(model.project.images[2].id, model.project.images[1].id, false);
  model.resizeClip(model.project.clips[1].id, 48);
  model.setFps(30);
  const reopened = makeModel();
  reopened.replaceProject(JSON.parse(JSON.stringify(model.project)));
  assert.equal(reopened.project.fps, 30);
  assert.deepEqual(reopened.project.clips, model.project.clips);
  assert.equal(reopened.totalFrames, 96);
});

test("playback advances by FPS and live speed without changing clip durations", () => {
  const project = { fps: 24, playbackSpeed: 1, loopEnabled: true, currentFrame: 0 };
  const first = advancePlayback(project, 240, 500);
  assert.equal(first.currentFrame, 12);
  project.playbackSpeed = 2;
  const faster = advancePlayback({ ...project, currentFrame: first.currentFrame }, 240, 500, first.fractionalFrame);
  assert.equal(faster.currentFrame, 36);
});

test("playback loops to frame zero or stops on the final frame", () => {
  const looping = advancePlayback({ fps: 24, playbackSpeed: 1, loopEnabled: true, currentFrame: 22 }, 24, 1000);
  assert.equal(looping.currentFrame, 22);
  assert.equal(looping.stopped, false);
  const stopped = advancePlayback({ fps: 24, playbackSpeed: 1, loopEnabled: false, currentFrame: 22 }, 24, 1000);
  assert.equal(stopped.currentFrame, 23);
  assert.equal(stopped.stopped, true);
});

test("playback repeats the chosen inclusive frame range without losing fractional time", () => {
  const project = { fps: 24, playbackSpeed: 1, loopEnabled: true, currentFrame: 35, loopStartFrame: 12, loopEndFrame: 36 };
  const wrapped = advancePlayback(project, 72, 50, 0.3);
  assert.equal(wrapped.currentFrame, 12);
  assert.ok(Math.abs(wrapped.fractionalFrame - 0.5) < 1e-10);
  assert.equal(wrapped.stopped, false);
  assert.equal(advancePlayback(project, 72, 5000).currentFrame, 35, "large time steps can cross several loops");
  assert.equal(advancePlayback({ ...project, currentFrame: 71 }, 72, 0).currentFrame, 12, "starting outside the loop begins at Start");
  const single = advancePlayback({ ...project, currentFrame: 12, loopEndFrame: 13 }, 72, 5000);
  assert.equal(single.currentFrame, 12, "one-frame loops are valid");
  assert.equal(single.stopped, false);
  assert.equal(advancePlayback({ ...project, loopEnabled: false }, 72, 1000).currentFrame, 59, "Loop off plays the full sequence");
  const stopped = advancePlayback({ ...project, loopEnabled: false, currentFrame: 71 }, 72, 1000);
  assert.deepEqual(stopped, { currentFrame: 71, fractionalFrame: 0, stopped: true });
  assert.deepEqual(advancePlayback(project, 0, 1000), { currentFrame: 0, fractionalFrame: 0, stopped: true });
});

test("loop-handle dragging commits one undo step and round-trips with a project", async () => {
  const model = makeModel();
  await model.addImages(["a.png", "b.png", "c.png"]);
  const before = model.snapshot();
  const history = model.undoStack.length;
  assert.equal(model.setLoopRange(1.5, 50), false);
  model.setLoopRange(10, 72, true);
  model.setLoopRange(12, 60, true);
  model.setLoopRange(12, 36, true);
  assert.equal(model.undoStack.length, history);
  model.commitLoopRange(before);
  assert.equal(model.undoStack.length, history + 1);
  assert.deepEqual(loopRange(model.project), { startFrame: 12, endFrame: 36 });
  const reopened = makeModel();
  reopened.replaceProject(JSON.parse(JSON.stringify(model.project)));
  assert.deepEqual(loopRange(reopened.project), { startFrame: 12, endFrame: 36 });
  model.undo();
  assert.deepEqual(loopRange(model.project), { startFrame: 0, endFrame: 72 });
  model.redo();
  assert.deepEqual(loopRange(model.project), { startFrame: 12, endFrame: 36 });
  model.markSaved();
  model.setLoopRange(13, 36);
  assert.equal(model.dirty, true);
  model.undo();
  assert.equal(model.dirty, false);
});

test("loop bounds follow the full timeline by default and clamp after deleting or resizing clips", async () => {
  const model = makeModel();
  await model.addImages(["a.png"]);
  await model.addImages(["b.png", "c.png"]);
  assert.deepEqual(loopRange(model.project), { startFrame: 0, endFrame: 72 });
  model.setLoopRange(60, 70);
  model.selectClip(model.project.clips[2].id);
  model.deleteSelected();
  assert.deepEqual(loopRange(model.project), { startFrame: 47, endFrame: 48 });
  validateProject(model.project);
  model.undo();
  assert.deepEqual(loopRange(model.project), { startFrame: 60, endFrame: 70 });
  model.resizeClip(model.project.clips[2].id, 4);
  assert.deepEqual(loopRange(model.project), { startFrame: 51, endFrame: 52 });
  validateProject(model.project);
  model.clearImages();
  assert.deepEqual(loopRange(model.project), { startFrame: 0, endFrame: 0 });
  assert.equal(model.project.loopEndFrame, null);
  validateProject(model.project);
});

test("project validation rejects invalid loop bounds and accepts legacy full-timeline loops", async () => {
  const model = makeModel();
  await model.addImages(["a.png"]);
  for (const [loopStartFrame, loopEndFrame] of [[-1, 12], [1.5, 12], [24, null], [12, 12], [10, 25], [0, 10.5], [0, "10"]]) {
    assert.throws(() => validateProject({ ...model.project, loopStartFrame, loopEndFrame }), /Loop bounds/);
  }
  const legacy = structuredClone(model.project);
  delete legacy.loopStartFrame;
  delete legacy.loopEndFrame;
  model.replaceProject(legacy);
  assert.deepEqual(loopRange(model.project), { startFrame: 0, endFrame: 24 });
});

test("appending images seeks to the new clip after the cached old timeline", async () => {
  const model = makeModel();
  await model.addImages(["a.png"]);
  assert.equal(model.project.currentFrame, 0);
  assert.equal(model.totalFrames, 24);
  await model.addImages(["b.png"]);
  assert.equal(model.project.currentFrame, 24);
  assert.equal(model.selectedRange.startFrame, 24);
});

const outline = { color: "#ffffff", size: 10, position: "outside", softness: 0, opacity: 1 };
function outlineImage(model, imageId) {
  model.setImageOutlineResults([{ imageId, path: "outlined.png", width: 120, height: 100, outline }]);
}

test("background edits use the current result and reset restores the immutable original", async () => {
  for (const backgroundFirst of [false, true]) {
    const model = makeModel();
    await model.addImages(["original.png"]);
    const id = model.project.images[0].id;
    if (backgroundFirst) await model.removeImageBackground(id, { mode: "chroma" });
    outlineImage(model, id);
    await model.removeImageBackground(id, { mode: "chroma" });
    const image = model.project.images[0];
    assert.equal(image.path, "processed:outlined.png");
    assert.equal(image.originalPath, "original.png");
    assert.equal(image.outlineSourcePath, undefined);
    await model.removeImageBackground(id, { mode: "chroma" });
    assert.equal(image.path, "processed:processed:outlined.png");
    await model.resetImageBackground(id);
    assert.equal(image.path, "original.png");
    assert.equal(image.sourcePath, undefined);
    assert.equal(model.clearImageEffects(id), false);
    assert.equal(image.path, "original.png");
    assert.deepEqual([image.width, image.height], [100, 80]);
    assert.equal(image.outlineSourceDimensions, undefined);
    model.undo();
    assert.equal(model.project.images[0].path, "processed:processed:outlined.png");
  }
});

test("background removal consumes crop and paint once, preserving both states for undo", async () => {
  const model = makeModel();
  await model.addImages(["original.png"]);
  const image = model.project.images[0];
  const stroke = { tool: "brush", color: "#ff0000", opacity: 1, size: 4, points: [[0.5, 0.5]] };
  const crop = { left: 0.1, top: 0.2, right: 0.8, bottom: 0.9 };
  model.addPaintStroke(image.id, stroke);
  model.setImageCrop(image.id, crop);
  const bridge = window.frameLine.removeBackground;
  let request;
  window.frameLine.removeBackground = async (options) => {
    request = options;
    return { path: "cropped-painted-background.png", width: 70, height: 56 };
  };
  try {
    await model.removeImageBackground(image.id, { mode: "chroma" });
    assert.equal(request.path, "original.png");
    assert.deepEqual(request.paint_strokes, [stroke]);
    assert.deepEqual(request.crop, crop);
    assert.equal(image.paintStrokes, undefined);
    assert.equal(image.crop, undefined);
    assert.deepEqual([image.width, image.height], [70, 56]);
    assert.equal(image.originalPath, "original.png");
    model.undo();
    assert.deepEqual(model.project.images[0].paintStrokes, [stroke]);
    assert.deepEqual(model.project.images[0].crop, crop);
    model.redo();
    await model.removeImageBackground(image.id, { mode: "chroma" }, { path: "canvas-snapshot.png", width: 70, height: 56 });
    assert.equal(request.path, "canvas-snapshot.png");
    assert.equal(request.paint_strokes, undefined);
    assert.equal(request.crop, undefined);
    model.clearImageEffects(image.id);
    assert.equal(model.project.images[0].path, "original.png");
    assert.deepEqual([model.project.images[0].width, model.project.images[0].height], [100, 80]);
  } finally { window.frameLine.removeBackground = bridge; }
});

test("outlines consume the current crop and paint without applying either twice", async () => {
  const model = makeModel();
  await model.addImages(["original.png"]);
  const image = model.project.images[0];
  model.addPaintStroke(image.id, { tool: "brush", color: "#ff0000", opacity: 1, size: 4, points: [[0.5, 0.5]] });
  model.setImageCrop(image.id, { left: 0.2, top: 0.2, right: 0.8, bottom: 0.8 });
  model.setImageOutlineResults([{
    imageId: image.id, path: "outlined-current.png", width: 80, height: 68, outline,
    basePath: "cropped-painted.png", baseDimensions: { width: 60, height: 48 }, bakedEdits: true
  }]);
  assert.equal(image.paintStrokes, undefined);
  assert.equal(image.crop, undefined);
  assert.equal(image.outlineSourcePath, "cropped-painted.png");
  assert.equal(image.originalPath, "original.png");
  model.resetImageOutline([image.id]);
  assert.equal(image.path, "cropped-painted.png");
  assert.deepEqual([image.width, image.height], [60, 48]);
  // Removing the last outline still leaves edits in the baked working image.
  assert.equal(model.clearImageEffects(image.id), true);
  assert.equal(image.path, "original.png");
});

test("Clear all restores original dimensions and effects with one undo step", async () => {
  const model = makeModel();
  await model.addImages(["a.png", "b.png", "c.png"]);
  const [a, b, c] = model.project.images;
  model.addPaintStroke(a.id, { tool: "brush", size: 4, color: "#ff0000", opacity: 1, points: [[0.5, 0.5]] });
  model.setImageCrop(a.id, { left: 0.2, top: 0.1, right: 0.8, bottom: 0.9 });
  outlineImage(model, b.id);
  const before = structuredClone(model.project.images);
  const history = model.undoStack.length;
  assert.equal(model.clearImageEffects(c.id, true), true, "Clear all works from an unedited image");
  assert.equal(model.undoStack.length, history + 1);
  for (const [index, image] of model.project.images.entries()) {
    assert.equal(image.path, ["a.png", "b.png", "c.png"][index]);
    assert.deepEqual([image.width, image.height], [100 + index, 80]);
    for (const field of ["sourcePath", "outlineSourcePath", "outlineSourceDimensions", "outlineSettings", "paintStrokes", "crop", "outline"]) {
      assert.equal(image[field], undefined);
    }
  }
  const cleared = structuredClone(model.project.images);
  model.undo();
  assert.deepEqual(model.project.images, before);
  model.redo();
  assert.deepEqual(model.project.images, cleared);
  assert.equal(model.clearImageEffects(c.id, true), false, "clearing clean images does not add history");
  assert.equal(model.undoStack.length, history + 1);
});

test("outline padding preserves off-center strokes and asymmetric crops", async () => {
  const model = makeModel();
  await model.addImages(["original.png"]);
  const image = model.project.images[0];
  model.addPaintStroke(image.id, { tool: "brush", size: 1, color: "#ff0000", opacity: 1, points: [[0.2, 0.25]] });
  model.setImageCrop(image.id, { left: 0.1, top: 0.2, right: 0.8, bottom: 0.9 });
  outlineImage(model, image.id);
  assert.deepEqual(image.paintStrokes[0].points[0], [30 / 120, 30 / 100]);
  assert.deepEqual(image.crop, { left: 20 / 120, top: 26 / 100, right: 90 / 120, bottom: 82 / 100 });
  model.resetImageOutline([image.id]);
  assert.deepEqual(image.paintStrokes[0].points[0], [0.2, 0.25]);
  assert.deepEqual(image.crop, { left: 0.1, top: 0.2, right: 0.8, bottom: 0.9 });
});

test("obsolete outline results cannot override undo or project replacement", async () => {
  const model = makeModel();
  await model.addImages(["original.png"]);
  const imageId = model.project.images[0].id;
  model.record();
  const revision = model.editRevision;
  model.undo();
  assert.equal(model.setImageOutlineResults([{ imageId, path: "late.png", width: 120, height: 100, outline }], false, revision), false);
  assert.equal(model.project.images[0].path, "original.png");
  const nextRevision = model.editRevision;
  model.replaceProject(structuredClone(model.project));
  assert.equal(model.setImageOutlineResults([{ imageId, path: "late.png", width: 120, height: 100, outline }], false, nextRevision), false);
});

test("baked padding results preserve originals, consume edits once, and undo as a batch", async () => {
  const model = makeModel();
  await model.addImages(["first.png", "second.png"]);
  const [first, second] = model.project.images;
  model.setImageCrop(first.id, { left: .25, top: .25, right: .75, bottom: .75 });
  model.addPaintStroke(first.id, { tool: "brush", color: "#ff0000", opacity: 1, size: 4, points: [[.5, .5]] });
  const before = structuredClone(model.project);
  const history = model.undoStack.length;
  const results = [
    { imageId: first.id, path: "padded-first.png", width: 56, height: 49 },
    { imageId: second.id, path: "padded-second.png", width: 107, height: 89 }
  ];
  assert.equal(model.setWorkingImageResults(results), true);
  assert.equal(model.undoStack.length, history + 1);
  assert.equal(first.originalPath, "first.png");
  assert.deepEqual(first.originalDimensions, { width: 100, height: 80 });
  assert.equal(first.crop, undefined);
  assert.equal(first.paintStrokes, undefined);
  assert.equal(first.path, "padded-first.png");
  const padded = structuredClone(model.project);
  assert.deepEqual(validateProject(padded).images, padded.images, "padded results round-trip as project assets");
  model.undo();
  assert.deepEqual(model.project, before);
  model.redo();
  assert.deepEqual(model.project, padded);
  model.clearImageEffects(first.id, true);
  assert.deepEqual(model.project.images.map(image => [image.path, image.width, image.height]),
    [["first.png", 100, 80], ["second.png", 101, 80]]);
});

test("late or invalid processed padding results do not alter the project", async () => {
  const model = makeModel();
  await model.addImages(["original.png"]);
  const result = { imageId: model.project.images[0].id, path: "padded.png", width: 110, height: 90 };
  const revision = model.editRevision;
  model.setImageCrop(result.imageId, { left: .2, top: .2, right: .8, bottom: .8 });
  const before = structuredClone(model.project);
  assert.equal(model.setWorkingImageResults([result], revision), false);
  assert.throws(() => model.setWorkingImageResults([{ ...result, width: -1 }]), /Invalid processed image/);
  assert.deepEqual(model.project, before);
});

test("malformed projects leave the active project and history intact", async () => {
  const model = makeModel();
  await model.addImages(["original.png"]);
  const before = structuredClone(model.project);
  const history = model.undoStack.length;
  const changes = [
    project => { project.images[0].paintStrokes = "invalid"; },
    project => { project.images[0].paintStrokes = [null]; },
    project => { project.images[0].crop = { left: 0.8, top: 0, right: 0.2, bottom: 1 }; },
    project => { project.images[0].outlineSettings = { size: 0 }; },
    project => { delete project.images[0].width; },
    project => { project.playbackSpeed = 17; },
    project => { project.images.push(null); },
    project => { project.clips.push(null); },
    project => { project.loopEnabled = "false"; }
  ];
  for (const change of changes) {
    const invalid = structuredClone(before);
    change(invalid);
    assert.throws(() => model.replaceProject(invalid));
    assert.deepEqual(model.project, before);
    assert.equal(model.undoStack.length, history);
  }
  const legacy = structuredClone(before);
  delete legacy.playbackSpeed;
  delete legacy.loopEnabled;
  model.replaceProject(legacy);
  assert.equal(model.project.playbackSpeed, 1);
  assert.equal(model.project.loopEnabled, true);
});

test("dirty state ignores navigation, respects undo and the actual saved snapshot", async () => {
  const model = makeModel();
  assert.equal(model.dirty, false);
  await model.addImages(["original.png"]);
  assert.equal(model.dirty, true);
  model.markSaved();
  model.setFrame(10);
  model.setZoom(300);
  model.selectClip(model.project.clips[0].id);
  assert.equal(model.dirty, false);
  const saved = structuredClone(model.project);
  model.setSpeed(2);
  model.markSaved(saved);
  assert.equal(model.dirty, true);
  model.undo();
  assert.equal(model.dirty, false);
  model.setDefaultDuration(12);
  assert.equal(model.dirty, true);
  model.undo();
  assert.equal(model.dirty, false);
  model.setLoop(false);
  model.undo();
  assert.equal(model.dirty, false);
});

test("background results cannot mutate the project after another edit", async () => {
  const model = makeModel();
  await model.addImages(["original.png"]);
  const originalBridge = window.frameLine.removeBackground;
  let finish;
  window.frameLine.removeBackground = () => new Promise(resolve => { finish = resolve; });
  try {
    const work = model.removeImageBackground(model.project.images[0].id, {});
    model.setFps(30);
    finish({ path: "late.png", width: 100, height: 80 });
    assert.equal(await work, false);
    assert.equal(model.project.images[0].path, "original.png");
  } finally { window.frameLine.removeBackground = originalBridge; }
});

test("history bounds large snapshots while preserving the next undo and redo", async () => {
  const model = makeModel();
  await model.addImages(["original.png"]);
  model.historyByteLimit = 1;
  for (const fps of [25, 30, 60]) model.setFps(fps);
  assert.equal(model.undoStack.length, 1);
  model.undo();
  assert.equal(model.project.fps, 30);
  assert.equal(model.redoStack.length, 1);
  model.redo();
  assert.equal(model.project.fps, 60);
});


test('a first playback timestamp before the Play event cannot move outside the loop', () => {
  const project = {...createProject(), currentFrame:12, loopStartFrame:12, loopEndFrame:36, loopEnabled:true};
  const result = advancePlayback(project,120,-.4,0);
  assert.deepEqual(result,{currentFrame:12,fractionalFrame:0,stopped:false});
  assert.equal(advancePlayback({...project,currentFrame:72},120,-.4,0).currentFrame,12);
});
