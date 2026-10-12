import {PointerTool} from '../sdk/tool-plugin.mjs';

/** Paint saved protection regions that other effects preserve. */
export class IgnoreTool extends PointerTool {
  static definition={id:'ignore',name:'Ignore Brush',ariaLabel:'Ignore brush',icon:'shield',group:'basic',mode:'pointer',tooltip:'Paint areas to protect from effects'};
}
