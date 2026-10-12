import {ControllerBase} from '../controller-base.mjs';
import {brushImagePoint} from '../../model/brush-geometry.mjs';
import {IncrementalBrushMask} from '../../model/incremental-brush-mask.mjs';
import {protectionMask,recoverPixels} from '../../model/protection-mask.mjs';
import {originalImage} from '../../model/image-effects.mjs';
import {originalOffset,workingGeometry,translateIgnoreStrokes} from '../../model/image-protection.mjs';
import {cropPixelRect} from '../../model/crop-geometry.mjs';

/** Capture protection and original-pixel restoration as individual reversible gestures. */
export class LocalBrushController extends ControllerBase {
  /** Synchronize view-only overlay controls without changing saved protection or edit history. */
  syncIgnoreVisibility() {
    const runtime=this.application,visible=document.querySelector('#preview-ignore-visible').checked;
    const button=document.querySelector('#preview-ignore-toggle'),action=visible ? 'Hide' : 'Show';
    button.setAttribute('aria-pressed',String(visible));
    button.setAttribute('aria-label',`${action} Ignore overlay`);
    button.dataset.tooltip=`${action} Ignore overlay (protection stays active)`;
    button.classList.toggle('grid-enabled',visible);
    button.querySelector('.material-icon').textContent=visible ? 'visibility' : 'visibility_off';
    runtime.updateIgnoreOverlay();
  }

  /** Identify the full working raster without tying cached pixels to unrelated timeline edits. */
  recoveryKey(image) {
    return JSON.stringify([image.id,image.path,image.width,image.height,image.paintStrokes,originalImage(image),image.originalOffset]);
  }

  /** Prepare the current raster and original in the same coordinate system before painting. */
  async prepareRecoverBrush() {
    const runtime=this.application,image=runtime.currentPreviewImage();
    if(runtime.previewTool!=='recover' || !image || this.preparing || runtime.refineBusy) return;
    const key=this.recoveryKey(image);
    if(this.recovery?.key===key) return;
    this.preparing=true; runtime.refineBusy=true; runtime.setToolProgress('local-brush',true); runtime.syncToolActivation();
    let result;
    try {
      const snapshot=structuredClone(image);
      result=await runtime.materializeWorkingImage({...snapshot,crop:null,outline:null});
      const source=new Image(); source.src=runtime.localImageUrl(result.path); await source.decode();
      const original=originalImage(snapshot),base=new Image(); base.src=runtime.localImageUrl(original.path); await base.decode();
      const before=document.createElement('canvas'),reference=document.createElement('canvas');
      before.width=reference.width=snapshot.width; before.height=reference.height=snapshot.height;
      before.getContext('2d',{willReadFrequently:true}).drawImage(source,0,0);
      const offset=originalOffset(snapshot,original.dimensions);
      reference.getContext('2d',{willReadFrequently:true}).drawImage(base,offset.x,offset.y,original.dimensions.width,original.dimensions.height);
      if(runtime.previewTool==='recover' && this.recoveryKey(runtime.currentPreviewImage() ?? {})===key) this.recovery={key,before,reference};
    } catch(error) { runtime.notifyError(error); }
    finally {
      if(result?.temporary) await window.frameLine.discardProcessedImages([result.path]).catch(runtime.notifyError);
      this.preparing=false; runtime.refineBusy=false; runtime.setToolProgress('local-brush',false); runtime.syncToolActivation();
    }
  }

