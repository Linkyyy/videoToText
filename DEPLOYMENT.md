# 视笺部署交接

更新：2026-10-19。

## 已部署资源

| 项目 | 地址 / 配置 |
| --- | --- |
| 网站 | https://shijian-video.vercel.app |
| Vercel 项目 | [huangwenwang / shijian-video](https://vercel.com/huangwenwang/shijian-video) |
| 视频处理服务 | https://video-worker-production-8629.up.railway.app |
| Railway 项目 | [shijian-video](https://railway.com/project/f2b3d61b-aff6-4221-a3c5-bbec6e6bf3a4) |
| Railway 服务 | `video-worker`，`production` 环境 |

两个服务均已部署成功。Vercel 使用 Node.js 24；Railway 使用 Docker、单个副本、单个 Uvicorn worker，监听端口 8000，健康检查 `/health`，已启用空闲休眠。没有创建额外数据库服务或持久卷，也没有更改账户付费套餐。

源码仓库：[Linkyyy/videoToText](https://github.com/Linkyyy/videoToText)，代码位于 `main` 分支。当前线上服务使用 CLI 上传源码部署，尚未连接 GitHub 自动部署；推送代码后仍需手动发布，或在部署平台另行连接仓库。

## 开始使用

1. 打开网站即可使用，无需访问密码；右上角设置可查看服务配置状态。
2. 导入字幕或文本，即可使用 DeepSeek 总结；视频链接会优先提取平台已有字幕。
3. 最近 6 份笔记保存在当前浏览器的 localStorage 中，不跨设备同步，清除浏览器数据后会丢失。处理服务临时保留 24 小时的任务结果与本机历史是独立的存储。

网站已按用户要求移除访问密码。公开访问者的转写和总结请求会使用部署方配置的 API 额度。

`GROQ_API_KEY` 已在 [Railway 的 video-worker 生产变量](https://railway.com/project/f2b3d61b-aff6-4221-a3c5-bbec6e6bf3a4/service/04d5845a-d6a6-4c73-add8-ec23e0a6ee99/variables?environmentId=d3dc06de-a8c7-4d7a-9bd0-ab3f3d28f89a)中配置并部署，无字幕音视频可以调用 Groq Whisper 转写。以后修改变量时需要应用待部署变更，才能进入实际运行环境。云环境里的密钥配置不会自动复制到这两个部署平台。

## 已完成的验证

- Vercel 生产构建成功，线上 `/api/health` 返回 200，DeepSeek 和 worker 配置状态均为 true。
- Railway 容器启动成功，平台健康检查和公网 `/health` 均返回 200。
- 从线上网站 API 发起真实 DeepSeek 请求，流式输出完成，得到 485 字的中文学习笔记，没有错误事件。
- 网站支持无密码访问；跨站请求、无效任务凭证及私网视频地址仍会被拒绝。
- 免密码版本已通过真实生产浏览器验收：新会话无需输入密码即可完成 DeepSeek 总结（389 字符）；桌面和手机设置均没有密码输入框。本机历史可在刷新后恢复，新浏览器会话中没有其他会话的历史。
- Vercel 能签发上传凭证，文件直接上传 Railway 返回 202；同一凭证再次使用返回 409。
- 上传预检正确允许网站的精确 HTTPS Origin。
- 从实际浏览器上传 6.56 秒合成测试语音，Groq 成功识别出英文原文及时间轴，网站自动调用 DeepSeek 完成 391 字的中文总结，Markdown 与 SRT 均成功下载。这条流程使用真实生产服务，没有模拟响应。
- Chromium 实测生产网站的桌面及手机首页、示例内容；均无横向溢出或页面脚本错误。浏览器信任云环境已有代理证书，未关闭 TLS 校验。
- 开发期间通过 26 项 TypeScript 测试、14 项 Python 测试和 10 项浏览器测试。模拟第三方响应的测试不能代替真实平台或语音转写验收。
- B站真实链接 `https://www.bilibili.com/video/BV17x411w7KC?p=1` 已通过生产浏览器验收：成功下载并转写 199.32 秒视频，得到 23 段、632 字符字幕，DeepSeek 流式总结完整结束（639 字符），Markdown 和 SRT 均成功导出，没有页面脚本错误。

网站上传、真实语音转写、DeepSeek 总结和导出流程已经通过线上验收。平台链接的可用性还取决于登录、地区、验证码和平台对服务器 IP 的限制；B站、抖音等链接不能保证全部可解析，必要时可改用文件上传。

B站解析修复已部署：下载音轨复用第一次解析得到的格式、媒体地址和请求头，避免重新访问视频页面；临时网络错误最多额外重试一次；地区限制、登录要求和平台限流分别显示明确提示；服务端保留经过脱敏的错误诊断。新增测试覆盖暂时性错误恢复、复用解析结果、永久错误不重试和日志凭证脱敏。

旧测试链接 `BV1GJ411x7h7` 在 yt-dlp 自带测试中已标为地区限制案例，不能用它代表普通公开视频是否可解析。`BV17x411w7KC?p=1` 修复后已通过线上完整流程。已核对 `yt-dlp==2026.8.19` 是检查时 PyPI 的最新稳定版，没有关闭证书校验。需要登录、付费权限或地区授权的视频仍遵循平台限制；抖音链接尚未进行真实视频验收。

## 后续维护

- `DEEPSEEK_API_KEY`、`WORKER_URL` 和 `WORKER_API_TOKEN` 位于 Vercel 的安全环境变量中。更改后需要重新发布网站。
- Railway 的 `WORKER_API_TOKEN` 已与网站保持一致，`CORS_ORIGINS` 已精确设置为网站 Origin。不要单独修改其中一侧的共享令牌。
- 当前 `/data` 使用临时磁盘，重新部署或重建容器可能丢失任务。需要保留任务时添加挂载到 `/data` 的持久卷，并确保容器 UID 10001 可以读写。
- 本次上传以 `worker/` 目录本身作为 Railway 构建根，所以线上 `rootDirectory` 为 `/`、Dockerfile 为 `Dockerfile`。README 中的 `/worker` 路径适用于今后从 GitHub 仓库根构建的方式。
- Railway 已提示 `railway.json` 将于 2026-12-01 后停止支持；后续重新部署前，应按平台文档迁移到 Infrastructure as Code，或改用平台界面维护等价设置。
- 安装和启动说明、仓库路径已保存到云环境配置草稿。需要在环境设置中保存并发布，才会用于后续任务；这与本次网站部署是两件独立的事。

任何 API 密钥、CLI 登录凭证、共享令牌或访问密码都不应写入文档、源码归档或 Git。
