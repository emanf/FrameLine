import {clipRanges, loopRange, totalFrames} from './project-model.mjs';
import {mergeIntervals, intersectIntervals, subtractIntervals, intervalCount} from './frame-intervals.mjs';

export const cleanupDefaults = Object.freeze({
  unit:'clips', scope:'all', from:1, to:1, numbering:'global', action:'keep',
  mode:'every', every:5, offset:1, keep:1, skip:4, count:10, percent:50,
  custom:'1, 6, 11', keepFirst:false, keepLast:false, include:'', exclude:'', timing:'compact',
});

/** Require positive safe integers for frame counts and positions. */
function integer(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${label} must be a positive whole number.`);
  return value;
}

/** Parse one-based lists, inclusive ranges, and stepped ranges into normalized intervals. */
export function parseFrameList(text, maximum) {
  if (!text.trim()) return [];
  const intervals = [];
  const parts = text.trim().split(/[,;\s]+/);
  for (const part of parts) {
    const match = /^(\d+)(?:-(\d+)(?::(\d+))?)?$/.exec(part);
    if (!match) throw new Error(`Invalid entry “${part}”. Use 1, 5-12, or 20-40:5.`);
    const start = integer(Number(match[1]), 'Frame number');
    const end = integer(Number(match[2] ?? match[1]), 'Range end');
    const step = integer(Number(match[3] ?? 1), 'Range step');
    if (start > end || end > maximum) throw new Error(`“${part}” must be within 1–${maximum}, with the start before the end.`);
    if (step === 1) intervals.push([start-1, end]);
    else for (let number = start; number <= end; number += step) intervals.push([number-1,number]);
  }
  return mergeIntervals(intervals);
}

/** Resolve the edit scope while retaining positions outside it. */
function scopeIntervals(project, options, selectedIds, ranges, maximum) {
  if (options.scope === 'all') return [[0,maximum]];
  if (options.scope === 'custom') {
    const from = integer(options.from,'Range start'), to = integer(options.to,'Range end');
    if (from > to || to > maximum) throw new Error(`Choose a range within 1–${maximum}.`);
    return [[from-1,to]];
  }
  if (options.scope === 'selected' && !selectedIds.size) throw new Error('Select timeline clips before using this scope.');
  const loop = loopRange(project);
  return mergeIntervals(ranges.flatMap((range,index) => {
    const selected = options.scope === 'selected' ? selectedIds.has(range.clip.id)
      : range.endFrame > loop.startFrame && range.startFrame < loop.endFrame;
    if (!selected) return [];
    if (options.unit === 'clips') return [[index,index+1]];
    return [[options.scope === 'selected' ? range.startFrame : Math.max(range.startFrame,loop.startFrame),
      options.scope === 'selected' ? range.endFrame : Math.min(range.endFrame,loop.endFrame)]];
  }));
}

/** Select pattern matches using interval arithmetic and sparse-scope ordinals. */
function patternIntervals(scope, options, maximum) {
  const count = intervalCount(scope);
  if (options.mode === 'count' || options.mode === 'percent') {
    const target = options.mode === 'count' ? integer(options.count,'Target count')
      : Math.max(1, Math.round(count * options.percent/100));
    if (options.mode === 'percent' && (!Number.isFinite(options.percent) || options.percent <= 0 || options.percent > 100)) throw new Error('Percentage must be greater than 0 and at most 100.');
    if (target > count) throw new Error(`The target count cannot exceed ${count}.`);
    if (target === count) return scope;
    const matches = [];
    // A single sample keeps the first position; multiple samples include both endpoints.
    let scopeIndex = 0, ordinalStart = 0;
    for (let i = 0; i < target; i++) {
      const ordinal = target === 1 ? 0 : Math.round(i*(count-1)/(target-1));
      while (ordinal >= ordinalStart+scope[scopeIndex][1]-scope[scopeIndex][0]) {
        ordinalStart += scope[scopeIndex][1]-scope[scopeIndex][0]; scopeIndex++;
      }
      const position = scope[scopeIndex][0]+ordinal-ordinalStart;
      matches.push([position,position+1]);
    }
    return mergeIntervals(matches);
  }
  const relative = options.numbering === 'scope';
  const limit = relative ? count : maximum;
  const custom = options.mode === 'custom' ? parseFrameList(options.custom,limit) : null;
  if (custom && !custom.length) throw new Error('Enter at least one number or range.');
  let cycle, width, offset;
  if (!custom) {
    if (options.mode === 'odd' || options.mode === 'even') {
      cycle = 2; width = 1; offset = options.mode === 'odd' ? 0 : 1;
    } else {
      offset = integer(options.offset,'Start at')-1;
      if (offset >= limit) throw new Error(`Start at must be within 1–${limit}.`);
      width = options.mode === 'groups' ? integer(options.keep,'Keep count') : 1;
      cycle = options.mode === 'groups' ? width+integer(options.skip,'Skip count') : integer(options.every,'Interval');
      if (!Number.isSafeInteger(cycle)) throw new Error('The repeating interval is too large.');
    }
  }
  const result = [];
  let ordinal = 0;
  for (const [start,end] of scope) {
    const a = relative ? ordinal : start, b = relative ? ordinal+end-start : end;
    const translate = relative ? start-ordinal : 0;
    if (custom) {
      for (const [left,right] of intersectIntervals(custom,[[a,b]])) result.push([left+translate,right+translate]);
    } else {
      const first = offset + Math.max(0,Math.floor((a-offset)/cycle))*cycle;
      for (let left = first; left < b; left += cycle) {
        const right = Math.min(b,left+width);
        if (right > a) result.push([Math.max(a,left)+translate,right+translate]);
        if (width === cycle) { result[result.length-1][1] = b; break; }
      }
    }
    ordinal += end-start;
  }
  return mergeIntervals(result);
}

/** Build a nonmutating cleanup plan; clips retain IDs and sources, with integral durations. */
export function timelineCleanupPlan(project, input = {}, selected = []) {
  const options = {...cleanupDefaults,...input};
  for (const [field,values] of Object.entries({unit:['clips','frames'],scope:['all','range','selected','custom'],
    action:['keep','remove'],mode:['every','odd','even','groups','count','percent','custom'],
    numbering:['global','scope'],timing:['compact','hold']})) {
    if (!values.includes(options[field])) throw new Error(`Unknown ${field}.`);
  }
  const frames = totalFrames(project), ranges = clipRanges(project);
  const maximum = options.unit === 'clips' ? ranges.length : frames;
  if (!maximum) throw new Error('Add clips to the frame line first.');
  const scope = scopeIntervals(project,options,new Set(selected),ranges,maximum);
  if (!intervalCount(scope)) throw new Error('There are no positions in the chosen scope.');
  const matches = patternIntervals(scope,options,maximum);
  let chosen = options.action === 'keep' ? matches : subtractIntervals(scope,matches);
  const includes = parseFrameList(options.include,maximum);
  if (options.keepFirst) includes.push([0,1]);
  if (options.keepLast) includes.push([maximum-1,maximum]);
  chosen = mergeIntervals([...chosen,...intersectIntervals(scope,mergeIntervals(includes))]);
  chosen = subtractIntervals(chosen,parseFrameList(options.exclude,maximum));
  const kept = mergeIntervals([...subtractIntervals([[0,maximum]],scope),...chosen]);
  const keptUnits = intervalCount(kept);
  if (!keptUnits) throw new Error('This pattern would remove everything. Keep at least one position.');
  let intervalIndex = 0;
  const keptFrames = options.unit === 'frames' ? kept : mergeIntervals(ranges.flatMap((range,index) => {
    while (intervalIndex < kept.length && kept[intervalIndex][1] <= index) intervalIndex++;
    return intervalIndex < kept.length && kept[intervalIndex][0] <= index ? [[range.startFrame,range.endFrame]] : [];
  }));
  const entries = [];
  let cursor = 0;
  for (const range of ranges) {
    while (cursor < keptFrames.length && keptFrames[cursor][1] <= range.startFrame) cursor++;
    let duration = 0, first = null;
    for (let i = cursor; i < keptFrames.length && keptFrames[i][0] < range.endFrame; i++) {
      const start = Math.max(range.startFrame,keptFrames[i][0]), end = Math.min(range.endFrame,keptFrames[i][1]);
      duration += end-start; first ??= start;
    }
    if (duration) entries.push({...range,firstKeptFrame:first,durationFrames:duration});
  }
  const clips = entries.map((entry,index) => ({...entry.clip, durationFrames: options.timing === 'hold'
    ? (entries[index+1]?.firstKeptFrame ?? frames) - (index ? entry.firstKeptFrame : 0)
    : entry.durationFrames}));
  return {options,scope,kept,keptFrames,keptUnits,removedUnits:maximum-keptUnits,maximum,
    clips,frames:clips.reduce((sum,clip)=>sum+clip.durationFrames,0),originalFrames:frames,
    changed:clips.length !== project.clips.length || clips.some((clip,index)=>clip.id !== project.clips[index].id || clip.durationFrames !== project.clips[index].durationFrames)};
}
