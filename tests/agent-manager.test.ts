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
            expect.stringContaining('AGENT_ID=')
        );

        // Verify CLI launch command includes prompt injection via file
        expect(mockTmux.sendKeys).toHaveBeenCalledWith(
            expect.stringContaining('test-pane-new'),
            expect.stringMatching(/gemini -m 'my-custom-model'.*cat.*inception\.txt/)
        );
    });

    // --- Issue 3: Default model ---

    it('should use gemini-3-flash-preview as default model when none specified', async () => {
        const savedEnv = process.env.GEMINI_MODEL;
        delete process.env.GEMINI_MODEL;

        try {
            await manager.createAgent({ name: 'default-model-agent', role: 'tester' });
            expect(mockTmux.sendKeys).toHaveBeenCalledWith(
                expect.any(String),
                expect.stringContaining('gemini-3-flash-preview')
            );
        } finally {
            if (savedEnv !== undefined) process.env.GEMINI_MODEL = savedEnv;
        }
    });

    it('should use GEMINI_MODEL env var over default model', async () => {
        const savedEnv = process.env.GEMINI_MODEL;
        process.env.GEMINI_MODEL = 'env-specified-model';

        try {
            await manager.createAgent({ name: 'env-model-agent', role: 'tester' });
            expect(mockTmux.sendKeys).toHaveBeenCalledWith(
                expect.any(String),
                expect.stringContaining('env-specified-model')
            );
        } finally {
            if (savedEnv !== undefined) process.env.GEMINI_MODEL = savedEnv;
            else delete process.env.GEMINI_MODEL;
        }
    });

    it('should use params.model over GEMINI_MODEL env var', async () => {
        const savedEnv = process.env.GEMINI_MODEL;
        process.env.GEMINI_MODEL = 'env-specified-model';

        try {
            await manager.createAgent({ name: 'param-model-agent', role: 'tester', model: 'explicit-model' });
            expect(mockTmux.sendKeys).toHaveBeenCalledWith(
                expect.any(String),
                expect.stringContaining('explicit-model')
            );
            expect(mockTmux.sendKeys).not.toHaveBeenCalledWith(
                expect.any(String),
                expect.stringContaining('env-specified-model')
            );
        } finally {
            if (savedEnv !== undefined) process.env.GEMINI_MODEL = savedEnv;
            else delete process.env.GEMINI_MODEL;
        }
    });

    // --- Issue 2: waitForCommand timeout ---

    it('should return timeout status when no command is delivered within timeout', async () => {
        // Create an agent dir so waitForCommand can find the inbox
        const agentId = 'timeout-test-agent';
        const agentDir = path.join(TEST_ROOT, '.agents', 'sessions', manager.sessionId, 'agents', agentId);
        await fs.mkdir(agentDir, { recursive: true });
        await fs.writeFile(path.join(agentDir, 'inbox.jsonl'), '');

        const result = await manager.waitForCommand(agentId, 0, 600); // 600ms explicit timeout
        expect(result.status).toBe('timeout');
        expect(result.next_cursor).toBe(0);
    });

    it('should return command immediately when inbox already has content', async () => {
        const agentId = 'ready-inbox-agent';
        const agentDir = path.join(TEST_ROOT, '.agents', 'sessions', manager.sessionId, 'agents', agentId);
        await fs.mkdir(agentDir, { recursive: true });
        const task = { type: 'task', taskId: 'abc', payload: { action: 'do-it' }, timestamp: Date.now() };
        await fs.writeFile(path.join(agentDir, 'inbox.jsonl'), JSON.stringify(task) + '\n');

        const result = await manager.waitForCommand(agentId, 0, 5000);
        expect(result.status).toBe('command');
        expect(result.command.taskId).toBe('abc');
        expect(result.next_cursor).toBe(1);
    });

    // --- Issue 1: Targeted messaging ---

    async function setupTwoAgents() {
        const a1 = await manager.createAgent({ name: 'agent-1', role: 'worker' });
        jest.clearAllMocks();
        mockTmux.getCurrentTmuxContext.mockResolvedValue({ sessionId: 'test-session', windowId: 'test-window', paneId: 'test-pane-orig' });
        mockTmux.splitPane.mockResolvedValue({ sessionId: 'test-session', windowId: 'test-window', paneId: 'test-pane-new-2' });
        mockTmux.sendKeys.mockResolvedValue(undefined);
        const a2 = await manager.createAgent({ name: 'agent-2', role: 'worker' });
        return [a1, a2];
    }

    function readInbox(agentId: string): Promise<string> {
        const inboxPath = path.join(TEST_ROOT, '.agents', 'sessions', manager.sessionId, 'agents', agentId, 'inbox.jsonl');
        return fs.readFile(inboxPath, 'utf-8');
    }

    it('emitEvent with no target broadcasts to all peer agents', async () => {
        const [a1, a2] = await setupTwoAgents();

        await manager.emitEvent(a1.id, { type: 'hello' });

        const a2Inbox = await readInbox(a2.id);
        expect(a2Inbox).toContain('"hello"');

        // Sender's own inbox should not have the event
        const a1Inbox = await readInbox(a1.id);
        expect(a1Inbox).toBe('');
    });

    it('emitEvent with target="all" broadcasts to all peer agents', async () => {
        const [a1, a2] = await setupTwoAgents();

        await manager.emitEvent(a1.id, { type: 'broadcast-all' }, 'all');

        const a2Inbox = await readInbox(a2.id);
        expect(a2Inbox).toContain('"broadcast-all"');
    });

    it('emitEvent with target="master" writes to outbox and broadcast but NOT to any peer inbox', async () => {
        const [a1, a2] = await setupTwoAgents();

        await manager.emitEvent(a1.id, { type: 'master-reply' }, 'master');

        const a2Inbox = await readInbox(a2.id);
        expect(a2Inbox).toBe('');

        // Broadcast file should have the event
        const broadcastPath = path.join(TEST_ROOT, '.agents', 'sessions', manager.sessionId, 'broadcast.jsonl');
        const broadcast = await fs.readFile(broadcastPath, 'utf-8');
        expect(broadcast).toContain('"master-reply"');
    });

    it('emitEvent with specific agent_id delivers only to that agent', async () => {
        const [a1, a2] = await setupTwoAgents();

        // Create a third agent
        jest.clearAllMocks();
        mockTmux.getCurrentTmuxContext.mockResolvedValue({ sessionId: 'test-session', windowId: 'test-window', paneId: 'test-pane-orig' });
        mockTmux.splitPane.mockResolvedValue({ sessionId: 'test-session', windowId: 'test-window', paneId: 'test-pane-new-3' });
        mockTmux.sendKeys.mockResolvedValue(undefined);
        const a3 = await manager.createAgent({ name: 'agent-3', role: 'worker' });

        await manager.emitEvent(a1.id, { type: 'targeted' }, a2.id);

        const a2Inbox = await readInbox(a2.id);
        expect(a2Inbox).toContain('"targeted"');

        const a3Inbox = await readInbox(a3.id);
        expect(a3Inbox).toBe('');
    });

    // --- readEvents tests ---

    it('readEvents returns empty when outbox does not exist', async () => {
        const result = await manager.readEvents('nonexistent-agent', 0);
        expect(result.events).toEqual([]);
        expect(result.next_cursor).toBe(0);
    });

    it('readEvents reads from broadcast.jsonl when no agent_id provided', async () => {
        const [a1] = await setupTwoAgents();
        await manager.emitEvent(a1.id, { type: 'broadcast-event' });

        const result = await manager.readEvents(undefined, 0);
        expect(result.events.length).toBe(1);
        expect(result.events[0].type).toBe('broadcast-event');
        expect(result.next_cursor).toBe(1);
    });

    it('readEvents reads from specific agent outbox when agent_id provided', async () => {
        const [a1, a2] = await setupTwoAgents();
        await manager.emitEvent(a1.id, { type: 'agent1-event' });
        await manager.emitEvent(a2.id, { type: 'agent2-event' });

        const result = await manager.readEvents(a1.id, 0);
        expect(result.events.length).toBe(1);
        expect(result.events[0].type).toBe('agent1-event');
        expect(result.next_cursor).toBe(1);
    });

    it('readEvents cursor skips already-read events', async () => {
        const [a1] = await setupTwoAgents();
        await manager.emitEvent(a1.id, { type: 'event-one' });
        await manager.emitEvent(a1.id, { type: 'event-two' });
        await manager.emitEvent(a1.id, { type: 'event-three' });

        // Read first two via broadcast
        const first = await manager.readEvents(undefined, 0, 2);
        expect(first.events.length).toBe(2);
        expect(first.next_cursor).toBe(2);

        // Resume from cursor=2
        const second = await manager.readEvents(undefined, 2);
        expect(second.events.length).toBe(1);
        expect(second.events[0].type).toBe('event-three');
        expect(second.next_cursor).toBe(3);
    });

    it('readEvents limit caps returned events', async () => {
        const [a1] = await setupTwoAgents();
        await manager.emitEvent(a1.id, { type: 'e1' });
        await manager.emitEvent(a1.id, { type: 'e2' });
        await manager.emitEvent(a1.id, { type: 'e3' });

        const result = await manager.readEvents(undefined, 0, 2);
        expect(result.events.length).toBe(2);
        expect(result.next_cursor).toBe(2);
    });

    it('readEvents cursor past end returns empty with same cursor', async () => {
        const [a1] = await setupTwoAgents();
        await manager.emitEvent(a1.id, { type: 'only-event' });

        const result = await manager.readEvents(undefined, 99);
        expect(result.events).toEqual([]);
        expect(result.next_cursor).toBe(99);
    });

    // --- deleteAgent tests (#1, #5) ---

    it('deleteAgent removes the agent directory from the filesystem', async () => {
        const agent = await manager.createAgent({ name: 'delete-me', role: 'tester' });
        const agentDir = path.join(TEST_ROOT, '.agents', 'sessions', manager.sessionId, 'agents', agent.id);

        // Directory must exist before deletion
        await expect(fs.access(agentDir)).resolves.toBeUndefined();

        await manager.deleteAgent(agent.id);

        // Directory must be gone after deletion
        await expect(fs.access(agentDir)).rejects.toThrow();
    });

    it('deleteAgent with malformed tmuxPaneId still removes directory', async () => {
        const agentId = 'bad-pane-agent';
        const agentDir = path.join(TEST_ROOT, '.agents', 'sessions', manager.sessionId, 'agents', agentId);
        await fs.mkdir(agentDir, { recursive: true });
        await fs.writeFile(
            path.join(agentDir, 'meta.json'),
            JSON.stringify({ id: agentId, tmuxPaneId: 'only:two' })
        );

        const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
        try {
            await manager.deleteAgent(agentId);
        } finally {
            warnSpy.mockRestore();
        }

        // Directory must be removed despite bad paneId
        await expect(fs.access(agentDir)).rejects.toThrow();
    });

    // --- waitForCommand corrupt line test (#2a) ---

    it('waitForCommand skips corrupt lines and returns the next valid command', async () => {
        const agentId = 'corrupt-inbox-agent';
        const agentDir = path.join(TEST_ROOT, '.agents', 'sessions', manager.sessionId, 'agents', agentId);
        await fs.mkdir(agentDir, { recursive: true });
        const validTask = { type: 'task', taskId: 'xyz', payload: {}, timestamp: Date.now() };
        // First line is corrupt JSON, second line is valid
        await fs.writeFile(
            path.join(agentDir, 'inbox.jsonl'),
            'NOT VALID JSON\n' + JSON.stringify(validTask) + '\n'
        );

        const result = await manager.waitForCommand(agentId, 0, 5000);
        expect(result.status).toBe('command');
        if (result.status === 'command') {
            expect((result.command as any).taskId).toBe('xyz');
            expect(result.next_cursor).toBe(2);
        }
    });

    // --- readEvents corrupt line test (#2b) ---

    it('readEvents tolerates corrupt lines and returns valid events', async () => {
        const [a1] = await setupTwoAgents();
        const outboxPath = path.join(TEST_ROOT, '.agents', 'sessions', manager.sessionId, 'agents', a1.id, 'outbox.jsonl');
        const validEvent = { type: 'good-event', agentId: a1.id, timestamp: Date.now() };
        // Write one valid event, one corrupt line, then another valid event
        await fs.writeFile(
            outboxPath,
            JSON.stringify(validEvent) + '\n' + 'CORRUPT\n' + JSON.stringify({ ...validEvent, type: 'good-event-2' }) + '\n'
        );

        const result = await manager.readEvents(a1.id, 0);
        expect(result.events.length).toBe(2);
        expect(result.events[0].type).toBe('good-event');
        expect(result.events[1].type).toBe('good-event-2');
        // next_cursor advances past all 3 lines (including the corrupt one) so it is never re-read
        expect(result.next_cursor).toBe(3);
    });

    it('emitEvent with array of agent IDs delivers to each listed agent', async () => {
        const [a1, a2] = await setupTwoAgents();

        jest.clearAllMocks();
        mockTmux.getCurrentTmuxContext.mockResolvedValue({ sessionId: 'test-session', windowId: 'test-window', paneId: 'test-pane-orig' });
        mockTmux.splitPane.mockResolvedValue({ sessionId: 'test-session', windowId: 'test-window', paneId: 'test-pane-new-3' });
        mockTmux.sendKeys.mockResolvedValue(undefined);
        const a3 = await manager.createAgent({ name: 'agent-3', role: 'worker' });

        jest.clearAllMocks();
        mockTmux.getCurrentTmuxContext.mockResolvedValue({ sessionId: 'test-session', windowId: 'test-window', paneId: 'test-pane-orig' });
        mockTmux.splitPane.mockResolvedValue({ sessionId: 'test-session', windowId: 'test-window', paneId: 'test-pane-new-4' });
        mockTmux.sendKeys.mockResolvedValue(undefined);
        const a4 = await manager.createAgent({ name: 'agent-4', role: 'worker' });

        await manager.emitEvent(a1.id, { type: 'multi-target' }, [a2.id, a3.id]);

        const a2Inbox = await readInbox(a2.id);
        expect(a2Inbox).toContain('"multi-target"');

        const a3Inbox = await readInbox(a3.id);
        expect(a3Inbox).toContain('"multi-target"');

        const a4Inbox = await readInbox(a4.id);
        expect(a4Inbox).toBe('');
    });
});
