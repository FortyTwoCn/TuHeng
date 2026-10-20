# 图衡 TuHeng

工程图学教学闭环。Next.js + TypeScript 模块化单体，独立 Node Worker 与可替换视觉评分核心。

## 本地运行

Node 22+、Docker Compose。复制 `.env.example` 为 `.env`，设置 AUTH_SECRET 和 SEED_PASSWORD（至少 12 字符）。

```sh
npm ci
docker compose up -d
npm run db:generate
npm run db:migrate
npm run db:seed
npm run dev
# 另一个终端
npm run worker
```

访问 http://localhost:3000 。测试账户 student@tuheng.local、teacher@tuheng.local、admin@tuheng.local 使用 SEED_PASSWORD。seed 仅本地显式执行，数据标记为演示。

未配置视觉 API 时仍能提交、人工复核与发布，任务明确显示配置阻塞；不会生成模拟分。配置 AI_API_KEY、AI_BASE_URL、AI_MODEL、AI_OUTPUT_MODE 后在任务页面重试。真实调用不会使用测试 Mock。

```sh
npm run typecheck
npm run lint
npm test
npm run test:integration
npm run build
npm run test:e2e
```

架构与权限见 docs/。实际完成/限制、精确测试结果与下一步见 docs/DELIVERY.md。

配置真实视觉服务后执行 `npm run model:sync`，再重启 Web/Worker。旧任务沿用旧配置，可在管理页选择“使用当前配置新建运行”。详见 [运行与恢复](docs/OPERATIONS.md)。

Playwright 首次使用先 `npx playwright install chromium`；已有系统 Chromium 时可用 `PLAYWRIGHT_CHROMIUM_PATH=/usr/bin/chromium npm run test:e2e`。集成测试应在隔离测试数据库运行；本地验收时先停止普通 Worker，避免它抢占测试任务。

本环境本地演示账户初始密码为 `TuHeng-Dev-2026!`（仅本地测试）。自行安装时使用 `.env` 中配置的 SEED_PASSWORD；不要在正式环境复用演示账号或密码。
