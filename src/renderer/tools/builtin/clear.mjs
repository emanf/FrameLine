import { ActionTool } from '../sdk/tool-plugin.mjs';

/** Clear tool integrated with the shared editor lifecycle. */
export class ClearTool extends ActionTool {
  static definition = {
    "id": "clear",
    "name": "Clear",
    "ariaLabel": "Clear image effects for this image or all images",
    "icon": "cleaning_services",
    "group": "clear",
    "mode": "action",
    "buttonId": "preview-clear-effects",
    "tooltip": "Clear image effects for this image or all images"
  };
}
