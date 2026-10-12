import {cleanupDefaults, timelineCleanupPlan} from '../model/timeline-cleanup.mjs';
import {clipRanges} from '../model/project-model.mjs';

/** Own cleanup draft settings and a bounded, paged preview without editing the project. */
export class TimelineCleanupViewModel {
  constructor(project, selectedIds) {
    this.project = project;
    this.selectedIds = selectedIds;
    this.options = {...cleanupDefaults,to:project.clips.length};
    this.ranges = clipRanges(project);
    this.images = new Map(project.images.map(image => [image.id,image]));
    this.page = 0;
    this.pageSize = 48;
    this.plan = null;
    this.error = '';
  }

  /** Validate changed settings and replace the result plan atomically. */
  update(options) {
    this.options = {...this.options,...options};
    this.page = 0;
    try { this.accept({plan:timelineCleanupPlan(this.project,this.options,this.selectedIds)}); }
    catch (error) { this.accept({error:error.message}); }
  }

  /** Accept a computed draft result and cache ordinal boundaries for preview lookup. */
  accept({plan,error = ''}) {
    this.plan = plan ?? null;
    this.error = error;
    let count = 0;
    this.boundaries = this.plan?.kept.map(([start,end]) => (count += end-start)) ?? [];
  }

  /** Resolve one retained position to its edited source image in logarithmic time. */
  previewItem(ordinal) {
    let lowInterval = 0, highInterval = this.boundaries.length-1;
    while (lowInterval < highInterval) {
      const middle = Math.floor((lowInterval+highInterval)/2);
      if (this.boundaries[middle] <= ordinal) lowInterval = middle+1; else highInterval = middle;
    }
    const position = this.plan.kept[lowInterval][0]+ordinal-(this.boundaries[lowInterval-1] ?? 0);
    let index = position;
    if (this.options.unit === 'frames') {
      let low = 0, high = this.ranges.length-1;
      while (low < high) {
        const middle = Math.floor((low+high)/2);
        if (this.ranges[middle].endFrame <= position) low = middle+1; else high = middle;
      }
      index = low;
    }
    const clip = this.project.clips[index];
    return {number:position+1,ordinal:ordinal+1,image:this.images.get(clip.imageId),duration:clip.durationFrames};
  }

  /** Return only the visible result page, even for very long held images. */
  previewItems() {
    if (!this.plan) return [];
    const start = this.page*this.pageSize, end = Math.min(this.plan.keptUnits,start+this.pageSize);
    return Array.from({length:end-start},(_,index)=>this.previewItem(start+index));
  }

  get pages() { return this.plan ? Math.ceil(this.plan.keptUnits/this.pageSize) : 0; }
}
