# yo-chat-mini

## 静态客户端直连（2026-11-06）

当前前端直接请求 Yoroll 线上服务，不再通过本项目的 Express 转发。列表为 `https://api.lineargame.ai/api/v1/feed/games?game_engine=drama&page=1&page_size=12`；详情、章节和字幕依次直连主 API 与发布 CDN；聊天创建会话、读取历史和 SSE 回复直连 `https://chat-api.lineargame.ai/api/v1`。观看进度按短剧保存在当前浏览器的 localStorage，不再使用服务端会话。

聊天使用 Yoroll 已有的邮箱登录 `/users/login` 和 `/users/me`，用户 token 只保存在当前标签页的 sessionStorage，不写入构建环境变量。TikTok SDK code 不能作为 Yoroll token；仓库中尚无 TikTok → Yoroll 换码契约，当前不会虚构该接口。token 失效后重新登录。会话 ID 按账号、服务地址、短剧和角色隔离，当前标签页刷新后复用。

可通过 `VITE_YOROLL_API_BASE_URL`、`VITE_YOROLL_CHAT_BASE_URL`、`VITE_YOROLL_CONTENT_LANGUAGE` 配置直连地址与语言，默认即生产地址。修改后执行 `npm run build:minis` 并重新上传。前端无需配置 `VITE_API_BASE_URL`、数据库或 Express 适配服务。

线上 API/CDN 必须允许 TikTok 实际页面 origin 的 CORS，请在平台配置中允许主 API、Chat API 和内容 CDN 域名。Chat API 预检需允许 `Authorization`、`Content-Type`、`X-Client-Type`、`X-Client-Platform`、`X-Client-Version`、`X-Device-Id` 等请求头。`yo-chat-server` 使用 `CORS_ALLOWED_ORIGINS` 精确匹配 origin；生产部署工作流从 `PROD_CORS_ALLOWED_ORIGINS` 读取，默认只有 `https://chat.yoroll.ai`，需保留原配置并追加实际 TikTok origin。若跨域不通过，修正线上服务的 CORS 配置；客户端没有代理回退。

TikTok 官方播放器仍需要已审核的媒体 ID。静态客户端通过 `VITE_TIKTOK_MEDIA_MAP_URL` 读取公开 HTTPS JSON，结构为节点 ID 到 `{ album_id, episode_id, vid }`；不得包含密钥或长期播放 token。缺少映射时明确报错。聊天不向线上接口添加未定义的剧情上下文字段，因此不能保证模型防剧透。

下文涉及 `/api/*`、Express、数据库和 Mock 聊天的说明仅适用于保留的旧服务端代码；当前前端不调用这些接口。

## 互动短剧首页

首页 `/` 展示与 YorollApp「互动短剧」tab 相同来源的简单列表（封面、标题、会员/付费标记、播放量、标签），支持分页、空态和失败重试。点击条目进入 `/?drama_id={id}#watch` 播放该剧；点击「和角色聊聊」进入已有详情页，选择角色后进入聊天，返回时保留视频进度。未关联角色的剧不显示聊天入口。`/#detail` 仍可访问默认示例剧详情。

- 原接口：`GET https://api.lineargame.ai/api/v1/feed/games?game_engine=drama&page=1&page_size=12`，来源为同级 `YorollApp/src/api/feed.ts` 的 `getFeedGames`。
- 本项目代理：`GET /api/dramas?page=1`，固定 `game_engine=drama`、每页 12 条，沿用 `YOROLL_API_BASE_URL` 和 `YOROLL_CONTENT_LANGUAGE`（通过 `Accept-Language` 传递，默认 `en-US`）。
- 首页独立请求列表，不加载单剧章节/字幕，也不要求观看会话；不使用本地假数据。
- 详情、播放、字幕和聊天 API 通过 `X-Drama-Id` 选择短剧，未传时沿用默认示例剧。每部剧的内容缓存、会话 cookie、观看进度和聊天记录独立，TikTok 登录恢复也按用户和短剧区分。
- 视频页保留返回、暂停/播放、进度条、选集、剧情选项和阶段信息；没有字幕/倍速控制、点赞、收藏、转发或全屏按钮。字幕内容本身继续显示。
- 当前没有会员/积分授权对接，只加载 `chapterLock.fromChapter` 之前的免费章节，锁定章节仅显示禁用项；没有免费章节时提示并允许返回首页。角色聊天仍受下文所述 Yoroll 用户凭证接入限制。
- 手机调试浮层使用 eruda，通过外部脚本加载并直接初始化，不受 URL 参数限制。

TikTok Mini Drama 独立 Web 项目，支持观看 **The Spooky Doll’s Revenge** 并与剧中角色聊天。本地目录 `yo-chat-mini/` 与 `YorollApp/` 同级。前端使用 React、TypeScript 和 Vite，后端使用 Express 和 SQLite，需要 Node 24 及以上。

