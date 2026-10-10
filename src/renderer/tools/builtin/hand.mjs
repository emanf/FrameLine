import { PointerTool } from '../sdk/tool-plugin.mjs';

/** Hand tool integrated with the shared editor lifecycle. */
export class HandTool extends PointerTool {
  static definition = {
    "id": "hand",
    "name": "Hand",
    "ariaLabel": "Hand tool",
    "icon": "pan_tool",
    "group": "basic",
    "mode": "pointer",
    "tooltip": "Hand tool"
  };
}
