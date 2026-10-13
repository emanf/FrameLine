/** Own Screen Keying controls, preset restoration, and numeric labels. */
export class BackgroundKeyingView {
  constructor(session) {
    this.session=session;
    this.fields=[['screen_balance',.5,0,1],['black_level',0,0,.99],['white_level',1,.01,1],
      ['edge_size',3,0,8],['edge_tolerance',.1,0,1],['despill_strength',1,0,1],['despill_balance',.5,0,1]]
      .map(([key,defaultValue,min,max])=>({key,defaultValue,min,max,
        input:document.querySelector(`#background-keying-${key.replaceAll('_','-')}`),
        output:document.querySelector(`#background-keying-${key.replaceAll('_','-')}-value`)}));
    this.connected=document.querySelector('#background-keying-connected');
  }

  /** Restore validated values without inheriting legacy RGB-distance settings as keying levels. */
  restore(saved) {
    for(const field of this.fields) field.input.value=String(this.session.runtime.clampNumber(saved?.[field.key],field.min,field.max,field.defaultValue));
    if(Number(this.fields[2].input.value)<=Number(this.fields[1].input.value)) this.fields[2].input.value=String(Number(this.fields[1].input.value)+.01);
    this.connected.checked=saved?.connected_only===true;
    this.labels();
  }

  /** Collect the same options for preview, Apply, batch processing, and saved presets. */
  options() {
    return {...Object.fromEntries(this.fields.map(({key,input})=>[key,Number(input.value)])),connected_only:this.connected.checked};
  }

  /** Show balance and level values in node-style precision, and despill as a percentage. */
  labels() {
    for(const {key,input,output} of this.fields) {
      output.textContent=key==='edge_size' ? `${input.value} px` : key==='despill_strength' ? `${Math.round(Number(input.value)*100)}%` : Number(input.value).toFixed(3);
    }
  }

  /** Disable saturation controls when detection selects the neutral-background fallback. */
  setAlgorithm(algorithm) {
    const neutral=algorithm==='neutral-distance';
    for(const {input} of this.fields) input.disabled=neutral;
    this.connected.disabled=neutral;
    document.querySelector('#background-keying-neutral-hint').hidden=!neutral;
  }

  /** Keep level intervals valid and bind events to the modal's disposable handler collection. */
  bind(bindings) {
    for(const field of this.fields) bindings.listen(field.input,'input',()=>{
      const black=this.fields[1].input,white=this.fields[2].input;
      if(Number(black.value)>=Number(white.value)) {
        if(field.key==='white_level') black.value=String(Number(white.value)-.01);
        else white.value=String(Number(black.value)+.01);
      }
      this.labels();this.session.updateValues();
    });
    bindings.listen(this.connected,'change',this.session.updateValues);
  }
}
