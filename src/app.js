import { WIDTH, HEIGHT, DEFAULT_SETTINGS, ChartEngine, History, clone, uid, clamp, createChart, parsePEC, serializePEC, validateChart, normalizeBpms, isDuration, eventLane, pasteObjects, generateNotes } from './core.js';
import { NativeView } from './view.js';
import { AudioPlayer } from './audio.js';
import { ProjectStore, downloadFile, toPortable, fromPortable } from './storage.js';

const resourceURL = path => `./assets/original/${path.split(/[\\/]/).map(encodeURIComponent).join('/')}`;
const cleanName = name => name.replace(/\.[^.]+$/, '');
const imageFile = file => file.type.startsWith('image/') || /\.(png|jpe?g|webp|bmp)$/i.test(file.name);
const audioFile = file => file.type.startsWith('audio/') || /\.(mp3|ogg|wav|m4a|flac|aac)$/i.test(file.name);

class PhiEditer {
  constructor() {
    this.scene = 'select';
    this.songIndex = 0;
    this.library = [];
    this.player = new AudioPlayer();
    this.player.onError = error => this.toast(error.message);
    this.effects = [];
    this.keys = new Set();
    this.pointer = { x: 500, y: 700 };
    this.savedUntil = 0;
    this.busy = false;
    this.clipboard = [];
    this.resetState();
  }
  resetState() {
    this.state = { line: -1, editing: false, lineVisible: false, hideUnselected: false, hideNote: false, hideAll: false, showEvents: true, openPreview: true, attach: true, attachX: true, eventAnchor: false, anchorSlider: 6000, grid: 1, selection: new Set(), selectedAnchors: new Set(), anchors: [], pending: null, batch: null, box: null, confirmQuit: false };
    this.resetAnchors();
  }
  resetAnchors() {
    const count = this.settings?.anchorCount ?? 7;
    this.state.anchors = Array.from({ length: count }, (_, index) => WIDTH / (count + 1) * (index + 1));
    this.state.selectedAnchors.clear();
  }
  async init() {
    const response = await fetch('./assets/catalog.json');
    if (!response.ok) throw new Error('缺少资源目录，请使用 start.cmd 启动项目。');
    const catalog = await response.json();
    this.store = await new ProjectStore().open();
    this.settings = { ...DEFAULT_SETTINGS, ...catalog.settings, ...await this.store.get('preferences', 'settings') };
    this.view = new NativeView(this, catalog);
    await this.view.preload();
    this.library = catalog.songs.map((song, index) => ({ id: `builtin-${index}`, name: song.name, level: song.level, composer: song.composer, charter: song.charter, chartPath: resourceURL(song.chart), chartName: song.chart, audio: { name: song.audio, url: resourceURL(song.audio) }, image: { name: song.image, url: resourceURL(song.image) } }));
    const records = await this.store.all('projects');
    for (const record of records) {
      const index = this.library.findIndex(song => song.id === record.id);
      if (index >= 0) this.library[index] = record;
      else this.library.push(record);
    }
    this.bindEvents();
    this.resetAnchors();
    await this.showSong(false);
    this.autosaveTimer = setInterval(() => {
      if (this.record && this.dirty) this.store.save(this.snapshot(), true).catch(error => this.toast(`自动保存失败：${error.message}`));
    }, this.settings.autosaveSeconds * 1000);
    document.querySelector('#loading').remove();
    this.installHelp();
    this.frame = this.frame.bind(this);
    requestAnimationFrame(this.frame);
    window.pe = this;
  }
  get chartTime() { return this.player.currentTime + (this.history?.chart.offset ?? 0) / 1000; }
  get cursorBeat() {
    if (!this.engine) return 0;
    const seconds = this.chartTime + (this.pointer.y - 300) / (this.settings.barlineSpeed * 120);
    const beat = this.engine.tempo.toBeat(seconds);
    if (!this.state.attach) return beat;
    const lower = Math.floor(beat * this.state.grid) / this.state.grid;
    const upper = lower + 1 / this.state.grid;
    return Math.abs(this.engine.tempo.toSeconds(lower) - seconds) <= Math.abs(this.engine.tempo.toSeconds(upper) - seconds) ? lower : upper;
  }
  get cursorRegion() {
    const scale = this.state.showEvents ? 0.25 : 0.8;
    const center = this.state.showEvents ? 500 : WIDTH / 2;
    if (Math.abs(this.pointer.x - center) <= WIDTH * scale / 2) return 'note';
    if (this.state.showEvents && Math.abs(this.pointer.x - 1200) <= WIDTH * scale / 2) return 'event';
    return null;
  }
  get cursorX() {
    const center = this.state.showEvents ? 500 : WIDTH / 2;
    const scale = this.state.showEvents ? 0.25 : 0.8;
    let positionX = (this.pointer.x - center) / scale;
    if (!this.state.showEvents && this.state.attachX && this.state.anchors.length) {
      const closest = this.state.anchors.reduce((first, second) => Math.abs(first - this.pointer.x) < Math.abs(second - this.pointer.x) ? first : second);
      positionX = (closest - center) / scale;
    }
    return clamp(positionX, -1024, 1024);
  }
  get selectedObjects() {
    if (!this.history) return [];
    return [...this.history.chart.notes, ...this.history.chart.events].filter(item => this.state.selection.has(item.id));
  }
  toast(message, duration = 3500) {
    const element = document.querySelector('#toast');
    element.textContent = message;
    element.classList.add('visible');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => element.classList.remove('visible'), duration);
  }
  async execute(operation) {
    try { return await operation(); }
    catch (error) { console.error(error); this.toast(error.message, 6000); }
  }
  async showSong(play = true) {
    const record = this.library[this.songIndex];
    await this.player.load(record.audio);
    this.player.setRate(1);
    this.player.setVolumes(1, this.settings.seVolume);
    await this.view.background(record.image);
    if (play) await this.player.play().catch(error => { if (error.name !== 'NotAllowedError') throw error; });
  }
  async cycleSong(direction) {
    if (this.busy || !this.library.length) return;
    this.busy = true;
    try {
      this.songIndex = (this.songIndex + direction + this.library.length) % this.library.length;
      this.scene = 'select';
      await this.showSong();
    } finally { this.busy = false; }
  }
  async enterSong() {
    if (this.busy) return;
    this.busy = true;
    try {
      this.player.pause();
      const record = clone(this.library[this.songIndex]);
      if (!record.chart) {
        const response = await fetch(record.chartPath);
        if (!response.ok) throw new Error(`谱面读取失败：${record.chartName}`);
        record.chart = parsePEC(await response.text());
      }
      validateChart(record.chart);
      this.record = record;
      this.player.setRate(1);
      this.player.setVolumes(this.settings.bgmVolume, this.settings.seVolume);
      this.history = new History(clone(record.chart));
      this.rebuild();
      this.resetState();
      this.effects = [];
      this.scene = 'editor';
      this.dirty = false;
      this.player.seek(0);
      this.previousTime = this.chartTime - 1e-6;
      this.player.durationFallback = this.engine.lastSecond + 5;
      await this.player.play().catch(error => { if (error.name === 'NotAllowedError') this.toast('按空格开始播放。'); else throw error; });
      const autosave = await this.store.get('autosaves', record.id);
      if (autosave && (!record.savedAt || autosave.savedAt > record.savedAt)) this.toast('发现较新的自动保存，可按 F1 → 恢复自动保存。', 6000);
    } finally { this.busy = false; }
  }
  rebuild() {
    this.engine = new ChartEngine(this.history.chart);
    this.record.chart = this.history.chart;
    this.player.durationFallback = Math.max(20, this.engine.lastSecond + 5);
  }
  mutate(label, mutation) {
    try {
      if (this.history.transact(label, mutation)) {
        this.dirty = true;
        this.rebuild();
      }
    } catch (error) {
      this.rebuild();
      throw error;
    }
  }
  updateObject(id, key, value) {
    this.mutate('修改属性', chart => {
      const item = [...chart.notes, ...chart.events].find(item => item.id === id);
      if (!item) return;
      item[key] = value;
      if (key === 'beat' && !isDuration(item.kind) && item.type !== 2) item.endBeat = value;
    });
  }
  selectLine(line) {
    if (!Number.isInteger(line) || line < 0 || line > 999) return;
    this.state.line = line;
    this.state.selection.clear();
    this.state.pending = null;
  }
  selectObject(id, append = false) {
    this.player.pause();
    if (!append) this.state.selection.clear();
    if (append && this.state.selection.has(id)) this.state.selection.delete(id);
    else this.state.selection.add(id);
    this.state.pending = null;
  }
  selectAnchor(index) {
    this.player.pause();
    this.state.selection.clear();
    if (this.state.selectedAnchors.has(index)) this.state.selectedAnchors.delete(index);
    else this.state.selectedAnchors.add(index);
  }
  async togglePlay() {
    if (this.player.playing) this.player.pause();
    else { this.previousTime = this.chartTime - 1e-6; await this.player.play(); }
  }
  seek(seconds) {
    this.player.pause();
    this.player.seek(seconds);
    this.previousTime = this.chartTime;
    this.effects = [];
  }
  snapshot() { return { ...clone(this.record), chart: clone(this.history.chart) }; }
  async save(exportPEC = false) {
    if (!this.record) return;
    const snapshot = this.snapshot();
    snapshot.savedAt = await this.store.save(snapshot);
    this.record.savedAt = snapshot.savedAt;
    const index = this.library.findIndex(song => song.id === snapshot.id);
    if (index >= 0) this.library[index] = snapshot;
    else this.library.push(snapshot);
    this.dirty = false;
    this.savedUntil = performance.now() + 1200;
    if (exportPEC) downloadFile(this.record.chartName ?? `${this.record.name}.pec`, serializePEC(this.history.chart));
  }
  async returnLibrary() {
    if (this.record) await this.save();
    this.player.pause();
    this.scene = 'select';
    this.state.confirmQuit = false;
    this.state.editing = false;
    this.record = null;
    await this.showSong();
  }
  showAdd() {
    this.player.pause();
    this.newSong = { name: '', audio: null, image: null, level: '', composer: '', charter: '', bpm: 120 };
    this.scene = 'add';
  }
  async cancelAdd() { this.scene = 'select'; await this.showSong(); }
  pickFiles(accept = '', multiple = true, directory = false) {
    return new Promise(resolve => {
      const input = document.querySelector('#file-input');
      input.value = '';
      input.accept = accept;
      input.multiple = multiple;
      input.webkitdirectory = directory;
      input.onchange = () => resolve([...input.files]);
      input.oncancel = () => resolve([]);
      input.click();
    });
  }
  async pickForNew(kind) {
    const files = await this.pickFiles(kind === 'audio' ? 'audio/*,.ogg,.flac' : 'image/*', false);
    if (files[0]) this.newSong[kind] = { name: files[0].name, blob: files[0] };
  }
  async createSong() {
    for (const field of this.view.fields.values()) if (field.id.startsWith('add-') && !field.readOnly) field.commit(field.value);
    const song = this.newSong;
    if (!song.name.trim()) throw new Error('请填写谱面名称。');
    if (!(Number(song.bpm) > 0)) throw new Error('BPM 必须大于 0。');
    const record = { id: uid(), name: song.name.trim(), level: song.level, composer: song.composer, charter: song.charter, audio: song.audio, image: song.image, chart: createChart(Number(song.bpm)), chartName: `${song.name.trim()}.pec` };
    await this.store.save(record);
    this.library.push(record);
    this.songIndex = this.library.length - 1;
    this.scene = 'select';
    await this.showSong();
  }
  async importFiles(files) {
    if (!files.length) return;
    const imported = [];
    for (const file of files) {
      if (/\.peweb$/i.test(file.name)) {
        const record = await fromPortable(await file.text());
        validateChart(record.chart);
        record.id = uid();
        imported.push(record);
      } else if (/\.pec$/i.test(file.name)) {
        const chart = parsePEC(await file.text());
        const stem = cleanName(file.name).toLowerCase();
        const matching = files.filter(item => cleanName(item.name).toLowerCase() === stem);
        const music = matching.find(audioFile) ?? files.find(audioFile);
        const image = matching.find(imageFile) ?? files.find(imageFile);
        imported.push({ id: uid(), name: cleanName(file.name), level: '', composer: '', charter: '', chartName: file.name, chart, audio: music ? { name: music.name, blob: music } : null, image: image ? { name: image.name, blob: image } : null });
      }
    }
    if (!imported.length) {
      if (!this.record) throw new Error('请同时选择 PEC 谱面，或先进入一个谱面再更换素材。');
      const music = files.find(audioFile);
      const image = files.find(imageFile);
      if (music) { this.record.audio = { name: music.name, blob: music }; await this.player.load(this.record.audio); }
      if (image) { this.record.image = { name: image.name, blob: image }; await this.view.background(this.record.image); }
      this.dirty = true;
      await this.save();
      this.toast('素材已保存。');
      return;
    }
    if (this.record) await this.save();
    for (const record of imported) { await this.store.save(record); this.library.push(record); }
    this.record = null;
    this.songIndex = this.library.length - imported.length;
    this.scene = 'select';
    await this.showSong(false);
    this.toast(`已导入 ${imported.length} 个谱面。`);
  }
  showSettings() {
    if (!this.record) { this.toast('请先进入谱面。'); return; }
    this.player.pause();
    this.settingsDraft = clone(this.settings);
    this.chartDraft = { offset: this.history.chart.offset, bpms: clone(this.history.chart.bpms) };
    this.settingsScroll = 0;
    this.settingsTab = 1;
    this.scene = 'settings';
  }
  async applySettings() {
    for (const field of this.view.fields.values()) if (field.style.display !== 'none' && document.activeElement === field) field.commit(field.value);
    const draft = this.settingsDraft;
    if (![draft.width, draft.height, draft.barlineSpeed, draft.scrollSpeed].every(value => Number.isFinite(value) && value > 0)) throw new Error('窗口尺寸、滚动速度必须为正数。');
    if (!Number.isInteger(draft.width) || !Number.isInteger(draft.height) || draft.width < 320 || draft.width > 8192 || draft.height < 240 || draft.height > 8192) throw new Error('画布分辨率应为 320–8192 × 240–8192 范围内的整数。');
    if (!Number.isInteger(draft.anchorCount) || draft.anchorCount < 0 || draft.anchorCount > 100) throw new Error('辅助线数量必须为 0–100 的整数。');
    if (!(draft.noteSize > 0) || !Number.isFinite(draft.lineWidth)) throw new Error('音符尺寸必须大于 0。');
    const bpms = normalizeBpms(this.chartDraft.bpms).map(({ beat, bpm }) => ({ beat, bpm }));
    this.mutate('BPM 与 Offset 设置', chart => { chart.offset = this.chartDraft.offset; chart.bpms = bpms; });
    this.settings = clone(draft);
    this.player.setVolumes(this.settings.bgmVolume, this.settings.seVolume);
    this.resetAnchors();
    await this.store.put('preferences', 'settings', this.settings);
    this.scene = 'editor';
    this.view.resize();
  }
  cancelSettings() { this.scene = 'editor'; }
  async resetSettings() { this.settingsDraft = { ...DEFAULT_SETTINGS }; await this.applySettings(); }
  addAtPointer(type, control = false) {
    if (!this.state.editing || this.state.line < 0 || this.pointer.y < 300 || this.pointer.y > HEIGHT) return;
    const region = this.cursorRegion;
    if (!region) return;
    this.player.pause();
    const beat = this.cursorBeat;
    if (region === 'event') {
      if (type !== 1 && type !== 2) return;
      const lane = clamp(Math.floor((this.pointer.x - (1200 - 256)) / 128), 0, 3);
      const kind = (type === 2 ? ['cm', 'cr', 'cf', null] : ['cp', 'cd', 'ca', 'cv'])[lane];
      if (!kind) return;
      const line = this.engine.lineAt(this.state.line, this.engine.tempo.toSeconds(beat));
      const values = lane === 0 ? [line.x, line.y] : [lane === 1 ? line.angle : lane === 2 ? line.alpha : line.speed];
      if (type === 2) {
        if (!this.state.pending?.kind) { this.state.pending = { kind, line: this.state.line, beat, endBeat: beat, values, easing: 1 }; return; }
        const pending = this.state.pending;
        if (Math.abs(beat - pending.beat) < 1e-8) return;
        this.mutate('新增持续事件', chart => chart.events.push({ ...pending, id: uid(), beat: Math.min(pending.beat, beat), endBeat: Math.max(pending.beat, beat) }));
        this.state.pending = null;
      } else this.mutate('新增突变事件', chart => chart.events.push({ id: uid(), kind, line: this.state.line, beat, endBeat: beat, values, easing: 1 }));
      this.state.selection.clear();
      return;
    }
    const positionX = this.cursorX;
    if (type === 2) {
      if (!this.state.pending || this.state.pending.kind) { this.state.pending = { type: 2, beat, x: positionX, line: this.state.line }; return; }
      const pending = this.state.pending;
      if (Math.abs(beat - pending.beat) < 1e-8) return;
      this.mutate('新增 Hold', chart => chart.notes.push({ id: uid(), type, line: pending.line, beat: Math.min(beat, pending.beat), endBeat: Math.max(beat, pending.beat), x: pending.x, side: 1, fake: false, speed: 1, size: 1 }));
      this.state.pending = null;
    } else {
      if (control && this.state.batch?.stage === 2) {
        const batch = this.state.batch;
        this.mutate('批量生成音符', chart => {
          const temporary = { notes: [] };
          generateNotes(temporary, { startBeat: batch.startBeat, endBeat: batch.endBeat, startX: batch.startX, endX: batch.endX, step: batch.step, easingType: batch.easing, line: this.state.line, type });
          chart.notes.push(...temporary.notes.filter(note => note.beat > batch.startBeat + 1e-8 && note.beat < batch.endBeat - 1e-8));
        });
        this.state.batch = null;
        return;
      }
      this.mutate('新增音符', chart => chart.notes.push({ id: uid(), type, line: this.state.line, beat, endBeat: beat, x: positionX, side: 1, fake: false, speed: 1, size: 1 }));
      if (control) {
        if (!this.state.batch) this.state.batch = { stage: 1, startBeat: beat, startX: positionX, step: 0.25, easing: 1 };
        else if (this.state.batch.stage === 1) {
          const batch = this.state.batch;
          batch.endBeat = beat;
          batch.endX = positionX;
          if (batch.endBeat < batch.startBeat) { [batch.startBeat, batch.endBeat] = [batch.endBeat, batch.startBeat]; [batch.startX, batch.endX] = [batch.endX, batch.startX]; }
          batch.stage = 2;
        }
      }
    }
    this.state.selection.clear();
  }
  deleteSelection() {
    if (!this.state.selection.size) return;
    this.mutate('删除所选对象', chart => {
      chart.notes = chart.notes.filter(item => !this.state.selection.has(item.id));
      chart.events = chart.events.filter(item => !this.state.selection.has(item.id));
    });
    this.state.selection.clear();
  }
  copySelection() {
    if (this.selectedObjects.length) this.clipboard = clone(this.selectedObjects);
  }
  pasteSelection(mirror = false) {
    const objects = this.clipboard.length ? this.clipboard : clone(this.selectedObjects);
    if (!objects.length || !this.state.editing || this.state.line < 0) return;
    let ids = [];
    this.mutate(mirror ? '镜像粘贴' : '粘贴', chart => ids = pasteObjects(chart, objects, this.cursorBeat, this.state.line, mirror));
    this.state.selection = new Set(ids);
  }
  undo(redo = false) {
    const label = redo ? this.history.redo() : this.history.undo();
    if (label) { this.rebuild(); this.dirty = true; this.state.selection.clear(); this.toast(`${redo ? '重做' : '撤销'}：${label}`, 1200); }
  }
  escape() {
    this.pressedHit = null;
    if (document.querySelector('#web-tools').open) { document.querySelector('#web-tools').close(); return; }
    if (this.scene === 'settings') { this.cancelSettings(); return; }
    if (this.scene === 'add') { this.execute(() => this.cancelAdd()); return; }
    if (this.scene !== 'editor') return;
    if (this.state.confirmQuit) { this.state.confirmQuit = false; return; }
    if (this.state.pending || this.state.batch || this.state.box || this.state.selection.size || this.state.selectedAnchors.size) {
      this.state.pending = null;
      this.state.batch = null;
      this.state.box = null;
      this.state.selection.clear();
      this.state.selectedAnchors.clear();
    } else if (this.state.editing) this.state.editing = false;
    else if (this.state.line >= 0) this.state.line = -1;
    else { this.player.pause(); this.state.confirmQuit = true; }
  }
  finishBox() {
    const box = this.state.box;
    if (!box) return;
    const seconds = this.chartTime + (this.pointer.y - 300) / (this.settings.barlineSpeed * 120);
    const beat = this.engine.tempo.toBeat(seconds);
    const minimumBeat = Math.min(box.beat, beat);
    const maximumBeat = Math.max(box.beat, beat);
    const minimumX = Math.min(box.x, this.pointer.x);
    const maximumX = Math.max(box.x, this.pointer.x);
    const scale = this.state.showEvents ? 0.25 : 0.8;
    const center = this.state.showEvents ? 500 : WIDTH / 2;
    const objects = box.region === 'event' ? this.history.chart.events : this.history.chart.notes;
    this.state.selection.clear();
    for (const item of objects) {
      if (item.line !== this.state.line || item.beat > maximumBeat || item.endBeat < minimumBeat) continue;
      const positionX = item.type ? center + scale * item.x : 1200 + scale * WIDTH * (-0.375 + eventLane(item.kind) * 0.25);
      if (positionX >= minimumX && positionX <= maximumX) this.state.selection.add(item.id);
    }
    this.state.box = null;
  }
  beginDrag() {
    if (!this.selectedObjects.length || this.dragSnapshot) return;
    this.player.pause();
    this.dragSnapshot = clone(this.history.chart);
    const selected = this.selectedObjects;
    this.dragOrigin = selected.length === 1 && selected[0].type ? { beat: selected[0].beat, x: selected[0].x } : { beat: this.cursorBeat, x: this.cursorX };
    this.updateDrag();
  }
  updateDrag() {
    if (!this.dragSnapshot) return;
    const beatDelta = this.cursorBeat - this.dragOrigin.beat;
    const xDelta = this.cursorX - this.dragOrigin.x;
    const original = [...this.dragSnapshot.notes, ...this.dragSnapshot.events];
    for (const item of this.selectedObjects) {
      const before = original.find(source => source.id === item.id);
      item.beat = before.beat + beatDelta;
      item.endBeat = before.endBeat + beatDelta;
      if (item.type) item.x = before.x + xDelta;
    }
    this.rebuild();
  }
  finishDrag() {
    if (!this.dragSnapshot) return;
    if (JSON.stringify(this.dragSnapshot) !== JSON.stringify(this.history.chart)) {
      this.history.undoStack.push({ label: '拖动对象', chart: this.dragSnapshot });
      this.history.redoStack.length = 0;
      this.dirty = true;
    }
    this.dragSnapshot = null;
  }
  pickFromPreview() {
    const selected = this.selectedObjects;
    if (selected.length !== 1) return;
    const item = selected[0];
    let positionX = this.pointer.x;
    let positionY = this.pointer.y;
    if (this.state.eventAnchor) {
      const gap = Math.max(500 - 0.05 * this.state.anchorSlider, 50);
      positionX = 1024 + Math.round((positionX - 1024) / gap) * gap;
      positionY = 700 + Math.round((positionY - 700) / gap) * gap;
    }
    if (item.type) {
      const line = this.engine.lineAt(item.line, this.chartTime);
      const angle = -line.angle * Math.PI / 180;
      this.updateObject(item.id, 'x', (positionX - line.x) * Math.cos(angle) + (positionY - line.y) * Math.sin(angle));
    } else if (['cp', 'cm'].includes(item.kind)) this.updateObject(item.id, 'values', [positionX, positionY]);
    else if (['cd', 'cr'].includes(item.kind)) {
      const line = this.engine.lineAt(item.line, this.chartTime);
      this.updateObject(item.id, 'values', [-Math.atan2(positionY - line.y, positionX - line.x) * 180 / Math.PI]);
    }
  }
  mirrorEvent(axis) {
    const selected = this.selectedObjects.filter(item => !item.type);
    if (!selected.length) return;
    this.mutate('变换事件目标', () => {
      for (const item of selected) {
        if (['cp', 'cm'].includes(item.kind)) item.values[axis] = (axis === 0 ? WIDTH : HEIGHT) - item.values[axis];
        if (axis === 0 && ['cd', 'cr'].includes(item.kind)) item.values[0] = -item.values[0];
        if (['ca', 'cf'].includes(item.kind)) item.values[0] = axis === 0 ? 0 : 255;
      }
    });
  }
  bindEvents() {
    const canvas = this.view.canvas;
    canvas.addEventListener('contextmenu', event => event.preventDefault());
    canvas.addEventListener('pointerdown', event => this.execute(async () => {
      this.pointer = this.view.point(event);
      this.pointerDown = { ...this.pointer };
      canvas.focus();
      if (event.button === 2) { this.escape(); return; }
      if (event.button !== 0) return;
      if (this.scene === 'editor' && this.state.editing && event.ctrlKey && this.cursorRegion) {
        this.player.pause();
        if (this.state.box) this.finishBox();
        else this.state.box = { x: this.pointer.x, beat: this.engine.tempo.toBeat(this.chartTime + (this.pointer.y - 300) / (this.settings.barlineSpeed * 120)), region: this.cursorRegion };
        return;
      }
      this.view.render();
      const hit = this.view.hit(this.pointer);
      if (hit) {
        if (hit.kind === 'slider') { this.activeSlider = hit; hit.action(hit.valueAt(this.pointer)); canvas.setPointerCapture(event.pointerId); }
        else if (hit.kind === 'button' || hit.kind === 'line') this.pressedHit = hit;
        else if (event.shiftKey && ['note', 'event'].includes(hit.kind)) this.selectObject(hit.id, true);
        else await hit.action();
      }
    }));
    canvas.addEventListener('pointermove', event => {
      this.pointer = this.view.point(event);
      if (this.activeSlider) this.activeSlider.action(this.activeSlider.valueAt(this.pointer));
      if (this.dragSnapshot) this.updateDrag();
      canvas.style.cursor = this.view.hit(this.pointer) ? 'pointer' : 'default';
    });
    canvas.addEventListener('pointerup', event => {
      this.activeSlider = null;
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
      const pressed = this.pressedHit;
      this.pressedHit = null;
      if (pressed && this.view.contains(pressed, this.pointer)) this.execute(() => pressed.action());
      if (this.state.box && this.pointerDown && Math.hypot(this.pointer.x - this.pointerDown.x, this.pointer.y - this.pointerDown.y) > 8) this.finishBox();
      this.pointerDown = null;
    });
    canvas.addEventListener('dblclick', () => {
      if (this.scene === 'editor' && this.state.line >= 0) { this.player.pause(); this.state.editing = true; }
    });
    canvas.addEventListener('wheel', event => {
      event.preventDefault();
      const direction = Math.sign(event.deltaY);
      if (!direction) return;
      if (this.scene === 'select') this.execute(() => this.cycleSong(direction));
      if (this.scene === 'settings') this.settingsScroll = clamp(this.settingsScroll + direction * 40, -5000, 5000);
      if (this.scene === 'editor') this.seek(this.player.currentTime - direction * this.settings.scrollSpeed * 0.0002 * this.player.duration * this.player.rate);
    }, { passive: false });
    addEventListener('keydown', event => this.execute(() => this.keydown(event)));
    addEventListener('keyup', event => {
      this.keys.delete(event.code);
      if (event.code === 'KeyF') this.finishDrag();
      if (event.key === 'Control') this.firstDigit = null;
    });
    addEventListener('blur', () => { this.keys.clear(); this.firstDigit = null; this.pressedHit = null; this.finishDrag(); this.player.pause(); });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) { this.keys.clear(); this.finishDrag(); this.player.pause(); if (this.record && this.dirty) this.execute(() => this.store.save(this.snapshot(), true)); }
    });
    addEventListener('beforeunload', event => { if (this.dirty) { event.preventDefault(); event.returnValue = ''; } });
    document.addEventListener('dragover', event => event.preventDefault());
    document.addEventListener('drop', event => { event.preventDefault(); this.execute(() => this.importFiles([...event.dataTransfer.files])); });
    document.querySelector('#close-tools').onclick = () => document.querySelector('#web-tools').close();
    document.querySelector('#web-tools').addEventListener('click', event => {
      const action = event.target.dataset.action;
      if (action) this.execute(() => this.webAction(action));
    });
  }
  async keydown(event) {
    const typing = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement;
    const key = event.key.toLowerCase();
    const control = event.ctrlKey || event.metaKey;
    if (key === 'f1') { event.preventDefault(); this.player.pause(); const dialog = document.querySelector('#web-tools'); if (dialog.open) dialog.close(); else dialog.showModal(); return; }
    if (typing) {
      if (control && key === 's' && this.scene === 'editor') { event.preventDefault(); event.target.blur(); await this.save(event.shiftKey); }
      return;
    }
    if (document.querySelector('#web-tools').open) return;
    if ([' ', 'enter', 'escape', 'delete', 'arrowleft', 'arrowright', 'arrowup', 'arrowdown'].includes(key) || (control && /^[0-9a-z]$/.test(key))) event.preventDefault();
    this.keys.add(event.code);
    if (key === 'escape') { this.escape(); return; }
    if (this.scene === 'select') {
      if (key === 'arrowleft' || key === 'arrowright') await this.cycleSong(key === 'arrowleft' ? -1 : 1);
      if (key === 'enter') await this.enterSong();
      if (control && key === 'o') await this.webAction('import');
      return;
    }
    if (this.scene === 'add') { if (key === 'enter') await this.createSong(); return; }
    if (this.scene === 'settings') { if (key === 'enter') await this.applySettings(); return; }
    if (this.scene !== 'editor') return;
    if (control) {
      if (key === 's') { await this.save(event.shiftKey); return; }
      if (key === 'o') { await this.webAction('import'); return; }
      if (key === 'z') { this.undo(event.shiftKey); return; }
      if (key === 'y') { this.undo(true); return; }
      if (key === 'c') { this.copySelection(); return; }
      if (key === 'x') { this.copySelection(); this.deleteSelection(); return; }
      if (key === 'v' || key === 'b') { this.pasteSelection(key === 'b' || event.shiftKey); return; }
      if (key === 'a') { this.state.selection = new Set([...this.history.chart.notes, ...this.history.chart.events].filter(item => item.line === this.state.line).map(item => item.id)); return; }
      if (/^\d$/.test(key)) {
        const digit = Number(key);
        const line = this.firstDigit == null ? digit : this.firstDigit * 10 + digit;
        this.firstDigit = this.firstDigit == null ? digit : null;
        this.selectLine(line);
        this.player.pause();
        this.state.editing = true;
        return;
      }
    }
    if (key === ' ') { await this.togglePlay(); return; }
    if (key === 'n') { this.state.openPreview = !this.state.openPreview; return; }
    if (key === 'enter' && this.state.line >= 0) { this.player.pause(); this.state.editing = true; return; }
    if (['j', 'k', 'l'].includes(key)) { this.player.setRate({ j: 0.5, k: 0.75, l: 1 }[key]); return; }
    if (key === 'o' || key === 'p') { this.settings.scrollSpeed = Math.max(1, this.settings.scrollSpeed + (key === 'o' ? -1 : 1)); return; }
    if (!this.settings.editMode || !this.state.editing) return;
    if (['q', 'w', 'e', 'r'].includes(key)) { if (!event.repeat) this.addAtPointer({ q: 1, w: 4, e: 3, r: 2 }[key], control); return; }
    if (key === 'delete' || key === 'backspace') { this.deleteSelection(); return; }
    if (key === 'f') { this.beginDrag(); return; }
    if (key === 'm') { this.pickFromPreview(); return; }
    if (key === 'a' || key === 's') { this.mirrorEvent(key === 'a' ? 0 : 1); return; }
    if (key === 'v') { this.state.attachX = !this.state.attachX; return; }
    if (key === 'z') { this.resetAnchors(); return; }
    if ((key === 'x' || key === 'c') && this.state.selectedAnchors.size) {
      const first = [...this.state.selectedAnchors][0];
      const delta = this.pointer.x - this.state.anchors[first];
      for (const index of this.state.selectedAnchors) this.state.anchors[index] += key === 'x' || index === first ? delta : -delta;
      return;
    }
    if (['arrowleft', 'arrowright', 'arrowdown', 'arrowup'].includes(key) && this.state.selection.size) {
      this.mutate('移动所选音符', () => {
        for (const item of this.selectedObjects) {
          if (!item.type) continue;
          if (key === 'arrowdown') item.side = item.side === 1 ? 2 : 1;
          else if (key === 'arrowleft' || key === 'arrowright') item.x += key === 'arrowleft' ? -50 : 50;
          else { item.beat += 1 / this.state.grid; item.endBeat += 1 / this.state.grid; }
        }
      });
    }
  }
  async webAction(action) {
    document.querySelector('#web-tools').close();
    if (action === 'import') await this.importFiles(await this.pickFiles('.pec,.peweb,audio/*,image/*,.ogg,.flac'));
    if (action === 'media') await this.importFiles(await this.pickFiles('audio/*,image/*,.ogg,.flac'));
    if (action === 'export') { if (!this.record) throw new Error('请先进入谱面。'); await this.save(true); }
    if (action === 'backup') {
      if (!this.record) throw new Error('请先进入谱面。');
      await this.save();
      downloadFile(`${this.record.name}.peweb`, await toPortable(this.snapshot()), 'application/json');
    }
    if (action === 'restore') {
      if (!this.record) throw new Error('请先进入谱面。');
      const record = await this.store.get('autosaves', this.record.id);
      if (!record) throw new Error('此谱面没有自动保存。');
      validateChart(record.chart);
      this.mutate('恢复自动保存', chart => Object.assign(chart, clone(record.chart)));
      this.toast(`已恢复 ${new Date(record.savedAt).toLocaleString()} 的自动保存。`);
    }
    if (action === 'settings') this.showSettings();
    if (action === 'library') await this.returnLibrary();
    if (action === 'fullscreen') { if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); }
  }
  installHelp() {
    const entries = [
      ['← / →，滚轮', '选曲页面切换歌曲；点击封面或 Enter 进入'],
      ['Space', '播放 / 暂停；滚轮移动时间轴'],
      ['点击判定线 → Enter', '选择判定线并进入编辑；Ctrl + 数字直接选择'],
      ['Ctrl + 两位数字', '按住 Ctrl 连按数字选择 10–99 号判定线'],
      ['Q / W / E', '在鼠标处放置 Tap / Drag / Flick'],
      ['R → R', '放置 Hold 的起点与终点'],
      ['事件栏 Q / R', 'Q 放置突变事件；R 两次放置持续事件'],
      ['Ctrl + 点击两次 / 拖框', '矩形框选；Shift + 点击增减所选对象'],
      ['Ctrl + C / X / V / B', '复制 / 剪切 / 粘贴 / 镜像粘贴；粘贴到鼠标拍数'],
      ['Ctrl + Q/W/E 三次', '设起点 → 设终点 → 输入 Step/Type → 批量生成'],
      ['F + 鼠标移动', '拖动所选音符或事件；松开 F 完成'],
      ['Delete / Ctrl + Z / Y', '删除 / 撤销 / 重做（包括属性与事件修改）'],
      ['← / → / ↓', '所选音符横移 50 / 切换上下侧'],
      ['M / A / S', 'M 用鼠标拾取位置或角度；事件 A 水平翻转、S 垂直翻转；透明度设为 0 / 255'],
      ['V / Z / X / C', '切换横向吸附 / 重置辅助线 / 平移所选辅助线 / 反向平移'],
      ['J / K / L，O / P', '播放速度 0.5 / 0.75 / 1；减小 / 增大滚轮速度'],
      ['N / Esc', '切换缩略预览；逐级取消、退出编辑或返回选曲'],
      ['Ctrl + S / Shift + S', '保存到浏览器 / Ctrl + Shift + S 同时导出 PEC'],
      ['Ctrl + O / 拖入文件', '导入 PEC、完整 .peweb 项目及音乐、背景'],
      ['F1 / F11', '文件与帮助 / 浏览器全屏']
    ];
    const table = document.createElement('table');
    for (const [key, description] of entries) {
      const row = document.createElement('tr');
      for (const text of [key, description]) { const cell = document.createElement('td'); cell.textContent = text; row.append(cell); }
      table.append(row);
    }
    document.querySelector('#help-text').append(table);
  }
  frame() {
    if (this.scene === 'editor' && this.engine) {
      const seconds = this.chartTime;
      if (this.player.playing && seconds >= this.previousTime && seconds - this.previousTime < 1) {
        for (const note of this.engine.notes) {
          if (note.fake || note.start > seconds || note.start <= this.previousTime) continue;
          if (this.state.hideUnselected && note.line !== this.state.line) continue;
          this.player.hit(note.type);
          if (!this.state.hideAll && !this.state.hideNote) {
            const geometry = this.engine.noteGeometry(note, note.start);
            this.effects.push({ x: geometry.x, y: geometry.y, time: seconds, created: performance.now(), particles: Array.from({ length: 4 }, () => { const angle = Math.random() * Math.PI * 2; return { vx: Math.cos(angle) * 20, vy: Math.sin(angle) * 20 }; }) });
          }
        }
        for (const note of this.engine.notes) {
          if (note.type !== 2 || note.fake || seconds <= note.start || seconds >= note.end || this.state.hideAll || this.state.hideNote || (this.state.hideUnselected && note.line !== this.state.line)) continue;
          if (Math.floor((seconds - note.start) / (20 / 120)) > Math.floor((this.previousTime - note.start) / (20 / 120))) {
            const geometry = this.engine.noteGeometry(note, seconds);
            this.effects.push({ x: geometry.x, y: geometry.y, time: seconds, created: performance.now(), particles: Array.from({ length: 4 }, () => { const angle = Math.random() * Math.PI * 2; return { vx: Math.cos(angle) * 20, vy: Math.sin(angle) * 20 }; }) });
          }
        }
      }
      this.previousTime = seconds;
      this.effects = this.effects.filter(effect => performance.now() - effect.created < 465 || seconds - effect.time < 2 / 3);
    }
    this.view.render();
    requestAnimationFrame(this.frame);
  }
}

const application = new PhiEditer();
application.init().catch(error => {
  console.error(error);
  document.querySelector('#loading').textContent = `启动失败：${error.message}。请运行 start.cmd，并使用同一个本地地址访问。`;
});
