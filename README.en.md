# TPS Meter

[简体中文](README.md) · English

A live tokens-per-second tag beside the context ring in the OpenCode session header, with a 30-second detail panel.

- Tag: live rate, five-bar speed meter, pulsing dot and scan highlight.
- Panel: hover to open; shows the current rate, 30-second chart, peak, average, first-token latency, step tokens and duration.
- Pin: click the tag or the pin button to keep the panel on screen; click again to return to hover behavior.
- Error state: a failed run or scheduled retry turns the tag and panel red and shows the retry attempt.
- Event markers: verbose mode annotates the chart with user messages, model start and end, tool calls and results, run completion and errors.
- Builds: browser userscript, Chrome extension and a native OpenCode Desktop GUI plugin, with matching visuals and metrics.

## Install

Full steps and troubleshooting: [docs/install.md](docs/install.md) (Chinese).

| Build | Environment | Install |
|---|---|---|
| Userscript | Browser tab | Install `web/tps-meter.user.js` with Tampermonkey or Violentmonkey |
| Chrome extension | Browser tab | Unzip `web/tps-meter-extension.zip` and load it in `chrome://extensions` |
| Native plugin | OpenCode Desktop 2.2.0 or later | Add this directory to `plugins` in the global `opencode.json`, then restart Desktop |

Native plugin entry in `~/.config/opencode/opencode.json`:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["/path/to/tps-meter"]
}
```

## Usage

| Action | Result |
|---|---|
| Hover the tag | Opens the panel with live metrics |
| Click the tag or the pin button | Pins the panel; click again to unpin |
| Click elsewhere while pinned | The panel stays pinned |
| Click the marker toggle | Shows or hides event markers on the chart, off by default |
| `Escape` | Closes the panel and unpins it |
| Pointer leaves the tag and panel | Hover mode collapses; pinned mode stays |

## Errors and markers

- `session.retry.scheduled` turns the tag and panel red and shows `Retrying · attempt N`.
- `session.execution.failed` and `session.step.failed` show `Run failed`.
- A new message, a new step or a successful run restores the normal palette.
- Colors interpolate through a registered custom property; the tag also uses a red glow, a faster dot ripple and a faster scan animation.
- The verbose toggle sits left of the pin button. When enabled, event icons appear above the chart; hover an icon to read its name.

| Marker | Event |
|---|---|
| User message | `session.inbox.delivered` |
| Model start | `session.step.started` |
| Model end | `session.step.ended` |
| Tool call | `session.tool.called` |
| Tool result | `session.tool.success` / `session.tool.failed` |
| Run complete | `session.execution.succeeded` |
| Error | `session.retry.scheduled` / `session.execution.failed` / `session.step.failed` |

## Demo

Hover, pin and unpin while the session is idle:

![Hover and pin while idle](docs/media/panel-hover-pin.gif)

The panel during live streaming:

![Live panel and chart](docs/media/panel-live.gif)

## Language

The plugin follows the OpenCode interface language and supports English, Simplified Chinese and Traditional Chinese. The web build reads the `oc_locale` cookie and updates immediately when the language changes; the native plugin uses the locale context.

## Metrics

- Live rate is estimated from streamed text, reasoning and tool arguments and updates every 200 ms.
- When a step ends, the exact value is computed from `tokens.output + tokens.reasoning` and server timestamps.
- Definitions and error sources: [docs/metrics.md](docs/metrics.md) (Chinese).

## Layout

```
tps-meter/
├── src/
│   ├── gui.tsx                 GUI entry, i18n, slot registration
│   ├── tps.tsx                 Solid component, event subscriptions, panel
│   └── tps.css                 Native plugin styles
├── web/
│   ├── tps-meter.user.js       Web implementation (source of truth)
│   ├── index.html              Install page and static preview
│   ├── extension/
│   │   ├── manifest.json       Chrome extension manifest
│   │   └── content.js          Generated from the userscript
│   └── tps-meter-extension.zip Extension package
├── scripts/
│   └── build-web.mjs           Version check, sync and packaging
├── docs/
│   ├── architecture.md         Runtime shapes and data flow
│   ├── install.md              Install, update and troubleshooting
│   └── metrics.md              Metric definitions and error sources
├── dist/
│   └── gui-experimental.cjs    GUI plugin build output
├── CHANGELOG.md
├── package.json
├── tsconfig.json
└── vite.config.ts
```

## Development

```sh
npm install
npm run check     # TypeScript type check
npm run build     # Build the native plugin, sync and package the web build
npm run build:gui # Only dist/gui-experimental.cjs
npm run build:web # Version check, sync content.js, repack the zip
```

`dist/` and `web/tps-meter-extension.zip` are build outputs kept in the repository so the plugin can be installed directly and rolled back. `web/extension/content.js` is copied from `web/tps-meter.user.js`; do not edit it separately.

The version must match in `package.json`, the `@version` line of `web/tps-meter.user.js` and `web/extension/manifest.json`; `build:web` fails on a mismatch.

## Documentation

- [Architecture](docs/architecture.md) (Chinese)
- [Install and troubleshooting](docs/install.md) (Chinese)
- [Metric definitions](docs/metrics.md) (Chinese)
- [Changelog](CHANGELOG.md)
