/** Own temporary event handlers for a dialog or view with a bounded lifetime. */
export class EventBindings {
  constructor() { this.entries = []; }

  /** Attach one handler and retain the exact target/options needed to remove it. */
  listen(target, type, listener, options) {
    target.addEventListener(type, listener, options);
    this.entries.push({target, type, listener, options});
  }

  /** Detach every retained handler; repeated disposal is safe. */
  dispose() {
    for (const {target, type, listener, options} of this.entries.splice(0)) {
      target.removeEventListener(type, listener, options);
    }
  }
}
