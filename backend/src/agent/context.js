const MAX_HISTORY = 12;

export class TaskContext {
  constructor() {
    this.reset();
  }

  reset() {
    this.objective = "";
    this.history = [];
    this.completedActions = [];
  }

  start(objective) {
    this.reset();
    this.objective = objective;
  }

  addAction(action, result) {
    this.completedActions.push({ action, result, timestamp: Date.now() });
    if (this.completedActions.length > MAX_HISTORY) this.completedActions.shift();
  }

  snapshot() {
    return {
      objective: this.objective,
      history: this.history.slice(-MAX_HISTORY),
      completedActions: this.completedActions.slice(-MAX_HISTORY),
    };
  }
}

