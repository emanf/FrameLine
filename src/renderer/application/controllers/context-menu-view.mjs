import { ControllerBase } from '../controller-base.mjs';


/** Render themed menus with keyboard navigation and focus restoration. */
export class ContextMenuView extends ControllerBase {
  /** Remove the active menu and release its temporary document handlers. */
  closeContextMenu() {
    const runtime = this.application;
    runtime.dismissContextMenu?.();
    document.querySelector('.context-menu')?.remove();
  }

  /** Mount themed actions with keyboard navigation and restore focus when closing. */
  renderContextMenu(x, y, actions, label) {
    const runtime = this.application;
    runtime.closeContextMenu();
    const menu = document.createElement('div');
    menu.className = 'context-menu';
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', label);
    const previousFocus = document.activeElement;
    const dismiss = event => { if (!menu.contains(event.target)) runtime.closeContextMenu(); };
    runtime.dismissContextMenu = () => {
      document.removeEventListener('pointerdown', dismiss);
      document.removeEventListener('click', dismiss);
      menu.remove();
      runtime.dismissContextMenu = null;
    };
    for (const [label, icon, action, disabled = false] of actions) {
      const button = document.createElement("button");
      button.type = 'button';
      button.setAttribute('role', 'menuitem');
      button.setAttribute('aria-label', label);
      button.disabled = disabled;
      const symbol = document.createElement("span");
      symbol.className = "material-icon";
      symbol.textContent = icon;
      symbol.setAttribute("aria-hidden", "true");
      button.textContent = label;
      button.prepend(symbol);
      button.addEventListener("click", async () => {
        runtime.closeContextMenu();
        if (previousFocus?.isConnected) previousFocus.focus({preventScroll:true});
      try { await action(); } catch (error) {
        if (error.code !== "EXPORT_CANCELLED") runtime.notifyError(error);
      }
      });
      menu.append(button);
    }
    document.body.append(menu);
    menu.style.left = `${Math.max(8, Math.min(x, innerWidth - menu.offsetWidth - 8))}px`;
    menu.style.top = `${Math.max(8, Math.min(y, innerHeight - menu.offsetHeight - 8))}px`;
    menu.addEventListener('keydown', event => {
      event.stopPropagation();
      const buttons = [...menu.querySelectorAll('button:not(:disabled)')];
      const index = buttons.indexOf(document.activeElement);
      if (event.key === 'Escape') {
        event.preventDefault(); runtime.closeContextMenu();
        if (previousFocus?.isConnected) previousFocus.focus({preventScroll:true});
      } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault();
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
          : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
        buttons[next]?.focus();
      } else if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault(); document.activeElement?.click();
      } else if (event.key === 'Tab') runtime.closeContextMenu();
    });
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('click', dismiss);
    menu.querySelector('button:not(:disabled)')?.focus({preventScroll:true});
  }
}
