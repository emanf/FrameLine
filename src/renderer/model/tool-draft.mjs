function imageSourceKey(image) {
  // Renaming an asset does not change the pixels a tool is editing. Include
  // original/source metadata because Color Cleanup also samples those images.
  const { name, ...source } = image;
  return JSON.stringify(source);
}

export function captureToolSource(project, image) {
  return { project, imageKey: imageSourceKey(image) };
}

export function matchesToolSource(source, project, image) {
  return Boolean(image && source?.project === project && source.imageKey === imageSourceKey(image));
}
