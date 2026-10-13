/** Serialize routine preview cancellation without rejecting Electron's IPC handler. */
function previewFailure(error) {
  if (error?.code === 'PREVIEW_SUPERSEDED') {
    return {cancelled: true, code: 'PREVIEW_SUPERSEDED'};
  }
  throw error;
}

module.exports = {previewFailure};
