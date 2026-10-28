# 实现架构

## 两种宿主

OpenCode 有两套前端宿主，插件分别以不同方式接入。

| 宿主 | 加载机制 | 入口 |
|---|---|---|
| 浏览器标签页 | 页面自行发起请求，没有插件桥 | `web/tps-meter.user.js` 或 Chrome 扩展 |
| OpenCode Desktop | 服务端返回 `/api/plugin/gui`，桌面端加载插件包 | `dist/gui-experimental.cjs`，由 `src/` 构建 |

浏览器环境不提供 GUI 插件桥，因此网页版通过 content script 注入同一套逻辑；两套实现共享指标定义与视觉语言，代码各自维护。

## 数据流

```
服务端事件流 /api/event
        │  session.step.started
        │  session.text.delta
        │  session.reasoning.delta
        │  session.tool.input.delta
        │  session.step.ended / failed
        ▼
  采样与状态机 ──► 标签数值、速度条
        │
        ├──► 200 ms 定时器 ──► 时间线缓冲 ──► SVG 曲线
        │
        └──► /api/session/:id/message?order=desc&limit=40
                 页面加载时补齐已完成步骤的精确值
```

原生插件通过 `props.session.server.data.on(...)` 订阅同一批事件；网页版通过 `EventSource` 监听 `/api/event`，并按 `event.data.sessionID` 过滤。

## 状态机

| 状态 | 进入条件 | 标签表现 |
|---|---|---|
| `empty` | 无数据 | 隐藏 |
| `running` | 步骤开始但暂无增量，或停顿超过 800 ms | 保留上一次测得的速度 |
| `live` | 2 秒窗口内有增量 | 实时值、脉冲与扫描动画 |
| `done` | 步骤结束 | 精确值，速度条降饱和 |

状态迁移由事件驱动，定时器只负责采样与界面刷新。

## 挂载位置

- 原生插件注册在 `session.header` 槽位的 `order: 15`，位于内置用量指示（`order: 10`）与会话详情（`order: 20`）之间。
- 网页版从会话标题节点向上查找包含 `[data-component="progress-circle"]` 的祖先，把标签插入其触发容器之后；节点被替换时由 500 ms 定时器重新挂载。
- 网页版对页面的识别依据应用根节点上的 `bg-v2-` 类、进度环或页面标题，其他站点直接退出，不建立连接。

## 语言

- 原生插件通过 `ctx.locale` 订阅 OpenCode 的 locale，文案覆盖 `en`、`zh`、`zht`，随设置实时切换。
- 网页版依次读取 `oc_locale` cookie、`<html lang>` 与 `navigator.language`，映射到 `zh`、`zht`、`en`。
- 网页版监听 `<html lang>` 变化，切换语言后立即刷新统计字段、图注与提示文案，无需刷新页面。

## 固定交互

面板有 `hover` 与 `pinned` 两种显示状态，由 `data-pinned` 与 `data-open` 两个属性表达。

- 悬停：进入标签或面板展开，离开后 140 ms 收起。缓冲用于跨过标签与面板之间的间隙。
- 固定：点击标签或图钉切换。固定后不响应页面其他位置的点击，只由再次点击或 `Escape` 关闭。
- 定位：面板使用 `position: fixed`，每次采样或窗口变化时按标签矩形重新计算，并夹紧到视口内；标签移出视口时隐藏。

## 曲线渲染

- 环形缓冲每 200 ms 记录一次速度，保留 30 秒以上，空闲期记录 0。
- 使用内联 SVG：`viewBox` 宽 214，与实际内容宽度一致，避免非等比缩放导致线宽与端点变形。
- y 轴取 `max(20, ceil(峰值 / 10) * 10)`；x 轴在数据不足 30 秒时按已有跨度铺满，满 30 秒后转为滚动窗口。
- 仅当面板展开时重绘，关闭后停止绘制。

## 构建流水线

```
src/*.tsx, src/*.css ──vite + @opencode/plugin/gui/vite──► dist/gui-experimental.cjs
web/tps-meter.user.js ──build-web.mjs──► web/extension/content.js
                                       └► web/tps-meter-extension.zip
```

`build-web.mjs` 会先校验三个版本号一致，再同步与打包。

## 已知限制

- 实时值来自字符数估算，与分词器结果存在偏差；精确值以步骤结束后的 token 用量为准。
- 固定面板依赖 `position: fixed`，若页头祖先元素引入 `transform` 或 `filter`，定位基准会改变。
- 浏览器扩展需要「重新加载」才会应用新的 content script，已打开的页面需刷新。
- 会话累计指标不跨刷新持久化。
