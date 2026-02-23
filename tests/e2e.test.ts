// tests/e2e.test.ts
import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import * as tmux from '../src/tmux.js'; // Ensure we use the same tmux module as AgentManager

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const WORKSPACE_ROOT = path.resolve(__dirname, '..');

async function sleep(ms: number) {
    return new Promise(r => setTimeout(r, ms));
}

// Helper to wait for file content
async function waitForLog(filePath: string, text: string, timeoutMs = 20000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        try {
            const content = await fs.readFile(filePath, 'utf-8');
            if (content.includes(text)) return true;
        } catch {}
        await sleep(500);
    }
    return false;
}

let AgentManager: any;

describe('E2E with Mock Gemini', () => {
    let manager: any;
    let createdAgents: string[] = [];

    beforeEach(async () => {
        // Kill session to ensure clean state and avoid pane exhaustion
        await tmux.killSession('openclaw-agents');
        createdAgents = [];

        const mod = await import('../src/agent-manager.js');
        AgentManager = mod.AgentManager;
        manager = new AgentManager(WORKSPACE_ROOT);
    });

    afterEach(async () => {
        for (const id of createdAgents) {
            try {
                await manager.deleteAgent(id);
            } catch (e) {}
        }
        await tmux.killSession('openclaw-agents');
    });

    it('should spawn a mock agent and process a task', async () => {
        // Use current node executable path to avoid PATH issues in tmux
        const nodePath = process.execPath;
        // Use node to run the JS mock directly (no ts-node dependency issues)
        // Use absolute path for reliability
        const mockScript = path.resolve(WORKSPACE_ROOT, 'tests/mocks/mock-gemini.js');
        // Pass WORKSPACE_ROOT as argument to ensure paths align even if CWD differs in tmux
        const mockCommand = `"${nodePath}" "${mockScript}" "${WORKSPACE_ROOT}"`;

        const agent = await manager.createAgent({
            name: 'e2e-worker',
            role: 'worker',
            executablePath: mockCommand,
            cwd: WORKSPACE_ROOT // Ensure mock runs in the same workspace
        });
        createdAgents.push(agent.id);

        expect(agent).toBeDefined();

        const sessionDir = path.join(WORKSPACE_ROOT, '.agents', 'sessions', manager.sessionId);
        const masterInboxPath = path.join(sessionDir, 'master_inbox.jsonl');

        // 1. Wait for Agent Ready (mock writes to master_inbox)
        const ready = await waitForLog(masterInboxPath, '"agent_ready"');
        if (!ready) {
             console.error("Agent Ready Timeout!");
             try {
                 const debugLog = await fs.readFile(path.join(WORKSPACE_ROOT, 'mock_debug.log'), 'utf-8');
                 console.error("Mock Debug Log:", debugLog);
             } catch (e) {
                 console.error("Mock Debug Log not found!");
             }

             // Capture tmux pane output to see why it failed
             if (agent && agent.tmuxPaneId) {
                try {
                    const parts = agent.tmuxPaneId.split(":");
                    const paneId = parts[2] || parts[0];
                    const paneLogs = await tmux.capturePane(paneId, 50);
                    console.error("Tmux Pane Logs:", paneLogs);
                } catch (e) {
                    console.error("Failed to capture tmux pane logs", e);
                }
             }
        }
        expect(ready).toBe(true);

        // 2. Send task message to agent
        await manager.sendMessage("master", { instruction: "Say Hello" }, agent.id);

        // 3. Wait for Task Completion (mock writes task_completed to master_inbox)
        const completed = await waitForLog(masterInboxPath, '"task_completed"');
        expect(completed).toBe(true);

        const content = await fs.readFile(masterInboxPath, 'utf-8');
        expect(content).toContain('Say Hello');
        expect(content).toContain('mocked');
    }, 30000);
});
