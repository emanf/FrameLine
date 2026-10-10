import { PointerTool } from '../sdk/tool-plugin.mjs';

/** Brush tool integrated with the shared editor lifecycle. */
export class BrushTool extends PointerTool {
  static definition = {
    "id": "brush",
    "name": "Brush",
    "ariaLabel": "Brush tool",
    "icon": "brush",
    "group": "basic",
    "mode": "pointer",
    "tooltip": "Brush tool"
  };
  /** Commit the tool draft through the editor command service. */
  apply() { return this.context.command('applyPaintDraft'); }

}
