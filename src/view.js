import { WIDTH, HEIGHT, clamp, isDuration, eventLane, easing } from './core.js';
import { nativeTextureSize } from './native-compat.js';

const noteTextures = { 1: 'Tap2.png', 2: 'Hold3.png', 3: 'Flick2.png', 4: 'Drag2.png' };
const highlightedTextures = { 1: 'Tap2HL.png', 3: 'Flick2HL.png', 4: 'DragHL.png' };

export class NativeView {
  constructor(application, catalog) {
    this.app = application;
    this.catalog = catalog;
    this.canvas = document.querySelector('#canvas');
    this.context = this.canvas.getContext('2d', { alpha: false });
    this.controls = document.querySelector('#controls');
    this.fields = new Map();
    this.images = new Map();
    this.tinted = new Map();
    this.hits = [];
    this.activeFields = new Set();
    this.canvas.style.cursor = 'default';
    this.resize = this.resize.bind(this);
    addEventListener('resize', this.resize);
    this.resize();
  }
  resize() {
    this.scale = Math.min(innerWidth / WIDTH, innerHeight / HEIGHT);
    this.left = (innerWidth - WIDTH * this.scale) / 2;
    this.top = (innerHeight - HEIGHT * this.scale) / 2;
    const stage = document.querySelector('#stage');
    stage.style.left = `${this.left}px`;
    stage.style.top = `${this.top}px`;
    stage.style.transform = `scale(${this.scale})`;
    this.canvas.width = Math.round(clamp(this.app.settings?.width ?? WIDTH, 320, 8192));
    this.canvas.height = Math.round(clamp(this.app.settings?.height ?? HEIGHT, 240, 8192));
  }
  point(event) { return { x: (event.clientX - this.left) / this.scale, y: HEIGHT - (event.clientY - this.top) / this.scale }; }
  async preload() {
    await Promise.all(Object.keys(this.catalog.textures).map(name => this.loadImage(name, `./assets/original/Texture/${encodeURIComponent(name)}`)));
    await document.fonts.load('60px Exo-Regular');
    await document.fonts.ready;
  }
  loadImage(key, url) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => { this.images.set(key, image); resolve(image); };
      image.onerror = () => reject(new Error(`素材读取失败：${url}`));
      image.src = url;
    });
  }
  async background(media) {
    if (this.backgroundURL) URL.revokeObjectURL(this.backgroundURL);
    this.images.delete('background');
    this.blurredBackground = null;
    if (!media) return;
    this.backgroundURL = media.blob ? URL.createObjectURL(media.blob) : null;
    const image = await this.loadImage('background', this.backgroundURL ?? media.url);
    const temporary = document.createElement('canvas');
    temporary.width = WIDTH;
    temporary.height = HEIGHT;
    const context = temporary.getContext('2d');
    const scale = Math.max(WIDTH / image.width, HEIGHT / image.height);
    context.filter = 'blur(16px)';
    context.drawImage(image, (WIDTH - image.width * scale) / 2, (HEIGHT - image.height * scale) / 2, image.width * scale, image.height * scale);
    this.blurredBackground = temporary;
  }
  textureSize(name) {
    const texture = this.catalog.textures[name];
    if (texture) return nativeTextureSize(texture);
    const image = this.images.get(name);
    return { width: image.width, height: image.height };
  }
  image(name, x, y, options = {}) {
    let image = this.images.get(name);
    if (!image) return;
    if (options.tint && options.tint !== '#ffffff') {
      const key = `${name}:${options.tint}`;
      if (!this.tinted.has(key)) {
        const temporary = document.createElement('canvas');
        temporary.width = image.width;
        temporary.height = image.height;
        const context = temporary.getContext('2d');
        context.drawImage(image, 0, 0);
        context.globalCompositeOperation = 'multiply';
        context.fillStyle = options.tint;
        context.fillRect(0, 0, image.width, image.height);
        context.globalCompositeOperation = 'destination-in';
        context.drawImage(image, 0, 0);
        this.tinted.set(key, temporary);
      }
      image = this.tinted.get(key);
    }
    const size = this.textureSize(name);
    const width = options.width ?? size.width * (options.scaleX ?? options.scale ?? 1);
    const height = options.height ?? size.height * (options.scaleY ?? options.scale ?? 1);
    const anchorX = options.anchorX ?? 0.5;
    const anchorY = options.anchorY ?? 0.5;
    const context = this.context;
    context.save();
    context.globalAlpha = clamp(options.alpha ?? 1, 0, 1);
    context.translate(x, HEIGHT - y);
    if (options.angle) context.rotate(options.angle * Math.PI / 180);
    context.scale(width < 0 ? -1 : 1, height < 0 ? -1 : 1);
    context.drawImage(image, -Math.abs(width) * anchorX, -Math.abs(height) * (1 - anchorY), Math.abs(width), Math.abs(height));
    context.restore();
    return { x: x + width * (0.5 - anchorX), y: y + height * (0.5 - anchorY), width: Math.abs(width), height: Math.abs(height) };
  }
  text(text, x, y, size = 60, options = {}) {
    const context = this.context;
    context.save();
    context.globalAlpha = options.alpha ?? 1;
    context.font = `${size}px ${options.font ?? 'Exo-Regular'}, sans-serif`;
    context.fillStyle = options.color ?? '#ffffff';
    context.textAlign = options.align ?? 'center';
    context.textBaseline = 'middle';
    context.fillText(String(text), x, HEIGHT - y);
    context.restore();
  }
  button(name, x, y, scale, action, options = {}) {
    const pressed = this.app.pressedHit?.label === (options.label ?? name) && this.app.pressedHit?.positionX === x && this.app.pressedHit?.positionY === y;
    const pressedScale = scale === 0.12 && ['save.png', 'settings.png'].includes(name) ? 0.10 : ['Confirm.png', 'Cancel.png', 'Reset.png'].includes(name) && scale === 0.4 ? 0.35 : scale === 0.5 ? 0.45 : name === 'delete1.png' ? 0.08 : name === 'add.png' && scale === 0.05 ? 0.04 : scale;
    const bounds = this.image(name, x, y, { scale: pressed ? pressedScale : scale, ...options });
    if (bounds) {
      const size = this.textureSize(name);
      this.hits.push({ ...bounds, width: size.width * scale, height: size.height * scale, positionX: x, positionY: y, action, kind: 'button', label: options.label ?? name });
    }
  }
  check(id, x, y, value, action, scale = 1) {
    this.image('check_box_normal.png', x, y, { scale });
    if (value) this.image('check_box_active.png', x, y, { scale });
    const size = this.textureSize('check_box_normal.png');
    this.hits.push({ x, y, width: size.width * scale, height: size.height * scale, action: () => action(!value), kind: 'button', label: id });
  }
  slider(id, x, y, value, action, options = {}) {
    const name = options.texture ?? 'slider_short.png';
    const scale = options.scale ?? 0.4;
    const dimensions = this.textureSize(name);
    const width = dimensions.width * scale;
    const angle = options.vertical ? -90 : 0;
    this.image(name, x, y, { scale, angle });
    if (options.vertical) this.image(options.ball ?? 'ball2.png', x, y + (value - 0.5) * width, { scale, angle });
    else this.image(options.ball ?? 'ball2.png', x + (value - 0.5) * width, y, { scale });
    this.hits.push({ x, y, width: options.vertical ? Math.max(35, dimensions.height * scale) : width, height: options.vertical ? width : Math.max(35, dimensions.height * scale), kind: 'slider', valueAt: point => clamp(((options.vertical ? point.y - y : point.x - x) / width) + 0.5, 0, 1), action, label: id });
  }
  input(id, x, y, value, onChange, options = {}) {
    this.activeFields.add(id);
    let field = this.fields.get(id);
    if (!field) {
      field = document.createElement('input');
      field.className = 'native-input';
      field.id = id;
      field.autocomplete = 'off';
      field.spellcheck = false;
      field.setAttribute('aria-label', options.label ?? id);
      field.addEventListener('change', () => {
        try { field.commit(field.value); } catch (error) { this.app.toast(error.message); }
      });
      field.addEventListener('keydown', event => {
        if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); field.blur(); }
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); field.value = field.lastValue; field.blur(); }
      });
      this.controls.append(field);
      this.fields.set(id, field);
    }
    field.commit = onChange;
    field.lastValue = String(value);
    if (document.activeElement !== field) field.value = String(value);
    field.style.display = 'block';
    field.style.left = `${x}px`;
    field.style.top = `${HEIGHT - y}px`;
    field.style.width = `${options.width ?? 400}px`;
    field.style.height = `${options.height ?? 100}px`;
    field.style.fontSize = `${options.fontSize ?? 60}px`;
    field.style.transform = `translate(-50%, -50%) scale(${options.scaleX ?? 1}, ${options.scaleY ?? 1})`;
    field.style.opacity = options.alpha ?? 200 / 255;
    field.readOnly = Boolean(options.readonly);
    if (options.pick) {
      field.onclick = () => options.pick();
      field.style.cursor = 'pointer';
    } else { field.onclick = null; field.style.cursor = 'text'; }
  }
  render() {
    const context = this.context;
    context.setTransform(this.canvas.width / WIDTH, 0, 0, this.canvas.height / HEIGHT, 0, 0);
    context.fillStyle = '#000';
    context.fillRect(0, 0, WIDTH, HEIGHT);
    this.hits = [];
    this.activeFields.clear();
    const scene = this.app.scene;
    if (scene === 'select' || scene === 'add') this.selectScene();
    if (scene === 'editor') this.editorScene();
    if (scene === 'settings') this.settingsScene();
    for (const [id, field] of this.fields) if (!this.activeFields.has(id)) field.style.display = 'none';
  }
  selectScene() {
    const app = this.app;
    const song = app.library[app.songIndex];
    if (!song) return;
    this.image('background', WIDTH / 2, HEIGHT / 2, { width: WIDTH, height: HEIGHT, alpha: 70 / 255 });
    const metadata = () => {
      this.text(song.name, WIDTH * 0.25, HEIGHT * 0.24, 125, { align: 'left' });
      this.text(song.level, WIDTH * 0.75, HEIGHT * 0.24, 125, { align: 'right' });
      this.text(`Composed By ${song.composer}`, WIDTH * 0.5, HEIGHT * 0.16, 75);
      this.text(`Charted By ${song.charter}`, WIDTH * 0.5, HEIGHT * 0.08, 75);
      this.button('add.png', WIDTH * 0.97, HEIGHT * 0.97, 0.06, () => app.showAdd(), { anchorX: 1, anchorY: 1, label: '添加谱面' });
    };
    if (app.scene === 'select') {
      const bounds = this.image('background', WIDTH * 0.5, HEIGHT * 0.55, { width: WIDTH * 0.66, height: HEIGHT * 0.66, alpha: 200 / 255 });
      this.hits.push({ ...(bounds ?? { x: WIDTH * 0.5, y: HEIGHT * 0.55, width: WIDTH * 0.66, height: HEIGHT * 0.66 }), action: () => app.enterSong(), kind: 'button', label: '进入谱面' });
      metadata();
    } else {
      metadata();
      this.image('backg2.png', 0, 0, { scale: 3, alpha: 200 / 255 });
      const rows = [['name', 'Chart Name:'], ['audio', 'Song:'], ['image', 'Background:'], ['level', 'Level:'], ['composer', 'Composer:'], ['charter', 'Charter:'], ['bpm', 'BPM:']];
      rows.forEach(([key, label], index) => {
        const positionY = HEIGHT * (0.88 - index * 0.12);
        this.text(label, WIDTH * 0.3, positionY, 100);
        this.input(`add-${key}`, WIDTH * 0.7, positionY, app.newSong[key]?.name ?? app.newSong[key] ?? '', value => app.newSong[key] = value, { width: 400, height: 100, scaleX: 2, scaleY: 1.5, fontSize: 80, readonly: ['audio', 'image'].includes(key), label, pick: ['audio', 'image'].includes(key) ? () => app.pickForNew(key) : null });
      });
      this.button('Confirm.png', WIDTH * 0.6, HEIGHT * 0.06, 0.4, () => app.createSong(), { label: '确认新建' });
      this.button('Cancel.png', WIDTH * 0.4, HEIGHT * 0.06, 0.4, () => app.cancelAdd(), { label: '取消新建' });
    }
  }
  editorScene() {
    const app = this.app;
    const state = app.state;
    const settings = app.settings;
    const seconds = app.chartTime;
    if (settings.showBackground && this.blurredBackground) {
      this.context.save();
      this.context.globalAlpha = settings.backgroundAlpha / 255;
      this.context.drawImage(this.blurredBackground, 0, 0);
      this.context.restore();
    }
    this.preview(seconds);
    if (settings.editMode) {
      for (const [index, [key, label, labelX]] of [['lineVisible', 'Line Visible', 270], ['hideUnselected', 'Hide Unselected', 325], ['hideNote', 'Hide Note', 250], ['hideAll', 'Hide All', 228]].entries()) {
        const positionY = HEIGHT - 50 - index * 70;
        this.check(key, 88, positionY, state[key], value => state[key] = value, 0.7);
        this.text(label, labelX, positionY, 52.5, { alpha: 200 / 255 });
      }
      this.text(state.line >= 0 ? `Selected: ${state.line}` : '', WIDTH / 2, HEIGHT - 50, 75, { alpha: 200 / 255 });
      this.button('save.png', WIDTH - 100, HEIGHT - 100, 0.12, () => app.save(), { label: '保存谱面' });
      this.button('settings.png', WIDTH - 100, HEIGHT - 250, 0.12, () => { if (!state.editing) app.showSettings(); }, { label: '设置' });
      this.button(app.player.playing ? 'resume1.png' : 'resume2.png', WIDTH - 100, 200, 0.12, () => app.togglePlay(), { label: '播放暂停' });
      this.text(`Beats:  ${app.engine.tempo.toBeat(seconds).toFixed(2)}`, 200, 40, 60);
      if (state.editing && state.line >= 0) this.chartEditor(seconds);
      this.slider('播放进度', state.editing ? 220 : WIDTH / 2, state.editing ? HEIGHT * 0.55 : 100, app.player.currentTime / app.player.duration, value => app.seek(value * app.player.duration), { texture: '111.png', ball: 'ball.png', scale: state.editing ? 0.48 : 0.72, vertical: state.editing });
    } else {
      const combo = app.engine.comboAt(seconds);
      const count = app.engine.judgments.length;
      this.button('Pause.png', 90, HEIGHT - 90, 0.15, () => app.togglePlay(), { alpha: 200 / 255 });
      this.image('Prefix.png', 70, 70, { scale: 0.15, alpha: 200 / 255 });
      this.text(String(count ? Math.floor(1000000 * combo / count) : 0).padStart(7, '0'), WIDTH - 215, HEIGHT - 90, 75, { alpha: 200 / 255 });
      this.text(combo, WIDTH / 2, HEIGHT - 90, 125, { alpha: 200 / 255 });
      this.text('combo', WIDTH / 2, HEIGHT - 172, 60, { alpha: 200 / 255 });
      this.text(app.record.name, 90, 70, 60, { align: 'left', alpha: 200 / 255 });
      this.text(app.record.level, WIDTH - 70, 70, 60, { align: 'right', alpha: 200 / 255 });
    }
    if (app.savedUntil > performance.now()) this.text('Chart Saved', WIDTH / 2, 200, 100, { font: 'Consolas', alpha: clamp((app.savedUntil - performance.now()) / 1000, 0, 1) });
    if (state.confirmQuit) {
      this.text('Sure to Quit', WIDTH / 2, HEIGHT * 0.6, 200, { font: 'Consolas' });
      this.button('Cancel.png', 700, 300, 0.5, () => state.confirmQuit = false);
      this.button('Confirm.png', 1300, 300, 0.5, () => app.returnLibrary());
    }
  }
  preview(seconds) {
    const app = this.app;
    const state = app.state;
    const settings = app.settings;
    const lines = new Map(app.engine.lineIds.map(line => [line, app.engine.lineAt(line, seconds)]));
    for (const [line, value] of lines) {
      const visible = !state.hideAll && (!state.hideUnselected || state.line === line);
      const positionX = value.alpha >= 10000 ? ((Math.trunc(value.x) % WIDTH) + WIDTH) % WIDTH : value.x;
      const positionY = value.alpha >= 10000 ? ((Math.trunc(value.y) % HEIGHT) + HEIGHT) % HEIGHT : value.y;
      const alpha = value.alpha >= 10000 ? value.alpha - 10000 : value.alpha;
      this.image('line.png', positionX, positionY, { scaleY: settings.lineWidth * 2, alpha: visible ? state.lineVisible ? 1 : clamp(alpha / 255, 0, 1) : 0, angle: value.angle, tint: settings.lineColor });
      if (settings.editMode && visible && (!state.editing || line === state.line)) {
        const bounds = this.image('line2.png', positionX, positionY, { scale: 2, angle: value.angle, alpha: line === state.line ? 1 : 0 });
        if (bounds) this.hits.push({ x: positionX, y: positionY, width: bounds.width, height: bounds.height, angle: value.angle, kind: 'line', line, action: () => app.selectLine(line) });
      }
    }
    if (!state.hideAll && !state.hideNote) {
      for (const note of app.engine.notes) {
        if (note.start < seconds - 0.042 && (note.type !== 2 || note.end < seconds)) continue;
        if (state.hideUnselected && note.line !== state.line) continue;
        const geometry = app.engine.noteGeometry(note, seconds, lines.get(note.line));
        if (!geometry.visible) continue;
        const alpha = state.line >= 0 && note.line !== state.line ? 120 / 255 : 1;
        const scale = settings.noteSize / 4;
        const tint = '#ffffff';
        if (note.type === 2) {
          const direction = note.side === 2 ? -1 : 1;
          const distance = (geometry.endDistance - geometry.distance) * direction;
          const angle = geometry.angle + (note.side === 2 ? 180 : 0);
          const radians = geometry.angle * Math.PI / 180;
          const headGap = seconds < note.start ? 12 : 0;
          this.image('Hold.png', geometry.x + Math.sin(radians) * headGap * direction, HEIGHT - geometry.y + Math.cos(radians) * headGap * direction, { scaleX: scale * note.size, height: distance - headGap, anchorY: 0, angle, alpha, tint });
          if (seconds < note.start) this.image('HoldHead.png', geometry.x, HEIGHT - geometry.y, { scaleX: scale * note.size, scaleY: scale, anchorY: 0, angle, alpha });
          this.image('HoldEnd.png', geometry.x + Math.sin(radians) * distance * direction, HEIGHT - geometry.y + Math.cos(radians) * distance * direction, { scaleX: scale * note.size, scaleY: scale, anchorY: 0, angle, alpha });
        } else {
          if (geometry.x < -200 || geometry.x > WIDTH + 200 || geometry.y < -50 || geometry.y > HEIGHT + 50) continue;
          this.image(settings.multiNoteHint && note.highlight ? highlightedTextures[note.type] : noteTextures[note.type], geometry.x, HEIGHT - geometry.y, { scaleX: scale * note.size, scaleY: scale, alpha, angle: geometry.angle, tint });
        }
      }
    }
    for (const effect of app.effects) {
      const age = (performance.now() - effect.created) / 1000;
      const frame = Math.floor(age / 0.015) + 1;
      if (frame <= 31) this.image(`img-${frame}.png`, effect.x, HEIGHT - effect.y, { scale: settings.noteSize * 1.4, tint: '#ffeca0', alpha: state.editing ? 40 / 255 : 1 });
      const particleAge = seconds - effect.time;
      const expansion = easing(particleAge * 1.5, 16);
      for (const particle of effect.particles) this.image('particle.png', effect.x + particle.vx * 15 * expansion, HEIGHT - effect.y + particle.vy * 15 * expansion, { scale: settings.noteSize * 11.5 * expansion, alpha: 1 - 1.5 * particleAge, tint: '#ffeca0' });
    }
  }
  chartEditor(seconds) {
    const app = this.app;
    const state = app.state;
    const scale = state.showEvents ? 0.25 : 0.8;
    const noteScale = state.showEvents ? 0.4 : 0.9;
    const center = state.showEvents ? 500 : WIDTH / 2;
    const eventCenter = 1200;
    const timelineSpeed = app.settings.barlineSpeed * 120;
    this.image('backg2.png', 1200, 500, { alpha: 130 / 255 });
    const line = app.engine.lineAt(state.line, seconds);
    this.text(`Pos: (${(line.x - 1024).toFixed(1)},${(line.y - 700).toFixed(1)}) Dir: ${(-line.angle).toFixed(1)} Alp: ${Math.trunc(line.alpha)} V: ${line.speed.toFixed(1)}`, WIDTH - 680, 50, 50);
    if (state.openPreview) {
      this.image('line.png', 100, 700, { scaleX: 0.02, scaleY: 0.5 });
      for (const note of app.engine.notes) {
        if (note.line !== state.line) continue;
        const startY = 700 + (note.start - seconds) * 75;
        const endY = 700 + (note.end - seconds) * 75;
        if (Math.max(startY, endY) < 0 || Math.min(startY, endY) > HEIGHT) continue;
        this.image(noteTextures[note.type], 100 + note.x * 0.08, note.type === 2 ? (startY + endY) / 2 : startY, { scaleX: 0.01, scaleY: note.type === 2 ? (endY - startY) / this.textureSize('Hold3.png').height : 0.01 });
      }
    }
    const gridStart = center - WIDTH * scale / 2;
    const gridEnd = state.showEvents ? eventCenter + WIDTH * scale / 2 : center + WIDTH * scale / 2;
    const fromBeat = Math.max(0, Math.floor(app.engine.tempo.toBeat(seconds) * state.grid) / state.grid);
    const toBeat = app.engine.tempo.toBeat(seconds + (HEIGHT - 300) / timelineSpeed);
    const lineWidth = gridEnd - gridStart;
    for (let index = Math.floor(fromBeat * state.grid); index <= Math.ceil(toBeat * state.grid); index++) {
      const beat = index / state.grid;
      const positionY = 300 + timelineSpeed * (app.engine.tempo.toSeconds(beat) - seconds);
      if (positionY < 300 || positionY > HEIGHT + 100) continue;
      this.image('line3.png', (gridStart + gridEnd) / 2, positionY, { width: lineWidth, alpha: 100 / 255, tint: Number.isInteger(beat) ? '#ffffff' : '#00ff00' });
      if (Number.isInteger(beat)) this.text(beat, gridEnd + 50, positionY, 60);
    }
    this.image('line.png', center, 300, { width: WIDTH * scale });
    if (state.showEvents) this.image('line.png', eventCenter, 300, { width: WIDTH * scale });
    if (!state.showEvents && state.attachX) {
      for (const [index, positionX] of state.anchors.entries()) {
        this.image('line4.png', positionX, 300, { alpha: 100 / 255, anchorY: 0, tint: state.selectedAnchors.has(index) ? '#ff0000' : '#ffffff' });
        this.hits.push({ x: positionX, y: 850, width: 12, height: 1100, kind: 'anchor', action: () => app.selectAnchor(index) });
      }
    }
    for (const note of app.engine.notes) {
      if (note.line !== state.line) continue;
      const startY = 300 + timelineSpeed * (note.start - seconds);
      const endY = 300 + timelineSpeed * (note.end - seconds);
      if (Math.max(startY, endY) < -30 || Math.min(startY, endY) > HEIGHT + 30) continue;
      const selected = state.selection.has(note.id);
      const bounds = this.image(noteTextures[note.type], center + scale * note.x, startY, { scaleX: 0.129 * noteScale * note.size, scaleY: note.type === 2 ? (endY - startY) / this.textureSize('Hold3.png').height : 0.129 * noteScale, anchorY: note.type === 2 ? 0 : 0.5, tint: selected ? '#00ff00' : '#ffffff' });
      this.hits.push({ ...bounds, width: Math.max(bounds.width, 28), height: Math.max(bounds.height, 18), kind: 'note', id: note.id, action: () => app.selectObject(note.id) });
    }
    if (state.showEvents) {
      for (const event of app.history.chart.events) {
        if (event.line !== state.line) continue;
        const startY = 300 + timelineSpeed * (app.engine.tempo.toSeconds(event.beat) - seconds);
        const endY = 300 + timelineSpeed * (app.engine.tempo.toSeconds(event.endBeat) - seconds);
        if (Math.max(startY, endY) < -30 || Math.min(startY, endY) > HEIGHT + 30) continue;
        const positionX = eventCenter + scale * WIDTH * (-0.375 + eventLane(event.kind) * 0.25);
        const duration = isDuration(event.kind);
        const bounds = this.image(duration ? 'Hold4.png' : 'tap9.png', positionX, startY, { scaleX: duration ? 0.8 * noteScale : 0.15 * noteScale, scaleY: duration ? (endY - startY) / this.textureSize('Hold4.png').height : 0.15 * noteScale, anchorY: duration ? 0 : 0.5, tint: state.selection.has(event.id) ? '#00ff00' : '#ffffff' });
        this.hits.push({ ...bounds, width: Math.max(bounds.width, 35), height: Math.max(bounds.height, 18), kind: 'event', id: event.id, action: () => app.selectObject(event.id) });
      }
    }
    if (state.pending) {
      const pending = state.pending;
      const startY = 300 + timelineSpeed * (app.engine.tempo.toSeconds(pending.beat) - seconds);
      const endY = 300 + timelineSpeed * (app.engine.tempo.toSeconds(app.cursorBeat) - seconds);
      const positionX = pending.kind ? eventCenter + scale * WIDTH * (-0.375 + eventLane(pending.kind) * 0.25) : center + scale * pending.x;
      const texture = pending.kind ? 'Hold4.png' : 'Hold3.png';
      const width = this.textureSize(texture).width * noteScale * (pending.kind ? 0.8 : 0.129);
      this.image(texture, positionX, Math.min(startY, endY), { width, height: Math.abs(endY - startY), anchorY: 0, alpha: 0.7 });
    }
    if (state.box) {
      const box = state.box;
      const positionY = 300 + timelineSpeed * (app.engine.tempo.toSeconds(box.beat) - seconds);
      this.context.save();
      this.context.fillStyle = '#00ff0064';
      this.context.fillRect(box.x, HEIGHT - positionY, app.pointer.x - box.x, positionY - app.pointer.y);
      this.context.restore();
    }
    this.slider('节拍细分', center, 200, [1, 2, 3, 4, 6, 8].indexOf(state.grid) / 5, value => state.grid = [1, 2, 3, 4, 6, 8][Math.round(value * 5)]);
    this.text('x1   x2   x3   x4   x6   x8', center, 150, 60);
    this.check('Disable Attach', 488, 50, !state.attach, value => state.attach = !value);
    this.text('Disable Attach', 700, 50, 52.5);
    this.check('事件编辑', 100, 250, state.showEvents, value => { state.showEvents = value; state.selection.clear(); state.pending = null; });
    this.check('事件定位网格', 1580, 250, state.eventAnchor, value => state.eventAnchor = value);
    if (state.eventAnchor && state.showEvents) {
      const gap = Math.max(500 - 0.05 * state.anchorSlider, 50);
      for (let index = -25; index < 25; index++) {
        this.image('line4.png', 1024 + gap * index, 0, { anchorY: 0 });
        this.image('line4.png', 0, 700 + gap * index, { anchorY: 0, angle: -90 });
      }
      this.slider('定位网格间距', 1580, 150, state.anchorSlider / 10000, value => state.anchorSlider = value * 10000, { scale: 0.3 });
    }
    this.propertyPanel();
  }
  propertyPanel() {
    const app = this.app;
    const state = app.state;
    const selected = app.selectedObjects;
    const item = selected.length === 1 ? selected[0] : null;
    if (state.batch?.stage === 2) {
      this.text('Step', WIDTH - 250, HEIGHT - 250, 75);
      this.input('batch-step', WIDTH - 250, HEIGHT - 350, state.batch.step, value => state.batch.step = Number(value));
      this.text('Type', WIDTH - 250, HEIGHT - 450, 75);
      this.input('batch-easing', WIDTH - 250, HEIGHT - 550, state.batch.easing, value => state.batch.easing = Number(value));
      return;
    }
    if (!item) return;
    const change = (key, value) => app.updateObject(item.id, key, value);
    if (item.type) {
      this.text('Hit Time', WIDTH - 250, HEIGHT - 50, 75);
      this.input('note-time', WIDTH - 250, HEIGHT - 150, item.beat.toFixed(3), value => change('beat', Number(value)), { fontSize: 80 });
      if (item.type === 2) {
        this.text('End Time', WIDTH - 250, HEIGHT - 250, 75, { alpha: 200 / 255 });
        this.input('note-end', WIDTH - 250, HEIGHT - 350, item.endBeat.toFixed(3), value => change('endBeat', Number(value)), { fontSize: 80 });
      }
      this.text('Relative X', WIDTH - 250, HEIGHT - 450, 75);
      this.input('note-x', WIDTH - 250, HEIGHT - 550, item.x.toFixed(3), value => change('x', Number(value)), { fontSize: 80 });
      this.text('Down Side', WIDTH - 250, HEIGHT - 650, 75);
      this.check('Down Side', WIDTH - 250, HEIGHT - 750, item.side === 2, value => change('side', value ? 2 : 1));
      this.text('Fake Note', WIDTH - 250, HEIGHT - 820, 75);
      this.check('Fake Note', WIDTH - 250, HEIGHT - 920, item.fake, value => change('fake', value));
      this.text('Speed', WIDTH - 250, HEIGHT - 1000, 75);
      this.input('note-speed', WIDTH - 250, HEIGHT - 1100, item.speed.toFixed(3), value => change('speed', Number(value)), { fontSize: 80 });
      this.text('Size', WIDTH - 250, HEIGHT - 1200, 75);
      this.input('note-size', WIDTH - 250, HEIGHT - 1300, item.size.toFixed(3), value => change('size', Number(value)), { fontSize: 80 });
    } else {
      const kind = item.kind;
      const duration = isDuration(kind);
      this.text(['cp', 'cm'].includes(kind) ? 'Move' : ['cd', 'cr'].includes(kind) ? 'Rotate' : ['ca', 'cf'].includes(kind) ? 'Alpha' : 'Speed', WIDTH - 250, HEIGHT - 150, 80);
      this.text('Start Time', WIDTH - 250, HEIGHT - 250, 60);
      this.input('event-time', WIDTH - 250, HEIGHT - 350, item.beat.toFixed(3), value => change('beat', Number(value)));
      if (duration) {
        this.text('End Time', WIDTH - 250, HEIGHT - 450, 60);
        this.input('event-end', WIDTH - 250, HEIGHT - 550, item.endBeat.toFixed(3), value => change('endBeat', Number(value)));
      }
      const values = [...item.values];
      if (['cp', 'cm'].includes(kind)) { values[0] -= 1024; values[1] -= 700; }
      if (['cd', 'cr'].includes(kind)) values[0] = -values[0];
      this.text('Target', WIDTH - 250, HEIGHT - 650, 60);
      this.input('event-target', WIDTH - 250, HEIGHT - 800, values.map(value => Number(value.toFixed(3))).join(' '), value => {
        const parameters = value.trim().split(/\s+/).map(Number);
        if (['cp', 'cm'].includes(kind)) { parameters[0] += 1024; parameters[1] += 700; }
        if (['cd', 'cr'].includes(kind)) parameters[0] = -parameters[0];
        change('values', parameters);
      }, { height: 200 });
      if (['cm', 'cr'].includes(kind)) {
        this.text('Motion Type', WIDTH - 250, HEIGHT - 950, 60);
        this.input('event-easing', WIDTH - 250, HEIGHT - 1050, item.easing, value => change('easing', Number(value)));
      }
    }
  }
  settingsScene() {
    const app = this.app;
    const draft = app.settingsDraft;
    const scroll = app.settingsScroll;
    this.button('Confirm.png', WIDTH * 0.4, HEIGHT * 0.1, 0.4, () => app.applySettings());
    this.button('Cancel.png', WIDTH * 0.6, HEIGHT * 0.1, 0.4, () => app.cancelSettings());
    this.button('Reset.png', WIDTH * 0.2, HEIGHT * 0.1, 0.4, () => app.resetSettings());
    this.button('General.png', WIDTH * 0.1, HEIGHT * 0.85, 0.4, () => { app.settingsTab = 1; app.settingsScroll = 0; }, { tint: app.settingsTab === 1 ? '#00ff00' : '#ffffff' });
    this.button('Chart.png', WIDTH * 0.1, HEIGHT * 0.7, 0.4, () => { app.settingsTab = 2; app.settingsScroll = 0; }, { tint: app.settingsTab === 2 ? '#00ff00' : '#ffffff' });
    if (app.settingsTab === 1) {
      const rows = [['Window Size (Width&Height)', 'size', 'input'], ['TempoLine Dropping Speed', 'barlineSpeed', 'input'], ['BGM Volume', 'bgmVolume', 'slider'], ['SE Volume', 'seVolume', 'slider'], ['Highlight simul. notes', 'multiNoteHint', 'check'], ['Line Width', 'lineWidth', 'slider'], ['Note Size', 'noteSize', 'slider'], ['Edit Mode', 'editMode', 'check'], ['Show Background', 'showBackground', 'check'], ['Mouse-Scroll Speed', 'scrollSpeed', 'scroll'], ['Anchorline Amount', 'anchorCount', 'input'], ['Line Color(RGB)', 'color', 'input']];
      rows.forEach(([label, key, type], index) => {
        const positionY = HEIGHT * (0.85 - index * 0.1) + scroll;
        if (positionY < 0 || positionY > HEIGHT + 100) return;
        this.text(label, WIDTH * 0.5, positionY, 75);
        if (type === 'check') this.check(label, WIDTH * 0.85, positionY, draft[key], value => draft[key] = value);
        else if (type === 'slider' || type === 'scroll') this.slider(label, WIDTH * 0.85, positionY, draft[key] / (type === 'scroll' ? 10 : 1), value => draft[key] = value * (type === 'scroll' ? 10 : 1));
        else {
          let value = draft[key];
          if (key === 'size') value = `${draft.width} ${draft.height}`;
          if (key === 'color') value = draft.lineColor.match(/\w\w/g).map(component => parseInt(component, 16)).join(' ');
          this.input(`settings-${key}`, WIDTH * 0.85, positionY, value, value => {
            if (key === 'size') [draft.width, draft.height] = value.trim().split(/\s+/).map(Number);
            else if (key === 'color') {
              const components = value.trim().split(/\s+/).map(Number);
              if (components.length !== 3 || components.some(component => !Number.isInteger(component) || component < 0 || component > 255)) throw new Error('RGB 必须是三个 0–255 的整数。');
              draft.lineColor = `#${components.map(component => component.toString(16).padStart(2, '0')).join('')}`;
            } else draft[key] = Number(value);
          }, { width: 300, fontSize: key === 'color' ? 40 : 60, label });
        }
      });
    } else {
      this.text('Offset', WIDTH * 0.5, HEIGHT * 0.85 + scroll, 75);
      this.input('settings-offset', WIDTH * 0.85, HEIGHT * 0.85 + scroll, app.chartDraft.offset, value => app.chartDraft.offset = Number(value), { width: 300 });
      this.text('BPM List', WIDTH * 0.3, HEIGHT * 0.65 + scroll, 75);
      this.text('Time', WIDTH * 0.55, HEIGHT * 0.75 + scroll, 75);
      this.text('BPM', WIDTH * 0.8, HEIGHT * 0.75 + scroll, 75);
      app.chartDraft.bpms.forEach((entry, index) => {
        const positionY = HEIGHT * (0.65 - index * 0.1) + scroll;
        if (positionY < 0 || positionY > HEIGHT + 100) return;
        this.input(`bpm-time-${index}`, WIDTH * 0.55, positionY, entry.beat.toFixed(3), value => entry.beat = Number(value), { width: 300 });
        this.input(`bpm-value-${index}`, WIDTH * 0.8, positionY, entry.bpm.toFixed(3), value => entry.bpm = Number(value), { width: 300 });
        this.button('delete1.png', WIDTH * 0.92, positionY, 0.1, () => { if (app.chartDraft.bpms.length > 1) app.chartDraft.bpms.splice(index, 1); else app.toast('至少保留一条 BPM。'); });
      });
      this.button('add.png', WIDTH * 0.55, HEIGHT * (0.65 - 0.1 * app.chartDraft.bpms.length) + scroll, 0.05, () => { const previous = app.chartDraft.bpms.at(-1); app.chartDraft.bpms.push({ beat: previous.beat + 4, bpm: previous.bpm }); });
    }
  }
  hit(point) {
    for (let index = this.hits.length - 1; index >= 0; index--) {
      const hit = this.hits[index];
      if (this.contains(hit, point)) return hit;
    }
    return null;
  }
  contains(hit, point) {
    let positionX = point.x - hit.x;
    let positionY = hit.y - point.y;
    if (hit.angle) {
      const angle = -hit.angle * Math.PI / 180;
      [positionX, positionY] = [positionX * Math.cos(angle) - positionY * Math.sin(angle), positionX * Math.sin(angle) + positionY * Math.cos(angle)];
    }
    return Math.abs(positionX) <= hit.width / 2 && Math.abs(positionY) <= hit.height / 2;
  }
}
