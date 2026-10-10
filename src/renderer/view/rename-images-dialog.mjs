import {imageRenamePlan} from '../model/image-names.mjs';

export function requestImageRename(images, selectedIds) {
  const dialog = document.querySelector('#rename-images-dialog');
  const form = document.querySelector('#rename-images-form');
  const input = id=>document.querySelector(`#rename-${id}`);
  const scope = input('scope');
  const mode = input('mode');
  const error = input('error');
  const apply = input('apply');
  const preview = input('preview');
  form.reset();
  dialog.returnValue = '';
  scope.querySelector('option[value="selected"]').disabled = !selectedIds.length;
  scope.querySelector('option[value="selected"]').textContent = `Selected images (${selectedIds.length})`;
  scope.querySelector('option[value="all"]').textContent = `All images (${images.length})`;
  const options = ()=>({
    scope:scope.value,mode:mode.value,order:input('order').value,
    baseName:input('base').value,separator:input('separator').value,suffix:input('suffix').value,
    pattern:input('pattern').value,start:input('start').valueAsNumber,step:input('step').valueAsNumber,
    padding:input('padding').value,preserveExtension:input('extension').checked,
    letterCase:input('case').value,makeUnique:input('unique').checked,
  });
  const update = ()=>{
    input('sequence-fields').hidden = mode.value !== 'sequence';
    input('pattern-fields').hidden = mode.value !== 'pattern';
    preview.replaceChildren();
    try {
      const plan = imageRenamePlan(images,options(),selectedIds);
      const changed = plan.filter(item=>item.name!==item.oldName).length;
      for (const item of plan.slice(0,8)) {
        const row = document.createElement('tr');
        for (const name of [item.oldName,item.name]) {
          const cell = document.createElement('td');cell.textContent=name;cell.title=name;row.append(cell);
        }
        preview.append(row);
      }
      input('summary').textContent = `${changed} ${changed === 1 ? 'image' : 'images'} will be renamed${plan.length>8 ? ` · Showing the first 8 of ${plan.length}` : ''}.`;
      error.hidden = true;apply.disabled = !changed;
    } catch (failure) {
      error.textContent = failure.message;error.hidden = false;apply.disabled = true;
      input('summary').textContent = 'Adjust the options to see a preview.';
    }
  };
  return new Promise(resolve=>{
    const close = ()=>dialog.close();
    const submit = event=>{
      event.preventDefault();update();
      if (apply.disabled) return;
      dialog.close(JSON.stringify(options()));
    };
    const cleanup = ()=>{
      form.removeEventListener('input',update);form.removeEventListener('change',update);
      form.removeEventListener('submit',submit);input('close').removeEventListener('click',close);
      input('cancel').removeEventListener('click',close);dialog.removeEventListener('close',cleanup);
      resolve(dialog.returnValue ? JSON.parse(dialog.returnValue) : null);
    };
    form.addEventListener('input',update);form.addEventListener('change',update);
    form.addEventListener('submit',submit);input('close').addEventListener('click',close);
    input('cancel').addEventListener('click',close);dialog.addEventListener('close',cleanup);
    update();dialog.showModal();input('base').focus();input('base').select();
  });
}
