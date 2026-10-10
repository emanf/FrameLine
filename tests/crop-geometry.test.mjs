import test from "node:test";
import assert from "node:assert/strict";
import { cropPixelRect, cropFromPixelRect } from "../src/renderer/model/crop-geometry.mjs";

test("crop fields preserve exact pixel bounds through normalized project data", () => {
  for (const [width, height] of [[100, 100], [127, 83], [1920, 1080]]) {
    const rect = { x: 29, y: 17, width: 26, height: 38 };
    assert.deepEqual(cropPixelRect(width, height, cropFromPixelRect(width, height, rect)), rect);
  }
  assert.deepEqual(cropPixelRect(32, 32), { x: 0, y: 0, width: 32, height: 32 });
});

test("numeric crop bounds clamp to the image and retain at least one pixel", () => {
  const rect = { x: 999, y: -20, width: 0, height: 999 };
  assert.deepEqual(cropPixelRect(32, 16, cropFromPixelRect(32, 16, rect)),
    { x: 31, y: 0, width: 1, height: 16 });
  assert.deepEqual(cropPixelRect(32, 16, cropFromPixelRect(32, 16,
    { x: 4.4, y: 6.7, width: 30, height: -2 })), { x: 4, y: 7, width: 28, height: 1 });
});

test("fractional legacy crops cover their source pixels and scale for other images", () => {
  assert.deepEqual(cropPixelRect(100, 100, { left: .294, top: .173, right: .551, bottom: .555 }),
    { x: 29, y: 17, width: 27, height: 39 });
  const crop = cropFromPixelRect(64, 16, { x: 16, y: 4, width: 32, height: 8 });
  assert.deepEqual(cropPixelRect(16, 64, crop), { x: 4, y: 16, width: 8, height: 32 });
});
