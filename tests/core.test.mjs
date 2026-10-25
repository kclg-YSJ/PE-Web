import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createChart, parsePEC, serializePEC, ChartEngine, TempoMap, History, clone, easing, pasteObjects, generateNotes, parseNativeSettings } from '../src/core.js';

const close = (actual, expected, tolerance = 1e-7) => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} != ${expected}`);
const semantic = chart => ({ offset: chart.offset, bpms: chart.bpms, notes: chart.notes.map(({ id, ...note }) => note).sort((first, second) => JSON.stringify(first).localeCompare(JSON.stringify(second))), events: chart.events.map(({ id, ...event }) => event).sort((first, second) => JSON.stringify(first).localeCompare(JSON.stringify(second))) });

test('all four notes, modifiers and seven event commands survive PEC export', () => {
  const chart = parsePEC('321 bp 0 120 bp 8 180 n1 0 1 -512 1 0 # 1.5 & 2 n2 2 2 6 128 2 1 # .75 & .5 n3 1 3 20 1 0 n4 3 4 -25 2 0 cp 0 0 1024 700 cm 0 1 4 800 600 29 cd 0 0 -30 cr 0 4 8 150 16 ca 0 0 255 cf 0 5 9 -125 cv 0 0 10');
  assert.deepEqual(semantic(parsePEC(serializePEC(chart))), semantic(chart));
});

test('original native PEC files preserve every note, event and modifier', async () => {
  const root = resolve('assets/original');
  for (const name of (await readdir(root)).filter(name => name.endsWith('.pec') || name === 'c')) {
    const chart = parsePEC(await readFile(resolve(root, name), 'utf8'));
    assert.deepEqual(semantic(parsePEC(serializePEC(chart))), semantic(chart), name);
  }
});

test('unsorted BPM events are integrated and converted in both directions', () => {
  const tempo = new TempoMap([{ beat: 8, bpm: 60 }, { beat: 0, bpm: 120 }, { beat: 4, bpm: 240 }]);
  close(tempo.toSeconds(4), 2);
  close(tempo.toSeconds(8), 3);
  close(tempo.toSeconds(10), 5);
  for (const beat of [-8, 0, 0.125, 3.33, 4, 7.8, 8, 64]) close(tempo.toBeat(tempo.toSeconds(beat)), beat);
  assert.throws(() => new TempoMap([{ beat: 0, bpm: 0 }]));
});

test('instant events, continuous events and exact endpoints have stable values', () => {
  const engine = new ChartEngine(parsePEC('0 bp 0 60 cp 0 0 1024 700 cm 0 2 4 1224 900 1 cp 0 6 10 20 cd 0 0 0 cr 0 2 4 90 5 ca 0 0 255 cf 0 2 4 0 cv 0 0 10'));
  assert.deepEqual(engine.lineAt(0, 0), { x: 1024, y: 700, angle: 0, alpha: 255, speed: 10 });
  const middle = engine.lineAt(0, 3);
  close(middle.x, 1124);
  close(middle.y, 800);
  close(middle.angle, 22.5);
  close(middle.alpha, 127.5);
  close(engine.lineAt(0, 4).x, 1224);
  close(engine.lineAt(0, 6).x, 10);
  assert.deepEqual(engine.lineAt(0, 1), engine.lineAt(0, 1));
});

test('speed integration accounts for forward, reverse and zero segments', () => {
  const engine = new ChartEngine(parsePEC('0 bp 0 60 cv 0 0 10 cv 0 2 -5 cv 0 4 0'));
  close(engine.distance(0, 1, 3), 600);
  close(engine.distance(0, 3, 1), -600);
  close(engine.distance(0, 4, 8), 0);
  close(engine.distance(0, -1, 1), 2400);
});

test('all 29 native easing functions have valid endpoints and samples', () => {
  for (let type = 1; type <= 29; type++) {
    close(easing(0, type), 0);
    close(easing(1, type), 1);
    for (let index = 0; index <= 100; index++) assert.ok(Number.isFinite(easing(index / 100, type)));
  }
  close(easing(0.5, 2), Math.SQRT1_2);
  close(easing(0.5, 5), 0.25);
  close(easing(0.5, 9), 0.125);
  close(easing(0.5, 26), 0.765625);
  assert.ok(easing(0.7, 20) > 1);
});

test('fake notes, holds and simultaneous notes produce correct preview statistics', () => {
  const engine = new ChartEngine(parsePEC('0 bp 0 60 n1 0 1 0 1 0 n2 0 1 3 100 2 0 n3 0 2 0 1 1 n4 0 4 0 1 0'));
  assert.equal(engine.notes.filter(note => note.highlight).length, 2);
  assert.equal(engine.judgments.length, 3);
  assert.equal(engine.comboAt(0.99), 0);
  assert.equal(engine.comboAt(1), 1);
  assert.equal(engine.comboAt(2), 1);
  assert.equal(engine.comboAt(3), 2);
  assert.equal(engine.comboAt(4), 3);
});

test('note geometry preserves side, clockwise rotation and special alpha behavior', () => {
  const chart = parsePEC('0 bp 0 60 cp 0 0 1024 700 cd 0 0 0 ca 0 0 255 cv 0 0 1 n1 0 2 100 1 0 n1 0 2 -100 2 0');
  const engine = new ChartEngine(chart);
  const above = engine.noteGeometry(engine.notes[0], 1);
  const below = engine.noteGeometry(engine.notes[1], 1);
  close(above.x, 1124);
  close(above.y, 580);
  close(below.x, 924);
  close(below.y, 820);
  assert.equal(engine.noteGeometry(engine.notes[0], 1, { x: 1024, y: 700, angle: 0, alpha: -1 }).visible, false);
});

test('undo and redo recover note properties, events and invalid transactions', () => {
  const history = new History(createChart());
  const original = clone(history.chart);
  history.transact('offset', chart => chart.offset = 123);
  history.transact('position', chart => chart.events[0].values = [200, 300]);
  history.undo();
  assert.deepEqual(history.chart.events, original.events);
  history.undo();
  assert.deepEqual(history.chart, original);
  history.redo();
  assert.equal(history.chart.offset, 123);
  assert.throws(() => history.transact('invalid', chart => chart.bpms[0].bpm = 0));
  assert.equal(history.chart.bpms[0].bpm, 120);
  assert.equal(history.chart.offset, 123);
});

test('paste moves across judge lines and preserves durations across BPM changes', () => {
  const chart = parsePEC('0 bp 0 120 bp 4 60 n2 0 0 2 200 1 0 # 2 & 1.5 cp 0 0 1300 700');
  const objects = clone([chart.notes[0], chart.events[0]]);
  const ids = pasteObjects(chart, objects, 4, 8, true);
  const note = chart.notes.find(item => item.id === ids[0]);
  assert.equal(note.line, 8);
  assert.equal(note.x, -200);
  assert.equal(note.beat, 4);
  assert.equal(note.endBeat, 5);
  assert.equal(note.speed, 2);
  assert.equal(note.size, 1.5);
  assert.equal(chart.events.at(-1).values[0], 748);
});

test('batch creation follows easing and rejects loops that cannot terminate', () => {
  const chart = createChart();
  generateNotes(chart, { startBeat: 0, endBeat: 1, startX: -100, endX: 100, step: 0.25, type: 3, line: 0, easingType: 5 });
  assert.equal(chart.notes.length, 5);
  close(chart.notes[2].x, -50);
  assert.throws(() => generateNotes(chart, { startBeat: 0, endBeat: 1, step: 0 }));
});

test('missing Alpha setting does not consume the first song', () => {
  const fixture = 'WindowSize: 2048 1400\n#\nName: Climax\nSong: Climax.mp3\nPicture: Climax.jpg\nChart: Climax.pec\nLevel: IN 15\nComposer: USAO\nCharter:\n';
  const { songs, settings } = parseNativeSettings(fixture);
  assert.equal(songs.length, 1);
  assert.equal(songs[0].name, 'Climax');
  assert.equal(songs[0].level, 'IN 15');
  assert.equal(settings.backgroundAlpha, 70);
});

test('bad files fail with actionable diagnostics instead of silently dropping commands', () => {
  assert.throws(() => parsePEC(''), /为空/);
  assert.throws(() => parsePEC('0 bp 0 no'), /不是数字/);
  assert.throws(() => parsePEC('0 n2 0 1'), /参数不足/);
  assert.throws(() => parsePEC('0 nonsense 4'), /未知/);
  assert.throws(() => parsePEC('0 # 2'), /没有音符/);
});

test('native negative note speed, zero size and absent offset remain loadable', () => {
  const chart = parsePEC('bp 0 120 n1 0 2 20 1 0 # -1 & 0');
  assert.equal(chart.offset, 0);
  assert.equal(chart.notes[0].speed, -1);
  assert.equal(chart.notes[0].size, 0);
  assert.equal(new ChartEngine(chart).distance(0, 0, 2), 0);
  assert.deepEqual(semantic(parsePEC(serializePEC(chart))), semantic(chart));
});
