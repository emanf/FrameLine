import { ToolOptionsViewModel } from '../viewmodel/tool-options-view-model.mjs';

/** Build themed controls from plugin schemas and synchronize validated option values. */
export class ToolControlsView {
  constructor(registry) { this.registry = registry; this.models = new Map(); }

  /** Mount processor controls before preferences or event handlers inspect the DOM. */
  mount(tool) {
    if (!tool.isProcessor) return;
    const id = tool.id;
    const existing = document.querySelector(`#preview-${id}-controls`);
    const panel = document.createElement('div');
    panel.id = `preview-${id}-controls`;
    panel.className = 'brush-controls';
    panel.hidden = true;
    const help = document.createElement('p');
    help.className = 'preview-options-content';
    help.textContent = tool.definition.description ?? tool.name;
    panel.append(help);
    this.models.set(id, new ToolOptionsViewModel(tool.definition.fields));
    for (const field of tool.definition.fields ?? []) {
      const row = document.createElement('div'); row.className = 'tool-option';
      const label = document.createElement('label'); label.htmlFor = `preview-${id}-${field.key}`;
      label.textContent = field.label + ' ';
      const output = document.createElement('output'); output.id = `${label.htmlFor}-value`; label.append(output);
      const input = document.createElement(field.type === 'select' ? 'select' : 'input');
      input.id = label.htmlFor; input.dataset.toolField = field.key; input.dataset.toolId = id;
      input.setAttribute(`data-${id}-field`, field.key);
      if (field.type === 'select') {
        for (const option of field.options) input.add(new Option(option.label, option.value));
      } else {
        input.type = field.type;
        if (['range','number'].includes(field.type)) {
          input.min = field.min; input.max = field.max; input.step = field.step ?? 1;
        }
      }
      input.setAttribute('aria-label', field.label);
      input.defaultValue = String(field.defaultValue); input.value = String(field.defaultValue);
      if (field.type === 'checkbox') input.checked = field.defaultValue;
      row.append(label, input); panel.append(row);
    }
    const status = document.createElement('p'); status.id = `preview-${id}-status`;
    status.className = 'preview-options-content'; status.setAttribute('role','status');
    status.setAttribute('aria-live','polite'); status.textContent = 'Enable to preview. Apply commits changes.';
    const progress = document.createElement('progress'); progress.id = `preview-${id}-progress`;
    progress.className = 'tool-processing-progress'; progress.hidden = true;
    progress.setAttribute('aria-label', `${tool.name} processing`);
    const label = document.createElement('label'); label.className = 'field-label'; label.htmlFor = `preview-${id}-scope`; label.textContent = 'Apply to:';
    const scope = document.createElement('select'); scope.id = label.htmlFor;
    scope.add(new Option('This image','current')); scope.add(new Option('All images','all'));
    const actions = document.createElement('div'); actions.className = 'tool-actions';
    for (const action of ['apply','discard']) {
      const button = document.createElement('button'); button.type = 'button'; button.id = `preview-${id}-${action}`;
      button.className = action === 'apply' ? 'primary-button secondary-button' : 'secondary-button';
      button.disabled = true; button.textContent = action === 'apply' ? `Apply ${tool.name}` : 'Discard'; actions.append(button);
    }
    panel.append(status, progress, label, scope, actions);
    if (existing) existing.replaceWith(panel);
    else document.querySelector('#preview-brush-controls').before(panel);
    this.read(id);
  }

  /** Read native controls through the DOM-independent validation model. */
  read(id) {
    const model = this.models.get(id);
    for (const input of document.querySelectorAll(`[data-tool-id="${id}"]`)) {
      model.set(input.dataset.toolField, input.type === 'checkbox' ? input.checked : input.value, false);
    }
    const values = model.snapshot(); this.write(id, values); return values;
  }

  /** Restore options after Undo, project preferences, or a plugin defaults reset. */
  write(id, values) {
    const model = this.models.get(id); model.restore(values);
    for (const field of model.fields) {
      const input = document.getElementById(`preview-${id}-${field.key}`);
      const value = model.values[field.key];
      if (input.type === 'checkbox') input.checked = value; else input.value = value;
      document.getElementById(`${input.id}-value`).value = `${value}${field.suffix ?? ''}`;
    }
  }
}
