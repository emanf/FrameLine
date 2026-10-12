import {imageUrl} from './view-format.mjs';
import {TimelineCleanupThumbnails} from './timeline-cleanup-thumbnails.mjs';

const numberFields = new Set(['from','to','every','offset','keep','skip','count','percent']);
const checkFields = new Set(['keepFirst','keepLast']);

/** Render a themed cleanup draft with paged thumbnails and explicit commit/cancel actions. */
export class TimelineCleanupDialog {
  constructor(viewModel, thumbnailServices) {
    this.vm = viewModel;
    this.dialog = document.querySelector('#timeline-cleanup-dialog');
    this.form = document.querySelector('#timeline-cleanup-form');
    this.events = new AbortController();
    this.requestId = 0;
    this.thumbnailRequestId = 0;
    this.thumbnails = new TimelineCleanupThumbnails(thumbnailServices.resolveImage,thumbnailServices.releaseImages);
  }

  field(name) { return this.form.querySelector(`#cleanup-${name}`); }

  /** Read editable options; preview navigation is deliberately outside the draft. */
  readOptions() {
    return Object.fromEntries(Object.keys(this.vm.options).map(name => {
      const field = this.field(name);
      return [name,checkFields.has(name) ? field.checked : numberFields.has(name) ? field.valueAsNumber : field.value];
    }));
  }

  /** Show only controls relevant to the current pattern and scope. */
  renderControls() {
    const {unit,scope,mode} = this.vm.options;
    for (const [name,visible] of Object.entries({range:scope==='custom',every:mode==='every',
      offset:['every','groups'].includes(mode),keep:mode==='groups',skip:mode==='groups',
      count:mode==='count',percent:mode==='percent',custom:mode==='custom',numbering:!['count','percent'].includes(mode)})) {
      const element = this.field(name==='range' ? 'range-fields' : `${name}-field`);
      element.hidden = !visible;
      for (const control of element.querySelectorAll('input,select')) control.disabled = !visible;
    }
    this.field('unit-help').textContent = unit === 'clips'
      ? 'Clip 1 is the first image block, regardless of its duration. Range scope includes whole clips that overlap Start–End.'
      : 'Frame 1 is the first playback frame. Held images count once for each frame of their duration.';
  }

  /** Rebuild at most one page of previews using the currently edited source images. */
  renderResult() {
    this.thumbnails.clear();
    const id = ++this.thumbnailRequestId;
    const {plan,error} = this.vm;
    this.field('error').hidden = !error;
    this.field('error').textContent = error;
    this.field('apply').disabled = !this.field('progress').hidden || !plan?.changed;
    this.field('summary').textContent = plan ? `${plan.keptUnits} of ${plan.maximum} ${this.vm.options.unit} kept · ${plan.removedUnits} removed · ${plan.clips.length} resulting clips · ${plan.frames} timeline frames (${(plan.frames/this.vm.project.fps).toFixed(2)} seconds).${plan.changed ? '' : ' No timeline changes.'}` : 'Adjust the options to preview the result.';
    this.field('pages').textContent = `of ${this.vm.pages || 1}`;
    this.field('page').value = String(this.vm.page+1);
    this.field('page').max = String(this.vm.pages || 1);
    this.field('previous').disabled = !this.field('progress').hidden || !plan || this.vm.page === 0;
    this.field('next').disabled = !this.field('progress').hidden || !plan || this.vm.page+1 >= this.vm.pages;
    const fragment = document.createDocumentFragment();
    const editedCards = [];
    for (const item of this.vm.previewItems()) {
      const card = document.createElement('div'); card.className = 'cleanup-preview-item';
      const image = document.createElement('img'); image.alt = item.image?.name ?? 'Image'; image.loading = 'lazy'; image.decoding = 'async';
      if (item.image) {
        if (item.image.paintStrokes?.length || item.image.crop || item.image.outline) editedCards.push({image:item.image,element:image});
        else image.src = imageUrl(item.image.path);
      }
      const label = document.createElement('span'); label.textContent = `#${item.number}`;
      const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = '×';
      remove.setAttribute('aria-label',`Exclude ${this.vm.options.unit === 'clips' ? 'clip' : 'frame'} ${item.number}`);
      remove.dataset.exclude = item.number;
      remove.disabled = !plan.scope.some(([start,end]) => item.number-1 >= start && item.number-1 < end);
      card.title = `${item.image?.name ?? 'Image'} · Original ${this.vm.options.unit === 'clips' ? 'clip' : 'frame'} ${item.number} → kept position ${item.ordinal}`;
      card.append(image,label,remove); fragment.append(card);
    }
    this.field('preview').replaceChildren(fragment);
    if (editedCards.length) {
      this.setPreviewBusy(true);
      this.thumbnails.render(editedCards).then(() => {
        if (id === this.thumbnailRequestId && !this.events.signal.aborted) this.setPreviewBusy(false);
      }).catch(error => {
        if (id !== this.thumbnailRequestId || this.events.signal.aborted) return;
        this.setPreviewBusy(false);
        this.field('error').hidden = false;
        this.field('error').textContent = `Could not prepare edited image previews: ${error.message}`;
        this.field('apply').disabled = true;
      });
    }
  }

