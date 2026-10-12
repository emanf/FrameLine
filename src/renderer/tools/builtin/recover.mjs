import {PointerTool} from '../sdk/tool-plugin.mjs';

/** Restore source-image pixels through a brush without clearing the entire image. */
export class RecoverTool extends PointerTool {
  static definition={id:'recover',name:'Recover Brush',ariaLabel:'Recover brush',icon:'restore',group:'clear',mode:'pointer',tooltip:'Brush to restore pixels from the original image'};
}
