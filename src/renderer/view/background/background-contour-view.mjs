/** Own optional boundary cleanup controls and their saved values. */
export class BackgroundContourView {
  constructor(session) {
    this.session = session;
    this.enabled = document.querySelector('#background-contour-enabled');
    this.settings = document.querySelector('#background-contour-settings');
    this.tolerance = document.querySelector('#background-contour-tolerance');
    this.output = document.querySelector('#background-contour-tolerance-value');
    this.method = document.querySelector('#background-contour-method');
    this.curveSettings = document.querySelector('#background-contour-curve-settings');
    this.preserve = document.querySelector('#background-contour-preserve-corners');
    this.cornerSettings = document.querySelector('#background-contour-corner-settings');
    this.fields = [['strength', 100, 0, 100, '%'], ['radius', 32, 1, 128, ' px'], ['corner_angle', 110, 10, 160, '°']]
      .map(([key, fallback, min, max, suffix]) => ({key, fallback, min, max, suffix,
        input: document.querySelector(`#background-contour-${key.replaceAll('_', '-')}`),
        output: document.querySelector(`#background-contour-${key.replaceAll('_', '-')}-value`)}));
  }

  /** Restore user settings; legacy presets leave contour reshaping disabled. */
  restore(saved) {
    this.enabled.checked = saved?.contour_smoothing_enabled === true;
    this.method.value = saved?.contour_options?.method === 'pixel' ? 'pixel' : 'curve';
    this.tolerance.max = this.method.value === 'pixel' ? '8' : '64';
    this.tolerance.value = String(this.session.runtime.clampNumber(saved?.contour_smoothing, .25, Number(this.tolerance.max), 8));
    this.preserve.checked = saved?.contour_options?.preserve_corners !== false;
    for (const field of this.fields) {
      field.input.value = String(this.session.runtime.clampNumber(saved?.contour_options?.[field.key], field.min, field.max, field.fallback));
    }
    this.update();
  }

  /** Send zero when disabled so existing background-removal behavior stays unchanged. */
  options() {
    return {contour_smoothing: this.enabled.checked ? Number(this.tolerance.value) : 0,
      contour_options: {method: this.method.value, preserve_corners: this.preserve.checked,
        ...Object.fromEntries(this.fields.map(({key, input}) => [key, Number(input.value)]))}};
  }

  /** Remember the tolerance independently of whether the effect is enabled. */
  storedOptions() {
    return {...this.options(), contour_smoothing_enabled: this.enabled.checked, contour_smoothing: Number(this.tolerance.value)};
  }

  /** Synchronize numeric labels and hide the inactive effect's settings. */
  update() {
    this.settings.hidden = !this.enabled.checked;
    this.tolerance.disabled = !this.enabled.checked;
    this.tolerance.max = this.method.value === 'pixel' ? '8' : '64';
    if (Number(this.tolerance.value) > Number(this.tolerance.max)) this.tolerance.value = this.tolerance.max;
    this.output.textContent = `${Number(this.tolerance.value)} px`;
    this.method.disabled = !this.enabled.checked;
    this.curveSettings.hidden = this.method.value !== 'curve';
    this.preserve.disabled = !this.enabled.checked;
    this.cornerSettings.hidden = !this.preserve.checked;
    for (const field of this.fields) {
      field.input.disabled = !this.enabled.checked || this.method.value !== 'curve' || (field.key === 'corner_angle' && !this.preserve.checked);
      field.output.textContent = `${field.input.value}${field.suffix}`;
    }
  }

  /** Bind preview updates through the modal's disposable event collection. */
  bind(bindings) {
    const changed = () => {
      this.update();
      this.session.updateValues();
    };
    bindings.listen(this.enabled, 'change', changed);
    bindings.listen(this.tolerance, 'input', changed);
    bindings.listen(this.method, 'change', changed);
    bindings.listen(this.preserve, 'change', changed);
    for (const {input} of this.fields) bindings.listen(input, 'input', changed);
  }
}
