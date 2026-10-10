/** Common metadata and lifecycle for every installed editor tool. */
export class ToolPlugin {
  static apiVersion = 1;
  static definition = {id:'tool',name:'Tool',icon:'build',group:'features',mode:'adjustment'};

  /** @param {object} context Host services, provided by the tool coordinator. */
  constructor(context) { this.context=context; this.definition={...this.constructor.definition}; }
  get id() { return this.definition.id; }
  get name() { return this.definition.name; }
  get requiresEnable() { return this.definition.mode === 'adjustment'; }
  get buttonId() { return this.definition.buttonId ?? `preview-tool-${this.id}`; }
  get isProcessor() { return false; }

  /** Select a tool through the host's pending-edit and processing guards. */
  activate() { return this.context.select(this.id); }
  /** Commit the active draft; built-in adapters delegate to their commands. */
  apply() { return false; }
  /** Remove a pending preview without modifying the project's working image. */
  discard() { return this.context.discard(); }
  /** Mount optional custom controls after registration; schema processors need no override. */
  mount() {}
  /** React to Enable changes for a custom adjustment tool. */
  enabledChanged(_enabled) {}
  /** Release transient gesture state after the host permits switching tools. */
  deactivate() {}
  /** Release plugin-owned resources when the editor closes. */
  dispose() {}
  /** Optional pointer hooks return true when the plugin consumes the event. */
  pointerDown(_event) { return false; }
  pointerMove(_event) { return false; }
  pointerUp(_event) { return false; }
}

/** Immediate commands such as restoring originals or opening a modal tool. */
export class ActionTool extends ToolPlugin {
  activate() { return this.context.action(this.id); }
}

/** Tools operating on pointer gestures without an Enable checkbox. */
export class PointerTool extends ToolPlugin {}

/** Image adjustments with a pending preview, Apply, Discard, and batch scope. */
export class ImageTool extends ToolPlugin {}

/** Image processors share scheduling, progress, output ownership, and history. */
export class ImageProcessorTool extends ImageTool {
  get isProcessor() { return true; }
  apply() { return this.context.applyProcessor(); }
  /**
   * Process the current edited image. Override for a JavaScript processor, or
   * provide processor.py in the manifest to use the Python processing service.
   * @returns {Promise<{path:string,width:number,height:number}>} Owned PNG output.
   */
  process(image, options, {preview=false,onProgress}={}) {
    return this.context.process(this.id,image,options,{preview,onProgress});
  }
}
