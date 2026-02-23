export interface Agent {
  id: string;
  name: string;
  role: string;
  tmuxPaneId: string;
  status: "created" | "ready" | "busy" | "stalled" | "error";
  createdAt: number;
  metadata: Record<string, unknown>;
}

export interface CreateAgentParams {
  name: string;
  role: string;
  cwd?: string;
  env?: Record<string, string>;
  model?: string; // Optional: Gemini model to use
  executablePath?: string; // Optional: Override the binary command (for testing)
  args?: string[]; // Optional: Extra arguments for the command (e.g. ["--yolo", "--debug"])
}
