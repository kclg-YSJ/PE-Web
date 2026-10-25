import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const { chromium } = await import(process.env.PE_TEST_PLAYWRIGHT ?? 'playwright');
const browser = await chromium.launch({ channel: process.env.PE_TEST_BROWSER ?? 'msedge', headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
const context = await browser.newContext({ viewport: { width: 1463, height: 1000 }, acceptDownloads: true });
const page = await context.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
const output = resolve('verification');
await mkdir(output, { recursive: true });
const results = [];
const step = async (name, operation) => { await operation(); results.push(name); console.log(`PASS ${name}`); };
const point = async (positionX, positionY) => page.evaluate(({ positionX, positionY }) => ({ x: pe.view.left + positionX * pe.view.scale, y: pe.view.top + (1400 - positionY) * pe.view.scale }), { positionX, positionY });
const move = async (positionX, positionY) => { const position = await point(positionX, positionY); await page.mouse.move(position.x, position.y); };
const click = async (positionX, positionY) => { const position = await point(positionX, positionY); await page.mouse.click(position.x, position.y); };
const count = () => page.evaluate(() => pe.history.chart.notes.length);

try {
  await page.goto(process.env.PE_TEST_URL ?? 'http://127.0.0.1:5179');
  await page.waitForFunction(() => window.pe?.view && !document.querySelector('#loading'));
  await step('selection scene loads the single bundled Climax chart', async () => {
    assert.equal(await page.evaluate(() => pe.library.length), 1);
    assert.equal(await page.evaluate(() => pe.library[0].name), 'Climax');
    await page.evaluate(() => document.querySelector('#toast').classList.remove('visible'));
    await page.screenshot({ path: resolve(output, '01-selection.png') });
    await page.keyboard.press('ArrowRight');
    await page.waitForFunction(() => pe.songIndex === 0 && !pe.busy);
    await page.keyboard.press('ArrowLeft');
    await page.waitForFunction(() => pe.songIndex === 0 && !pe.busy);
  });
  await step('song selection wheel direction matches the native scroll callback', async () => {
    await page.evaluate(() => pe.library.push({ ...pe.library[0], id: 'wheel-test', name: 'Wheel test' }));
    await move(1024, 1000);
    await page.mouse.wheel(0, 120);
    await page.waitForFunction(() => pe.songIndex === 1 && !pe.busy);
    await page.mouse.wheel(0, -120);
    await page.waitForFunction(() => pe.songIndex === 0 && !pe.busy);
    await page.mouse.wheel(120, 0);
    await page.waitForTimeout(80);
    assert.equal(await page.evaluate(() => pe.songIndex), 0);
    await page.evaluate(() => pe.library.pop());
  });
  await step('native chart loads with playable audio', async () => {
    await click(1024, 770);
    await page.waitForFunction(() => pe.scene === 'editor' && !pe.busy);
    await page.keyboard.press('Space');
    assert.equal(await page.evaluate(() => pe.player.playing), false);
    assert.ok(await count() > 300);
    await page.screenshot({ path: resolve(output, '02-preview.png') });
  });
  await step('sprite dimensions and control edge hits use native content scaling', async () => {
    const dimensions = await page.evaluate(() => {
      pe.view.render();
      const save = pe.view.hits.find(hit => hit.label === '保存谱面');
      const checkbox = pe.view.hits.find(hit => hit.label === 'lineVisible');
      const slider = pe.view.hits.find(hit => hit.label === '播放进度');
      return { save: save.width, checkbox: checkbox.width, slider: slider.width, tap: pe.view.textureSize('Tap2.png').width * pe.settings.noteSize / 4 };
    });
    assert.ok(Math.abs(dimensions.save - 122.88) < 1e-6);
    assert.equal(dimensions.checkbox, 56);
    assert.equal(dimensions.slider, 1440);
    assert.equal(dimensions.tap, 247.25);
    await click(1998, 1300);
    await page.waitForFunction(() => pe.savedUntil > performance.now());
    await click(113, 1350);
    assert.equal(await page.evaluate(() => pe.state.lineVisible), true);
    await click(113, 1350);
    await click(1600, 100);
    assert.ok(Math.abs(await page.evaluate(() => pe.player.currentTime / pe.player.duration) - 0.9) < 1e-5);
  });
  await step('Ctrl+0 enters the original note and event editor', async () => {
    await page.keyboard.press('Control+0');
    assert.equal(await page.evaluate(() => pe.state.editing), true);
    await page.evaluate(() => pe.seek(7.2));
    await page.screenshot({ path: resolve(output, '03-editor.png') });
  });
  await step('editor wheel direction and time step match the original timeline', async () => {
    const stepSize = await page.evaluate(() => {
      pe.seek(20);
      return pe.settings.scrollSpeed * 0.0002 * pe.player.duration * pe.player.rate;
    });
    await move(850, 900);
    await page.mouse.wheel(0, 120);
    await page.waitForFunction(() => pe.player.currentTime < 20);
    assert.ok(Math.abs(await page.evaluate(() => pe.player.currentTime) - (20 - stepSize)) < 1e-5);
    await page.mouse.wheel(0, -120);
    await page.waitForFunction(() => Math.abs(pe.player.currentTime - 20) < 1e-5);
    await page.evaluate(() => pe.seek(7.2));
  });
  await step('Q W E and two R presses create all four notes', async () => {
    const before = await count();
    await move(400, 800);
    await page.keyboard.press('q');
    await move(500, 900);
    await page.keyboard.press('w');
    await move(600, 1000);
    await page.keyboard.press('e');
    await move(550, 700);
    await page.keyboard.press('r');
    await move(550, 1100);
    await page.keyboard.press('r');
    assert.equal(await count(), before + 4);
    assert.equal(await page.evaluate(() => pe.history.chart.notes.at(-1).type), 2);
  });
  await step('property controls edit size, speed, side and fake status', async () => {
    await page.evaluate(() => pe.selectObject(pe.history.chart.notes.at(-1).id));
    await page.waitForSelector('#note-size:visible');
    await page.locator('#note-size').fill('1.5');
    await page.locator('#note-size').press('Enter');
    await page.locator('#note-speed').fill('0.75');
    await page.locator('#note-speed').press('Enter');
    await click(1798, 650);
    await click(1798, 480);
    const note = await page.evaluate(() => pe.history.chart.notes.at(-1));
    assert.equal(note.size, 1.5);
    assert.equal(note.speed, 0.75);
    assert.equal(note.side, 2);
    assert.equal(note.fake, true);
    await page.screenshot({ path: resolve(output, '04-note-properties.png') });
  });
  await step('note and event edits support undo and redo', async () => {
    const before = await count();
    await page.keyboard.press('Delete');
    assert.equal(await count(), before - 1);
    await page.keyboard.press('Control+z');
    assert.equal(await count(), before);
    await page.keyboard.press('Control+y');
    assert.equal(await count(), before - 1);
    await page.keyboard.press('Control+z');
  });
  await step('all four event lanes and continuous events work', async () => {
    const before = await page.evaluate(() => pe.history.chart.events.length);
    for (const positionX of [1008, 1136, 1264, 1392]) { await move(positionX, 800); await page.keyboard.press('q'); }
    for (const positionX of [1008, 1136, 1264]) { await move(positionX, 700); await page.keyboard.press('r'); await move(positionX, 1100); await page.keyboard.press('r'); }
    assert.equal(await page.evaluate(() => pe.history.chart.events.length), before + 7);
    await page.evaluate(() => pe.selectObject(pe.history.chart.events.at(-2).id));
    await page.waitForSelector('#event-easing:visible');
    await page.locator('#event-easing').fill('29');
    await page.locator('#event-easing').press('Enter');
    assert.equal(await page.evaluate(() => pe.history.chart.events.at(-2).easing), 29);
    await page.screenshot({ path: resolve(output, '05-event-properties.png') });
  });
  await step('copy and mirror paste preserve properties', async () => {
    await page.evaluate(() => pe.selectObject(pe.history.chart.notes.at(-1).id));
    await page.keyboard.press('Control+c');
    const before = await count();
    await move(500, 1050);
    await page.keyboard.press('Control+b');
    assert.equal(await count(), before + 1);
    assert.equal(await page.evaluate(() => pe.history.chart.notes.at(-1).size), 1.5);
  });
  await step('three-step Ctrl+Q batch generation and history work', async () => {
    await page.keyboard.press('Escape');
    const before = await count();
    await page.keyboard.down('Control');
    await move(300, 600);
    await page.keyboard.press('q');
    await move(650, 1250);
    await page.keyboard.press('q');
    await page.keyboard.up('Control');
    await page.waitForSelector('#batch-step:visible');
    await page.locator('#batch-step').fill('0.25');
    await page.locator('#batch-step').press('Enter');
    await page.keyboard.press('Control+q');
    assert.ok(await count() > before + 2);
  });
  await step('settings, BPM editing and cancel preserve the chart', async () => {
    await page.evaluate(() => pe.showSettings());
    await page.screenshot({ path: resolve(output, '06-settings.png') });
    await click(204.8, 980);
    await page.waitForSelector('#settings-offset:visible');
    await page.locator('#settings-offset').fill('250');
    await page.locator('#settings-offset').press('Enter');
    await page.locator('#bpm-value-0').fill('200');
    await page.locator('#bpm-value-0').press('Enter');
    await page.screenshot({ path: resolve(output, '07-bpm.png') });
    await click(819.2, 140);
    await page.waitForFunction(() => pe.scene === 'editor');
    assert.equal(await page.evaluate(() => pe.history.chart.offset), 250);
    assert.equal(await page.evaluate(() => pe.history.chart.bpms[0].bpm), 200);
  });
  await step('settings wheel moves the layer in the original direction', async () => {
    await page.evaluate(() => pe.showSettings());
    await move(850, 900);
    await page.mouse.wheel(0, 120);
    await page.waitForFunction(() => pe.settingsScroll === 40);
    await page.mouse.wheel(0, -120);
    await page.waitForFunction(() => pe.settingsScroll === 0);
    await click(1228.8, 140);
    await page.waitForFunction(() => pe.scene === 'editor');
  });
  await step('playback pitch speed, pause and progress seek work', async () => {
    await page.keyboard.press('j');
    assert.equal(await page.evaluate(() => pe.player.media.playbackRate), 0.5);
    await page.keyboard.press('k');
    assert.equal(await page.evaluate(() => pe.player.media.playbackRate), 0.75);
    await page.keyboard.press('l');
    await page.keyboard.press('Space');
    const before = await page.evaluate(() => pe.player.currentTime);
    await page.waitForTimeout(250);
    assert.ok(await page.evaluate(() => pe.player.currentTime) > before);
    await page.keyboard.press('Space');
  });
  await step('PEC export downloads a complete valid file', async () => {
    const pending = page.waitForEvent('download');
    await page.keyboard.press('Control+Shift+s');
    const download = await pending;
    const path = resolve(output, 'roundtrip.pec');
    await download.saveAs(path);
    const text = await readFile(path, 'utf8');
    assert.ok(text.startsWith('250\nbp'));
    assert.ok(text.includes('cr '));
  });
  await step('manual save survives a full browser reload', async () => {
    const before = await count();
    await page.keyboard.press('Control+s');
    await page.waitForFunction(() => !pe.dirty);
    await page.reload();
    await page.waitForFunction(() => window.pe && !document.querySelector('#loading'));
    await click(1024, 770);
    await page.waitForFunction(() => pe.scene === 'editor' && !pe.busy);
    assert.equal(await count(), before);
    assert.equal(await page.evaluate(() => pe.history.chart.offset), 250);
  });
  await step('native add-chart form creates a blank editable project', async () => {
    await page.evaluate(() => pe.returnLibrary());
    await click(1930, 1305);
    await page.waitForSelector('#add-name:visible');
    await page.locator('#add-name').fill('Browser regression');
    await page.locator('#add-name').press('Enter');
    await page.locator('#add-level').fill('IN 12');
    await page.locator('#add-level').press('Enter');
    await page.locator('#add-bpm').fill('60');
    await page.locator('#add-bpm').press('Enter');
    await page.screenshot({ path: resolve(output, '08-add-chart.png') });
    await click(1228.8, 84);
    await page.waitForFunction(() => pe.scene === 'select' && pe.library.length === 2);
    await click(1024, 770);
    await page.waitForFunction(() => pe.scene === 'editor' && !pe.busy);
    await page.keyboard.press('Space');
    await page.keyboard.press('Control+0');
    await page.evaluate(() => { pe.seek(0); pe.state.grid = 8; });
    assert.equal(await count(), 0);
    assert.equal(await page.evaluate(() => pe.history.chart.bpms[0].bpm), 60);
  });
  await step('Ctrl drag rectangle selects only objects inside the rectangle', async () => {
    for (const [positionX, positionY] of [[400, 780], [600, 1260], [700, 1260]]) { await move(positionX, positionY); await page.keyboard.press('q'); }
    await page.keyboard.down('Control');
    await move(350, 650);
    await page.mouse.down();
    await move(650, 1330);
    await page.mouse.up();
    await page.keyboard.up('Control');
    assert.equal(await page.evaluate(() => pe.state.selection.size), 2);
  });
  await step('F dragging moves the group and creates one undo operation', async () => {
    const before = await page.evaluate(() => pe.selectedObjects.map(item => ({ id: item.id, beat: item.beat, x: item.x })));
    const undoCount = await page.evaluate(() => pe.history.undoStack.length);
    await page.keyboard.down('f');
    await move(670, 1200);
    await page.keyboard.up('f');
    const after = await page.evaluate(() => pe.selectedObjects.map(item => ({ id: item.id, beat: item.beat, x: item.x })));
    assert.ok(after[0].x !== before[0].x);
    assert.equal(after[0].x - before[0].x, after[1].x - before[1].x);
    assert.equal(await page.evaluate(() => pe.history.undoStack.length), undoCount + 1);
    await page.keyboard.press('Control+z');
    for (const item of before) assert.equal(await page.evaluate(id => pe.history.chart.notes.find(note => note.id === id).x, item.id), item.x);
  });
  await step('native event toggle and anchor controls retain the original coordinates', async () => {
    await click(100, 250);
    assert.equal(await page.evaluate(() => pe.state.showEvents), false);
    await click(768, 700);
    assert.ok(await page.evaluate(() => pe.state.selectedAnchors.size) > 0);
    await move(800, 700);
    await page.keyboard.press('x');
    assert.equal(await page.evaluate(() => pe.state.anchors[2]), 800);
    await page.keyboard.press('z');
    assert.equal(await page.evaluate(() => pe.state.anchors[2]), 768);
    await page.keyboard.press('v');
    assert.equal(await page.evaluate(() => pe.state.attachX), false);
    await page.keyboard.press('v');
    await click(100, 250);
  });
  await step('music and background file imports persist binary media', async () => {
    await page.keyboard.press('F1');
    const pending = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: '更换音乐 / 背景' }).click();
    const chooser = await pending;
    await chooser.setFiles([resolve('assets/original/Climax.mp3'), resolve('assets/original/Climax.jpg')]);
    await page.waitForFunction(() => pe.record.audio?.blob && pe.record.image?.blob && !pe.dirty);
    assert.ok(await page.evaluate(() => pe.record.audio.blob.size) > 1000000);
  });
  await step('portable project contains music, background and an intact chart', async () => {
    await page.keyboard.press('F1');
    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name: '导出完整项目' }).click();
    const download = await pending;
    const path = resolve(output, 'portable.peweb');
    await download.saveAs(path);
    const portable = JSON.parse(await readFile(path, 'utf8'));
    assert.equal(portable.schema, 'phiediter-pe-web/1');
    assert.ok(portable.record.audio.data.startsWith('data:audio/'));
    assert.ok(portable.record.image.data.startsWith('data:image/'));
    assert.equal(portable.record.chart.notes.length, 3);
    await page.keyboard.press('F1');
    const pendingChooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: '导入 PEC / 项目' }).click();
    const chooser = await pendingChooser;
    await chooser.setFiles(path);
    await page.waitForFunction(() => pe.scene === 'select' && pe.library.length === 3);
    await click(1024, 770);
    await page.waitForFunction(() => pe.scene === 'editor' && !pe.busy);
    await page.keyboard.press('Space');
    assert.equal(await count(), 3);
    assert.ok(await page.evaluate(() => pe.record.audio.blob.size) > 1000000);
  });
  await step('real 30-second autosave fires and recovery is undoable', async () => {
    await page.evaluate(() => pe.mutate('autosave test', chart => chart.offset = 1234));
    const deadline = Date.now() + 35000;
    let autosaved = false;
    while (Date.now() < deadline && !autosaved) {
      autosaved = await page.evaluate(async () => (await pe.store.get('autosaves', pe.record.id))?.chart.offset === 1234);
      if (!autosaved) await page.waitForTimeout(500);
    }
    assert.equal(autosaved, true, '30-second interval did not save the edited chart');
    await page.evaluate(() => pe.mutate('later test', chart => chart.offset = 4321));
    await page.evaluate(() => pe.webAction('restore'));
    assert.equal(await page.evaluate(() => pe.history.chart.offset), 1234);
    await page.keyboard.press('Control+z');
    assert.equal(await page.evaluate(() => pe.history.chart.offset), 4321);
  });
  assert.deepEqual(errors, []);
  await writeFile(resolve(output, 'browser-results.json'), JSON.stringify({ passed: results.length, results, errors, date: new Date().toISOString() }, null, 2));
  console.log(`Browser checks passed: ${results.length}`);
} finally {
  await browser.close();
}