  /** Draw the union of saved Ignore marks without adding the overlay to image data. */
  updateIgnoreOverlay(image=this.application.currentPreviewImage()) {
    const runtime=this.application,canvas=document.querySelector('#preview-ignore-overlay');
    const enabled=document.querySelector('#preview-ignore-enabled');
    enabled.checked=image?.ignoreEnabled!==false;
    document.querySelector('#preview-ignore-clear').disabled=!image?.ignoreStrokes?.length || runtime.refineBusy;
    const strokes=[...(image?.ignoreStrokes ?? []),...(this.gesture?.tool==='ignore' && this.gesture.imageId===image?.id ? [this.gesture.stroke] : [])];
    canvas.hidden=!image || !strokes.length || !document.querySelector('#preview-ignore-visible').checked;
    if(canvas.hidden) return;
    let width=image.width,height=image.height,marks=strokes;
    const preview=runtime.previewImageWrap.classList.contains('outline-preview') ? '#preview-outline-canvas'
      : runtime.previewImageWrap.classList.contains('padding-preview') ? '#preview-padding-canvas'
      : runtime.previewImageWrap.classList.contains('refine-preview') ? '#preview-refine-canvas' : null;
    if(preview) {
      const output=document.querySelector(preview),geometry=workingGeometry(image);
      width=output.width; height=output.height;
      const padding=runtime.previewPaddingDraft?.padding;
      const x=geometry.x+(padding?.left ?? Math.floor((width-geometry.width)/2)),y=geometry.y+(padding?.top ?? Math.floor((height-geometry.height)/2));
      marks=translateIgnoreStrokes(strokes,image,{width,height},x,y);
    }
    const signature=JSON.stringify([width,height,marks]);
    if(this.overlayKey===signature && !canvas.hidden) return;
    this.overlayKey=signature;
    let left=width,top=height,right=0,bottom=0;
    for(const mark of marks) for(const [x,y] of mark.points) {
      const radius=mark.size/2+2;
      left=Math.min(left,Math.max(0,Math.floor(x*width-radius)));top=Math.min(top,Math.max(0,Math.floor(y*height-radius)));
      right=Math.max(right,Math.min(width,Math.ceil(x*width+radius)));bottom=Math.max(bottom,Math.min(height,Math.ceil(y*height+radius)));
    }
    canvas.width=width;canvas.height=height;
    const mask=protectionMask(marks,width,height,{left,top,right,bottom}),context=canvas.getContext('2d'),pixels=context.createImageData(mask.width,mask.height);
    for(let i=0;i<mask.data.length;i++) {pixels.data[i*4]=255;pixels.data[i*4+1]=55;pixels.data[i*4+2]=75;pixels.data[i*4+3]=Math.round(mask.data[i]*.28);}
    context.putImageData(pixels,mask.left,mask.top);
  }

  /** Append coalesced pointer samples using the shared brush pixel-center convention. */
  appendLocalSamples(event) {
    const gesture=this.gesture;if(!gesture) return;
    for(const sample of [...(event.getCoalescedEvents?.() ?? []),event]) {
      const point=brushImagePoint(sample.clientX,sample.clientY,gesture.bounds,gesture.width,gesture.height,!gesture.stroke.antiAlias);
      const last=gesture.stroke.points.at(-1);
      if(!last || Math.hypot((point[0]-last[0])*gesture.width,(point[1]-last[1])*gesture.height)>.01) gesture.stroke.points.push(point);
    }
  }

  /** Restore only the current stroke footprint from its immutable gesture baseline. */
  renderLocalGesture() {
    const gesture=this.gesture,runtime=this.application;
    if(!gesture) return;
    gesture.raster.append();
    const mask=gesture.raster.takeDirtyMask();
    if(!mask) return;
    if(gesture.tool==='ignore') {
      const canvas=document.querySelector('#preview-ignore-overlay');
      const pixels=gesture.overlayBase.getContext('2d').getImageData(mask.left,mask.top,mask.width,mask.height);
      for(let i=0;i<mask.data.length;i++) {
        const offset=i*4;pixels.data[offset]=255;pixels.data[offset+1]=55;pixels.data[offset+2]=75;
        pixels.data[offset+3]=Math.max(pixels.data[offset+3],Math.round(mask.data[i]*.28));
      }
      canvas.getContext('2d').putImageData(pixels,mask.left,mask.top);
      canvas.hidden=!document.querySelector('#preview-ignore-visible').checked;
      return;
    }
    const {before,reference}=this.recovery;
    const region=before.getContext('2d').getImageData(mask.left,mask.top,mask.width,mask.height);
    const original=reference.getContext('2d').getImageData(mask.left,mask.top,mask.width,mask.height);
    recoverPixels(region.data,original.data,mask.data);
    runtime.previewPaintContext.putImageData(region,mask.left,mask.top);
    runtime.previewPaintCanvas.hidden=false;runtime.previewImageWrap.classList.add('paint-erases-image');
  }

