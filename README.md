# 视笺 · 视频转字幕与 AI 知识笔记

中文 Next.js 网站：粘贴视频链接或上传音视频，提取带时间轴的字幕，用 DeepSeek 整理观点、学习笔记或会议纪要。网页与 API 部署到 **Vercel**，下载及转写部署为独立的 **Docker 服务**。

当前上线地址、使用方式和生产验收记录见 [部署交接](DEPLOYMENT.md)。

## 功能

- 链接入口：B站、抖音、YouTube、TikTok、Vimeo、小红书、快手（具体可用性取决于 yt-dlp、登录状态、地区与平台限制）。支持短链接及分享文案中的 HTTPS 链接。
- 优先读取平台现成字幕，无字幕时下载音轨，使用 FFmpeg 分段并调用 **Groq Whisper** 转写。DeepSeek 用于文本分析，不承担语音识别。
- 上传音视频（最大 200 MB、默认最长 2 小时），或导入 SRT / VTT / TXT；字幕文件在浏览器解析。
- DeepSeek 流式总结；长字幕先分段提炼再合并，保留已有时间戳，区分视频观点与推论。
- 原文字幕可编辑；支持 Markdown / TXT / SRT 导出，纯文本不会伪造时间轴。
- 最近 6 份笔记只保存在本机浏览器，可删除、清空；内置明确标注的免费示例。
- 网站无需访问密码；保留任务签名、一次性上传凭证、流式文件大小限制、平台域名限制和私网地址检查。

## 架构

```text
浏览器 ──文本/链接/签名任务查询──► Next.js / Vercel ──文本──► DeepSeek
   │                                    │
   │ 短期签名凭证 + 音视频直接上传        │ 服务端私有认证
   ▼                                    ▼
Docker / FastAPI ── yt-dlp ── 平台字幕或音轨 ── FFmpeg ── Groq Whisper
   └─ SQLite 持久化任务队列，单进程、单视频处理；原音视频处理后删除
```

音视频不经过 Vercel 的函数请求体，长视频处理不占用 Vercel 函数执行时长。网页每 2 秒查询任务状态；AI 总结使用最长 300 秒的流式函数。

## 本地运行

需要 Node.js 24、Python 3.12、FFmpeg（包含 ffprobe）。也可用 Docker 运行 worker。

```bash
npm ci
cp .env.example .env.local
python3 -m venv .venv
.venv/bin/pip install -r worker/requirements.txt
cp worker/.env.example worker/.env
```

生成一个至少 32 字符的随机密码，并将**同一个值**分别填入 `.env.local` 与 `worker/.env` 的 `WORKER_API_TOKEN`。不要把密钥提交到 Git；这些文件已经被忽略。填写 DeepSeek、Groq 密钥；只使用已有字幕时可不填写 Groq。

两个终端分别运行：

```bash
# 终端一：worker。仅从已填写且由你维护的本地文件加载配置。
cd worker
set -a
. ./.env
set +a
../.venv/bin/uvicorn app:app --host 127.0.0.1 --port 8000 --workers 1
```

```bash
# 终端二：仓库根目录
npm run dev
```

用本地 HTTP 请求验证服务：`curl -f http://127.0.0.1:8000/health`、`curl -f http://127.0.0.1:3000/api/health`。网站无需访问密码，右上角设置可查看服务配置状态。即使没有任何密钥，示例、字幕导入、编辑、导出与本机历史仍可使用。

Docker 本地运行：填写 `worker/.env` 后，在 `worker/` 下执行 `docker compose up --build -d`。Compose 只绑定回环地址；外网部署应通过托管平台的 HTTPS 入口或自己的反向代理访问。

## 部署到 Vercel + Docker

### 1. 部署视频处理服务

使用支持长驻 Docker 容器的服务（自己的服务器、Railway、Render 等），将 Docker 构建根目录指向 `worker/`，使用其中的 `Dockerfile`。建议 2 核、2 GB 内存及至少 5 GB 可写磁盘。容器监听 `${PORT:-8000}`，健康检查路径为 `/health`。

**Railway 的具体设置：**新建项目并连接本仓库，在 Service 的 Source 中将 Root Directory 设为 `/worker`，Config File Path 设为 `/worker/railway.json`。仓库已提供对应配置，构建使用该目录的 Dockerfile，副本数为 1，健康检查为 `/health`。在 Networking 中生成公网 HTTPS 域名，目标端口使用 `8000`（如平台注入 `PORT`，使用该值）。如添加 Volume，挂载到 `/data`，并确保 UID 10001 有写权限；否则将 `DATA_DIR` 设为可写目录，并接受重新部署时历史任务丢失。

本云环境也可使用 `bash scripts/setup-cloud.sh` 安装并验证，然后运行 `.venv/bin/python scripts/dev.py` 同时启动网站与本地 worker。此启动器读取本地配置文件，缺少共享认证时只在两个子进程的内存里生成临时随机密钥，不写入任何配置文件。

配置环境变量：

