import { ImageProcessorTool } from '../sdk/tool-plugin.mjs';

/** Clean Pixels tool integrated with the shared editor lifecycle. */
export class CleanPixelsTool extends ImageProcessorTool {
  static definition = {
    "id": "clean",
    "name": "Clean Pixels",
    "icon": "auto_awesome",
    "group": "features",
    "mode": "adjustment",
    "tooltip": "Clean noise and dirty pixels across the whole image",
    "description": "Reduce noise across the whole image while keeping colors and transparency.",
    "previewMethod": "previewCleanPixels",
    "applyMethod": "cleanImagePixels",
    "fields": [
      {
        "key": "strength",
        "label": "Cleanup strength",
        "type": "range",
        "defaultValue": 80,
        "min": 0,
        "max": 100,
        "step": 1,
        "suffix": "%"
      },
      {
        "key": "tolerance",
        "label": "Color tolerance",
        "type": "range",
        "defaultValue": 32,
        "min": 1,
        "max": 100,
        "step": 1,
        "suffix": ""
      },
      {
        "key": "radius",
        "label": "Cleanup radius",
        "type": "range",
        "defaultValue": 2,
        "min": 1,
        "max": 8,
        "step": 1,
        "suffix": " px"
      },
      {
        "key": "speckles",
        "label": "Remove isolated speckles",
        "type": "range",
        "defaultValue": 60,
        "min": 0,
        "max": 100,
        "step": 1,
        "suffix": "%"
      }
    ]
  };
}
