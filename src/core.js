export const WIDTH = 2048;
export const HEIGHT = 1400;
export const EVENT_KINDS = ['cp', 'cm', 'cd', 'cr', 'ca', 'cf', 'cv'];
export const EVENT_LABELS = { cp: '位置突变', cm: '移动', cd: '角度突变', cr: '旋转', ca: '透明度突变', cf: '渐变透明度', cv: '速度' };
export const NOTE_LABELS = { 1: 'Tap', 2: 'Hold', 3: 'Flick', 4: 'Drag' };
export const EASING_LABELS = ['线性', 'Out Sine', 'In Sine', 'Out Quad', 'In Quad', 'InOut Sine', 'InOut Quad', 'Out Cubic', 'In Cubic', 'Out Quart', 'In Quart', 'InOut Cubic', 'InOut Quart', 'Out Quint', 'In Quint', 'Out Expo', 'In Expo', 'Out Circ', 'In Circ', 'Out Back', 'In Back', 'InOut Circ', 'InOut Back', 'Out Elastic', 'In Elastic', 'Out Bounce', 'In Bounce', 'InOut Bounce', 'InOut Elastic'];
export const DEFAULT_SETTINGS = Object.freeze({ width: 2048, height: 1400, barlineSpeed: 8, bgmVolume: 0.6, seVolume: 0.4, multiNoteHint: true, lineWidth: 0.5, noteSize: 0.5, scrollSpeed: 3, anchorCount: 7, backgroundAlpha: 70, showBackground: true, editMode: true, lineColor: '#ffffff', autosaveSeconds: 30, anchorGap: 200 });

export const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));
export const clone = value => structuredClone(value);
export const uid = () => globalThis.crypto?.randomUUID?.() ?? `pe-${Date.now()}-${Math.random().toString(36).slice(2)}`;
export const isDuration = kind => ['cm', 'cr', 'cf'].includes(kind);
export const eventLane = kind => ({ cp: 0, cm: 0, cd: 1, cr: 1, ca: 2, cf: 2, cv: 3 })[kind];
const numeric = value => Number.isFinite(Number(value));
const formatNumber = value => Number(value.toFixed(9)).toString();

export function easeOutBounce(progress) {
  const factor = 7.5625;
  const divisor = 2.75;
  if (progress < 1 / divisor) return factor * progress ** 2;
  if (progress < 2 / divisor) return factor * (progress - 1.5 / divisor) ** 2 + 0.75;
  if (progress < 2.5 / divisor) return factor * (progress - 2.25 / divisor) ** 2 + 0.9375;
  return factor * (progress - 2.625 / divisor) ** 2 + 0.984375;
}

