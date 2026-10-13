import { survivingBefore } from './frame-intervals.mjs';
import { loopRange } from './project-model.mjs';

/** Plan clip removal while keeping playback boundaries attached to surviving frames. */
export function timelineDeletionPlan(project, removeClip) {
  const clips = [];
  const keptFrames = [];
  let position = 0;
  let frames = 0;
  for (const [index, clip] of project.clips.entries()) {
    const end = position + clip.durationFrames;
    if (!removeClip(clip, index)) {
      clips.push(clip);
      const previous = keptFrames.at(-1);
      if (previous?.[1] === position) previous[1] = end;
      else keptFrames.push([position, end]);
      frames += clip.durationFrames;
    }
    position = end;
  }
  if (clips.length === project.clips.length) return null;

  // A boundary inside a removed clip collapses to its surviving insertion point.
  const loopStartFrame = survivingBefore(keptFrames, project.loopStartFrame ?? 0);
  const loopEndFrame = project.loopEndFrame == null
    ? null : survivingBefore(keptFrames, project.loopEndFrame);
  const range = loopRange({ loopStartFrame, loopEndFrame }, frames);
  return {
    clips,
    currentFrame: Math.max(0, Math.min(survivingBefore(keptFrames, project.currentFrame), frames - 1)),
    loopStartFrame: range.startFrame,
    loopEndFrame: !frames || loopEndFrame == null ? null : range.endFrame
  };
}
