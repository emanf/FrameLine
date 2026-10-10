import { IMAGE_SIZE_PRESETS, validateNewImageOptions, cornerBackground } from "../model/new-image.mjs";
import { originalImage } from "../model/image-effects.mjs";
import { imageUrl } from "./timeline-view.mjs";

async function sampleOriginal(image) {
  const original = originalImage(image);
  const source = new Image();
  source.src = imageUrl(original.path);
  await source.decode();
  // Only allocate four pixels, even when the imported image is very large.
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 2;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  const corners = [[0, 0], [source.naturalWidth - 1, 0], [0, source.naturalHeight - 1], [source.naturalWidth - 1, source.naturalHeight - 1]];
  corners.forEach(([x, y], index) => context.drawImage(source, x, y, 1, 1, index % 2, Math.floor(index / 2), 1, 1));
  const data = context.getImageData(0, 0, 2, 2).data;
  return { width: source.naturalWidth, height: source.naturalHeight, samples: corners.map((_, index) => [...data.slice(index * 4, index * 4 + 4)]) };
}

export async function requestNewImageOptions(image) {
  const defaults = { width: 1920, height: 1080, transparent: true, color: "#ffffff" };
  let samples = [];
  let description = "Choose a standard size or enter your own dimensions in pixels.";
  if (image) {
    Object.assign(defaults, originalImage(image).dimensions);
    try {
      const sampled = await sampleOriginal(image);
      samples = sampled.samples;
      Object.assign(defaults, sampled, cornerBackground(samples));
      description = `Size from ${image.name}. ${defaults.detected ? "Background suggested from its four corners." : "Corners suggest transparency or no single background color."}`;
    } catch {
      description = `Size from ${image.name}. Its corners could not be sampled; choose a background below.`;
    }
  }
  const dialog = document.querySelector("#create-image-dialog");
  const form = document.querySelector("#create-image-form");
  const width = document.querySelector("#create-image-width");
  const height = document.querySelector("#create-image-height");
  const count = document.querySelector("#create-image-count");
  const preset = document.querySelector("#create-image-preset");
  const transparent = document.querySelector("#create-image-transparent");
  const color = document.querySelector("#create-image-color");
  const error = document.querySelector("#create-image-error");
  const preview = document.querySelector("#create-image-preview");
  width.value = String(defaults.width);
  height.value = String(defaults.height);
  count.value = "1";
  transparent.checked = defaults.transparent;
  color.value = defaults.color;
  error.hidden = true;
  document.querySelector("#create-image-description").textContent = description;
  preset.replaceChildren(new Option("Custom size", "custom"), ...IMAGE_SIZE_PRESETS.map((item, index) => new Option(item.label, String(index))));
  const cornerSwatches = document.querySelector("#create-image-corners");
  cornerSwatches.replaceChildren();
  ["Top left", "Top right", "Bottom left", "Bottom right"].forEach((label, index) => {
    if (!samples[index]) return;
    const [r, g, b, a] = samples[index];
    const swatch = document.createElement("span");
    swatch.className = "create-image-corner";
    swatch.style.setProperty("--corner-color", `rgba(${r}, ${g}, ${b}, ${a / 255})`);
    swatch.dataset.tooltip = `${label}: ${a === 0 ? "transparent" : `RGB ${r}, ${g}, ${b} · ${Math.round(a / 255 * 100)}% opacity`}`;
    swatch.setAttribute("aria-label", swatch.dataset.tooltip);
    cornerSwatches.append(swatch);
  });
  document.querySelector("#create-image-corner-field").hidden = !samples.length;
  const sync = () => {
    const index = IMAGE_SIZE_PRESETS.findIndex(item => item.width === Number(width.value) && item.height === Number(height.value));
    preset.value = index < 0 ? "custom" : String(index);
    const ratio = Math.max(1 / 100, Math.min(100, Number(width.value) / Number(height.value) || 1));
    preview.style.width = `${Math.min(200, 110 * ratio)}px`;
    preview.style.height = `${Math.min(110, 200 / ratio)}px`;
    preview.style.backgroundColor = color.value;
    preview.classList.toggle("solid-background", !transparent.checked);
    document.querySelector("#create-image-color-value").textContent = color.value;
    document.querySelector("#create-image-size-value").textContent = `${width.value || "—"} × ${height.value || "—"} px`;
    error.hidden = true;
  };
  const changePreset = () => {
    const item = IMAGE_SIZE_PRESETS[Number(preset.value)];
    if (item) { width.value = String(item.width); height.value = String(item.height); }
    sync();
  };
  const changeColor = () => { transparent.checked = false; sync(); };
  sync();
  dialog.returnValue = "";
  return new Promise(resolve => {
    let result = null;
    const submit = event => {
      event.preventDefault();
      try {
        result = validateNewImageOptions({ width: width.value, height: height.value, count: count.value, transparent: transparent.checked, color: color.value });
        dialog.close();
      } catch (validationError) {
        error.textContent = validationError.message;
        error.hidden = false;
      }
    };
    const cancel = event => { event.preventDefault(); dialog.close(); };
    const buttons = [document.querySelector("#create-image-close"), document.querySelector("#create-image-cancel")];
    const onClose = () => {
      form.removeEventListener("submit", submit);
      dialog.removeEventListener("cancel", cancel);
      dialog.removeEventListener("close", onClose);
      buttons.forEach(button => button.removeEventListener("click", cancel));
      [width, height, count, transparent].forEach(field => field.removeEventListener("input", sync));
      preset.removeEventListener("change", changePreset);
      color.removeEventListener("input", changeColor);
      resolve(result);
    };
    form.addEventListener("submit", submit);
    dialog.addEventListener("cancel", cancel);
    dialog.addEventListener("close", onClose);
    buttons.forEach(button => button.addEventListener("click", cancel));
    [width, height, count, transparent].forEach(field => field.addEventListener("input", sync));
    preset.addEventListener("change", changePreset);
    color.addEventListener("input", changeColor);
    dialog.showModal();
    width.focus();
    width.select();
  });
}
