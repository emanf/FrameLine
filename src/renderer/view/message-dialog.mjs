let messageQueue = Promise.resolve();

export function showMessage(options) {
  const result = messageQueue.then(() => presentMessage(options));
  messageQueue = result.then(() => {}, () => {});
  return result;
}

function presentMessage({ title, message, actions, scope = null }) {
  const dialog = document.querySelector("#message-dialog");
  const closeButton = document.querySelector("#message-close");
  const choices = document.querySelector("#message-actions");
  const scopeField = document.querySelector("#message-scope-field");
  const scopeSelect = document.querySelector("#message-scope");
  document.querySelector("#message-title").textContent = title;
  document.querySelector("#message-text").textContent = message;
  scopeField.hidden = !scope;
  scopeSelect.replaceChildren();
  for (const option of scope?.options ?? []) {
    const element = document.createElement("option");
    element.value = option.value;
    element.textContent = option.label;
    scopeSelect.append(element);
  }
  scopeSelect.value = scope?.value ?? "";
  choices.replaceChildren();
  dialog.returnValue = "";
  return new Promise(resolve => {
    const finish = action => dialog.close(JSON.stringify({ action, scope: scopeSelect.value }));
    const cancel = event => { event?.preventDefault(); finish("cancel"); };
    const onClose = () => {
      const result = dialog.returnValue ? JSON.parse(dialog.returnValue) : { action: "cancel" };
      closeButton.removeEventListener("click", cancel);
      dialog.removeEventListener("cancel", cancel);
      dialog.removeEventListener("close", onClose);
      choices.replaceChildren();
      resolve(result);
    };
    for (const { label, value, primary = false } of actions) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = primary ? "primary-button secondary-button" : "secondary-button";
      button.dataset.action = value;
      button.textContent = label;
      button.addEventListener("click", () => finish(value));
      choices.append(button);
    }
    closeButton.addEventListener("click", cancel);
    dialog.addEventListener("cancel", cancel);
    dialog.addEventListener("close", onClose);
    dialog.showModal();
    // Cancel receives initial focus for destructive confirmations. Every
    // button remains keyboard accessible, and Escape always cancels.
    (choices.querySelector('[data-action="cancel"]') ?? choices.firstElementChild)?.focus();
  });
}
