// Pending tool gestures share chronological order with project commands.
// A stable project state ID survives Undo/Redo; editRevision deliberately does not.
export class ToolEditHistory {
  constructor(limit = 100) {
    this.limit = limit;
    this.clear();
  }

  clear() { this.undoStack = []; this.redoStack = []; }
  record(before, after, stateId) {
    if (Array.isArray(before.strokes) && Array.isArray(after.strokes)) {
      // Released strokes are immutable and shared by snapshots. Avoid
      // serializing every point in every previous stroke after each gesture.
      if (before.strokes.length === after.strokes.length && before.strokes.every((stroke,index) => stroke === after.strokes[index])) {
        const {strokes:beforeStrokes, ...beforeOptions} = before;
        const {strokes:afterStrokes, ...afterOptions} = after;
        if (JSON.stringify(beforeOptions) === JSON.stringify(afterOptions)) return false;
      }
    } else if (JSON.stringify(before) === JSON.stringify(after)) return false;
    this.undoStack.push({before, after, stateId});
    this.undoStack = this.undoStack.slice(-this.limit);
    this.redoStack = [];
    return true;
  }
  canUndo(stateId) { return this.undoStack.at(-1)?.stateId === stateId; }
  canRedo(stateId) { return this.redoStack.at(-1)?.stateId === stateId; }
  undo(stateId) {
    if (!this.canUndo(stateId)) return null;
    const entry = this.undoStack.pop();
    this.redoStack.push(entry);
    return entry.before;
  }
  redo(stateId) {
    if (!this.canRedo(stateId)) return null;
    const entry = this.redoStack.pop();
    this.undoStack.push(entry);
    return entry.after;
  }
}
