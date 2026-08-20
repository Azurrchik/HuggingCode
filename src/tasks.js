function taskId() {
  return `t_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

export class TaskManager {
  constructor() {
    this.tasks = new Map();
  }

  start(title, work) {
    const task = {
      id: taskId(),
      title: String(title || "Подзадача").slice(0, 180),
      status: "running",
      createdAt: new Date().toISOString(),
      completedAt: null,
      result: null,
      error: null,
    };
    this.tasks.set(task.id, task);

    Promise.resolve()
      .then(work)
      .then((result) => {
        if (task.status !== "running") return;
        task.status = "completed";
        task.result = String(result || "Подзадача завершена.");
        task.completedAt = new Date().toISOString();
      })
      .catch((error) => {
        if (task.status !== "running") return;
        task.status = "failed";
        task.error = error?.message || "Неизвестная ошибка подзадачи.";
        task.completedAt = new Date().toISOString();
      });

    return { ...task };
  }

  list() {
    return [...this.tasks.values()]
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .map((task) => ({ ...task }));
  }

  get(id) {
    const task = this.tasks.get(id);
    return task ? { ...task } : null;
  }

  stop(id) {
    const task = this.tasks.get(id);
    if (!task) throw new Error("Подзадача не найдена.");
    if (task.status !== "running") return { ...task };
    task.status = "stopped";
    task.completedAt = new Date().toISOString();
    task.error = "Подзадача отмечена остановленной. Текущий сетевой запрос может завершиться позднее, но результат будет проигнорирован.";
    return { ...task };
  }

  clearCompleted() {
    for (const [id, task] of this.tasks) {
      if (task.status !== "running") this.tasks.delete(id);
    }
  }
}