## Vercel 部署

`vercel.json` 将 Vite 静态资源交给 CDN，`api/index.ts` 承接 Express API 和 SSE。Vercel 使用 Node 24；本地启动方式不变。

Vercel 上必须配置独立 Neon Postgres 的 `DATABASE_URL`，用于持久保存会话、观看进度和聊天记录；未设置时服务明确拒绝启动，不使用临时文件保存数据。本地未设置 `DATABASE_URL` 时继续使用 SQLite。聊天仍默认使用下文说明的 Mock；真实模型需要独立配置。

```bash
vercel link --project yo-chat-mini --scope YOUR_TEAM -y
vercel deploy --scope YOUR_TEAM -y --no-wait
```

Vercel 项目 `yo-chat-mini` 已连接本 GitHub 仓库：推送 `main` 自动部署正式环境，其他分支和 PR 自动生成预览。Production、Preview 和 Development 均已连接该项目专用的 Neon 数据库；凭据由 Vercel 环境变量管理，无需提交 `.env.local`、`.vercel/` 或个人 Token。新建 Vercel 项目时，需要在对应环境重新连接 Neon。

GitHub Actions 在每次推送和 PR 上读取 `package.json` 的 Node 版本，执行 `npm ci`、`npm test` 和 `npm run build`。Vercel 同样使用 `npm ci`，按提交的 lockfile 安装依赖。拉取最新 `main` 后，其他开发者可以继续使用下文的本地启动命令，也可直接推送分支进行预览，无需手动执行 Vercel CLI。

此部署为独立 Web 入口；TikTok 登录和官方媒体配置仍按下文的真实平台联调要求提供。

使用 `vercel env pull .env.vercel.development.local --environment development` 拉取开发环境变量后，可运行真实云数据库浏览器测试：`node --env-file=.env.vercel.development.local node_modules/@playwright/test/cli.js test`。设置 `TEST_DATABASE_URL` 后，`npm test` 还会验证跨进程持久化、会话轮换及跨实例聊天锁，并清理自身测试数据。

## 本地启动

首次克隆后，在项目根目录安装依赖并启动本地服务。

```sh
npm ci
npm run dev:local
```

打开 **http://localhost:5173**。一个命令同时启动页面和 API；本地观看无需登录。聊天默认使用 Yoroll，需要用户级 Yoroll 凭证（TikTok 换凭证接口待后端提供）。已构建版本可用 `npm start` 启动；两个命令使用同一端口，不应同时运行。

`npm run dev:local` 在本地开发时强制使用 local 会话，跳过 `TTMinis.login` 并使用原始视频 URL，即使启动环境中已有 `APP_MODE=tiktok` 也可调试网页。`npm run dev` 按 `APP_MODE` 启动；真机联调仍使用 `npm run dev:minis`。切换模式前先停止占用 5173 端口的旧服务。

观看进度、章节位置、选择、会话和聊天历史保存在本机 `.data/mini.sqlite`；浏览器仅持有 HttpOnly 本地会话 cookie。浏览器内置返回、刷新、聊天返回和章节切换都保留进度。已有页面重新进入时按服务端进度恢复。

## 真实与 Mock 的边界

| 能力 | 当前实现 |
|---|---|
| 标题、简介、封面、10 集、49 节点、13 处选择、1 处 QTE | 来自真实公开 API 和版本化 CDN；不是编造素材 |
| 关联角色 | API 返回的 Daniel Renault，`yt_daniel_renault_married_doll`；不添加虚构角色 |
| 视频 | 本地模式使用原始真实 MP4；TikTok 模式使用官方 VePlayer，缺映射时明确报错 |
| 内容接口不可达 | 返回 503 并显示加载错误，可点击重试；不读取本地快照或 Mock 短剧 |
| 聊天 | 默认 **Yoroll**：按角色创建独立会话，再通过会话 ID 调用 SSE；TikTok → Yoroll 鉴权尚待后端提供，缺凭证时明确报错。Mock 仅供显式离线测试 |
| 剧情关联 | 服务端从已发布图和字幕建立上下文，不接受前端传入剧情文本。保存剧、集、节点、角色、播放区间、选择 |
| 防剧透 | 仅加入实际播放区间内的完整字幕；拖动到后面不会把跳过的对白记作已看。回看/换分支会过滤不再可见的历史及幂等重放 |
| TikTok 身份 | 独立代码换码、身份映射、会话轮换/恢复已实现；真实换码未验证 |

短剧获取复用 YorollApp 的线上协议：`GET /feed/games/{dramaId}` → `game.game_json_url` → `chapters[].dataPath` → 节点视频和字幕。章节 JSON 的目录作为视频、封面和字幕的资源基址，不使用 `meta.cdnBase` 或 `videoBaseUrl`。清单和章节请求失败时最多重试两次。首页所选短剧复用同一套详情、播放及角色聊天页面。

