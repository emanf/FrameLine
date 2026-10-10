const extensionPattern = /\.(png|jpe?g|webp|bmp|gif|tiff?|svg|avif)$/i;
const nameKey = name => name.normalize('NFC').toLowerCase();

export function splitImageName(name) {
  const extension = name.match(extensionPattern)?.[0] ?? '';
  return {name:extension ? name.slice(0,-extension.length) : name, extension};
}

function validateName(name) {
  if (!name || name.length > 255 || /[<>:"/\\|?*\x00-\x1f]/.test(name) || /[. ]$/.test(name)
    || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) {
    throw new Error('Names must be 1–255 characters and cannot contain filename symbols, reserved device names, or end with a dot or space.');
  }
}

export function imageRenamePlan(images, options, selectedIds = []) {
  if (!['all','selected'].includes(options.scope) || !['sequence','pattern'].includes(options.mode)
    || !['import','reverse','name'].includes(options.order) || !['keep','lower','upper'].includes(options.letterCase)) {
    throw new Error('Choose valid rename, scope, order, and letter-case options.');
  }
  const {start,step,padding} = options;
  if (!Number.isSafeInteger(start) || start < 0 || !Number.isSafeInteger(step) || step < 1
    || typeof padding !== 'string' || !/^0{1,12}$/.test(padding)) {
    throw new Error('Use a non-negative starting number, a positive whole-number step, and 1–12 zeros for number format.');
  }
  for (const field of ['baseName','separator','suffix','pattern']) {
    if (typeof options[field] !== 'string') throw new Error('Rename text fields must contain text.');
  }
  for (const field of ['preserveExtension','makeUnique']) {
    if (typeof options[field] !== 'boolean') throw new Error('Choose valid extension and duplicate-name options.');
  }
  const selected = new Set(selectedIds);
  const targets = images.filter(image => options.scope === 'all' || selected.has(image.id));
  if (!targets.length) throw new Error('Select at least one image to rename.');
  if (!Number.isSafeInteger(start+(targets.length-1)*step)) throw new Error('The last sequence number is too large.');
  if (options.order === 'reverse') targets.reverse();
  if (options.order === 'name') targets.sort((a,b)=>a.name.localeCompare(b.name,undefined,{numeric:true,sensitivity:'base'}));
  if (options.mode === 'pattern' && /[{}]/.test(
    options.pattern.replace(/\{(name|number|index|ext)\}/g,''))) {
    throw new Error('Pattern tokens are {name}, {number}, {index}, and {ext}.');
  }
  const ids = new Set(targets.map(image=>image.id));
  const used = new Set(images.filter(image=>!ids.has(image.id)).map(image=>nameKey(image.name)));
  return targets.map((image,index)=>{
    const original = splitImageName(image.name);
    const extension = original.extension || splitImageName(image.path).extension;
    const number = String(start+index*step).padStart(padding.length,'0');
    let name = options.mode === 'pattern'
      ? options.pattern.replace(/\{(name|number|index|ext)\}/g,(_match,token)=>({
          name:original.name,number,index:String(index+1),ext:extension,
        })[token])
      : `${options.baseName}${options.separator}${number}${options.suffix}${options.preserveExtension ? extension : ''}`;
    name = name.trimStart();
    if (options.letterCase === 'lower') name = name.toLowerCase();
    if (options.letterCase === 'upper') name = name.toUpperCase();
    validateName(name);
    const base = splitImageName(name);
    let unique = name;
    let counter = 2;
    while (used.has(nameKey(unique))) {
      if (!options.makeUnique) throw new Error(`The name “${name}” is already used. Enable Make names unique or change the pattern.`);
      unique = `${base.name} (${counter++})${base.extension}`;
      validateName(unique);
    }
    used.add(nameKey(unique));
    return {id:image.id,oldName:image.name,name:unique};
  });
}
