const { spawn } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs/promises");
const os = require("node:os");
const crypto = require("node:crypto");
const readline = require("node:readline");
const {engineCommand} = require('./runtime-paths.cjs');

class PythonBridge {
  constructor({ ffmpegPath, ffprobePath, packaged = false } = {}) {
    this.ffmpegPath = ffmpegPath;
    this.ffprobePath = ffprobePath;
    this.command = engineCommand({packaged});
    this.process = spawn(this.command.executable, this.command.args, {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      env: {
        ...process.env,
        PYTHONUTF8: "1",
        FRAMELINE_FFMPEG_PATH: ffmpegPath || process.env.FRAMELINE_FFMPEG_PATH || "",
        FRAMELINE_FFPROBE_PATH: ffprobePath || process.env.FRAMELINE_FFPROBE_PATH || ""
      }
    });
    this.nextId = 1;
    this.pending = new Map();
    this.requestGroups = new Map();
    this.tasks = new Map();
    this.lines = readline.createInterface({ input: this.process.stdout });
    this.lines.on("line", (line) => this.handleLine(line));
    this.process.stderr.on("data", (chunk) => console.error(`[FrameLine Python] ${chunk}`));
    this.process.stdin.on("error", (error) => this.failAll(error));
    this.process.on("error", (error) => this.failAll(error));
    this.process.on("exit", (code) => {
      this.failAll(new Error(`Python image engine exited with code ${code ?? "unknown"}.`));
    });
  }

  request(command, payload, onProgress, {group} = {}) {
    if (this.failure || this.process.exitCode !== null || !this.process.stdin.writable) {
      return Promise.reject(new Error("Python image engine is not running."));
    }
    const id = this.nextId++;
    if (group) void this.cancelGroup(group).catch(error => console.error("Could not cancel obsolete preview:", error));
    const cancelFile = group ? path.join(os.tmpdir(), `frameline-preview-${crypto.randomUUID()}.cancel`) : null;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, onProgress, cancelFile, group });
      if (group) this.requestGroups.set(group, id);
      this.process.stdin.write(`${JSON.stringify({ ...payload, id, command, cancel_file:cancelFile })}\n`, (error) => {
        if (error) {
          this.cleanupRequest(id, this.pending.get(id));
          reject(error);
        }
      });
    });
  }

  async cancelGroup(group) {
    const id = this.requestGroups.get(group);
    const request = this.pending.get(id);
    if (!request?.cancelFile) return false;
    await fs.writeFile(request.cancelFile, "cancel");
    // Completion can race with the write. Do not leave a late marker behind.
    if (!this.pending.has(id)) await fs.rm(request.cancelFile, {force:true});
    return true;
  }

  cleanupRequest(id, request) {
    this.pending.delete(id);
    if (request?.group && this.requestGroups.get(request.group) === id) this.requestGroups.delete(request.group);
    if (request?.cancelFile) void fs.rm(request.cancelFile, {force:true}).catch(error => console.error("Could not remove preview marker:", error));
  }

  async runTask(taskId, command, payload, onProgress) {
    if (this.tasks.has(taskId)) throw new Error("An export with this ID is already running.");
    const cancelFile = path.join(os.tmpdir(), `frameline-${crypto.randomUUID()}.cancel`);
    const child = spawn(this.command.executable, [...this.command.args, "--task", cancelFile], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      env: {
        ...process.env,
        PYTHONUTF8: "1",
        FRAMELINE_FFMPEG_PATH: this.ffmpegPath || process.env.FRAMELINE_FFMPEG_PATH || "",
        FRAMELINE_FFPROBE_PATH: this.ffprobePath || process.env.FRAMELINE_FFPROBE_PATH || ""
      }
    });
    const task = { child, cancelFile, onProgress };
    this.tasks.set(taskId, task);
    return new Promise((resolve, reject) => {
      const lines = readline.createInterface({ input: child.stdout });
      let settled = false;
      const settle = (error, value) => {
        if (settled) return;
        settled = true;
        lines.close();
        this.tasks.delete(taskId);
        fs.rm(cancelFile, { force: true }).catch((cleanupError) => console.error("Failed to remove export cancellation marker:", cleanupError));
        if (error) reject(error);
        else resolve(value);
      };
      lines.on("line", (line) => {
        let message;
        try {
          message = JSON.parse(line);
        } catch (error) {
          console.error("Invalid export progress from Python image engine:", error);
          return;
        }
        if (message.type === "progress") onProgress(message);
        else if (message.type === "result") settle(null, message.result);
        else if (message.type === "cancelled") settle(Object.assign(new Error("Export cancelled."), { code: "EXPORT_CANCELLED" }));
        else if (message.type === "error") settle(new Error(message.error));
      });
      child.stderr.on("data", (chunk) => console.error(`[FrameLine Export] ${chunk}`));
      child.stdin.on("error", (error) => settle(error));
      child.on("error", (error) => settle(error));
      child.on("exit", (code) => {
        if (!settled) settle(new Error(`Export worker exited unexpectedly with code ${code ?? "unknown"}.`));
      });
      child.stdin.end(JSON.stringify({ ...payload, command }));
    });
  }

  async cancelTask(taskId) {
    const task = this.tasks.get(taskId);
    if (!task) return false;
    await fs.writeFile(task.cancelFile, "cancel");
    return true;
  }

  handleLine(line) {
    let response;
    try {
      response = JSON.parse(line);
    } catch (error) {
      console.error("Invalid response from Python image engine:", error);
      return;
    }
    const pending = this.pending.get(response.id);
    if (!pending) return;
    if (response.type === "progress") {
      try { pending.onProgress?.(response); }
      catch (error) { console.error("Image progress listener failed:", error); }
      return;
    }
    this.cleanupRequest(response.id, pending);
    if (response.error) pending.reject(Object.assign(new Error(response.error), response.cancelled ? {code:"PREVIEW_SUPERSEDED"} : {}));
    else pending.resolve(response.result);
  }

  failAll(error) {
    this.failure = error;
    for (const [id, pending] of this.pending) {
      this.cleanupRequest(id, pending);
      pending.reject(error);
    }
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    for (const { child } of this.tasks.values()) child.kill();
    this.failAll(new Error("Python image engine was closed."));
    this.process.stdin.end();
    this.process.kill();
  }
}

module.exports = { PythonBridge };
