import { ActionTool } from '../sdk/tool-plugin.mjs';

/** Remove Background tool integrated with the shared editor lifecycle. */
export class BackgroundTool extends ActionTool {
  static definition = {
    "id": "background",
    "name": "Remove Background",
    "ariaLabel": "Remove background from selected image",
    "icon": "auto_fix_high",
    "group": "magic",
    "mode": "action",
    "buttonId": "preview-remove-background",
    "tooltip": "Remove background from selected image"
  };
}
