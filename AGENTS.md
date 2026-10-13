# 项目指引

在本仓库执行任务前，必须阅读并遵守 [.pi/AGENTS.md](.pi/AGENTS.md)，并阅读 [README.md](README.md) 与 [接口核验记录](docs/api-verification.md)。

此根目录文件供 Pi 从项目根目录启动时发现；完整项目规范维护在 `.pi/AGENTS.md`，不要在两处复制规则。

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
