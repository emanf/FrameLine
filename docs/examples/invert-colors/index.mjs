import {ImageProcessorTool} from '@frameline/tools';

/** Blend an inverted RGB image into the current edited source, retaining alpha. */
export default class InvertColorsTool extends ImageProcessorTool {
  static definition = {
    id:'example-invert', name:'Invert Colors', icon:'invert_colors', group:'features', mode:'adjustment',
    description:'Invert image colors without changing transparency.',
    fields:[{key:'strength', label:'Strength', type:'range', min:0, max:100, step:1, defaultValue:100, suffix:'%'}]
  };
}
