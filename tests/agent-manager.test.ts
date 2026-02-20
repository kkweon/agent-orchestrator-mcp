// agent-orchestrator-mcp/tests/agent-manager.test.ts
import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TEST_ROOT = path.resolve(__dirname, '../.test-workspace');

const mockTmux = {
    getCurrentTmuxContext: jest.fn<any>(),
    createTmuxSession: jest.fn<any>(),
    splitPane: jest.fn<any>(),
    sendKeys: jest.fn<any>(),
    capturePane: jest.fn<any>(),
    killPane: jest.fn<any>()
};

jest.unstable_mockModule('../src/tmux.js', () => mockTmux);

let AgentManager: any;
let tmux: any;

describe('AgentManager', () => {
    let manager: any;

    beforeEach(async () => {
        const amModule = await import('../src/agent-manager.js');
        AgentManager = amModule.AgentManager;
        tmux = await import('../src/tmux.js');

        try {
            await fs.rm(TEST_ROOT, { recursive: true, force: true });
        } catch {}
        await fs.mkdir(TEST_ROOT, { recursive: true });
        
        manager = new AgentManager(TEST_ROOT);
        
        jest.clearAllMocks();

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

    it('should launch Gemini CLI with correct arguments and inject prompt', async () => {
        const agent = await manager.createAgent({
            name: 'test-agent',
            role: 'tester',
            model: 'my-custom-model'
        });

        // Verify environment setup
        expect(mockTmux.sendKeys).toHaveBeenCalledWith(
            expect.stringContaining('test-pane-new'),
            expect.stringContaining('export AGENT_ID=')
        );

        // Verify CLI launch command includes prompt injection via file
        expect(mockTmux.sendKeys).toHaveBeenCalledWith(
            expect.stringContaining('test-pane-new'),
            expect.stringMatching(/gemini -m my-custom-model.*cat.*inception\.txt/)
        );

        // We no longer send the prompt directly via sendKeys
        // so we don't expect the prompt text in sendKeys calls

    });
});
