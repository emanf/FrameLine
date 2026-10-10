import { PointerTool } from '../sdk/tool-plugin.mjs';

/** Color Cleanup tool integrated with the shared editor lifecycle. */
export class ColorCleanupTool extends PointerTool {
  static definition = {
    "id": "healing",
    "name": "Color Cleanup",
    "ariaLabel": "Color Cleanup Brush",
    "icon": "format_color_reset",
    "group": "basic",
    "mode": "pointer",
    "tooltip": "Color Cleanup Brush: remove unwanted color and recover transparency"
  };
  /** Commit the tool draft through the editor command service. */
  apply() { return this.context.command('applyPaintDraft'); }

}