export function easing(progress, type = 1) {
  const amount = clamp(progress, 0, 1);
  const angle = Math.PI;
  const back = 1.70158 * 1.525;
  const elastic = 2 * angle / 3;
  const elasticBoth = 2 * angle / 4.5;
  switch (Number(type)) {
    case 2: return Math.sin(amount * angle / 2);
    case 3: return 1 - Math.cos(amount * angle / 2);
    case 4: return 1 - (1 - amount) ** 2;
    case 5: return amount ** 2;
    case 6: return (1 - Math.cos(angle * amount)) / 2;
    case 7: return amount < 0.5 ? 2 * amount ** 2 : 1 - (-2 * amount + 2) ** 2 / 2;
    case 8: return 1 - (1 - amount) ** 3;
    case 9: return amount ** 3;
    case 10: return 1 - (1 - amount) ** 4;
    case 11: return amount ** 4;
    case 12: return amount < 0.5 ? 4 * amount ** 3 : 1 - (-2 * amount + 2) ** 3 / 2;
    case 13: return amount < 0.5 ? 8 * amount ** 4 : 1 - (-2 * amount + 2) ** 4 / 2;
    case 14: return 1 - (1 - amount) ** 5;
    case 15: return amount ** 5;
    case 16: return amount === 1 ? 1 : 1 - 2 ** (-10 * amount);
    case 17: return amount === 0 ? 0 : 2 ** (10 * amount - 10);
    case 18: return Math.sqrt(1 - (amount - 1) ** 2);
    case 19: return 1 - Math.sqrt(Math.abs(1 - amount ** 2));
    case 20: return 1 + 2.70158 * (amount - 1) ** 3 + 1.70158 * (amount - 1) ** 2;
    case 21: return 2.70158 * amount ** 3 - 1.70158 * amount ** 2;
    case 22: return amount < 0.5 ? (1 - Math.sqrt(1 - (2 * amount) ** 2)) / 2 : (Math.sqrt(1 - (-2 * amount + 2) ** 2) + 1) / 2;
    case 23: return amount < 0.5 ? (2 * amount) ** 2 * ((back + 1) * 2 * amount - back) / 2 : ((2 * amount - 2) ** 2 * ((back + 1) * (2 * amount - 2) + back) + 2) / 2;
    case 24: return amount === 0 || amount === 1 ? amount : 2 ** (-10 * amount) * Math.sin((amount * 10 - 0.75) * elastic) + 1;
    case 25: return amount === 0 || amount === 1 ? amount : -(2 ** (10 * amount - 10)) * Math.sin((amount * 10 - 10.75) * elastic);
    case 26: return easeOutBounce(amount);
    case 27: return 1 - easeOutBounce(1 - amount);
    case 28: return amount < 0.5 ? (1 - easeOutBounce(1 - 2 * amount)) / 2 : (1 + easeOutBounce(2 * amount - 1)) / 2;
    case 29: return amount === 0 || amount === 1 ? amount : amount < 0.5 ? -(2 ** (20 * amount - 10) * Math.sin((20 * amount - 11.125) * elasticBoth)) / 2 : 2 ** (-20 * amount + 10) * Math.sin((20 * amount - 11.125) * elasticBoth) / 2 + 1;
    default: return amount;
  }
}

export function normalizeBpms(entries) {
  if (!entries.length) throw new Error('谱面至少需要一条 BPM。');
  const sorted = entries.map(entry => ({ beat: Number(entry.beat), bpm: Number(entry.bpm) })).sort((first, second) => first.beat - second.beat);
  for (const entry of sorted) {
    if (!Number.isFinite(entry.beat) || !Number.isFinite(entry.bpm) || entry.bpm <= 0) throw new Error('BPM 必须是正数，拍数必须是有限数字。');
  }
  const unique = sorted.filter((entry, index) => index === sorted.length - 1 || entry.beat !== sorted[index + 1].beat);
  if (unique[0].beat > 0) unique.unshift({ beat: 0, bpm: unique[0].bpm });
  return unique;
}

export class TempoMap {
  constructor(entries) {
    this.entries = normalizeBpms(entries);
    this.entries[0].seconds = this.entries[0].beat * 60 / this.entries[0].bpm;
    for (let index = 1; index < this.entries.length; index++) {
      const previous = this.entries[index - 1];
      this.entries[index].seconds = previous.seconds + (this.entries[index].beat - previous.beat) * 60 / previous.bpm;
    }
  }
  toSeconds(beat) {
    const entry = this.entries[upperBound(this.entries, beat, item => item.beat) - 1] ?? this.entries[0];
    return entry.seconds + (beat - entry.beat) * 60 / entry.bpm;
  }
  toBeat(seconds) {
    const entry = this.entries[upperBound(this.entries, seconds, item => item.seconds) - 1] ?? this.entries[0];
    return entry.beat + (seconds - entry.seconds) * entry.bpm / 60;
  }
  bpmAt(seconds) {
    return (this.entries[upperBound(this.entries, seconds, item => item.seconds) - 1] ?? this.entries[0]).bpm;
  }
}

export function upperBound(items, target, accessor) {
  let minimum = 0;
  let maximum = items.length;
  while (minimum < maximum) {
    const middle = (minimum + maximum) >>> 1;
    if (accessor(items[middle]) <= target) minimum = middle + 1;
    else maximum = middle;
  }
  return minimum;
}