`YOROLL_API_BASE_URL` 默认 `https://api.lineargame.ai/api/v1`，测试环境可设为 `https://test-api.lineargame.ai/api/v1`；`YOROLL_CONTENT_LANGUAGE` 默认 `en-US`，通过 `Accept-Language` 交给服务端选择内容语言。线上内容首次请求时加载，并在服务进程内缓存；失败不会缓存，下次请求会重新获取。旧 `CONTENT_SOURCE` 配置不再生效。`fixtures/spooky-doll.json` 仅供自动化测试及 `sync:content` 保存参考数据使用，不参与运行时加载。

字幕按线上节点下发的 `subtitles` 获取；视频使用原发布内容。显式 Mock 聊天会引用这些原始字幕，没有伪造英语字幕或把自动翻译冒充原数据。QTE 延续原 App 的“片段结束后交互”行为；发布数据另含 `delay_from_start_seconds`，本版未按该字段改为片中触发。

### Yoroll 聊天接口

```dotenv
CHAT_PROVIDER=yoroll
YOROLL_CHAT_BASE_URL=https://chat-api.lineargame.ai/api/v1
# 可选，省略时沿用服务端会话默认模型
CHAT_MODEL=
```

测试环境地址为 `https://test-chat-api.lineargame.ai/api/v1`。Vercel 已有的 `CHAT_PROVIDER=mock` 需要改为 `yoroll` 并重新部署。

协议参考同级 `yorollapp/src/api/chat/conversations.ts`、`chatStream.ts` 和 `types.ts`：

- `POST /companions/:companionId/conversations`，传 `{ startNew: true }`，读取 `conversation.id`。角色 ID 使用内容 API 返回的 `character.id`。
- `POST /conversations/:conversationId/responses`，传 `text`、原始 `clientRequestId`、`streamFormat: "blocks"` 和可选 `model`。
- 处理 `block.updated` 完整块快照、`text.delta`、`response.completed` 和 `response.failed`；建议选项不混入正文，失败或未完成的流不保存为成功消息。

远端会话 ID 保存在当前用户的本地会话记录中，重试复用会话及幂等键；回看或切换分支导致可见历史变化时创建新的远端会话，防止继续使用已隐藏的远端历史。

**鉴权接入点**：`server/yoroll.ts` 的 `requireYorollAuth(session)` 读取服务端会话中的 `yorollAuth: { accessToken, userId }`。后续在 `/api/auth/tiktok` 中调用后端正式提供的换凭证接口，确认用户身份后写入该字段并持久化；当前未猜测换码 URL、返回字段或刷新协议，TikTok token 不能直接作为 Yoroll Bearer token。凭证不通过聊天请求体、环境共享账号或 bootstrap 下发。当前缺凭证时返回明确的 503，不能视为真实聊天已联调完成。

现有 Yoroll 创建/发送接口没有可信剧情上下文字段，本次不新增未经后端确认的参数、不写 pinned memory。已看上下文及本地消息过滤仍保留，但 Yoroll 使用其自身角色设定和远端历史，**不能保证生成不剧透**。可信上下文约束、鉴权刷新和真实模型效果需后续后端协议及联调确认。

可选真实模型由独立服务调用 OpenAI-compatible `chat/completions`，在 `.env.local` 配置：

```dotenv
CHAT_PROVIDER=openai-compatible
CHAT_BASE_URL=https://YOUR_AUTHORIZED_PROVIDER/v1/
CHAT_API_KEY=
CHAT_MODEL=
```

OpenAI-compatible 模式会收到服务端核验的已看对白；其防剧透能力仍需真实模型验收。显式设置 `CHAT_PROVIDER=mock` 可使用离线模板进行开发测试。服务失败不会自动回退 Mock，也不会搜索机器上的其他服务凭据。本次没有执行付费模型调用。

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

SDK 入口按官方文档使用 `TTMinis.init({ clientKey })`、`TTMinis.login(callback)`、`TTMinis.on/off('minis.hide'/'minis.show')` 和 `TTMinis.getPlayer('byteplus')`。启动时，只有 `/api/bootstrap` 返回 `mode: 'tiktok'` 且 `authenticated: false` 才调用登录；前端从回调的 `authResponse.code` 取码，提交到 `/api/auth/tiktok` 由服务端换取凭证并建立会话。已有会话或 local 模式会跳过 SDK 登录。Client Secret 和业务 Token 不写入前端。平台能力缺配置时明确失败，不退回原始视频 URL。

外部入口参数支持 `drama_id`、`episode_id`（本地章号或真实 externalId）、`character_id`；章节和角色必须关联所选短剧。例如 `/?drama_id=900a3d4e-6589-4c66-8287-d9bd06937c11&episode_id=1&character_id=yt_daniel_renault_married_doll`。

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
