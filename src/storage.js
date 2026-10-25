import { clone } from './core.js';

export class ProjectStore {
  async open() {
    this.database = await new Promise((resolve, reject) => {
      const request = indexedDB.open('phiediter-pe-web', 1);
      request.onupgradeneeded = () => {
        for (const name of ['projects', 'autosaves', 'preferences']) request.result.createObjectStore(name);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return this;
  }
  operation(store, mode, callback) {
    return new Promise((resolve, reject) => {
      const transaction = this.database.transaction(store, mode);
      const request = callback(transaction.objectStore(store));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onerror = () => reject(transaction.error ?? request.error);
      transaction.onabort = () => reject(transaction.error ?? new Error('浏览器存储事务被中止。'));
    });
  }
  get(store, key) { return this.operation(store, 'readonly', records => records.get(key)); }
  put(store, key, value) { return this.operation(store, 'readwrite', records => records.put(value, key)); }
  all(store) { return this.operation(store, 'readonly', records => records.getAll()); }
  async save(record, autosave = false) {
    const snapshot = clone(record);
    snapshot.savedAt = new Date().toISOString();
    await this.put(autosave ? 'autosaves' : 'projects', record.id, snapshot);
    return snapshot.savedAt;
  }
}

export function downloadFile(name, contents, type = 'text/plain;charset=utf-8') {
  const blob = contents instanceof Blob ? contents : new Blob([contents], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name.replace(/[<>:"/\\|?*]/g, '_');
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

export async function toPortable(record) {
  const result = clone(record);
  for (const kind of ['audio', 'image']) {
    const media = record[kind];
    if (!media) continue;
    let blob = media.blob;
    if (!blob && media.url) {
      const response = await fetch(media.url);
      if (!response.ok) throw new Error(`无法读取 ${kind}：${response.status}`);
      blob = await response.blob();
    }
    if (blob) {
      result[kind] = { name: media.name, data: await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
      }) };
    }
  }
  return JSON.stringify({ schema: 'phiediter-pe-web/1', record: result });
}

export async function fromPortable(text) {
  const project = JSON.parse(text);
  if (project.schema !== 'phiediter-pe-web/1' || !project.record?.chart) throw new Error('无法识别此项目文件。');
  const record = project.record;
  for (const kind of ['audio', 'image']) {
    if (!record[kind]) continue;
    const media = record[kind];
    if (!media.data?.startsWith('data:')) throw new Error('完整项目中的素材数据无效。');
    const response = await fetch(media.data);
    record[kind] = { name: media.name, blob: await response.blob() };
  }
  return record;
}
