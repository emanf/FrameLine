import {timelineCleanupPlan} from './timeline-cleanup.mjs';

/** Compute large cleanup previews outside the renderer's input and paint thread. */
self.onmessage = ({data}) => {
  try { self.postMessage({id:data.id,plan:timelineCleanupPlan(data.project,data.options,data.selected)}); }
  catch (error) { self.postMessage({id:data.id,error:error.message}); }
};
