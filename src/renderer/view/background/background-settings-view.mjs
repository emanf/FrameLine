/** Validate removal settings and synchronize controls and saved presets. */
export class BackgroundSettingsView {
  constructor(session) { this.session = session; }

  /** Collect active edge-color cleanup parameters and optional custom color endpoints. */
  fringeOptions() {
    const session = this.session;
    return {
    method: session.fringeMethod.value,
    ...Object.fromEntries(session.fringeFields.map(({ name, input }) => [name, Number(input.value)])),
    color: session.fringeColorMode.value === "custom" ? session.fringeColor.value.match(/[a-f\d]{2}/gi).map((channel) => parseInt(channel, 16)) : null,
    ...(session.fringeMethod.value === 'recover' && session.fringeKeepCustom.checked
      ? {keep_color:session.fringeKeepColor.value.match(/[a-f\d]{2}/gi).map(c => parseInt(c,16))} : {}),
    };

  }

  /** Capture cleanup settings, including disabled values, for saved removal presets. */
  storedFringeOptions() {
    const session = this.session;
    return {
    fringe_cleanup_enabled: session.fringeEnabled.checked,
    fringe_cleanup: session.fringeOptions(),
    fringe_color: session.fringeColor.value,
    fringe_keep_custom: session.fringeKeepCustom.checked,
    fringe_keep_color: session.fringeKeepColor.value,
    };

  }

  /** Build a processing request with active removal, refinement, and protection settings. */
  currentOptions() {
    const session = this.session;
    const options = {
      mode: session.method.value,
      background_source: session.backgroundSource.value,
      aggressive: session.aggressive.checked,
      aggressive_amount: Number(session.aggressiveAmount.value),
      tolerance: Number(session.tolerance.value),
      softness: !session.softnessEnabled.checked || session.smoothingEnabled.checked || (session.fringeEnabled.checked && session.fringeMethod.value === 'recover' && Number(document.querySelector('#background-fringe-strength').value)>0) ? 0 : Number(session.softness.value),
      edge_smoothing: session.smoothingEnabled.checked ? Number(session.smoothingAmount.value) : 0,
      spill: Number(session.spill.value),
      spill_color: session.spillColor.value.match(/[a-f\d]{2}/gi).map((channel) => parseInt(channel, 16)),
      connected_only: document.querySelector("#background-connected").checked,
      key_color: session.keyColor.value.match(/[a-f\d]{2}/gi).map((channel) => parseInt(channel, 16))
    };
    if (session.edgeTintEnabled.checked) {
      options.edge_color = session.edgeColor.value.match(/[a-f\d]{2}/gi).map((channel) => parseInt(channel, 16));
      options.edge_tint = Number(session.edgeTint.value);
    }
    if (session.fringeEnabled.checked) options.fringe_cleanup = session.fringeOptions();
    if (session.method.value === "sample" && session.sampleState.point) options.sample_point = session.sampleState.point;
    if (session.ignoreStrokes.length) options.ignore_strokes = structuredClone(session.ignoreStrokes);
    return options;
    
  }

  /** Persist the removal controls without saving transient ignore strokes. */
  saveLastUsed() {
    const session = this.session;
    const options = session.currentOptions();
    localStorage.setItem("frameline.background.last", JSON.stringify({
      settings_version: session.runtime.BACKGROUND_SETTINGS_VERSION,
      mode: options.mode,
      background_source: options.background_source,
      aggressive: options.aggressive,
      aggressive_amount: options.aggressive_amount,
      tolerance: options.tolerance,
      softness: Number(session.softness.value),
      softness_enabled: session.softnessEnabled.checked,
      edge_smoothing: Number(session.smoothingAmount.value),
      edge_smoothing_enabled: session.smoothingEnabled.checked,
      ...session.storedFringeOptions(),
      spill: options.spill,
      spill_color: session.spillColor.value,
      edge_tint_enabled: session.edgeTintEnabled.checked,
      edge_color: session.edgeColor.value,
      edge_tint: Number(session.edgeTint.value),
      connected_only: options.connected_only,
      key_color: session.keyColor.value
    }));
    
  }

