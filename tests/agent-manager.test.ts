// agent-orchestrator-mcp/tests/agent-manager.test.ts
import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TEST_ROOT = path.resolve(__dirname, '../.test-workspace');

// 1. Define mock implementations with proper types or as any
const mockTmux = {
    getCurrentTmuxContext: jest.fn<any>(),
    createTmuxSession: jest.fn<any>(),
    splitPane: jest.fn<any>(),
    sendKeys: jest.fn<any>(),
    capturePane: jest.fn<any>(),
    killPane: jest.fn<any>()
};

// 2. Mock the module
jest.unstable_mockModule('../src/tmux.js', () => mockTmux);

let AgentManager: any;
let tmux: any;

describe('AgentManager', () => {
    let manager: any;

    beforeEach(async () => {
        // Load modules dynamically
        const amModule = await import('../src/agent-manager.js');
        AgentManager = amModule.AgentManager;
        tmux = await import('../src/tmux.js');

        // Cleanup and Setup
        try {
            await fs.rm(TEST_ROOT, { recursive: true, force: true });
        } catch {}
        await fs.mkdir(TEST_ROOT, { recursive: true });
        
        manager = new AgentManager(TEST_ROOT);
        
        // Reset mocks
        jest.clearAllMocks();

        // Default mock behaviors
        mockTmux.getCurrentTmuxContext.mockResolvedValue({
            sessionId: 'test-session',
            windowId: 'test-window',
            paneId: 'test-pane-orig'
        });
        mockTmux.splitPane.mockResolvedValue({
            sessionId: 'test-session',
            windowId: 'test-window',
            paneId: 'test-pane-new'
        });
        mockTmux.sendKeys.mockResolvedValue(undefined);
        mockTmux.killPane.mockResolvedValue(undefined);
    });

    afterEach(async () => {
        try {
            await fs.rm(TEST_ROOT, { recursive: true, force: true });
        } catch {}
    });

    it('should create an agent in a session-isolated directory', async () => {
        const agent = await manager.createAgent({
            name: 'test-agent',
            role: 'tester'
        });

        expect(agent).toBeDefined();
        expect(manager.sessionId).toBeDefined(); // Check if sessionId exists
        
        // Verify path includes session ID
        const sessionDir = path.join(TEST_ROOT, '.agents/sessions', manager.sessionId);
        const agentDir = path.join(sessionDir, 'agents', agent.id);
        const metaPath = path.join(agentDir, 'meta.json');
        
        const metaExists = await fs.stat(metaPath).then(() => true).catch(() => false);
        expect(metaExists).toBe(true);
    });

    it('should list only agents in the current session', async () => {
        await manager.createAgent({ name: 'a1', role: 'r1' });
        // Simulate another session by creating a new manager instance (new session ID)
        const otherManager = new AgentManager(TEST_ROOT);
        await otherManager.createAgent({ name: 'b1', role: 'r2' });

        const session1Agents = await manager.listAgents();
        const session2Agents = await otherManager.listAgents();

        expect(session1Agents).toHaveLength(1);
        expect(session1Agents[0].name).toBe('a1');

        expect(session2Agents).toHaveLength(1);
        expect(session2Agents[0].name).toBe('b1');
    });

    it('should broadcast events only to the current session', async () => {
        const agent = await manager.createAgent({ name: 'reporter', role: 'reporter' });
        await manager.emitEvent(agent.id, { type: 'log', message: 'hello session 1' });

        const sessionDir = path.join(TEST_ROOT, '.agents/sessions', manager.sessionId);
        const broadcastPath = path.join(sessionDir, 'broadcast.jsonl');
        
        const content = await fs.readFile(broadcastPath, 'utf-8');
        expect(content).toContain('hello session 1');
    });
});