export function createChart(bpm = 120) {
  return {
    offset: 0,
    bpms: [{ beat: 0, bpm }],
    notes: [],
    events: [
      { id: uid(), kind: 'cp', line: 0, beat: 0, endBeat: 0, values: [1024, 700], easing: 1 },
      { id: uid(), kind: 'cd', line: 0, beat: 0, endBeat: 0, values: [0], easing: 1 },
      { id: uid(), kind: 'ca', line: 0, beat: 0, endBeat: 0, values: [255], easing: 1 },
      { id: uid(), kind: 'cv', line: 0, beat: 0, endBeat: 0, values: [10], easing: 1 }
    ]
  };
}

export function validateChart(chart) {
  if (!chart || !Array.isArray(chart.notes) || !Array.isArray(chart.events) || !Array.isArray(chart.bpms)) throw new Error('谱面结构不完整。');
  if (!numeric(chart.offset)) throw new Error('Offset 必须是有限数字。');
  normalizeBpms(chart.bpms);
  const identifiers = new Set();
  for (const item of [...chart.notes, ...chart.events]) {
    if (!Number.isInteger(item.line) || item.line < 0 || item.line > 999) throw new Error('判定线编号必须为 0–999 的整数。');
    if (!numeric(item.beat) || !numeric(item.endBeat)) throw new Error('拍数必须是有限数字。');
    if (identifiers.has(item.id)) throw new Error('谱面对象 ID 重复。');
    identifiers.add(item.id);
    if (item.type) {
      if (![1, 2, 3, 4].includes(item.type) || ![1, 2].includes(item.side)) throw new Error('音符类型或方向无效。');
      if (![item.x, item.speed, item.size].every(numeric)) throw new Error('音符坐标、速度和尺寸必须为有限数字。');
      if (item.type === 2 && item.endBeat < item.beat) throw new Error('Hold 结束拍不能小于开始拍。');
    } else {
      if (!EVENT_KINDS.includes(item.kind) || !Array.isArray(item.values) || item.values.length !== (['cp', 'cm'].includes(item.kind) ? 2 : 1) || !item.values.every(numeric)) throw new Error('判定线事件参数无效。');
      if (isDuration(item.kind) && item.endBeat < item.beat) throw new Error('事件结束拍不能小于开始拍。');
      if (!Number.isInteger(item.easing) || item.easing < 1 || item.easing > 29) throw new Error('缓动编号必须为 1–29。');
    }
  }
  return chart;
}

export function parsePEC(source) {
  const text = source.replace(/^\uFEFF/, '').replace(/\/\/[^\r\n]*/g, '');
  const tokens = [];
  let line = 1;
  let previous = 0;
  for (const match of text.matchAll(/\S+/g)) {
    for (let index = previous; index < match.index; index++) if (text[index] === '\n') line++;
    tokens.push({ value: match[0], line });
    previous = match.index + match[0].length;
  }
  if (!tokens.length) throw new Error('PEC 文件为空。');
  const hasOffset = Number.isFinite(Number(tokens[0].value));
  const chart = { offset: hasOffset ? Number(tokens[0].value) : 0, bpms: [], notes: [], events: [] };
  let cursor = hasOffset ? 1 : 0;
  let previousNote;
  const read = (count, command) => {
    if (cursor + count > tokens.length) throw new Error(`第 ${command.line} 行 ${command.value} 参数不足。`);
    const values = tokens.slice(cursor, cursor + count).map(token => Number(token.value) || (Number(token.value) === 0 ? 0 : NaN));
    cursor += count;
    if (!values.every(Number.isFinite)) throw new Error(`第 ${command.line} 行 ${command.value} 参数不是数字。`);
    return values;
  };
  while (cursor < tokens.length) {
    const command = tokens[cursor++];
    const kind = command.value.toLowerCase();
    if (kind === 'bp') {
      const [beat, bpm] = read(2, command);
      chart.bpms.push({ beat, bpm });
    } else if (/^n[1-4]$/.test(kind)) {
      const type = Number(kind[1]);
      const values = read(type === 2 ? 6 : 5, command);
      const [line, beat] = values;
      const [endBeat, position, side, fake] = type === 2 ? values.slice(2) : [beat, ...values.slice(2)];
      previousNote = { id: uid(), type, line, beat, endBeat, x: position, side, fake: Boolean(fake), speed: 1, size: 1 };
      chart.notes.push(previousNote);
    } else if (kind === '#' || kind === '&') {
      if (!previousNote) throw new Error(`第 ${command.line} 行修饰符前没有音符。`);
      previousNote[kind === '#' ? 'speed' : 'size'] = read(1, command)[0];
    } else if (EVENT_KINDS.includes(kind)) {
      const counts = { cp: 4, cm: 6, cd: 3, cr: 5, ca: 3, cf: 4, cv: 3 };
      const values = read(counts[kind], command);
      const [line, beat] = values;
      const duration = isDuration(kind);
      const endBeat = duration ? values[2] : beat;
      const parameters = values.slice(duration ? 3 : 2);
      const motion = ['cm', 'cr'].includes(kind) ? parameters.pop() : 1;
      chart.events.push({ id: uid(), kind, line, beat, endBeat, values: parameters, easing: motion });
    } else throw new Error(`第 ${command.line} 行存在未知 PEC 指令：${command.value}`);
  }
  if (!chart.bpms.length) chart.bpms = [{ beat: 0, bpm: 120 }];
  validateChart(chart);
  return chart;
}

