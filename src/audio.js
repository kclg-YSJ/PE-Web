export class AudioPlayer {
  constructor() {
    this.media = new Audio();
    this.media.preload = 'auto';
    this.media.preservesPitch = false;
    this.media.loop = true;
    this.media.addEventListener('error', () => this.onError?.(new Error('音乐无法解码或读取，请更换音频文件。')));
    this.rate = 1;
    this.position = 0;
    this.durationFallback = 180;
    this.playing = false;
    this.startedAt = 0;
    this.buffers = new Map();
    this.soundVolume = 0.4;
  }
  async load(media) {
    this.pause();
    if (this.objectURL) URL.revokeObjectURL(this.objectURL);
    this.objectURL = media?.blob ? URL.createObjectURL(media.blob) : null;
    this.hasMedia = Boolean(media?.url || this.objectURL);
    this.position = 0;
    this.media.removeAttribute('src');
    if (this.hasMedia) this.media.src = this.objectURL ?? media.url;
    this.media.load();
    this.media.playbackRate = this.rate;
  }
  get currentTime() {
    if (this.hasMedia) return this.media.currentTime;
    return this.position + (this.playing ? (performance.now() - this.startedAt) / 1000 * this.rate : 0);
  }
  get duration() { return Number.isFinite(this.media.duration) && this.media.duration > 0 ? this.media.duration : this.durationFallback; }
  async play() {
    await this.unlock();
    if (this.hasMedia) await this.media.play();
    else this.startedAt = performance.now();
    this.playing = true;
  }
  pause() {
    this.position = this.currentTime;
    this.media.pause();
    this.playing = false;
  }
  seek(seconds) {
    const position = Math.max(0, Math.min(this.duration, seconds));
    this.position = position;
    this.startedAt = performance.now();
    if (this.hasMedia) this.media.currentTime = position;
  }
  setRate(rate) {
    const wasPlaying = this.playing;
    if (!this.hasMedia) {
      this.position = this.currentTime;
      this.startedAt = performance.now();
    }
    this.rate = rate;
    this.media.playbackRate = rate;
    this.media.preservesPitch = false;
    this.playing = wasPlaying;
  }
  setVolumes(bgm, sound) { this.media.volume = Math.min(1, Math.max(0, bgm)); this.soundVolume = sound; }
  async unlock() {
    if (!this.context) {
      this.context = new AudioContext({ latencyHint: 'interactive' });
      this.loadingSounds = Promise.all(['tap', 'flick', 'drag'].map(type =>
        fetch(`./assets/original/SE/${type}.mp3`).then(response => {
          if (!response.ok) throw new Error(`音效读取失败：${type}`);
          return response.arrayBuffer();
        }).then(buffer => this.context.decodeAudioData(buffer)).then(buffer => this.buffers.set(type, buffer)).catch(error => this.onError?.(error))
      ));
    }
    if (this.context.state === 'suspended') await this.context.resume();
    await this.loadingSounds;
  }
  hit(type) {
    const name = type === 3 ? 'flick' : type === 4 ? 'drag' : 'tap';
    const buffer = this.buffers.get(name);
    if (!buffer || !this.soundVolume || !this.context) return;
    const source = this.context.createBufferSource();
    const gain = this.context.createGain();
    gain.gain.value = this.soundVolume;
    source.buffer = buffer;
    source.connect(gain).connect(this.context.destination);
    source.start();
  }
}
