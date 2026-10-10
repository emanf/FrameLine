import { ControllerBase } from '../controller-base.mjs';


/** Validate numeric input and custom preset values. */
export class NumberDialogView extends ControllerBase {
  /** Collect and validate a custom numeric preset in the themed dialog. */
  requestCustomNumber({ title, label, value, min, max, errorMessage }) {
    const runtime = this.application;
    const dialog = document.querySelector("#custom-number-dialog");
    const form = document.querySelector("#custom-number-form");
    const input = document.querySelector("#custom-number-input");
    const error = document.querySelector("#custom-number-error");
    document.querySelector("#custom-number-title").textContent = title;
    document.querySelector("#custom-number-label").textContent = label;
    input.min = String(min);
    input.max = String(max);
    input.value = String(value);
    error.hidden = true;
    dialog.returnValue = "";
  
    return new Promise((resolve) => {
      const cancelButton = document.querySelector("#custom-number-cancel");
      const close = () => dialog.close();
      const cleanup = () => {
        cancelButton.removeEventListener("click", close);
        form.removeEventListener("submit", submit);
        dialog.removeEventListener("close", onClose);
      };
      const onClose = () => {
        cleanup();
        resolve(dialog.returnValue === "" ? null : Number(dialog.returnValue));
      };
      const submit = (event) => {
        event.preventDefault();
        const parsed = Number(input.value);
        if (!Number.isFinite(parsed) || parsed <= min || parsed > max) {
          error.textContent = errorMessage;
          error.hidden = false;
          input.focus();
          return;
        }
        dialog.returnValue = String(parsed);
        dialog.close();
      };
      cancelButton.addEventListener("click", close);
      form.addEventListener("submit", submit);
      dialog.addEventListener("close", onClose);
      dialog.showModal();
      input.focus();
      input.select();
    });
  }

  /** Insert a valid custom preset without duplicating an existing option. */
  addCustomSelectValue(select, value, suffix) {
    const runtime = this.application;
    const valueString = String(value);
    if (![...select.options].some((option) => option.value === valueString)) {
      const option = document.createElement("option");
      option.value = valueString;
      option.textContent = `${value}${suffix} (custom)`;
      select.insertBefore(option, select.querySelector('option[value="add"]'));
    }
    select.value = valueString;
  }
}
