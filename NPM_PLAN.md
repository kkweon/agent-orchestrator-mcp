# Plan to Publish `agent-orchestrator-mcp` as an NPX Executable

This document outlines the steps required to prepare the `agent-orchestrator-mcp` project for publication to the NPM registry, enabling execution via `npx agent-orchestrator-mcp`.

## 1. File Structure Changes

### A. Update `package.json`

The following changes are required in `package.json`:

1.  **Add `bin` entry**: This tells NPM which file to execute when the package is installed or run via `npx`.
    ```json
    "bin": {
      "agent-orchestrator-mcp": "./dist/index.js"
    }
    ```
2.  **Add `files` allowlist**: Explicitly define which files to include in the package to keep it lean.
    ```json
    "files": [
      "dist",
      "README.md"
    ]
    ```
3.  **Update `scripts`**: Ensure the project is built before publishing.
    ```json
    "scripts": {
      "build": "tsc",
      "start": "node dist/index.js",
      "dev": "ts-node src/index.ts",
      "prepublishOnly": "npm run build"
    }
    ```
4.  **Verify `main` entry**: Ensure `"main": "dist/index.js"` points to the built entry point (already present).

### B. Update `src/index.ts`

To make the file executable directly by Node.js when installed, we need to add a "Shebang" line at the very top of the entry file.

1.  **Add Shebang**:
    ```typescript
    #!/usr/bin/env node
    ```
    *Insert this as the very first line of `src/index.ts`.*

### C. TypeScript Configuration (`tsconfig.json`)

Ensure `tsconfig.json` is configured to output to `dist/` and handle the shebang correctly (though `tsc` usually preserves it).

*   *Verification needed:* Check if `tsconfig.json` exists and has `outDir` set to `./dist`.

## 2. Preparation & Verification Steps

1.  **Install Dependencies**: Run `npm install` to ensure all dependencies are present.
2.  **Build**: Run `npm run build` to generate the `dist/` directory.
3.  **Local Test**:
    *   Run `npm link`.
    *   Try running `agent-orchestrator-mcp` in a new terminal.
    *   Verify it starts the MCP server (logs to stderr).
    *   Run `npm unlink`.

## 3. Publishing Steps

1.  **Login**: `npm login` (requires an NPM account).
2.  **Publish**: `npm publish --access public`.

## 4. Usage

Once published, users can run:
```bash
npx agent-orchestrator-mcp
```
This will download and execute the MCP server immediately.

## 5. Summary of Required File Edits

### `agent-orchestrator-mcp/package.json`

```json
{
  "name": "agent-orchestrator-mcp",
  "version": "1.0.0",
  "description": "Agent Orchestrator MCP Server for tmux-based sub-agents",
  "type": "module",
  "main": "dist/index.js",
  "bin": {
    "agent-orchestrator-mcp": "./dist/index.js"
  },
  "files": [
    "dist"
  ],
  "scripts": {
    "build": "tsc",
    "start": "node dist/index.js",
    "dev": "ts-node src/index.ts",
    "prepublishOnly": "npm run build"
  },
  ...
}
```

### `agent-orchestrator-mcp/src/index.ts`

```typescript
#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
...
```
