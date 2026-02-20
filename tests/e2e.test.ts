// tests/e2e.test.ts
import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

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

    beforeEach(async () => {
        const mod = await import('../src/agent-manager.js');
        AgentManager = mod.AgentManager;
        manager = new AgentManager(WORKSPACE_ROOT);
    });

    afterEach(async () => {
        // Cleanup if needed
    });

    it('should spawn a mock agent and process a task', async () => {
        // Use node to run the JS mock directly (no ts-node dependency issues)
        const mockScript = path.join(WORKSPACE_ROOT, 'tests', 'mocks', 'mock-gemini.js');
        const mockCommand = `node ${mockScript}`;

        console.log("Spawning Agent with Mock Command:", mockCommand);

        const agent = await manager.createAgent({
            name: 'e2e-worker',
            role: 'worker',
            executablePath: mockCommand 
        });

        expect(agent).toBeDefined();
        
        const sessionDir = path.join(WORKSPACE_ROOT, '.agents', 'sessions', manager.sessionId);
        const outboxPath = path.join(sessionDir, 'agents', agent.id, 'outbox.jsonl');

        // 1. Wait for Agent Ready
        console.log("Waiting for agent_ready...");
        const ready = await waitForLog(outboxPath, '"agent_ready"');
        expect(ready).toBe(true);

        // 2. Enqueue Task
        console.log("Enqueuing Task...");
        const taskId = await manager.enqueueTask(agent.id, { instruction: "Say Hello" });

        // 3. Wait for Task Completion
        console.log("Waiting for task_completed...");
        const completed = await waitForLog(outboxPath, '"task_completed"');
        expect(completed).toBe(true);
        
        const content = await fs.readFile(outboxPath, 'utf-8');
        expect(content).toContain('Say Hello');
        expect(content).toContain('mocked');

        await manager.deleteAgent(agent.id);
    }, 30000);
});
