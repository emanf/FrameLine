export function initializeTooltips() {
  const tooltip = document.createElement("div");
  tooltip.id = "app-tooltip";
  tooltip.className = "app-tooltip";
  tooltip.setAttribute("role", "tooltip");
  tooltip.setAttribute("popover", "manual");
  tooltip.hidden = true;
  document.body.append(tooltip);

  let owner = null;
  let hovered = null;
  let focused = null;
  let overTooltip = false;
  let keyboardMode = true;
  let showTimer;
  let hideTimer;

  const targetFor = node => node instanceof Element ? node.closest("[data-tooltip]") : null;
  const textFor = target => target?.dataset.tooltip?.trim() ?? "";
  const allowed = target => target?.isConnected && target.getClientRects().length && textFor(target)
    && !target.matches('select:open, [aria-expanded="true"]')
    && (!document.querySelector("dialog:modal") || target.closest("dialog:modal"));

  function hide() {
    clearTimeout(showTimer);
    clearTimeout(hideTimer);
    if (owner) {
      const ids = (owner.getAttribute("aria-describedby") ?? "").split(/\s+/).filter(id => id && id !== tooltip.id);
      if (ids.length) owner.setAttribute("aria-describedby", ids.join(" "));
      else owner.removeAttribute("aria-describedby");
    }
    if (tooltip.matches(":popover-open")) tooltip.hidePopover();
    tooltip.hidden = true;
    owner = null;
    overTooltip = false;
  }

  function dismiss() {
    hovered = null;
    focused = null;
    hide();
  }

  function position() {
    const anchor = owner.getBoundingClientRect();
    const box = tooltip.getBoundingClientRect();
    const margin = 8;
    const gap = 7;
    const left = Math.max(margin, Math.min(window.innerWidth - box.width - margin,
      anchor.left + anchor.width / 2 - box.width / 2));
    const below = anchor.bottom + gap;
    const top = below + box.height <= window.innerHeight - margin ? below : anchor.top - box.height - gap;
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${Math.max(margin, Math.min(window.innerHeight - box.height - margin, top))}px`;
  }

  function request(target) {
    clearTimeout(hideTimer);
    if (owner === target) return;
    hide();
    if (!allowed(target)) return;
    owner = target;
    showTimer = setTimeout(() => {
      if (!allowed(owner)) { hide(); return; }
      tooltip.textContent = textFor(owner);
      tooltip.hidden = false;
      // The top layer keeps tooltips visible above modal dialogs and panels.
      tooltip.showPopover();
      position();
      const ids = new Set((owner.getAttribute("aria-describedby") ?? "").split(/\s+/).filter(Boolean));
      ids.add(tooltip.id);
      owner.setAttribute("aria-describedby", [...ids].join(" "));
    }, 400);
  }

  function leave() {
    if (overTooltip) return;
    if (hovered || focused) { request(hovered ?? focused); return; }
    // Allow the pointer to cross the gap and hover the tooltip to read it.
    clearTimeout(hideTimer);
    hideTimer = setTimeout(hide, 120);
  }

  document.addEventListener("pointerover", event => {
    if (event.pointerType !== "mouse" || event.buttons) return;
    if (tooltip.contains(event.target)) { overTooltip = true; clearTimeout(hideTimer); return; }
    hovered = targetFor(event.target);
    if (hovered) request(hovered);
    else leave();
  });
  document.addEventListener("pointerout", event => {
    if (event.pointerType !== "mouse") return;
    if (tooltip.contains(event.target)) {
      if (tooltip.contains(event.relatedTarget)) return;
      overTooltip = false;
    } else if (hovered?.contains(event.relatedTarget)) return;
    else hovered = null;
    leave();
  });
  document.addEventListener("focusin", event => {
    if (!keyboardMode) return;
    focused = targetFor(event.target);
    if (focused) request(focused);
  });
  document.addEventListener("focusout", () => { focused = null; leave(); });
  document.addEventListener("pointerdown", () => { keyboardMode = false; dismiss(); }, true);
  document.addEventListener("keydown", event => {
    keyboardMode = true;
    if (event.key === "Escape" && !tooltip.hidden) {
      event.preventDefault();
      event.stopPropagation();
    }
    if (event.key !== "Shift" && event.key !== "Control" && event.key !== "Alt" && event.key !== "Meta") dismiss();
  }, true);
  document.addEventListener("scroll", event => {
    if (!tooltip.contains(event.target)) dismiss();
  }, true);
  document.addEventListener("dragstart", dismiss, true);
  document.addEventListener("pointercancel", dismiss, true);
  window.addEventListener("blur", dismiss);
  window.addEventListener("resize", dismiss);
  new MutationObserver(() => {
    if (!owner) return;
    if (!allowed(owner)) { dismiss(); return; }
    if (!tooltip.hidden && tooltip.textContent !== textFor(owner)) {
      tooltip.textContent = textFor(owner);
      position();
    }
  }).observe(document.body, { childList: true, subtree: true, attributes: true,
    attributeFilter: ["data-tooltip", "open", "hidden"] });
}
