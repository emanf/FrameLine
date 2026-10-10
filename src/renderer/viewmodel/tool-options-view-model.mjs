/** DOM-independent control values and validation for a registered image tool. */
export class ToolOptionsViewModel {
  constructor(fields=[]) {
    this.fields=fields;
    this.values=Object.fromEntries(fields.map(field=>[field.key,field.defaultValue]));
    this.listeners=new Set();
  }
  /** Validate a control value against its tool-provided schema. */
  set(key,value,notify=true) {
    const field=this.fields.find(field=>field.key===key);
    if(!field)throw new Error(`Unknown tool option: ${key}`);
    if(['range','number'].includes(field.type)) {
      value=Number(value);
      if(!Number.isFinite(value))value=field.defaultValue;
      value=Math.max(field.min,Math.min(field.max,value));
      const step=field.step??1;
      value=Number((field.min+Math.round((value-field.min)/step)*step).toPrecision(15));
      value=Math.max(field.min,Math.min(field.max,value));
    }else if(field.type==='checkbox')value=typeof value==='boolean'?value:field.defaultValue;
    else if(field.type==='color'&&!/^#[a-f\d]{6}$/i.test(value))value=field.defaultValue;
    else if(field.type==='select'&&!field.options.some(option=>option.value===value))value=field.defaultValue;
    this.values[key]=value;
    if(notify)for(const listener of this.listeners)listener(this.snapshot());
    return value;
  }
  restore(values) { for(const field of this.fields)this.set(field.key,values?.[field.key]??field.defaultValue,false); }
  snapshot() { return {...this.values}; }
  subscribe(listener) { this.listeners.add(listener);return()=>this.listeners.delete(listener); }
}
