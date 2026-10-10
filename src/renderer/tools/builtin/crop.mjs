import { ImageTool } from '../sdk/tool-plugin.mjs';

/** Crop tool integrated with the shared editor lifecycle. */
export class CropTool extends ImageTool {
  static definition = {
    "id": "crop",
    "name": "Crop",
    "icon": "crop",
    "group": "features",
    "mode": "adjustment",
    "tooltip": "Crop selected image"
  };
  /** Commit the tool draft through the editor command service. */
  apply() { return this.context.command('applyCrop'); }

}
