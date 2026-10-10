import { ImageTool } from '../sdk/tool-plugin.mjs';

/** Padding tool integrated with the shared editor lifecycle. */
export class PaddingTool extends ImageTool {
  static definition = {
    "id": "padding",
    "name": "Padding",
    "ariaLabel": "Image padding",
    "icon": "border_clear",
    "group": "features",
    "mode": "adjustment",
    "tooltip": "Add image padding"
  };
  /** Commit the tool draft through the editor command service. */
  apply() { return this.context.command('applyPadding'); }

}
