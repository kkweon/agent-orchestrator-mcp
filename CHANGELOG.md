## [1.1.8](https://github.com/kkweon/agent-orchestrator-mcp/compare/v1.1.7...v1.1.8) (2026-02-20)


### Bug Fixes

* use single quotes in tmux send-keys to prevent premature variable expansion ([c56e1cc](https://github.com/kkweon/agent-orchestrator-mcp/commit/c56e1cc9c78e8aac8907cbce741ddb0d0e0d2696))

## [1.1.7](https://github.com/kkweon/agent-orchestrator-mcp/compare/v1.1.6...v1.1.7) (2026-02-20)


### Bug Fixes

* add debug logging to mock gemini script to diagnose e2e failure ([613e89b](https://github.com/kkweon/agent-orchestrator-mcp/commit/613e89b195510bb354a48f85c2923de813f42975))
* conditionally skip args injection for mock execution to prevent failures ([310246c](https://github.com/kkweon/agent-orchestrator-mcp/commit/310246cf4b7299a0dcaa94c628d81e4b4ade730e))
* convert mock gemini script to ESM to resolve execution error ([98d0ce0](https://github.com/kkweon/agent-orchestrator-mcp/commit/98d0ce0305ecb28c6e9ff8bb0749960a836d52af))
* pass inception prompt as command argument instead of typing it ([0a2420e](https://github.com/kkweon/agent-orchestrator-mcp/commit/0a2420e7fb117c644e9c3eee8356c56d6bfbed96))
* pass workspace root explicitly to mock script to avoid path mismatch in CI ([e37475b](https://github.com/kkweon/agent-orchestrator-mcp/commit/e37475b6d456724bd0d60c6ed56cf4ef46102714))
* set larger tmux session size to prevent split failures in CI ([5309fd2](https://github.com/kkweon/agent-orchestrator-mcp/commit/5309fd21dd63dc4a8a4d36493f1256c5acaf702d))
* use -i flag for race-condition-free inception prompt injection ([c6d380a](https://github.com/kkweon/agent-orchestrator-mcp/commit/c6d380afa6230ec63bebc64ab4ac7652acce8577))

## [1.1.6](https://github.com/kkweon/agent-orchestrator-mcp/compare/v1.1.5...v1.1.6) (2026-02-20)


### Bug Fixes

* add 3s delay before injecting inception prompt to wait for cli boot ([df0b53d](https://github.com/kkweon/agent-orchestrator-mcp/commit/df0b53d61662d08c600b121079d974297f5794de))

## [1.1.5](https://github.com/kkweon/agent-orchestrator-mcp/compare/v1.1.4...v1.1.5) (2026-02-20)


### Bug Fixes

* remove cwd from extension config to allow npx to run freely ([45d51bc](https://github.com/kkweon/agent-orchestrator-mcp/commit/45d51bc900d0ecbf122af9c09a1be4a022558bfe))
* simplify npx args to standard usage ([2822f4b](https://github.com/kkweon/agent-orchestrator-mcp/commit/2822f4b08cbe84d753eea354d1bcdcace6f8a78e))

## [1.1.4](https://github.com/kkweon/agent-orchestrator-mcp/compare/v1.1.3...v1.1.4) (2026-02-20)


### Bug Fixes

* switch back to npx with quiet flag for mcp execution ([245f1eb](https://github.com/kkweon/agent-orchestrator-mcp/commit/245f1eb964ea9e0bd337633644c72e28ef8dc9fb))

## [1.1.3](https://github.com/kkweon/agent-orchestrator-mcp/compare/v1.1.2...v1.1.3) (2026-02-20)


### Bug Fixes

* revert to local node execution in extension config and add prepare script ([412975e](https://github.com/kkweon/agent-orchestrator-mcp/commit/412975e75d880c0ee06d5080ae5d844b19985a40))

## [1.1.2](https://github.com/kkweon/agent-orchestrator-mcp/compare/v1.1.1...v1.1.2) (2026-02-20)


### Bug Fixes

* make npx command explicit and ensure executable permissions ([e31cef4](https://github.com/kkweon/agent-orchestrator-mcp/commit/e31cef4a1d5ad471897fb9c00810eb53dc121478))

## [1.1.1](https://github.com/kkweon/agent-orchestrator-mcp/compare/v1.1.0...v1.1.1) (2026-02-20)


### Bug Fixes

* update installation command to use install --auto-update ([d8b73e4](https://github.com/kkweon/agent-orchestrator-mcp/commit/d8b73e43d27186ce5729bcde10b1b375a329fc05))

# [1.1.0](https://github.com/kkweon/agent-orchestrator-mcp/compare/v1.0.5...v1.1.0) (2026-02-20)


### Features

* add args param to agent_create for passing cli flags ([a972a45](https://github.com/kkweon/agent-orchestrator-mcp/commit/a972a45e3eeba0a692add69670a283fd057d8a04))

## [1.0.5](https://github.com/kkweon/agent-orchestrator-mcp/compare/v1.0.4...v1.0.5) (2026-02-20)


### Bug Fixes

* rename mcp server to tmux-agent-orchestrator to avoid collisions ([720882e](https://github.com/kkweon/agent-orchestrator-mcp/commit/720882e549dc5850aa05fd3fa9c9ddd8bb73365e))

## [1.0.4](https://github.com/kkweon/agent-orchestrator-mcp/compare/v1.0.3...v1.0.4) (2026-02-20)


### Bug Fixes

* use npx in gemini-extension.json for easier usage ([0e00483](https://github.com/kkweon/agent-orchestrator-mcp/commit/0e00483294319ed099ee41909159d30123192e24))

## [1.0.3](https://github.com/kkweon/agent-orchestrator-mcp/compare/v1.0.2...v1.0.3) (2026-02-20)


### Bug Fixes

* correct installation instructions for gemini extension ([a3e3506](https://github.com/kkweon/agent-orchestrator-mcp/commit/a3e3506eb712d3658d04f6c445e5116ffe9d1f9e))

## [1.0.2](https://github.com/kkweon/agent-orchestrator-mcp/compare/v1.0.1...v1.0.2) (2026-02-20)


### Bug Fixes

* document tmux prerequisite ([0cd2647](https://github.com/kkweon/agent-orchestrator-mcp/commit/0cd26479f71c262e4e826c194953cda8a0d3346b))

## [1.0.1](https://github.com/kkweon/agent-orchestrator-mcp/compare/v1.0.0...v1.0.1) (2026-02-20)


### Bug Fixes

* update README with usage instructions ([2363a3c](https://github.com/kkweon/agent-orchestrator-mcp/commit/2363a3c29ce8eb4eb8c1ff1e1ad050eeefcd45d2))

# 1.0.0 (2026-02-20)


### Bug Fixes

* add test script to package.json ([506b795](https://github.com/kkweon/agent-orchestrator-mcp/commit/506b795953037b31349c4cca1fae333ebd8be6f5))


### Features

* initial typescript project setup with mcp server skeleton ([599d280](https://github.com/kkweon/agent-orchestrator-mcp/commit/599d280fb39869df292e6df9b28252111f63d51b))
