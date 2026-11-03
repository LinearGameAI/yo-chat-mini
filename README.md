# yo-chat-mini

TikTok Mini Drama 独立 Web 项目，支持观看 **The Spooky Doll’s Revenge** 并与剧中角色聊天。本地目录 `yo-chat-mini/` 与 `YorollApp/` 同级。前端使用 React、TypeScript 和 Vite，后端使用 Express 和 SQLite，需要 Node 24 及以上。

## 本地启动

首次克隆后，在项目根目录安装依赖并启动本地服务。

```sh
npm ci
npm run dev
```

打开 **http://localhost:5173**。一个命令同时启动页面和 API，无需登录、环境变量或生产 Token。已构建版本可用 `npm start` 启动；两个命令使用同一端口，不应同时运行。

观看进度、章节位置、选择、会话和聊天历史保存在本机 `.data/mini.sqlite`；浏览器仅持有 HttpOnly 本地会话 cookie。浏览器内置返回、刷新、聊天返回和章节切换都保留进度。已有页面重新进入时按服务端进度恢复。

## 真实与 Mock 的边界

| 能力 | 当前实现 |
|---|---|
| 标题、简介、封面、10 集、49 节点、13 处选择、1 处 QTE | 来自真实公开 API 和版本化 CDN；不是编造素材 |
| 关联角色 | API 返回的 Daniel Renault，`yt_daniel_renault_married_doll`；不添加虚构角色 |
| 视频 | 本地模式使用原始真实 MP4；TikTok 模式使用官方 VePlayer，缺映射时明确报错 |
| 内容接口不可达 | 使用 `fixtures/spooky-doll.json` 中带来源和时间的真实 API 快照，页面标记为 saved API content；视频仍需网络 |
| 聊天 | 默认 **Mock**：模板回复，通过真实 SSE 逐块传输。不是已连通 YoChat 或真实 AI；页面明确标记 |
| 剧情关联 | 服务端从已发布图和字幕建立上下文，不接受前端传入剧情文本。保存剧、集、节点、角色、播放区间、选择 |
| 防剧透 | 仅加入实际播放区间内的完整字幕；拖动到后面不会把跳过的对白记作已看。回看/换分支会过滤不再可见的历史及幂等重放 |
| TikTok 身份 | 独立代码换码、身份映射、会话轮换/恢复已实现；真实换码未验证 |

当前源字幕只有中文 SRT；视频仍使用原发布内容。Mock 会引用这些原始字幕，没有伪造英语字幕或把自动翻译冒充原数据。QTE 延续原 App 的“片段结束后交互”行为；发布数据另含 `delay_from_start_seconds`，本版未按该字段改为片中触发。

可选真实模型由独立服务调用 OpenAI-compatible `chat/completions`，在 `.env.local` 配置：

```dotenv
CHAT_PROVIDER=openai-compatible
CHAT_BASE_URL=https://YOUR_AUTHORIZED_PROVIDER/v1/
CHAT_API_KEY=
CHAT_MODEL=
```

未配置时保持 Mock，不自动搜索或使用机器上的其他服务凭据。模型收到服务端核验的已看对白，不会收到整部剧简介、完整角色开场或隐藏 persona；生成质量及自由输入下的不剧透能力仍需接入后的真实模型验收。本次没有执行付费模型调用。

现有 YoChat 创建/发送接口没有可信剧情上下文字段。直接使用其完整角色开场可能提前剧透，因此本 MVP 不向现有生产聊天链路写入 pinned memory，也不将 TikTok 身份冒充 LGPlatform 用户。将来复用 YoChat 需要受信剧情上下文接口以及用户身份映射/独立 OAuth client 配置。

## TikTok 官方工具

已安装并固定官方 `tiktok-minis-cli 0.0.7`。**该版本 Playground 是手机扫码联调工具，没有免手机、免登录的本地模拟器模式。** 浏览器本地运行是本项目的 local 模式，不能把它称作 TikTok 真机验收。

```sh
# 仅检查官方工具是否能识别和启动项目；不会完成平台鉴权
npm run dev:tool
```

工具地址通常为 http://localhost:3000。脚本使用明确的 `local-preview-only` 标记打开工具入口，停在等待扫码界面；它不是有效 Client Key，不要扫码。退出时恢复原有 CLI Client Key 配置，不把这个标记用于发布构建。

真实联调前，复制 `.env.tiktok.example` 为 `.env.local` 并填写实际配置，然后先停止本地服务器，运行：

```sh
npm run dev:minis
```

还需要：

1. 真实 TikTok Client Key、仅服务端保存的 Client Secret、登记的测试账号和 TikTok 客户端；手机与电脑网络可达。
2. 正式 HTTPS 适配服务及实际前端 origin 白名单；静态包将 `VITE_API_BASE_URL` 指向该服务。跨站部署设置 `COOKIE_CROSS_SITE=true`（Secure / SameSite=None），并在目标 WebView 验证 cookie 策略；不使用 `*` 凭证跨域。
3. BytePlus / TikTok 审核并上架的媒体，按源节点配置实际 `album_id` / `episode_id` / `vid`。`config/tiktok-media.example.json` 仅提供结构；通过服务端 `TIKTOK_MEDIA_MAP_FILE` 指定真实映射文件。旧客户端需要短期播放凭证时，应接入官方凭证签发服务；不能长期复用过期 token。
4. 在 iOS / Android TikTok 实际验证登录、官方播放器、键盘、返回、前后台和流式网络。现有视频 URL 只用于本地播放，不能替代平台媒体审核和播放器限制。

