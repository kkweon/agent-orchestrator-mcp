// tests/session-connection.test.ts
import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const WORKSPACE_ROOT = path.resolve(__dirname, '..');

let AgentManager: any;

describe('Session Connection Logic', () => {
    let masterManager: any;
    let subManager: any;
    const originalEnv = process.env;
    let createdAgents: { manager: any, id: string }[] = [];

    beforeEach(async () => {
        // Dynamic import inside async function to avoid TLA issues in test runner
        const mod = await import('../src/agent-manager.js');
        AgentManager = mod.AgentManager;

        process.env = { ...originalEnv };
        delete process.env.AGENT_SESSION_ID;
        createdAgents = [];
        
        try {
            await fs.rm(path.join(WORKSPACE_ROOT, '.agents'), { recursive: true, force: true });
        } catch {}
    });

    afterEach(async () => {
        process.env = originalEnv;
        for (const { manager, id } of createdAgents) {
            try {
                await manager.deleteAgent(id);
            } catch (e) {}
        }
    });

    it('should NOT share data if Session ID is different (Current Bug Behavior)', async () => {
        masterManager = new AgentManager(WORKSPACE_ROOT);
        const agent = await masterManager.createAgent({ name: 'test', role: 'worker', executablePath: 'echo' }); 
        createdAgents.push({ manager: masterManager, id: agent.id });
        
        await masterManager.enqueueTask(agent.id, { msg: 'hello' });

        subManager = new AgentManager(WORKSPACE_ROOT);

        const agents = await subManager.listAgents();
        expect(agents.length).toBe(0); 
        expect(subManager.sessionId).not.toBe(masterManager.sessionId);
    });

    it('should share data if Session ID is passed via Environment Variable (The Fix)', async () => {
        masterManager = new AgentManager(WORKSPACE_ROOT);
        const agent = await masterManager.createAgent({ name: 'test', role: 'worker', executablePath: 'echo' });
        createdAgents.push({ manager: masterManager, id: agent.id });
        await masterManager.enqueueTask(agent.id, { msg: 'hello' });

        process.env.AGENT_SESSION_ID = masterManager.sessionId;

        subManager = new AgentManager(WORKSPACE_ROOT);

        // This assertion will FAIL until we apply the fix
        expect(subManager.sessionId).toBe(masterManager.sessionId);
        
        const agents = await subManager.listAgents();
        expect(agents.length).toBe(1);
        expect(agents[0].id).toBe(agent.id);

        const result = await subManager.waitForCommand(agent.id, 0, 100);
        expect(result.status).toBe('command');
    });
});