  /** Persist a completed gesture after its final sample, rejecting stale image changes. */
  async finishLocalGesture(event) {
    const runtime=this.application,gesture=this.gesture;
    if(!gesture || event.pointerId!==runtime.localBrushPointerId) return;
    event.preventDefault();event.stopImmediatePropagation();
    if(this.frame) cancelAnimationFrame(this.frame);this.frame=null;
    const valid=event.type!=='pointercancel' && gesture.revision===runtime.vm.editRevision && gesture.imageId===runtime.currentPreviewImage()?.id;
    if(valid) {this.appendLocalSamples(event);this.renderLocalGesture();}
    const image=runtime.currentPreviewImage();
    this.gesture=null;runtime.localBrushPointerId=null;
    if(runtime.previewStage.hasPointerCapture(event.pointerId)) runtime.previewStage.releasePointerCapture(event.pointerId);
    if(valid && gesture.tool==='ignore') {
      const canvas=document.querySelector('#preview-ignore-overlay');
      this.overlayKey=canvas.hidden ? null : JSON.stringify([image.width,image.height,[...(image.ignoreStrokes ?? []),gesture.stroke]]);
      runtime.vm.addIgnoreStroke(image.id,gesture.stroke);
    }
    else if(valid) {
      runtime.refineBusy=true;runtime.setToolProgress('local-brush',true);runtime.syncToolActivation();
      let result,committed=false;
      try {
        result=await runtime.storeCanvasImage(runtime.previewPaintCanvas);
        if(gesture.revision===runtime.vm.editRevision && image.id===runtime.currentPreviewImage()?.id) {
          committed=runtime.vm.setWorkingImageResults([{...result,imageId:image.id,crop:image.crop,outline:image.outline,sourceOffset:{x:0,y:0}}],gesture.revision);
          if(committed) this.recovery=null;
        }
      } catch(error) {runtime.notifyError(error);}
      finally {
        if(result && !committed) await window.frameLine.discardProcessedImages([result.path]).catch(runtime.notifyError);
        runtime.refineBusy=false;runtime.setToolProgress('local-brush',false);
      }
    }
    if(!valid && gesture.tool==='ignore') this.overlayKey=null;
    runtime.redrawPaintCanvas();runtime.updateIgnoreOverlay();runtime.updateBrushCursor(event.clientX,event.clientY);runtime.syncHistoryButtons();
    await runtime.prepareRecoverBrush();
  }