  /** Show controls and sampling hints relevant to the selected removal mode. */
  syncMethod() {
    const session = this.session;
    const sampleMode = session.method.value === "sample";
    const autoMode = session.method.value === 'auto';
    document.querySelector('#background-auto-settings').hidden = !autoMode;
    document.querySelector('#background-aggressive-settings').hidden = !session.aggressive.checked;
    document.querySelector('#background-aggressive-value').textContent = `${session.aggressiveAmount.value}%`;
    document.querySelector("#background-key-color-field").hidden = sampleMode || (autoMode && session.backgroundSource.value === 'auto');
    document.querySelector("#background-sample-color-field").hidden = !sampleMode;
    document.querySelector("#background-spill-field").hidden = session.method.value !== 'chroma';
    document.querySelector("#background-spill").hidden = session.method.value !== 'chroma';
    document.querySelector("#background-spill-color-field").hidden = session.method.value !== 'chroma';
    document.querySelector("#background-connected-field").hidden = !sampleMode;
    session.sampleHint.hidden = session.ignoreEnabled || !sampleMode;
    session.sampleHint.textContent = session.sampleState.point
      ? `Sample selected: RGB ${session.sampleState.color.join(", ")}. Click another background point to change it.`
      : "Click the background in the image to sample its color.";
    session.previewFrame.style.cursor = session.ignoreEnabled || sampleMode ? "crosshair" : "grab";
    document.querySelector("#background-apply-all").disabled = sampleMode && !session.sampleState.point;
    session.scheduleBackgroundPreview();
    
  }

  /** Synchronize option labels, save settings, and refresh the pending preview. */
  updateValues() {
    const session = this.session;
    document.querySelector("#background-tolerance-value").textContent = session.tolerance.value;
    document.querySelector("#background-softness-value").textContent = session.softness.value;
    const recover = session.fringeEnabled.checked && session.fringeMethod.value === 'recover' && Number(document.querySelector('#background-fringe-strength').value)>0;
    session.softness.disabled = !session.softnessEnabled.checked || session.smoothingEnabled.checked || recover;
    document.querySelector('#background-softness-hint').hidden = !session.softnessEnabled.checked || !(session.smoothingEnabled.checked || recover);
    document.querySelector('#background-fringe-keep-controls').hidden = session.fringeMethod.value !== 'recover';
    document.querySelector('#background-fringe-keep-field').hidden = !session.fringeKeepCustom.checked;
    document.querySelector('#background-fringe-hint').textContent = session.fringeMethod.value === 'recover'
      ? 'Like the Color Cleanup brush: recover foreground color and transparency from mixed pixels. Nearby subject colors are used automatically.'
      : 'Replace matching edge colors using nearby subject colors, keeping pixel opacity.';
    document.querySelector("#background-edge-smoothing-settings").hidden = !session.smoothingEnabled.checked;
    document.querySelector("#background-edge-smoothing-amount-value").textContent = `${session.smoothingAmount.value}%`;
    document.querySelector("#background-fringe-settings").hidden = !session.fringeEnabled.checked;
    document.querySelector("#background-fringe-color-field").hidden = session.fringeColorMode.value !== "custom";
    for (const field of session.fringeFields) if (field.output) field.output.textContent = `${field.input.value}${field.suffix}`;
    document.querySelector("#background-spill-value").textContent = `${session.spill.value}%`;
    document.querySelector("#background-edge-tint-value").textContent = `${session.edgeTint.value}%`;
    document.querySelector("#background-edge-color-field").hidden = !session.edgeTintEnabled.checked;
    session.saveLastUsed();
    session.scheduleBackgroundPreview();
    
  }

  /** Clamp cleanup fields and preserve a valid minimum/maximum opacity interval. */
  updateFringeValue(event) {
    const session = this.session;
    const field = session.fringeFields.find(({ input }) => input === event.target);
    field.input.value = String(Math.round(session.runtime.clampNumber(field.input.value, field.min, field.max, field.defaultValue)));
    if (Number(session.fringeMinimum.value) > Number(session.fringeMaximum.value)) {
      if (field.name === "max_opacity") session.fringeMinimum.value = session.fringeMaximum.value;
      else session.fringeMaximum.value = session.fringeMinimum.value;
    }
    session.updateValues();
    
  }
}
