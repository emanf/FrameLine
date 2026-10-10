/** Schedule background previews and color sampling with latest-request guards. */
export class BackgroundPreviewController {
  constructor(session) { this.session = session; }

  /** Fit source dimensions into the modal while aligning the protection overlay. */
  fitPreview() {
    const session = this.session;
    if (!session.preview.naturalWidth || !session.previewFrame.clientWidth) return;
    const scale = Math.min((session.previewFrame.clientWidth-24)/session.preview.naturalWidth,(session.previewFrame.clientHeight-24)/session.preview.naturalHeight);
    session.preview.style.width = `${Math.max(1,session.preview.naturalWidth*scale)}px`;
    session.preview.style.height = `${Math.max(1,session.preview.naturalHeight*scale)}px`;
    session.ignoreOverlay.style.width = session.preview.style.width;
    session.ignoreOverlay.style.height = session.preview.style.height;
    
  }

  /** Show pending/ready/sample/error state and an indeterminate processing bar. */
  setPreviewStatus(state) {
    const session = this.session;
    const busy = state === 'working';
    session.previewStatus.setAttribute('aria-busy', String(busy));
    session.previewProgress.hidden = !busy;
    session.previewProgress.removeAttribute('value');
    session.previewStatusText.textContent = {
      working: 'Updating preview… Changes are not applied.',
      ready: 'Preview ready — not applied. Click Apply to keep these changes.',
      sample: 'Choose a background color in the preview. Changes are not applied.',
      error: 'Preview unavailable. Changes are not applied.'
    }[state];
    
  }

  /** Debounce the newest removal request and reject obsolete decoded results. */
  scheduleBackgroundPreview() {
    const session = this.session;
    session.saveLastUsed();
    clearTimeout(session.runtime.backgroundPreviewTimer);
    const requestId = ++session.runtime.backgroundPreviewRequestId;
    session.errorElement.hidden = true;
    if (session.ignoreGesture) return;
    if (session.method.value === "sample" && !session.sampleState.point) {
      session.preview.src = session.runtime.localImageUrl(session.sourcePath);
      session.setPreviewStatus('sample');
      return;
    }
    session.setPreviewStatus('working');
    session.detectedColors.textContent = '';
    session.runtime.backgroundPreviewTimer = setTimeout(() => {
      session.runtime.backgroundPreviewTimer = null;
      const options = session.currentOptions();
      session.runtime.backgroundPreviewTask = session.runtime.runImageRequest('previewBackground', { ...options, path: session.sourcePath }, event => {
        if (requestId === session.runtime.backgroundPreviewRequestId && session.dialog.open) {
          session.previewProgress.max = event.total;
          session.previewProgress.value = event.current;
          session.previewStatusText.textContent = `${event.message} Changes are not applied.`;
        }
      })
        .then(async (result) => {
          if (requestId === session.runtime.backgroundPreviewRequestId && session.dialog.open) {
            const decoded = new Image();
            decoded.src = session.runtime.localImageUrl(result.path);
            await decoded.decode();
            if (requestId !== session.runtime.backgroundPreviewRequestId || !session.dialog.open) return;
            session.preview.src = session.runtime.localImageUrl(result.path);
            await session.preview.decode();
            if (requestId !== session.runtime.backgroundPreviewRequestId || !session.dialog.open) return;
            session.errorElement.hidden = true;
            if (options.mode === 'auto' && result.background_colors) {
              session.detectedColors.textContent = `${options.background_source === 'auto' ? 'Detected' : 'Custom'}: ${result.background_colors.map(color => '#' + color.map(channel => channel.toString(16).padStart(2, '0')).join('')).join(', ')}`;
            }
            session.setPreviewStatus('ready');
          }
        })
        .catch((error) => {
          if (requestId === session.runtime.backgroundPreviewRequestId && session.dialog.open) {
            session.errorElement.textContent = error instanceof Error ? error.message : String(error);
            session.errorElement.hidden = false;
            session.setPreviewStatus('error');
          }
        });
    }, 250);
    
  }

  /** Sample a clicked source pixel before scheduling sampled-color removal. */
  async selectSample(event) {
    const session = this.session;
    if (session.ignoreEnabled || event.button !== 0 || session.method.value !== "sample") return;
    const bounds = session.preview.getBoundingClientRect();
    const x = Math.max(0, Math.min(session.preview.naturalWidth - 1, Math.floor((event.clientX - bounds.left) / bounds.width * session.preview.naturalWidth)));
    const y = Math.max(0, Math.min(session.preview.naturalHeight - 1, Math.floor((event.clientY - bounds.top) / bounds.height * session.preview.naturalHeight)));
    try {
      const result = await window.frameLine.sampleImageColor({ path: session.sourcePath, x, y });
      session.sampleState.point = [x, y];
      session.sampleState.color = result.color;
      const hex = `#${result.color.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
      document.querySelector("#background-color-swatch").style.backgroundColor = hex;
      document.querySelector("#background-color-value").textContent = hex.toUpperCase();
      session.errorElement.hidden = true;
      session.syncMethod();
    } catch (error) {
      session.errorElement.textContent = error instanceof Error ? error.message : String(error);
      session.errorElement.hidden = false;
    }
    
  }
}
