import { ToolPlugin } from './sdk/tool-plugin.mjs';

/** Store validated tool instances; duplicate or invalid plugins cannot replace tools. */
export class ToolRegistry {
  constructor() { this.tools=new Map(); }
  /** Validate metadata once, before a tool can register controls or callbacks. */
  register(tool) {
    if (!(tool instanceof ToolPlugin)) throw new Error('Tools must extend ToolPlugin.');
    const definition=tool.definition;
    if (tool.constructor.apiVersion!==1) throw new Error('Unsupported tool API version.');
    if (!/^[a-z][a-z0-9-]{0,63}$/.test(definition.id)) throw new Error('Tool IDs use lowercase letters, numbers, and hyphens.');
    if (this.tools.has(tool.id)) throw new Error(`The tool ID "${tool.id}" is already registered.`);
    if (typeof definition.name!=='string' || !definition.name.trim() || definition.name.length>80) throw new Error('Tools need a name of 1–80 characters.');
    if (!['features','basic','magic','clear'].includes(definition.group)) throw new Error('Invalid tool group.');
    if (!['adjustment','pointer','action'].includes(definition.mode)) throw new Error('Invalid tool mode.');
    if (typeof definition.icon!=='string' || !/^[a-z0-9_]+$/.test(definition.icon)) throw new Error('Use a Material Symbols icon name.');
    if (tool.isProcessor && definition.mode!=='adjustment') throw new Error('Image processors use adjustment mode.');
    const fields=definition.fields??[];
    if (!Array.isArray(fields) || fields.length>32) throw new Error('Tool fields must be an array of at most 32 controls.');
    const names=new Set();
    for(const field of fields) {
      if (!/^[a-z][a-z0-9-]{0,31}$/.test(field.key) || names.has(field.key)) throw new Error('Tool field keys must be unique lowercase identifiers.');
      names.add(field.key);
      if (!['range','number','checkbox','select','color'].includes(field.type)) throw new Error('Unsupported tool control type.');
      if (typeof field.label!=='string' || !field.label.trim()) throw new Error('Tool controls need a label.');
      if (['range','number'].includes(field.type) && (!Number.isFinite(field.min) || !Number.isFinite(field.max) || field.min>field.max || !Number.isFinite(field.defaultValue) || field.defaultValue<field.min || field.defaultValue>field.max || field.step!==undefined&&(!Number.isFinite(field.step)||field.step<=0))) throw new Error('Invalid numeric tool control bounds.');
      if (field.type==='checkbox' && typeof field.defaultValue!=='boolean') throw new Error('Checkbox defaults must be boolean.');
      if (field.type==='color' && !/^#[a-f\d]{6}$/i.test(field.defaultValue)) throw new Error('Color defaults must be hexadecimal RGB.');
      if (field.type==='select' && (!Array.isArray(field.options) || !field.options.length || !field.options.every(option=>typeof option.value==='string'&&typeof option.label==='string') || !field.options.some(option=>option.value===field.defaultValue))) throw new Error('Select defaults must match one of the options.');
    }
    const freeze = value => {
      if (value && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
      return value;
    };
    tool.definition = freeze(structuredClone(definition));
    this.tools.set(tool.id,tool);
    return tool;
  }
  get(id) { return this.tools.get(id); }
  values() { return [...this.tools.values()]; }
  selectable() { return this.values().filter(tool=>tool.definition.mode!=='action'); }
  processors() { return this.values().filter(tool=>tool.isProcessor); }
  /** Dispose all plugins without preventing other plugins from releasing resources. */
  dispose() { for(const tool of this.tools.values())try{tool.dispose();}catch(error){console.error(error);} }
}
