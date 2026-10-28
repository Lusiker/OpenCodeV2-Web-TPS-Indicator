# 安装与排错

插件提供三种安装形态，按使用环境选择一种即可。

## 前置条件

- 网页版：Chrome 或 Edge，能访问 OpenCode 服务地址。
- 桌面版：OpenCode Desktop 2.2.0 及以上。
- 源码构建：Node.js 20 及以上，`zip` 命令可用。

以下示例用 `/path/to/tps-meter` 表示插件目录，安装时替换为实际路径。

## 网页版：用户脚本

1. 安装 Tampermonkey 或 Violentmonkey。
2. 在浏览器中打开 `web/tps-meter.user.js`，脚本管理器会显示安装页；也可以新建脚本后粘贴文件内容。
3. 打开或刷新 OpenCode 会话页，标签出现在上下文进度环右侧。

脚本匹配所有 http 与 https 页面，运行前检查页面是否为 OpenCode 应用，其他站点不做任何处理。

## 网页版：Chrome 扩展

1. 解压 `web/tps-meter-extension.zip`。
2. 打开 `chrome://extensions`，启用「开发者模式」。
3. 点击「加载已解压的扩展程序」，选择解压后的 `extension` 目录。
4. 启用扩展，刷新已经打开的 OpenCode 标签页。

content script 只注入到加载之后打开的页面，安装或更新后必须刷新。

## 桌面版：原生 GUI 插件

在全局 `~/.config/opencode/opencode.json` 的 `plugins` 中加入本目录：

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["/path/to/tps-meter"]
}
```

完全退出并重新打开 Desktop，或执行：

```sh
opencode service restart
```

服务端会加载 `package.json` 中 `exports` 指向的 `dist/gui-experimental.cjs`。

## 更新

```sh
cd /path/to/tps-meter
npm install
npm run build
```

- 用户脚本：脚本管理器识别到 `@version` 变化后提示更新，或重新安装一次。
- Chrome 扩展：在 `chrome://extensions` 点击扩展的「重新加载」，再刷新 OpenCode 页面。
- Desktop：完全退出重开，进程内的插件模块不会热替换。

## 排错

### 标签没有出现

1. 确认当前地址是 OpenCode 会话页，例如 `/session/ses_...`。
2. 确认扩展已启用且页面在加载扩展之后刷新过。
3. 打开控制台执行：

```js
document.querySelector(".oc-tps-host")?.shadowRoot?.querySelector(".value")?.textContent
```

返回数字说明脚本已运行，返回 `undefined` 说明 content script 没有注入。

4. 在 `chrome://extensions` 查看扩展是否有报错，必要时移除后重新加载目录。

### Desktop 没有加载插件

1. 检查 `opencode.json` 中的路径指向包含 `package.json` 的目录。
2. 确认 `dist/gui-experimental.cjs` 存在，缺失时执行 `npm run build:gui`。
3. 完全退出 Desktop 后重开；仅关闭窗口不会重新加载插件。
4. 查看服务端 `/api/plugin` 返回中是否包含 `tps-meter` 且状态为 `active`。

### 面板显示位置异常

面板使用 `position: fixed` 定位。若页头祖先元素带有 `transform`、`filter` 或 `perspective`，定位基准会变成该元素，面板可能偏移或被裁剪。出现这种情况需要把面板挂载到 `document.body` 下的独立容器。

### 数值与预期不符

实时值来自字符数估算，步骤结束后才切换为精确 token 用量。口径与误差范围见 [metrics.md](metrics.md)。

## 卸载

- 用户脚本：在脚本管理器中删除「OpenCode TPS Meter」。
- Chrome 扩展：在 `chrome://extensions` 移除扩展。
- Desktop：从 `opencode.json` 的 `plugins` 中删除本目录路径，重启 Desktop。
