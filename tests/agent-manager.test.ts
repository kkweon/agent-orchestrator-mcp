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
        // After shell-quoting, executable and model are wrapped in single quotes
        expect(mockTmux.sendKeys).toHaveBeenCalledWith(
            expect.stringContaining('test-pane-new'),
            expect.stringMatching(/'gemini' -m 'my-custom-model'.*cat.*inception\.txt/)
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

    // --- Actor model: sendMessage tests ---

    async function setupTwoAgents() {
        const a1 = await manager.createAgent({ name: 'agent-1', role: 'worker' });
        jest.clearAllMocks();
        mockTmux.getCurrentTmuxContext.mockResolvedValue({ sessionId: 'test-session', windowId: 'test-window', paneId: 'test-pane-orig' });
        mockTmux.splitPane.mockResolvedValue({ sessionId: 'test-session', windowId: 'test-window', paneId: 'test-pane-new-2' });
        mockTmux.sendKeys.mockResolvedValue(undefined);
        const a2 = await manager.createAgent({ name: 'agent-2', role: 'worker' });
        return [a1, a2];
    }

    function readInboxFile(agentId: string): Promise<string> {
        const inboxPath = path.join(TEST_ROOT, '.agents', 'sessions', manager.sessionId, 'agents', agentId, 'inbox.jsonl');
        return fs.readFile(inboxPath, 'utf-8');
    }

    function readMasterInbox(): Promise<string> {
        const masterInboxPath = path.join(TEST_ROOT, '.agents', 'sessions', manager.sessionId, 'master_inbox.jsonl');
        return fs.readFile(masterInboxPath, 'utf-8');
    }

    it('sendMessage with target="all" broadcasts to all agent inboxes and master inbox', async () => {
        const [a1, a2] = await setupTwoAgents();

        await manager.sendMessage(a1.id, { type: 'broadcast-all' }, 'all');

        const a2Inbox = await readInboxFile(a2.id);
        expect(a2Inbox).toContain('"broadcast-all"');

        const masterInbox = await readMasterInbox();
        expect(masterInbox).toContain('"broadcast-all"');
    });

    it('sendMessage with target="master" writes only to master_inbox, not to any agent inbox', async () => {
        const [a1, a2] = await setupTwoAgents();

        await manager.sendMessage(a1.id, { type: 'master-reply' }, 'master');

        const a2Inbox = await readInboxFile(a2.id);
        expect(a2Inbox).toBe('');

        const masterInbox = await readMasterInbox();
        expect(masterInbox).toContain('"master-reply"');
    });

    it('sendMessage with specific agent_id delivers only to that agent inbox', async () => {
        const [a1, a2] = await setupTwoAgents();

        // Create a third agent
        jest.clearAllMocks();
        mockTmux.getCurrentTmuxContext.mockResolvedValue({ sessionId: 'test-session', windowId: 'test-window', paneId: 'test-pane-orig' });
        mockTmux.splitPane.mockResolvedValue({ sessionId: 'test-session', windowId: 'test-window', paneId: 'test-pane-new-3' });
        mockTmux.sendKeys.mockResolvedValue(undefined);
        const a3 = await manager.createAgent({ name: 'agent-3', role: 'worker' });

        await manager.sendMessage(a1.id, { type: 'targeted' }, a2.id);

        const a2Inbox = await readInboxFile(a2.id);
        expect(a2Inbox).toContain('"targeted"');

        const a3Inbox = await readInboxFile(a3.id);
        expect(a3Inbox).toBe('');
    });

    it('sendMessage with array of agent IDs delivers to each listed agent', async () => {
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

        await manager.sendMessage(a1.id, { type: 'multi-target' }, [a2.id, a3.id]);

        const a2Inbox = await readInboxFile(a2.id);
        expect(a2Inbox).toContain('"multi-target"');

        const a3Inbox = await readInboxFile(a3.id);
        expect(a3Inbox).toContain('"multi-target"');

        const a4Inbox = await readInboxFile(a4.id);
        expect(a4Inbox).toBe('');
    });

    it('sendMessage includes from field in message', async () => {
        const [a1, a2] = await setupTwoAgents();

        await manager.sendMessage(a1.id, { type: 'hello' }, a2.id);

        const a2Inbox = await readInboxFile(a2.id);
        const parsed = JSON.parse(a2Inbox.trim());
        expect(parsed.from).toBe(a1.id);
        expect(parsed.type).toBe('hello');
    });

    // --- readInbox tests ---

    it('readInbox returns empty when inbox does not exist', async () => {
        const result = await manager.readInbox('nonexistent-agent', 0);
        expect(result.messages).toEqual([]);
        expect(result.next_cursor).toBe(0);
    });

    it('readInbox("master") reads from master_inbox.jsonl', async () => {
        const [a1] = await setupTwoAgents();
        await manager.sendMessage(a1.id, { type: 'to-master' }, 'master');

        const result = await manager.readInbox('master', 0);
        expect(result.messages.length).toBe(1);
        expect(result.messages[0].type).toBe('to-master');
        expect(result.next_cursor).toBe(1);
    });

    it('readInbox reads from specific agent inbox when agent_id provided', async () => {
        const [a1, a2] = await setupTwoAgents();
        await manager.sendMessage('master', { type: 'task-for-a1' }, a1.id);
        await manager.sendMessage('master', { type: 'task-for-a2' }, a2.id);

        const result = await manager.readInbox(a1.id, 0);
        expect(result.messages.length).toBe(1);
        expect(result.messages[0].type).toBe('task-for-a1');
        expect(result.next_cursor).toBe(1);
    });

    it('readInbox cursor skips already-read messages', async () => {
        const [a1] = await setupTwoAgents();
        await manager.sendMessage('master', { type: 'msg-one' }, a1.id);
        await manager.sendMessage('master', { type: 'msg-two' }, a1.id);
        await manager.sendMessage('master', { type: 'msg-three' }, a1.id);

        // Read first two
        const first = await manager.readInbox(a1.id, 0, 2);
        expect(first.messages.length).toBe(2);
        expect(first.next_cursor).toBe(2);

        // Resume from cursor=2
        const second = await manager.readInbox(a1.id, 2);
        expect(second.messages.length).toBe(1);
        expect(second.messages[0].type).toBe('msg-three');
        expect(second.next_cursor).toBe(3);
    });

    it('readInbox limit caps returned messages', async () => {
        const [a1] = await setupTwoAgents();
        await manager.sendMessage('master', { type: 'm1' }, a1.id);
        await manager.sendMessage('master', { type: 'm2' }, a1.id);
        await manager.sendMessage('master', { type: 'm3' }, a1.id);

        const result = await manager.readInbox(a1.id, 0, 2);
        expect(result.messages.length).toBe(2);
        expect(result.next_cursor).toBe(2);
    });

    it('readInbox cursor past end returns empty with same cursor', async () => {
        const [a1] = await setupTwoAgents();
        await manager.sendMessage('master', { type: 'only-msg' }, a1.id);

        const result = await manager.readInbox(a1.id, 99);
        expect(result.messages).toEqual([]);
        expect(result.next_cursor).toBe(99);
    });

    it('sendMessage target="all" does NOT deliver to the sender\'s own inbox', async () => {
        const [a1, a2] = await setupTwoAgents();

        await manager.sendMessage(a1.id, { type: 'broadcast-check' }, 'all');

        // a2 should receive it
        const a2Inbox = await readInboxFile(a2.id);
        expect(a2Inbox).toContain('"broadcast-check"');

        // a1 (the sender) should NOT receive its own broadcast
        const a1Inbox = await readInboxFile(a1.id);
        expect(a1Inbox).toBe('');
    });

    it('waitForCommand skips malformed JSONL line and advances cursor', async () => {
        const agentId = 'malformed-inbox-agent';
        const agentDir = path.join(TEST_ROOT, '.agents', 'sessions', manager.sessionId, 'agents', agentId);
        await fs.mkdir(agentDir, { recursive: true });
        // Write a malformed line followed by a valid line
        const validTask = { type: 'task', taskId: 'valid-one', payload: {} };
        await fs.writeFile(path.join(agentDir, 'inbox.jsonl'),
            'THIS IS NOT JSON\n' + JSON.stringify(validTask) + '\n');

        // waitForCommand with cursor=0 should skip the bad line and return the valid one
        const result = await manager.waitForCommand(agentId, 0, 5000);
        expect(result.status).toBe('command');
        if (result.status === 'command') {
            expect((result.command as any).taskId).toBe('valid-one');
        }
    });

    it('deleteAgent removes the agent directory so it no longer appears in listAgents', async () => {
        const [a1] = await setupTwoAgents();

        let agents = await manager.listAgents();
        expect(agents.some(a => a.id === a1.id)).toBe(true);

        await manager.deleteAgent(a1.id);

        agents = await manager.listAgents();
        expect(agents.some(a => a.id === a1.id)).toBe(false);
    });

    it('readInbox skips malformed JSONL lines and advances next_cursor past them', async () => {
        const [a1] = await setupTwoAgents();
        const agentDir = path.join(TEST_ROOT, '.agents', 'sessions', manager.sessionId, 'agents', a1.id);
        // Overwrite inbox with one bad line then one good line
        const goodMsg = { type: 'good-msg' };
        await fs.writeFile(path.join(agentDir, 'inbox.jsonl'),
            'MALFORMED\n' + JSON.stringify(goodMsg) + '\n');

        const result = await manager.readInbox(a1.id, 0);
        // next_cursor should be 2 (both raw lines consumed)
        expect(result.next_cursor).toBe(2);
        // Only the valid message is returned
        expect(result.messages.length).toBe(1);
        expect(result.messages[0].type).toBe('good-msg');
    });

    it('createAgent should throw if params.env contains an invalid key', async () => {
        await expect(
            manager.createAgent({ name: 'bad-env', role: 'worker', env: { 'FOO; rm -rf /': 'value' } })
        ).rejects.toThrow('Invalid env key');
    });
});
