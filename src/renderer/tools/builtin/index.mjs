import { ClearTool } from './clear.mjs';
import { BackgroundTool } from './background.mjs';
import { CropTool } from './crop.mjs';
import { OutlineTool } from './outline.mjs';
import { PaddingTool } from './padding.mjs';
import { RefineEdgesTool } from './refine.mjs';
import { CleanPixelsTool } from './clean.mjs';
import { HandTool } from './hand.mjs';
import { BrushTool } from './brush.mjs';
import { ColorCleanupTool } from './healing.mjs';
import { EraserTool } from './eraser.mjs';

/** Built-in tools use the same registration contract as installed plugins. */
export const builtinToolClasses = [ClearTool, BackgroundTool, CropTool, OutlineTool, PaddingTool, RefineEdgesTool, CleanPixelsTool, HandTool, BrushTool, ColorCleanupTool, EraserTool];
