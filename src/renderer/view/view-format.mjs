/** Encode a local source path for image loading. */
export function imageUrl(filePath) {
  const normalized = filePath.replace(/\\/g, "/");
  const encoded = normalized.split("/").map((part) => encodeURIComponent(part).replace(/%3A/gi, ":")).join("/");
  return normalized.startsWith("/") ? `file://${encoded}` : `file:///${encoded}`;
}

/** Format frame-derived seconds as a readable playback timecode. */
export function timecode(seconds, milliseconds = true) {
  const whole = Math.floor(seconds);
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const secs = whole % 60;
  const base = hours ? `${String(hours).padStart(2, "0")}:` : "";
  return `${base}${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}${milliseconds ? `.${String(Math.floor((seconds % 1) * 1000)).padStart(3, "0")}` : ""}`;
}

/** Format a clip duration with hundredth-second precision. */
export function durationTimecode(seconds) {
  const whole = Math.floor(seconds);
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const remaining = seconds % 60;
  const prefix = hours ? `${String(hours).padStart(2, "0")}:` : "";
  return `${prefix}${String(minutes).padStart(2, "0")}:${remaining.toFixed(2).padStart(5, "0")}`;
}

