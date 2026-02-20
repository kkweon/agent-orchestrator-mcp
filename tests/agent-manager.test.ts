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

    it('should create an agent successfully', async () => {
        const agent = await manager.createAgent({
            name: 'test-agent',
            role: 'tester'
        });

        expect(agent).toBeDefined();
        expect(agent.id).toBeDefined();
        expect(agent.name).toBe('test-agent');
        expect(agent.role).toBe('tester');
        
        const agentDir = path.join(TEST_ROOT, '.agents/agents', agent.id);
        const metaPath = path.join(agentDir, 'meta.json');
        
        const metaExists = await fs.stat(metaPath).then(() => true).catch(() => false);
        expect(metaExists).toBe(true);

        expect(mockTmux.splitPane).toHaveBeenCalled();
        expect(mockTmux.sendKeys).toHaveBeenCalled();
    });

    it('should enqueue tasks and wait for commands', async () => {
        const agent = await manager.createAgent({ name: 'worker', role: 'worker' });
        
        const taskId = await manager.enqueueTask(agent.id, { key: 'value' });
        expect(taskId).toBeDefined();

        const result = await manager.waitForCommand(agent.id, 0, 1000);
        
        expect(result.status).toBe('command');
        expect(result.command).toBeDefined();
        expect(result.command.taskId).toBe(taskId);
        expect(result.command.payload).toEqual({ key: 'value' });
    });
});
