import test from "node:test";
import assert from "node:assert/strict";
import { cornerBackground, validateNewImageOptions, IMAGE_SIZE_PRESETS } from "../src/renderer/model/new-image.mjs";

test("blank image options require positive integer dimensions and count, and bound batch memory", () => {
  const options = { width: "1920", height: "1080", count: "1", transparent: true, color: "#AABBCC" };
  assert.deepEqual(validateNewImageOptions(options), { width: 1920, height: 1080, count: 1, transparent: true, color: "#aabbcc" });
  for (const width of ["", 0, -1, 1.5, 8193, NaN, Infinity]) assert.throws(() => validateNewImageOptions({ ...options, width }), /Width and height/);
  for (const count of ["", 0, 1.5, 1001, Infinity]) assert.throws(() => validateNewImageOptions({ ...options, count }), /Image count/);
  assert.throws(() => validateNewImageOptions({ ...options, width: 8192, height: 8192 }), /32 million/);
  assert.throws(() => validateNewImageOptions({ ...options, count: 1000 }), /batch is too large/);
  assert.throws(() => validateNewImageOptions({ ...options, color: "bad" }), /background color/);
  for (const preset of IMAGE_SIZE_PRESETS) assert.doesNotThrow(() => validateNewImageOptions({ ...options, ...preset }));
});

test("four-corner background detection tolerates compression and a foreground corner", () => {
  assert.deepEqual(cornerBackground([[4,244,4,255], [6,242,6,255], [5,243,5,255], [0,0,0,255]]),
    { transparent: false, color: "#05f305", detected: true });
  assert.deepEqual(cornerBackground(Array.from({ length: 4 }, () => [255,255,255,255])),
    { transparent: false, color: "#ffffff", detected: true });
});

test("transparent, mixed, and semi-transparent corners do not invent a solid background", () => {
  for (const samples of [
    [],
    Array.from({ length: 4 }, () => [0,255,0,0]),
    Array.from({ length: 4 }, () => [0,255,0,128]),
    [[255,0,0,255], [0,255,0,255], [0,0,255,255], [255,255,255,255]],
    [[4,244,4,255], [4,244,4,255], [0,0,0,0], [0,0,0,0]]
  ]) assert.deepEqual(cornerBackground(samples), { transparent: true, color: "#ffffff", detected: false });
});