export function serializePEC(chart) {
  validateChart(chart);
  const lines = [formatNumber(chart.offset)];
  for (const entry of [...chart.bpms].sort((first, second) => first.beat - second.beat)) lines.push(`bp ${formatNumber(entry.beat)} ${formatNumber(entry.bpm)}`);
  for (const type of [1, 2, 3, 4]) {
    for (const note of chart.notes.filter(item => item.type === type).sort((first, second) => first.beat - second.beat)) {
      lines.push(`n${type} ${note.line} ${formatNumber(note.beat)} ${type === 2 ? `${formatNumber(note.endBeat)} ` : ''}${formatNumber(note.x)} ${note.side} ${Number(note.fake)}`, `# ${formatNumber(note.speed)}`, `& ${formatNumber(note.size)}`);
    }
    lines.push('');
  }
  const lineIds = [...new Set(chart.events.map(item => item.line))].sort((first, second) => first - second);
  for (const line of lineIds) {
    for (const kind of ['cv', 'cp', 'cd', 'ca', 'cm', 'cr', 'cf']) {
      for (const event of chart.events.filter(item => item.line === line && item.kind === kind).sort((first, second) => first.beat - second.beat)) {
        lines.push(`${kind} ${line} ${formatNumber(event.beat)} ${isDuration(kind) ? `${formatNumber(event.endBeat)} ` : ''}${event.values.map(formatNumber).join(' ')}${['cm', 'cr'].includes(kind) ? ` ${event.easing}` : ''}`);
      }
      lines.push('');
    }
  }
  return `${lines.join('\n').trimEnd()}\n`;
}

function dimensionAt(steps, ramps, seconds, defaults) {
  const step = steps[upperBound(steps, seconds, item => item.start) - 1];
  let values = step?.values ?? defaults;
  const rampIndex = upperBound(ramps, seconds, item => item.end);
  const completed = ramps[rampIndex - 1];
  if (completed && completed.end >= (step?.start ?? -Infinity)) values = completed.values;
  const active = ramps[rampIndex];
  if (active && active.start <= seconds) {
    const fraction = active.end === active.start ? 1 : easing((seconds - active.start) / (active.end - active.start), active.easing);
    values = values.map((value, index) => value + (active.values[index] - value) * fraction);
  }
  return [...values];
}