  /** Bind local gestures before standard pointer handling while leaving right-drag panning available. */
  initializeLocalBrushEvents() {
    const runtime=this.application,stage=document.querySelector('#preview-stage');runtime.localBrushPointerId=null;
    document.querySelector('#preview-ignore-overlay').getContext('2d',{willReadFrequently:true});
    stage.addEventListener('pointerdown',event => {
      if(event.button!==0 || !['ignore','recover'].includes(runtime.previewTool)) return;
      const image=runtime.currentPreviewImage();
      if(!image || runtime.playing || runtime.refineBusy || runtime.paddingBusy || runtime.outlineApplyBusy || runtime.backgroundEditBusy || runtime.localBrushPointerId!==null) return;
      const bounds=runtime.previewImageWrap.getBoundingClientRect();
      if(event.clientX<bounds.left || event.clientX>=bounds.right || event.clientY<bounds.top || event.clientY>=bounds.bottom) return;
      const crop=cropPixelRect(image.width,image.height,image.crop),x=(event.clientX-bounds.left)/bounds.width*image.width,y=(event.clientY-bounds.top)/bounds.height*image.height;
      if(x<crop.x || y<crop.y || x>=crop.x+crop.width || y>=crop.y+crop.height) return;
      if(runtime.previewTool==='recover' && this.recovery?.key!==this.recoveryKey(image)) {void runtime.prepareRecoverBrush();return;}
      event.preventDefault();event.stopImmediatePropagation();
      if(runtime.previewTool==='ignore') runtime.updateIgnoreOverlay(image);
      this.gesture={imageId:image.id,width:image.width,height:image.height,revision:runtime.vm.editRevision,bounds,tool:runtime.previewTool,
        stroke:{tool:'brush',color:'#ffffff',opacity:1,size:runtime.currentBrushSize(),shape:document.querySelector('#preview-square-brush').checked?'square':'round',antiAlias:document.querySelector('#preview-brush-antialias').checked,feather:0,points:[]}};
      this.gesture.raster=new IncrementalBrushMask(this.gesture.stroke,image.width,image.height);
      if(runtime.previewTool==='ignore') {
        const canvas=document.querySelector('#preview-ignore-overlay'),base=document.createElement('canvas');
        base.width=image.width;base.height=image.height;
        if(!canvas.hidden && canvas.width===image.width && canvas.height===image.height) base.getContext('2d',{willReadFrequently:true}).drawImage(canvas,0,0);
        canvas.width=image.width;canvas.height=image.height;canvas.getContext('2d').drawImage(base,0,0);
        this.gesture.overlayBase=base;
      }
      runtime.localBrushPointerId=event.pointerId;stage.setPointerCapture(event.pointerId);stage.focus({preventScroll:true});
      if(runtime.previewTool==='recover') {
        runtime.previewPaintCanvas.width=image.width;runtime.previewPaintCanvas.height=image.height;
        runtime.previewPaintContext.drawImage(this.recovery.before,0,0);
      }
      this.appendLocalSamples(event);this.renderLocalGesture();runtime.updateBrushCursor(event.clientX,event.clientY);runtime.syncHistoryButtons();
    },true);
    stage.addEventListener('pointermove',event => {
      if(event.pointerId!==runtime.localBrushPointerId) return;
      event.preventDefault();event.stopImmediatePropagation();this.appendLocalSamples(event);
      runtime.brushCursorPosition={x:event.clientX,y:event.clientY};
      if(!this.frame) this.frame=requestAnimationFrame(() => {this.frame=null;this.renderLocalGesture();runtime.updateBrushCursor();});
    },true);
    for(const type of ['pointerup','pointercancel']) stage.addEventListener(type,event => {void this.finishLocalGesture(event).catch(runtime.notifyError);},true);
    document.querySelector('#preview-ignore-enabled').addEventListener('change',event => {
      const image=runtime.currentPreviewImage();if(image) runtime.vm.setIgnoreState(image.id,event.target.checked);
    });
    document.querySelector('#preview-ignore-visible').addEventListener('change',() => {
      runtime.syncIgnoreVisibility();runtime.scheduleSavePreferences();
    });
    document.querySelector('#preview-ignore-toggle').addEventListener('click',() => {
      const checkbox=document.querySelector('#preview-ignore-visible');
      checkbox.checked=!checkbox.checked;runtime.syncIgnoreVisibility();runtime.scheduleSavePreferences();
    });
    runtime.syncIgnoreVisibility();
    document.querySelector('#preview-ignore-clear').addEventListener('click',() => {
      const image=runtime.currentPreviewImage();if(image) runtime.vm.setIgnoreState(image.id,true,true);
    });
    runtime.vm.subscribe(() => {runtime.updateIgnoreOverlay();if(runtime.previewTool==='recover') queueMicrotask(() => void runtime.prepareRecoverBrush());});
  }
}
