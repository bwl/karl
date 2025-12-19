import { SchedulerEvent, TaskState, VolleyState } from './types.js';

export function initState(tasks: string[]): VolleyState {
  return {
    startTime: Date.now(),
    tasks: tasks.map((task, index) => ({
      index,
      prompt: task,
      status: 'queued',
      tools: []
    }))
  };
}

export function applyEvent(state: VolleyState, event: SchedulerEvent): void {
  const task = state.tasks[event.taskIndex];
  if (!task) {
    return;
  }

  switch (event.type) {
    case 'task_start':
      task.status = 'running';
      task.startedAt = event.time;
      task.error = undefined;
      return;
    case 'tool_start': {
      task.tools.push({ name: event.tool, status: 'running', startedAt: event.time });
      return;
    }
    case 'tool_end': {
      const tool = findLastRunningTool(task, event.tool);
      if (tool) {
        tool.status = event.success ? 'done' : 'error';
        tool.endedAt = event.time;
        tool.error = event.error;
      } else {
        task.tools.push({
          name: event.tool,
          status: event.success ? 'done' : 'error',
          startedAt: event.time,
          endedAt: event.time,
          error: event.error
        });
      }
      return;
    }
    case 'task_complete':
      task.status = 'done';
      task.endedAt = event.time;
      task.result = event.result;
      task.error = undefined;
      return;
    case 'task_error':
      task.status = 'error';
      task.endedAt = event.time;
      task.error = event.error;
      return;
    case 'task_retry':
      task.status = 'queued';
      task.retries = event.attempt;
      task.tools = [];
      task.error = event.error;
      task.startedAt = undefined;
      task.endedAt = undefined;
      return;
  }
}

function findLastRunningTool(task: TaskState, name: string) {
  for (let i = task.tools.length - 1; i >= 0; i -= 1) {
    const tool = task.tools[i];
    if (tool.name === name && tool.status === 'running') {
      return tool;
    }
  }
  return undefined;
}
