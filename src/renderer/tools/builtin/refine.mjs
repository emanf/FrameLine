import { ImageProcessorTool } from '../sdk/tool-plugin.mjs';

/** Refine Edges tool integrated with the shared editor lifecycle. */
export class RefineEdgesTool extends ImageProcessorTool {
  static definition = {
    "id": "refine",
    "name": "Refine Edges",
    "icon": "blur_on",
    "group": "features",
    "mode": "adjustment",
    "tooltip": "Refine cutout edges and repair edge colors",
    "description": "Clean cutout edges using nearby image colors.",
    "previewMethod": "previewRefineEdges",
    "applyMethod": "refineImageEdges",
    "fields": [
      {
        "key": "clean",
        "label": "Clean transparency",
        "type": "range",
        "defaultValue": 10,
        "min": 0,
        "max": 100,
        "step": 1,
        "suffix": "%"
      },
      {
        "key": "repair",
        "label": "Repair edge colors",
        "type": "range",
        "defaultValue": 60,
        "min": 0,
        "max": 100,
        "step": 1,
        "suffix": "%"
      },
      {
        "key": "width",
        "label": "Repair width",
        "type": "range",
        "defaultValue": 2,
        "min": 1,
        "max": 16,
        "step": 1,
        "suffix": " px"
      },
      {
        "key": "smooth",
        "label": "Smooth edge",
        "type": "range",
        "defaultValue": 25,
        "min": 0,
        "max": 100,
        "step": 1,
        "suffix": "%"
      },
      {
        "key": "shrink",
        "label": "Shrink edge",
        "type": "range",
        "defaultValue": 0,
        "min": 0,
        "max": 3,
        "step": 1,
        "suffix": " px"
      }
    ]
  };
}
