export interface Agent {
  id: string;
  name: string;
  role: string;
  tmuxPaneId: string;
  status: "created" | "ready" | "busy" | "stalled" | "error";
  queue: Task[];
  currentTask?: Task;
  lastEventSeq: number;
  createdAt: number;
  metadata: Record<string, any>;
}

export interface Task {
  id: string;
  payload: Record<string, any>;
  status: "queued" | "running" | "completed" | "failed" | "canceled";
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
  cancelRequested: boolean;
}

export interface AgentEvent {
  seq: number;
  type: string;
  agentId: string;
  taskId?: string;
  payload?: any;
  timestamp: number;
}

export interface CreateAgentParams {
  name: string;
  role: string;
  cwd?: string;
  env?: Record<string, string>;
  model?: string; // Optional: Gemini model to use
  executablePath?: string; // Optional: Override the binary command (for testing)
}