export class ChartEngine {
  constructor(chart) {
    this.chart = chart;
    this.tempo = new TempoMap(chart.bpms);
    this.lineIds = [...new Set([0, ...chart.notes.map(item => item.line), ...chart.events.map(item => item.line)])].sort((first, second) => first - second);
    this.lines = new Map(this.lineIds.map(line => [line, Object.fromEntries(EVENT_KINDS.map(kind => [kind, []]))]));
    for (const event of chart.events) this.lines.get(event.line)[event.kind].push({ ...event, start: this.tempo.toSeconds(event.beat), end: this.tempo.toSeconds(event.endBeat) });
    for (const groups of this.lines.values()) {
      for (const [kind, events] of Object.entries(groups)) events.sort((first, second) => isDuration(kind) ? first.end - second.end || first.start - second.start : first.start - second.start);
      let integral = 0;
      for (let index = 0; index < groups.cv.length; index++) {
        if (index) integral += (groups.cv[index].start - groups.cv[index - 1].start) * groups.cv[index - 1].values[0];
        groups.cv[index].integral = integral;
      }
    }
    const hitTimes = new Map();
    for (const note of chart.notes) hitTimes.set(note.beat, (hitTimes.get(note.beat) ?? 0) + 1);
    this.notes = chart.notes.map(note => ({ ...note, start: this.tempo.toSeconds(note.beat), end: this.tempo.toSeconds(note.endBeat), highlight: hitTimes.get(note.beat) > 1 })).sort((first, second) => first.start - second.start);
    this.judgments = this.notes.filter(note => !note.fake).map(note => ({ time: note.type === 2 ? note.end : note.start, note })).sort((first, second) => first.time - second.time);
    this.lastSecond = Math.max(10, ...this.notes.map(note => note.end), ...chart.events.map(event => this.tempo.toSeconds(event.endBeat)));
  }
  lineAt(line, seconds) {
    const groups = this.lines.get(line);
    if (!groups) return { x: 0, y: 0, angle: 0, alpha: 0, speed: 10 };
    const [positionX, positionY] = dimensionAt(groups.cp, groups.cm, seconds, [0, 0]);
    return { x: positionX, y: positionY, angle: dimensionAt(groups.cd, groups.cr, seconds, [0])[0], alpha: dimensionAt(groups.ca, groups.cf, seconds, [0])[0], speed: (groups.cv[upperBound(groups.cv, seconds, item => item.start) - 1] ?? groups.cv[0])?.values[0] ?? 10 };
  }
  floorAt(line, seconds) {
    const speeds = this.lines.get(line)?.cv;
    if (!speeds?.length) return 0;
    const speed = speeds[upperBound(speeds, seconds, item => item.start) - 1] ?? speeds[0];
    return (speed.integral + (seconds - speed.start) * speed.values[0]) * 120;
  }
  distance(line, start, end) {
    return this.floorAt(line, end) - this.floorAt(line, start);
  }
  noteGeometry(note, seconds, lineState = this.lineAt(note.line, seconds)) {
    const distance = this.distance(note.line, seconds, note.start) * note.speed;
    let state = lineState;
    let vertical = note.type === 2 && seconds > note.start ? 0 : distance;
    let visible = lineState.alpha !== -1;
    if (lineState.alpha === -2 && distance < 0) visible = false;
    if (lineState.alpha <= -100 && lineState.alpha >= -1000 && seconds < this.tempo.toSeconds(note.beat - (-100 - lineState.alpha) / 10)) visible = false;
    if (lineState.alpha <= -1000 && lineState.alpha >= -2000) {
      if (seconds < this.tempo.toSeconds(note.beat - (-1000 - lineState.alpha) / 10)) visible = false;
      state = this.lineAt(note.line, note.type === 2 ? Math.max(seconds, note.start) : note.start);
      vertical = 0;
    }
    const radians = state.angle * Math.PI / 180;
    const direction = note.side === 2 ? -1 : 1;
    const positionX = state.x + Math.cos(radians) * note.x + Math.sin(radians) * vertical * direction;
    const positionY = HEIGHT - state.y + Math.sin(radians) * note.x - Math.cos(radians) * vertical * direction;
    return { x: positionX, y: positionY, angle: state.angle, distance: vertical * direction, endDistance: this.distance(note.line, seconds, note.end) * note.speed * direction, visible, state };
  }
  comboAt(seconds) {
    return upperBound(this.judgments, seconds, item => item.time);
  }
}

