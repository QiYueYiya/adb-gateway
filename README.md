# ADB Gateway

基于 Node.js 的 ADB 命令转发网关，为单台 Android 设备提供无线配对、命令执行和后台保活能力。

## 功能

- **无线配对** — 通过 Web 页面完成 ADB 无线配对，配对成功后自动销毁页面
- **命令执行** — 支持 `shell`、`su`、`adb` 三种模式的 REST API
- **静态鉴权** — Bearer Token 鉴权，密钥通过环境变量配置
- **后台保活** — 心跳检测 + 线性退避重连（5s 步长，60s 封顶），永不停止
- **健康检查** — `GET /health` 端点，返回设备状态和进程运行时间
- **Docker 支持** — 提供 Dockerfile 和 docker-compose 配置

## 技术栈

| 组件 | 说明 |
|------|------|
| 运行时 | Node.js >= 22 |
| 框架 | Express.js |
| ADB 客户端 | `@devicefarmer/adbkit` |
| 系统依赖 | `adb`（Android SDK Platform-Tools） |

## 快速开始

### 本地运行

```bash
# 安装依赖
npm install

# 配置环境变量（可选，已有默认值）
cp .env.example .env

# 启动服务
npm start

# 开发模式（自动重启）
npm run dev
```

### Docker 运行

```bash
# 拉取镜像
docker compose pull

# 启动
docker compose up -d

# 或本地构建
docker compose up --build
```

## API 文档

### 健康检查

```
GET /health
```

返回设备在线状态和进程运行时间，无需鉴权。

```json
{
  "status": "ok",
  "device": { "ip": "192.168.1.10", "port": 5555, "online": true },
  "uptime": 12345
}
```

### 配对设备

```
GET  /pair   # 配对页面（启动时可用，配对成功后销毁）
POST /pair   # 提交配对请求
```

POST 请求体：

```json
{
  "ip": "192.168.1.100",
  "pairPort": 37000,
  "pairCode": "123456"
}
```

### 执行命令

```
POST /exec
Authorization: Bearer <API_KEY>
```

请求体：

```json
{
  "command": "getprop ro.product.model",
  "type": "shell"
}
```

`type` 可选值：

| type | 说明 |
|------|------|
| `shell` | `adb shell <command>` |
| `su` | `adb shell su -c '<command>'` |
| `adb` | 直接执行 adbkit 客户端方法 |

响应：

```json
{ "success": true, "data": "Pixel 7", "error": null }
```

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `ADB_API_KEY` | `default-adb-key-2026` | API 鉴权密钥 |
| `ADB_COMMAND_TIMEOUT` | `30000` | 命令执行超时（ms） |
| `ADB_PAIR_TIMEOUT` | `60000` | 配对操作超时（ms） |
| `PORT` | `3000` | HTTP 监听端口 |
| `LOG_LEVEL` | `INFO` | 日志级别（DEBUG/INFO/WARN/ERROR） |

## 项目结构

```
├── index.js              # 主入口
├── lib/logger.js         # 日志工具
├── middleware/
│   ├── auth.js           # Bearer Token 鉴权
│   └── requestLogger.js  # 请求日志
├── routes/
│   ├── health.js         # 健康检查
│   ├── pair.js           # 配对路由
│   └── exec.js           # 命令执行路由
├── services/
│   ├── adb.js            # adbkit 客户端封装
│   └── keepalive.js      # 心跳 + 重连
├── Dockerfile
├── docker-compose.yml
└── .github/workflows/docker.yml
```

## Docker 镜像

镜像托管在 GitHub Container Registry：

```
ghcr.io/qiyueyiya/adb-gateway:latest
```

推送版本 tag 自动构建：

```bash
git tag 1.0.0
git push origin 1.0.0
# → ghcr.io/qiyueyiya/adb-gateway:1.0.0 + :latest
```

## License

MIT
