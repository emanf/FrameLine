/** Merge ordered or overlapping half-open integer intervals. */
export function mergeIntervals(intervals) {
  const result = [];
  for (const [start, end] of intervals.filter(([a,b]) => b > a).sort((a,b) => a[0]-b[0])) {
    const previous = result.at(-1);
    if (previous && start <= previous[1]) previous[1] = Math.max(previous[1], end);
    else result.push([start, end]);
  }
  return result;
}

/** Intersect two normalized interval lists in linear time. */
export function intersectIntervals(left, right) {
  const result = [];
  let a = 0, b = 0;
  while (a < left.length && b < right.length) {
    const start = Math.max(left[a][0], right[b][0]), end = Math.min(left[a][1], right[b][1]);
    if (end > start) result.push([start, end]);
    if (left[a][1] < right[b][1]) a++; else b++;
  }
  return result;
}

/** Subtract normalized intervals without expanding them into individual frames. */
export function subtractIntervals(source, removed) {
  const result = [];
  let j = 0;
  for (const [start, end] of source) {
    let cursor = start;
    while (j < removed.length && removed[j][1] <= start) j++;
    for (let k = j; k < removed.length && removed[k][0] < end; k++) {
      if (removed[k][0] > cursor) result.push([cursor, Math.min(end, removed[k][0])]);
      cursor = Math.max(cursor, removed[k][1]);
      if (cursor >= end) break;
    }
    if (cursor < end) result.push([cursor, end]);
  }
  return result;
}

/** Count positions covered by normalized intervals. */
export const intervalCount = intervals => intervals.reduce((sum,[start,end]) => sum+end-start, 0);

/** Map an ordinal within sparse intervals back to its original position. */
export function intervalPosition(intervals, ordinal) {
  for (const [start,end] of intervals) {
    if (ordinal < end-start) return start+ordinal;
    ordinal -= end-start;
  }
  return null;
}

/** Count surviving frames before an original timeline boundary. */
export function survivingBefore(intervals, boundary) {
  let count = 0;
  for (const [start,end] of intervals) {
    if (start >= boundary) break;
    count += Math.min(end,boundary)-start;
  }
  return count;
}