SDK 入口按官方文档使用 `TTMinis.init({ clientKey })`、`TTMinis.login({success, fail})`、`TTMinis.on/off('minis.hide'/'minis.show')` 和 `TTMinis.getPlayer('byteplus')`。Client Secret 和业务 Token 不写入前端。平台能力缺配置时明确失败，不退回原始视频 URL。

外部入口参数支持 `drama_id`、`episode_id`（本地章号或真实 externalId）、`character_id`；只能定位本剧及关联角色。例如 `/?drama_id=900a3d4e-6589-4c66-8287-d9bd06937c11&episode_id=1&character_id=yt_daniel_renault_married_doll`。

## 验证与构建

```sh
npm test
npm run test:e2e
npm run build
npm run build:minis
```

Playwright 使用本机 Chrome，在 iPhone 13 和 Pixel 7 尺寸验证真实视频、Mock SSE、历史、续播、浏览器返回、章节列表、分支、待选择状态及 QTE；还覆盖慢网络下视频 metadata 未加载就离开时，已存进度不会被 0 覆盖。API 测试验证严格字段、CSRF、跨域白名单、并发、幂等及回看过滤；单元测试验证字幕范围、跳播、历史可见性、生命周期和身份恢复。测试中的 TikTok 身份是明确的测试 fixture，未伪造正式登录成功。

`npm run build` 产出 `dist/` 和 `dist-server/`。`minis build` 已实际尝试：SDK 标签与包体检查通过；因为没有真实 Client Key，最终归档失败，尚无可提交平台的正式包。

`verification/` 保存操作截图及验收记录。运行时依赖的 `npm audit --omit=dev` 无已知漏洞；官方 CLI 的构建依赖仍有上游 glob / minimatch 相关开发依赖告警。已对其固定的旧 Express、Handlebars 和 qs 使用同主版本安全补丁覆盖；本地调试工具不作为公网服务部署。

## 复用来源

- `shared/drama.ts`：抽取 Yoroll main `e6199716` 的 `src/api/shortDrama.ts` 纯节点、字幕路径、分支、QTE 解析。
- `shared/subtitles.ts`：原 App `src/subtitle/srt.ts`。
- `shared/promptSession.ts`：原 App `src/screens/shortDramaChatPromptSession.ts`。
- `shared/sse.ts`：沿用原 `src/api/chat/chatStream.ts` 的 SSE 帧规则，替换原生网络依赖。
- `DramaDetail.tsx`：按 `ShortDramaDetailScreen.tsx` 移植居中竖封面、标题信息行、简介和横向选集；必需的开播按钮使用原 `YButton` 的尺寸与样式。
- `DramaUI.tsx` / `Player.tsx`：移植 `ShortDramaCharacters`、`ShortDramaCastEntry`、`ShortDramaEpisodeSheet` / `ShortDramaSheetShell`，以及 `ShortDramaScreen` 的顶部栏、底部选集条和分支选择按钮。
- `Chat.tsx`：按原 `ChatScreen`、`MessageBubble`、`PhotoGlassBackdrop` 移植角色背景、渐变遮罩、头部、毛玻璃助手气泡、粉色用户气泡和输入框。只适配本版文字聊天需要的操作。
- `styles.css`：沿用原 App 的系统字体和 `YOROLL_DARK` 颜色、字号、边距、圆角；不使用外部字体。
- `Icon.tsx`：从 App 实际使用的 `@yoroll/rn-icon 0.0.18` 提取原图形，仅将 React Native SVG 包装转换为 Web SVG；不依赖原 App 即可构建。`scripts/extract-app-icons.mjs` 保留提取过程，日常启动不执行它。
- `DramaPlayerIcon.tsx`：直接复用 App 尚未收入图标包的短剧播放、净屏和退出净屏图形。

真实数据来源：[短剧详情](https://api.lineargame.ai/api/v1/feed/games/900a3d4e-6589-4c66-8287-d9bd06937c11)、[版本化 game.json](https://drneqli4lopih.cloudfront.net/publish/workflows/qte/900a3d4e-6589-4c66-8287-d9bd06937c11/publish/v19/game.json)。需要更新快照时运行 `npm run sync:content`。

实施时核对的官方文档：[开发工具](https://developers.tiktok.com/docs/en/debug-your-mini-app)、[SDK 初始化](https://developers.tiktok.com/docs/en/minis-sdk-get-started)、[登录](https://developers.tiktok.com/docs/en/minis-sdk-login)、[服务端换码](https://developers.tiktok.com/docs/en/tiktok-minis-silent-login)、[生命周期](https://developers.tiktok.com/docs/en/minis-sdk-event)、[媒体管理](https://developers.tiktok.com/docs/en/media-asset-management)、[官方播放器](https://developers.tiktok.com/docs/en/minis-player)。
