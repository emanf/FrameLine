/** Render registered tool groups while retaining accessible names and theme classes. */
export class ToolToolbarView {
  constructor(registry) { this.registry = registry; }
  mount(tool) {
    let button = document.getElementById(tool.buttonId);
    if (!button) {
      button = document.createElement('button'); button.id = tool.buttonId;
      button.type = 'button'; button.className = 'preview-tool-button'; button.disabled = tool.definition.mode !== 'pointer';
      const icon = document.createElement('span'); icon.className = 'material-icon';
      icon.setAttribute('aria-hidden','true'); icon.textContent = tool.definition.icon; button.append(icon);
      const group = document.querySelector(`.preview-toolbox [data-tool-group="${tool.definition.group}"]`);
      if (group) group.append(button);
      else if (tool.definition.group === 'clear') document.querySelector('.preview-toolbox').prepend(button);
      else document.querySelector('.preview-toolbox').append(button);
    }
    button.dataset.tooltip = tool.definition.tooltip ?? tool.name;
    button.setAttribute('aria-label', tool.definition.ariaLabel ?? tool.name);
    if (tool.definition.mode !== 'action') button.setAttribute('aria-pressed','false');
    button.addEventListener('click', () => Promise.resolve(tool.activate()).catch(error => tool.context.reportError(error)));
  }
}
