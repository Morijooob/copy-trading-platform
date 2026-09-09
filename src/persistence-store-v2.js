import fs from 'node:fs/promises';
import path from 'node:path';

export class JsonPersistenceStore {
  constructor({ filePath }) {
    if (!filePath) throw new Error('filePath is required');
    this.filePath = filePath;
    this.queue = Promise.resolve();
  }

  async load(defaultValue = {}) {
    try {
      const raw = await fs.readFile(this.filePath, 'utf8');
      return JSON.parse(raw);
    } catch (error) {
      if (error.code === 'ENOENT') return defaultValue;
      throw new Error(`failed to load persistence store: ${error.message}`);
    }
  }

  async save(value) {
    this.queue = this.queue.then(async () => {
      await fs.mkdir(path.dirname(this.filePath), { recursive: true });
      const tempPath = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
      await fs.writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
      await fs.rename(tempPath, this.filePath);
    });
    return this.queue;
  }
}
