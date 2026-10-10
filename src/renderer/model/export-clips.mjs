import { clipRanges, loopRange } from "./project-model.mjs";

export function exportClipData(project, scope = "all", selectedClipIds = []) {
  const selected = new Set(selectedClipIds);
  const bounds = scope === "range" ? loopRange(project) : null;
  const images = new Map(project.images.map(image => [image.id, image]));
  return clipRanges(project).flatMap(({ clip, startFrame, endFrame }) => {
    if (scope === "selected" && !selected.has(clip.id)) return [];
    const duration = bounds
      ? Math.min(endFrame, bounds.endFrame) - Math.max(startFrame, bounds.startFrame)
      : clip.durationFrames;
    if (duration <= 0) return [];
    const image = images.get(clip.imageId);
    return [{
      path: image.path, image_id: image.id, paint_strokes: image.paintStrokes ?? [],
      crop: image.crop, outline: image.outline, duration_frames: duration
    }];
  });
}
