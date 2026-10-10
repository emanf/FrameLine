import test from "node:test";
import assert from "node:assert/strict";
import { circleStampSpans, pixelRoundStrokeSpans } from "../src/renderer/model/pixel-brush.mjs";

function stamp(diameter) {
  const rows = circleStampSpans(diameter);
  return Array.from({length:diameter}, (_, y) => {
    const row = rows.find(row => row.y === y);
    return Array.from({length:diameter}, (_, x) => row && x >= row.left && x < row.right ? '#' : '.').join('');
  });
}

test("hard circle stamps have recognizable round shapes at small odd/even diameters", () => {
  assert.deepEqual(stamp(1), ['#']);
  assert.deepEqual(stamp(3), ['.#.','###','.#.']);
  assert.deepEqual(stamp(5), ['.###.','#####','#####','#####','.###.']);
  assert.deepEqual(stamp(6), ['..##..','.####.','######','######','.####.','..##..']);
  assert.deepEqual(stamp(8), ['..####..','.######.','########','########','########','########','.######.','..####..']);
});

test("pixel circles stay symmetric and retain their exact diameter across brush sizes", () => {
  for (let diameter = 1; diameter <= 200; diameter++) {
    const rows = circleStampSpans(diameter);
    assert.equal(rows.length, diameter);
    assert.equal(Math.min(...rows.map(row => row.left)), 0);
    assert.equal(Math.max(...rows.map(row => row.right)), diameter);
    for (const row of rows) {
      const opposite = rows[diameter - 1 - row.y];
      assert.equal(row.left, diameter - row.right);
      assert.deepEqual([row.left,row.right], [opposite.left,opposite.right]);
    }
  }
});

test("hard round strokes snap to pixels and merge overlaps before applying opacity", () => {
  const base = {size:5,points:[[.51,.51],[.7,.65],[.51,.51]]};
  const spans = pixelRoundStrokeSpans(base,20,20);
  const pixels = new Set();
  for (const {y,left,right} of spans) for (let x=left;x<right;x++) {
    assert(!pixels.has(`${x},${y}`), 'each pixel is covered once per stroke');
    pixels.add(`${x},${y}`);
  }
  const dot = {size:5,points:[[.51,.51]]};
  assert.deepEqual(pixelRoundStrokeSpans(dot,20,20),pixelRoundStrokeSpans({...dot,points:[[.54,.54]]},20,20));
  assert.deepEqual(pixelRoundStrokeSpans({...dot,points:[[.51,.51],[.51,.51]]},20,20),pixelRoundStrokeSpans(dot,20,20));
});

test("one-pixel paths stay continuous and round stamps clip at image boundaries", () => {
  const diagonal = pixelRoundStrokeSpans({size:1,points:[[0,0],[1,1]]},5,5);
  assert.deepEqual(diagonal, Array.from({length:5}, (_, y) => ({y,left:y,right:y+1})));
  for (const point of [[0,0],[1,1]]) {
    const rows=pixelRoundStrokeSpans({size:8,points:[point]},6,4);
    assert(rows.length);
    assert(rows.every(row=>row.y>=0&&row.y<4&&row.left>=0&&row.right<=6&&row.left<row.right));
  }
  assert.deepEqual(pixelRoundStrokeSpans({size:1e100,points:[[0,0]]},5,5),Array.from({length:5}, (_, y) => ({y,left:0,right:5})), 'a brush larger than the image does not allocate its full stamp');
});
