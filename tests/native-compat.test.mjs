import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { NATIVE_CONTENT_SCALE_FACTOR, nativeTextureSize } from '../src/native-compat.js';
import { NativeView } from '../src/view.js';

const catalog = JSON.parse(await readFile(new URL('../assets/catalog.json', import.meta.url), 'utf8'));
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);

function renderer() {
  const draws = [];
  const context = { save() {}, restore() {}, translate() {}, rotate() {}, scale() {}, drawImage(...arguments_) { draws.push(arguments_); } };
  const view = Object.create(NativeView.prototype);
  Object.assign(view, { app: {}, catalog, context, images: new Map(Object.entries(catalog.textures).map(([name, size]) => [name, { ...size }])), hits: [], tinted: new Map() });
  return { view, draws };
}

test('medium resources use the 0.5 content scale factor', () => {
  assert.equal(NATIVE_CONTENT_SCALE_FACTOR, 0.5);
  const pixels = { width: 989, height: 100 };
  assert.deepEqual(nativeTextureSize(pixels), { width: 1978, height: 200 });
  assert.deepEqual(pixels, { width: 989, height: 100 });
});

test('note and effect images render in Cocos points rather than raw pixels', () => {
  const { view, draws } = renderer();
  const tap = view.image('Tap2.png', 1024, 700, { scale: 0.5 / 4 });
  close(tap.width, 247.25);
  close(tap.height, 25);
  close(draws[0][3], 247.25);
  close(draws[0][4], 25);
  const flick = view.image('Flick2.png', 500, 700, { scale: 0.129 * 0.4 });
  close(flick.width, catalog.textures['Flick2.png'].width * 2 * 0.129 * 0.4);
  const effect = view.image('img-1.png', 500, 700, { scale: 0.5 * 1.4 });
  close(effect.width, catalog.textures['img-1.png'].width * 1.4);
});

test('explicit line spans and Hold durations remain logical lengths', () => {
  const { view } = renderer();
  const line = view.image('line.png', 500, 300, { width: 512 });
  close(line.width, 512);
  close(line.height, 10);
  const duration = 720;
  const hold = view.image('Hold3.png', 500, 300, { scaleX: 0.129 * 0.4, scaleY: duration / view.textureSize('Hold3.png').height, anchorY: 0 });
  close(hold.width, 102.0648);
  close(hold.height, duration);
  close(hold.y, 300 + duration / 2);
  const event = view.image('Hold4.png', 1008, 300, { scaleX: 0.8 * 0.4, scaleY: duration / view.textureSize('Hold4.png').height, anchorY: 0 });
  close(event.width, 94.72);
  close(event.height, duration);
});

test('buttons and checkboxes use matching native drawing and hit sizes', () => {
  const { view } = renderer();
  view.button('save.png', 1948, 1300, 0.12, () => {});
  close(view.hits.at(-1).width, 122.88);
  assert.equal(view.contains(view.hits.at(-1), { x: 1948 + 50, y: 1300 }), true);
  view.check('Line Visible', 88, 1350, false, () => {}, 0.7);
  close(view.hits.at(-1).width, 56);
  close(view.hits.at(-1).height, 56);
  view.button('add.png', 1986.56, 1358, 0.06, () => {}, { anchorX: 1, anchorY: 1 });
  close(view.hits.at(-1).width, 240);
  close(view.hits.at(-1).x, 1866.56);
});

test('slider motion and picking use the enlarged native bar length', () => {
  const { view, draws } = renderer();
  view.slider('volume', 1000, 600, 0.75, () => {});
  const slider = view.hits.at(-1);
  close(slider.width, 600);
  close(slider.valueAt({ x: 1150, y: 600 }), 0.75);
  close(draws[0][3], 600);
  view.slider('time', 220, 770, 0.75, () => {}, { texture: '111.png', ball: 'ball.png', scale: 0.48, vertical: true });
  const vertical = view.hits.at(-1);
  close(vertical.height, 960);
  close(vertical.valueAt({ x: 220, y: 1010 }), 0.75);
});

test('user media retains pixel dimensions unless a display size is specified', () => {
  const { view } = renderer();
  view.images.set('background', { width: 800, height: 600 });
  assert.deepEqual(view.textureSize('background'), { width: 800, height: 600 });
  const image = view.image('background', 1024, 700, { width: 2048, height: 1400 });
  assert.equal(image.width, 2048);
  assert.equal(image.height, 1400);
});