export class History {
  constructor(chart, maximum = 150) {
    this.chart = chart;
    this.maximum = maximum;
    this.undoStack = [];
    this.redoStack = [];
  }
  transact(label, mutation) {
    const before = clone(this.chart);
    try {
      mutation(this.chart);
      validateChart(this.chart);
    } catch (error) {
      this.chart = before;
      throw error;
    }
    if (JSON.stringify(before) === JSON.stringify(this.chart)) return false;
    this.undoStack.push({ label, chart: before });
    if (this.undoStack.length > this.maximum) this.undoStack.shift();
    this.redoStack.length = 0;
    return true;
  }
  undo() { return this.move(this.undoStack, this.redoStack); }
  redo() { return this.move(this.redoStack, this.undoStack); }
  move(from, to) {
    const entry = from.pop();
    if (!entry) return false;
    to.push({ label: entry.label, chart: clone(this.chart) });
    this.chart = clone(entry.chart);
    return entry.label;
  }
}

export function pasteObjects(chart, objects, targetBeat, targetLine, mirror = false) {
  if (!objects.length) return [];
  const tempo = new TempoMap(chart.bpms);
  const originSeconds = Math.min(...objects.map(item => tempo.toSeconds(item.beat)));
  const targetSeconds = tempo.toSeconds(targetBeat);
  return objects.map(item => {
    const copy = clone(item);
    copy.id = uid();
    copy.line = targetLine;
    copy.beat = tempo.toBeat(targetSeconds + tempo.toSeconds(item.beat) - originSeconds);
    copy.endBeat = tempo.toBeat(targetSeconds + tempo.toSeconds(item.endBeat) - originSeconds);
    if (copy.type) {
      if (mirror) copy.x = -copy.x;
      chart.notes.push(copy);
    } else {
      if (mirror && ['cp', 'cm'].includes(copy.kind)) copy.values[0] = WIDTH - copy.values[0];
      if (mirror && ['cd', 'cr'].includes(copy.kind)) copy.values[0] = -copy.values[0];
      chart.events.push(copy);
    }
    return copy.id;
  });
}

export function generateNotes(chart, options) {
  const { startBeat, endBeat, startX, endX, step, type, line, easingType = 1, side = 1, fake = false, speed = 1, size = 1 } = options;
  if (!(step > 0) || endBeat <= startBeat || (endBeat - startBeat) / step > 20000) throw new Error('批量生成需要正数步长、递增拍数，每次最多 20000 个音符。');
  const result = [];
  for (let index = 0; index <= Math.floor((endBeat - startBeat) / step + 1e-8); index++) {
    const beat = startBeat + index * step;
    const note = { id: uid(), type, line, beat, endBeat: type === 2 ? Math.min(beat + step, endBeat) : beat, x: startX + (endX - startX) * easing((beat - startBeat) / (endBeat - startBeat), easingType), side, fake, speed, size };
    if (type === 2 && note.endBeat === note.beat) continue;
    chart.notes.push(note);
    result.push(note.id);
  }
  return result;
}

export function parseNativeSettings(source) {
  const settings = { ...DEFAULT_SETTINGS };
  const songs = [];
  let song;
  const keys = { TempoLineDroppingSpeed: 'barlineSpeed', BGMVolume: 'bgmVolume', SEVolume: 'seVolume', MultiNoteHint: 'multiNoteHint', LineWidth: 'lineWidth', NoteSize: 'noteSize', MouseScrollSpeed: 'scrollSpeed', AnchorLineAmount: 'anchorCount', Alpha: 'backgroundAlpha' };
  const metadata = { Name: 'name', Song: 'audio', Picture: 'image', Chart: 'chart', Level: 'level', Composer: 'composer', Charter: 'charter', Path: 'path' };
  for (const textLine of source.split(/\r?\n/)) {
    if (textLine.trim() === '#') {
      song = {};
      songs.push(song);
      continue;
    }
    const match = textLine.match(/^\s*([^:]+):\s*(.*?)\s*$/);
    if (!match) continue;
    const [, key, value] = match;
    if (song && metadata[key]) song[metadata[key]] = value;
    else if (keys[key] && numeric(value)) settings[keys[key]] = key === 'MultiNoteHint' ? Boolean(Number(value)) : Number(value);
    else if (key === 'WindowSize') [settings.width, settings.height] = value.split(/\s+/).map(Number);
  }
  return { settings, songs: songs.filter(item => item.name && item.chart) };
}
