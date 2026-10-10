import { PointerTool } from '../sdk/tool-plugin.mjs';

/** Eraser tool integrated with the shared editor lifecycle. */
export class EraserTool extends PointerTool {
  static definition = {
    "id": "eraser",
    "name": "Eraser",
    "ariaLabel": "Eraser tool",
    "icon": "ink_eraser",
    "group": "basic",
    "mode": "pointer",
    "tooltip": "Eraser tool"
  };
  /** Commit the tool draft through the editor command service. */
  apply() { return this.context.command('applyPaintDraft'); }

}
