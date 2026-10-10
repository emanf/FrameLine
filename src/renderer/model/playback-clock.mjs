import { loopRange } from "./project-model.mjs";

/** Advance a whole-frame playhead with fractional carry, loop bounds, and monotonic elapsed time. */
export function advancePlayback(project, frameCount, elapsedMilliseconds, fractionalFrame = 0) {
  if (!frameCount) return { currentFrame: 0, fractionalFrame: 0, stopped: true };
  // A frame callback can carry a timestamp from just before the Play event.
  // Backward clock movement must never advance into the frame before a loop.
  const elapsed = Math.max(0, elapsedMilliseconds);
  const accumulated = fractionalFrame + elapsed * project.fps * project.playbackSpeed / 1000;
  const advance = Math.floor(accumulated);
  const range = project.loopEnabled ? loopRange(project, frameCount) : { startFrame: 0, endFrame: frameCount };
  const startingFrame = project.loopEnabled && (project.currentFrame < range.startFrame || project.currentFrame >= range.endFrame)
    ? range.startFrame : project.currentFrame;
  let currentFrame = startingFrame + advance;
  let remainder = accumulated - advance;
  let stopped = false;

  if (currentFrame >= range.endFrame) {
    if (project.loopEnabled) currentFrame = range.startFrame + (currentFrame - range.startFrame) % (range.endFrame - range.startFrame);
    else {
      currentFrame = frameCount - 1;
      remainder = 0;
      stopped = true;
    }
  }

  return { currentFrame, fractionalFrame: remainder, stopped };
}
