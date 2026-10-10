// Keep one edited preview source. Leases protect files still being processed
// when navigation, Undo, or a tool switch retires the cached source.
export class WorkingSourceCache {
  constructor(dispose) {
    this.dispose = dispose;
    this.entry = null;
  }

  clear() {
    const entry = this.entry;
    this.entry = null;
    if (entry) { entry.retired = true; this.cleanup(entry); }
  }

  cleanup(entry) {
    if (!entry.retired || entry.references || !entry.result || entry.disposed) return;
    entry.disposed = true;
    if (entry.result.temporary) void Promise.resolve(this.dispose(entry.result.path)).catch(error => console.warn('Could not discard cached preview source:', error));
  }

  async acquire(source, load) {
    let entry = this.entry;
    if (!entry || entry.source.project !== source.project || entry.source.imageKey !== source.imageKey) {
      this.clear();
      entry = this.entry = {source, references:0, retired:false, result:null, disposed:false};
      entry.promise = Promise.resolve().then(load).then(result => {entry.result=result; this.cleanup(entry); return result;});
    }
    entry.references++;
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      entry.references--;
      this.cleanup(entry);
    };
    try { return {result:await entry.promise, release}; }
    catch (error) {
      if (this.entry === entry) this.clear();
      release();
      throw error;
    }
  }
}