| 名称                | 用途                                                                                                        |
| ------------------- | ----------------------------------------------------------------------------------------------------------- |
| `WORKER_API_TOKEN`  | 必填，至少 32 字符的随机密钥；与 Vercel 保持一致                                                            |
| `GROQ_API_KEY`      | 语音转写需要；已有字幕可不填                                                                                |
| `GROQ_MODEL`        | 可选，默认 `whisper-large-v3`                                                                               |
| `CORS_ORIGINS`      | 网站的精确 HTTPS Origin，如 `https://your-project.vercel.app`；多个以英文逗号分隔，不带末尾 `/`，不使用 `*` |
| `DATA_DIR`          | 默认 `/data`；建议挂载持久卷，需允许容器 UID 10001 读写                                                     |
| `MAX_VIDEO_SECONDS` | 可选，默认 `7200` 秒                                                                                        |
| `YTDLP_COOKIE_FILE` | 可选，平台要求登录时指定只读挂载的 Netscape 格式 Cookie 文件路径                                            |

部署后取得处理服务的公网 **HTTPS** 地址。确认 `/health` 返回 `{"status":"ok"}`。仅启动 **1 个 Uvicorn worker、1 个服务副本**；当前 SQLite 队列不支持多个实例同时消费。若部署平台使用临时磁盘，重启会丢失任务；持久卷可保留结果，处理到一半的任务重启后标记失败并提示重新提交。

`CORS_ORIGINS` 只影响浏览器直接上传；服务端链接解析和查询仍由 `WORKER_API_TOKEN` 认证。Vercel Preview 的域名如与 Production 不同，需要逐个加入允许列表。

### 2. 部署网站到 Vercel

先将代码提交并推送到你的 GitHub 仓库，然后在 Vercel 导入 `Linkyyy/videoToText`，框架选 Next.js，**Root Directory 保持仓库根目录**。项目已包含 `vercel.json`，自动执行 `npm ci`、`npm run build`。在 Vercel 设置 Node.js 为 24.x。

在 Vercel 的 Environment Variables 安全填写：

| 名称               | 用途                                                               |
| ------------------ | ------------------------------------------------------------------ |
| `DEEPSEEK_API_KEY` | 必填，DeepSeek API 密钥                                            |
| `DEEPSEEK_MODEL`   | 可选，默认 `deepseek-chat`                                         |
| `WORKER_URL`       | Docker 服务的 HTTPS 地址，不带末尾 `/`                             |
| `WORKER_API_TOKEN` | 与 Docker 服务完全相同                                             |

环境变量不带 `NEXT_PUBLIC_` 前缀。更改后重新部署。在 Docker 的 `CORS_ORIGINS` 中补上最终的网站 Origin，然后重新启动 worker。

已经在 CLI 登录 Vercel 时，也可在仓库根目录运行：

```bash
npx vercel login
npx vercel
# 在项目环境变量设置完整后发布正式版
npx vercel --prod
```

不要把密钥发到聊天里、写入仓库、命令参数或文档。云环境代理注入的密钥可能是仅供该环境使用的占位符，不能把这些占位符复制到 Vercel 或外部 Docker；请在各部署平台安全填写真实密钥。

### 3. 上线验收

1. 网站设置显示 DeepSeek、视频服务“已配置”；这仅代表变量存在，不能替代真实请求。
2. 直接导入一份 SRT，确认时间轴、TXT/SRT 导出正确。
3. 用真实字幕生成总结，确认逐步输出并最终完成，导出 Markdown。
4. 提交一个你能访问的短视频链接，检查平台字幕路径。
5. 上传一个含语音、没有字幕的短视频，检查 Groq 转写路径；确认浏览器跨域上传成功。
6. 刷新后打开“本机历史”，恢复笔记；在新浏览器会话中确认无需输入密码即可使用。

真实平台解析与第三方 AI 调用只有在配置有效密钥、部署网络和实际视频链接后才可验收。单元测试中的响应模拟及页面示例不代表这些外部服务已经连通。

## 测试

```bash
npm test
npm run typecheck
npm run build
npx playwright install chromium
npm run test:e2e
.venv/bin/pip install -r worker/requirements-dev.txt
cd worker
../.venv/bin/python -m pytest -q
```

浏览器测试覆盖桌面与手机：示例、SRT 导入、编辑、历史恢复、导出、剪贴板、模拟流式总结和错误反馈。API 测试验证签名、防越权、输入限制、DeepSeek 分段整理及断流检测；Python 测试运行实际 FFmpeg/ffprobe，模拟 Groq 的 HTTP 响应。需要额外浏览器安装时保留下载与 TLS 校验。

## 限制与数据流

- **不保证任意链接都可解析。** 抖音、B站及其他平台可能对服务器 IP、登录、地区、验证码或接口限制访问；这时网站返回明确错误，支持改用上传。更新 yt-dlp 时重新运行测试并更新 `worker/requirements.txt` 的版本锁定，不通过禁用 TLS 来绕过问题。
- 不支持直播、视频合集或 DRM 解密。默认每个视频最多 2 小时，单次字幕最多 60,000 字符；更长内容需要分段。Vercel 总结函数受所选套餐实际时限、可用地区及 DeepSeek 响应速度限制。
- 视频处理完成或失败即删除下载及上传音视频；任务结果 24 小时后过期、不再提供查询，后台每小时执行一次数据库及磁盘清理。浏览器最近 6 份笔记保存至用户主动清理。处理服务意外关机时，遗留文件会在重启清理。
- 音频会发送到 Groq，字幕会发送到 DeepSeek。私密内容导入前应考虑这两个外部服务的数据政策。Cookie 文件由你自行挂载、更新，网页和 Vercel 不接收平台 Cookie。
- 当前版本无需访问密码，不包含多用户账户、跨设备同步或持久的分布式限流。公开访问者的转写与总结会消耗部署方的 API 额度；横向扩容需替换 SQLite 队列及本地文件存储。
