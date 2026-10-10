import { ImageTool } from '../sdk/tool-plugin.mjs';

/** Outline tool integrated with the shared editor lifecycle. */
export class OutlineTool extends ImageTool {
  static definition = {
    "id": "outline",
    "name": "Outline",
    "ariaLabel": "Image outline",
    "icon": "border_outer",
    "group": "features",
    "mode": "adjustment",
    "tooltip": "Add an outline to the selected image"
  };
  /** Commit the tool draft through the editor command service. */
  apply() { return this.context.command('applyOutlineControls'); }

}