  /** Keep progress and commit/navigation controls consistent while preparing a preview. */
  setPreviewBusy(busy) {
    this.field('progress').hidden = !busy;
    this.field('apply').disabled = busy || !this.vm.plan?.changed;
    this.field('page').disabled = busy;
    this.field('previous').disabled = busy || !this.vm.plan || this.vm.page === 0;
    this.field('next').disabled = busy || !this.vm.plan || this.vm.page+1 >= this.vm.pages;
    this.field('preview').setAttribute('aria-busy',String(busy));
  }

  /** Apply input changes to the draft and refresh the result before enabling commit. */
  update(page = 0) {
    this.thumbnailRequestId = (this.thumbnailRequestId ?? 0)+1;
    this.thumbnails.clear();
    this.vm.options = this.readOptions();
    this.renderControls();
    this.field('apply').disabled = true;
    this.field('progress').hidden = false;
    this.field('previous').disabled = this.field('next').disabled = this.field('page').disabled = true;
    this.field('preview').setAttribute('aria-busy','true');
    clearTimeout(this.computeTimer);
    const id = ++this.requestId;
    this.computeTimer = setTimeout(() => {
      this.pendingPage = page;
      if (this.vm.project.clips.length > 2000 || (this.vm.options.unit === 'frames' && this.vm.ranges.at(-1).endFrame > 20000)) {
        // Retire obsolete jobs so changing a setting never waits behind an older preview.
        this.worker?.terminate();
        this.worker = new Worker(new URL('../model/timeline-cleanup-worker.mjs',import.meta.url),{type:'module'});
        this.worker.onmessage = ({data}) => {
          if (data.id !== this.requestId) return;
          this.vm.accept(data); this.finishUpdate();
        };
        this.worker.onerror = event => {
          if (id !== this.requestId) return;
          event.preventDefault();
          this.vm.accept({error:'The cleanup preview could not be calculated. Close and reopen the dialog to try again.'});
          this.finishUpdate();
        };
        this.worker.postMessage({id,project:this.vm.project,options:this.vm.options,selected:this.vm.selectedIds});
      } else {
        this.vm.update(this.vm.options);
        this.finishUpdate();
      }
    },80);
  }

  /** Publish a finished preview and enable Apply only for a valid timeline change. */
  finishUpdate() {
    this.vm.page = Math.max(0,Math.min(this.vm.pages-1,this.pendingPage));
    this.field('progress').hidden = true;
    this.field('page').disabled = false;
    this.field('preview').setAttribute('aria-busy','false');
    this.renderResult();
  }

  /** Resolve with validated settings on Apply and null on all dismissal paths. */
  open() {
    this.form.reset();
    this.dialog.returnValue = '';
    for (const [name,value] of Object.entries(this.vm.options)) {
      if (checkFields.has(name)) this.field(name).checked = value; else this.field(name).value = String(value);
    }
    this.field('scope').querySelector('[value="selected"]').disabled = !this.vm.selectedIds.length;
    const listen = (element,event,callback) => element.addEventListener(event,callback,{signal:this.events.signal});
    return new Promise(resolve => {
      const changed = event => {
        if (event.target === this.field('page')) return;
        if (event.target === this.field('unit')) this.field('to').value = String(event.target.value === 'clips' ? this.vm.project.clips.length : this.vm.ranges.at(-1)?.endFrame ?? 1);
        this.update();
      };
      listen(this.form,'input',changed); listen(this.form,'change',changed);
      const page = value => { this.vm.page = Math.max(0,Math.min(this.vm.pages-1,value)); this.renderResult(); };
      listen(this.field('previous'),'click',()=>page(this.vm.page-1));
      listen(this.field('next'),'click',()=>page(this.vm.page+1));
      listen(this.field('page'),'change',()=>page(Number.isSafeInteger(this.field('page').valueAsNumber) ? this.field('page').valueAsNumber-1 : 0));
      listen(this.field('preview'),'click',event => {
        const button = event.target.closest('[data-exclude]');
        if (!button || button.disabled) return;
        this.field('exclude').value = [this.field('exclude').value.trim(),button.dataset.exclude].filter(Boolean).join(', ');
        this.update(this.vm.page);
      });
      listen(this.field('reset-overrides'),'click',()=>{this.field('include').value = this.field('exclude').value = ''; this.update();});
      for (const name of ['close','cancel']) listen(this.field(name),'click',()=>this.dialog.close());
      listen(this.form,'submit',event => {event.preventDefault(); if (!this.field('apply').disabled) this.dialog.close('apply');});
      listen(this.dialog,'close',()=>{this.events.abort(); clearTimeout(this.computeTimer); this.worker?.terminate(); this.thumbnails.clear(); resolve(this.dialog.returnValue === 'apply' ? {options:{...this.vm.options},plan:this.vm.plan} : null);});
      this.update(); this.dialog.showModal(); this.field('every').focus();
    });
  }
}
