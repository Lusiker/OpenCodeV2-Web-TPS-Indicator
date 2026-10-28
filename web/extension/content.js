// ==UserScript==
// @name         OpenCode TPS Meter
// @namespace    https://opencode.ai/
// @version      1.2.4
// @description  Live tokens per second beside the context ring in the OpenCode web UI.
// @match        *://*/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(() => {
  "use strict"

  if (window.__ocTpsMeter) return
  window.__ocTpsMeter = true

  function isOpenCode() {
    const root = document.getElementById("root")
    if (root && /(^|\s)bg-v2-/.test(root.className)) return true
    if (document.querySelector('[data-component="progress-circle"]')) return true
    return /OpenCode/i.test(document.title)
  }

  if (!isOpenCode()) return

  const WINDOW_MS = 2000
  const TICK_MS = 200
  const IDLE_MS = 800
  const BARS = 5
  const SPAN_MS = 30000
  const MAX_SAMPLES = 220

  function cookieValue(name) {
    for (const part of document.cookie.split(";")) {
      const [key, ...rest] = part.trim().split("=")
      if (key === name) return decodeURIComponent(rest.join("="))
    }
    return undefined
  }

  function resolveLocale() {
    const raw = (
      cookieValue("oc_locale") ||
      document.documentElement.lang ||
      navigator.language ||
      "en"
    ).toLowerCase()
    if (raw === "zht" || raw.startsWith("zh-hant") || raw.startsWith("zh-tw")) return "zht"
    if (raw.startsWith("zh-hk") || raw.startsWith("zh-mo")) return "zht"
    if (raw.startsWith("zh")) return "zh"
    return "en"
  }

  const dictionaries = {
    zh: {
      label: "TPS",
      unit: "tok/s",
      live: "实时输出速度",
      done: "上一段输出速度",
      running: "等待模型输出",
      statPeak: "峰值",
      statAvg: "均值",
      statTtft: "首字",
      statStep: "本段",
      statTime: "耗时",
      statWindow: "窗口",
      windowShort: "2.0 s",
      chartLabel: "最近 30 秒",
      pinOn: "固定面板",
      pinOff: "取消固定",
      noteLive: "根据流式文本、推理与工具参数估算。",
      noteExact: "根据本段 token 用量计算。",
      noteRunning: "模型仍在工作，显示最近一次测得的速度。",
      aria: (rate) => `输出速度：每秒 ${rate} 个 token`,
    },
    zht: {
      label: "TPS",
      unit: "tok/s",
      live: "即時輸出速度",
      done: "上一段輸出速度",
      running: "等待模型輸出",
      statPeak: "峰值",
      statAvg: "均值",
      statTtft: "首字",
      statStep: "本段",
      statTime: "耗時",
      statWindow: "視窗",
      windowShort: "2.0 s",
      chartLabel: "最近 30 秒",
      pinOn: "固定面板",
      pinOff: "取消固定",
      noteLive: "根據串流文字、推理與工具參數估算。",
      noteExact: "根據本段 token 用量計算。",
      noteRunning: "模型仍在運作，顯示最近一次測得的速度。",
      aria: (rate) => `輸出速度：每秒 ${rate} 個 token`,
    },
    en: {
      label: "TPS",
      unit: "tok/s",
      live: "Live output speed",
      done: "Last output speed",
      running: "Waiting for model output",
      noteLive: "Estimated from streamed text, reasoning and tool arguments.",
      noteExact: "Computed from the step's token usage.",
      noteRunning: "The latest measured speed while the model is working.",
      statPeak: "Peak",
      statAvg: "Average",
      statTtft: "First token",
      statStep: "Step tokens",
      statTime: "Duration",
      statWindow: "Window",
      windowShort: "2.0 s",
      chartLabel: "Last 30 s",
      pinOn: "Pin panel",
      pinOff: "Unpin panel",
      aria: (rate) => `Output speed: ${rate} tokens per second`,
    },
  }

  let locale = resolveLocale()
  let copy = dictionaries[locale]

  const css = `
    :host {
      --accent: var(--v2-state-fg-success, #22c55e);
      display: inline-flex;
      align-items: center;
      height: 22px;
      color: var(--v2-text-text-muted, #888);
      font-family: inherit;
      font-size: 11px;
      font-variant-numeric: tabular-nums;
      vertical-align: middle;
    }

    * { box-sizing: border-box; }

    .tag {
      position: relative;
      display: inline-flex;
      align-items: center;
      gap: 5px;
      height: 22px;
      padding: 0 7px 0 6px;
      overflow: hidden;
      border: 1px solid var(--v2-border-border-muted, rgba(127, 127, 127, 0.24));
      border-radius: 6px;
      background:
        linear-gradient(
          180deg,
          color-mix(in srgb, var(--v2-background-bg-layer-02, rgba(127, 127, 127, 0.08)) 72%, transparent),
          color-mix(in srgb, var(--v2-background-bg-base, transparent) 18%, transparent)
        );
      color: var(--v2-text-text-muted, #888);
      font-family: inherit;
      font-size: 11px;
      font-weight: 500;
      font-variant-numeric: tabular-nums;
      letter-spacing: 0.01em;
      line-height: 1;
      white-space: nowrap;
      user-select: none;
      cursor: pointer;
      transition:
        border-color 180ms ease,
        background-color 180ms ease,
        color 180ms ease,
        box-shadow 220ms ease;
      animation: oc-tps-in 240ms cubic-bezier(0.2, 0.8, 0.2, 1) both;
    }

    .tag:is(:hover, :focus-visible) {
      border-color: var(--v2-border-border-strong, var(--v2-border-border-muted, rgba(127, 127, 127, 0.4)));
      color: var(--v2-text-text-base, #eee);
    }

    .tag:focus-visible {
      outline: 1px solid var(--v2-border-border-focus, var(--v2-text-text-accent, #5eead4));
      outline-offset: 1px;
    }

    .tag[data-state="live"] {
      border-color: color-mix(in srgb, var(--accent) 32%, var(--v2-border-border-muted, rgba(127, 127, 127, 0.24)));
      background:
        linear-gradient(
          180deg,
          color-mix(in srgb, var(--accent) 9%, var(--v2-background-bg-layer-02, rgba(127, 127, 127, 0.08))),
          color-mix(in srgb, var(--accent) 3%, var(--v2-background-bg-base, transparent))
        );
      color: var(--v2-text-text-base, #eee);
    }

    .tag[data-state="done"] {
      border-color: color-mix(in srgb, var(--accent) 18%, var(--v2-border-border-muted, rgba(127, 127, 127, 0.24)));
    }

    .tag[data-pinned="true"] {
      border-color: color-mix(in srgb, var(--accent) 34%, var(--v2-border-border-muted, rgba(127, 127, 127, 0.24)));
      color: var(--v2-text-text-base, #eee);
    }

    :host-context([data-color-scheme="dark"]) .tag[data-state="live"] {
      box-shadow:
        0 0 0 1px color-mix(in srgb, var(--accent) 8%, transparent),
        0 0 18px -8px color-mix(in srgb, var(--accent) 56%, transparent);
    }

    .dot {
      position: relative;
      flex: none;
      width: 4px;
      height: 4px;
      border-radius: 999px;
      background: currentColor;
      opacity: 0.5;
    }

    .tag[data-state="live"] .dot,
    .tag[data-state="done"] .dot { background: var(--accent); }
    .tag[data-state="live"] .dot { opacity: 1; }

    .tag[data-state="live"] .dot::after {
      content: "";
      position: absolute;
      inset: -3px;
      border: 1px solid var(--accent);
      border-radius: inherit;
      opacity: 0;
      animation: oc-tps-ring 1.8s ease-out infinite;
    }

    .label {
      color: var(--v2-text-text-faint, #777);
      font-size: 8.5px;
      font-weight: 650;
      letter-spacing: 0.09em;
    }

    .value {
      min-width: 3.1em;
      color: var(--v2-text-text-base, #eee);
      font-size: 11.5px;
      font-weight: 600;
      font-variant-numeric: tabular-nums;
      letter-spacing: -0.01em;
      text-align: end;
    }

    .unit {
      color: var(--v2-text-text-faint, #777);
      font-size: 9px;
      letter-spacing: 0.02em;
    }

    .bars {
      display: inline-flex;
      align-items: flex-end;
      gap: 1.5px;
      width: 11px;
      height: 9px;
      margin-inline-start: 1px;
    }

    .bars i {
      display: block;
      width: 2px;
      height: 100%;
      border-radius: 1px;
      background: currentColor;
      opacity: 0.32;
      transform-origin: 50% 100%;
      transition:
        transform 180ms cubic-bezier(0.22, 1, 0.36, 1),
        opacity 180ms ease,
        background-color 180ms ease;
    }

    .tag[data-state="live"] .bars i { background: var(--accent); opacity: 0.9; }
    .tag[data-state="running"] .bars i { opacity: 0.24; }
    .tag[data-state="done"] .bars i { opacity: 0.46; }

    .scan {
      position: absolute;
      inset: 0;
      pointer-events: none;
      opacity: 0;
      background: linear-gradient(
        105deg,
        transparent 28%,
        color-mix(in srgb, var(--accent) 14%, transparent) 48%,
        transparent 68%
      );
      transform: translateX(-130%);
    }

    .tag[data-state="live"] .scan {
      opacity: 1;
      animation: oc-tps-scan 2.6s cubic-bezier(0.4, 0, 0.2, 1) infinite;
    }

    .tip {
      position: fixed;
      z-index: 99999;
      display: none;
      width: 240px;
      flex-direction: column;
      gap: 8px;
      padding: 10px 12px 11px;
      border: 1px solid var(--v2-border-border-muted, rgba(127, 127, 127, 0.24));
      border-radius: 9px;
      background: var(--v2-background-bg-base, #111);
      box-shadow: var(--v2-elevation-floating, 0 8px 24px rgba(0, 0, 0, 0.24));
      color: var(--v2-text-text-base, #eee);
      font-family: inherit;
      font-size: 11px;
      line-height: 1.3;
      pointer-events: auto;
      animation: oc-tps-tip-in 120ms ease-out both;
    }

    .tip[data-open="true"] { display: flex; }

    .tip[data-pinned="true"] {
      border-color: color-mix(in srgb, var(--accent) 28%, var(--v2-border-border-muted, rgba(127, 127, 127, 0.24)));
      box-shadow:
        var(--v2-elevation-floating, 0 8px 24px rgba(0, 0, 0, 0.24)),
        0 0 0 1px color-mix(in srgb, var(--accent) 12%, transparent);
    }

    .tip-head {
      display: flex;
      align-items: center;
      gap: 6px;
      color: var(--v2-text-text-muted, #999);
      font-size: 11px;
      line-height: 1;
    }

    .tip-head .dot { opacity: 1; }

    .pin {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 18px;
      height: 18px;
      margin-inline-start: auto;
      padding: 0;
      border: 1px solid transparent;
      border-radius: 5px;
      background: transparent;
      color: var(--v2-text-text-faint, #777);
      cursor: pointer;
      transition:
        color 140ms ease,
        background-color 140ms ease,
        border-color 140ms ease;
    }

    .pin:hover {
      color: var(--v2-text-text-base, #eee);
      background: color-mix(in srgb, var(--v2-text-text-base, #fff) 9%, transparent);
    }

    .pin[aria-pressed="true"] {
      border-color: color-mix(in srgb, var(--accent) 34%, transparent);
      background: color-mix(in srgb, var(--accent) 13%, transparent);
      color: var(--accent);
    }

    .pin svg { display: block; width: 11px; height: 11px; }

    .tip-value {
      display: flex;
      align-items: baseline;
      gap: 5px;
      font-size: 21px;
      font-weight: 600;
      font-variant-numeric: tabular-nums;
      letter-spacing: -0.03em;
      line-height: 1;
    }

    .tip-unit {
      color: var(--v2-text-text-faint, #777);
      font-size: 10px;
      font-weight: 500;
      letter-spacing: 0;
    }

    .chart {
      position: relative;
      margin-block-start: 1px;
    }

    .chart svg {
      display: block;
      width: 100%;
      height: 52px;
      overflow: visible;
    }

    .chart-span {
      position: absolute;
      inset-block-start: 1px;
      inset-inline-end: 0;
      color: var(--v2-text-text-faint, #777);
      font-size: 9px;
      letter-spacing: 0.02em;
      pointer-events: none;
    }

    .chart .grid {
      stroke: var(--v2-border-border-muted, rgba(127, 127, 127, 0.18));
      stroke-dasharray: 2 3;
      stroke-width: 1;
      vector-effect: non-scaling-stroke;
    }

    .chart stop { stop-color: var(--accent); }

    .chart .line {
      fill: none;
      stroke: var(--accent);
      stroke-width: 1.4;
      stroke-linecap: round;
      stroke-linejoin: round;
      vector-effect: non-scaling-stroke;
    }

    .chart .area { fill: url(#oc-tps-area); }

    .chart .edge {
      fill: var(--accent);
      stroke: var(--v2-background-bg-base, #111);
      stroke-width: 1.5;
    }

    .chart[data-empty="true"] .line,
    .chart[data-empty="true"] .area,
    .chart[data-empty="true"] .edge { opacity: 0; }

    .chart[data-empty="false"] .line,
    .chart[data-empty="false"] .area,
    .chart[data-empty="false"] .edge { opacity: 1; transition: opacity 160ms ease; }

    .tip[data-state="live"] .chart .edge { animation: oc-tps-pulse 1.6s ease-in-out infinite; }

    .stats {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
      gap: 6px 14px;
      padding-block-start: 8px;
      border-block-start: 1px solid var(--v2-border-border-muted, rgba(127, 127, 127, 0.2));
    }

    .stat {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 8px;
      min-width: 0;
    }

    .stat .k {
      color: var(--v2-text-text-faint, #777);
      font-size: 10px;
      white-space: nowrap;
    }

    .stat .v {
      color: var(--v2-text-text-base, #eee);
      font-size: 11px;
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }

    .tip-note {
      color: var(--v2-text-text-faint, #777);
      font-size: 10px;
      line-height: 1.45;
    }

    @keyframes oc-tps-in {
      from { opacity: 0; transform: translateY(-2px) scale(0.96); }
      to { opacity: 1; transform: translateY(0) scale(1); }
    }

    @keyframes oc-tps-ring {
      0% { opacity: 0.45; transform: scale(0.7); }
      70%, 100% { opacity: 0; transform: scale(1.7); }
    }

    @keyframes oc-tps-scan {
      0% { transform: translateX(-130%); }
      58%, 100% { transform: translateX(130%); }
    }

    @keyframes oc-tps-tip-in {
      from { opacity: 0; transform: translateY(-2px); }
      to { opacity: 1; transform: translateY(0); }
    }

    @keyframes oc-tps-pulse {
      0%, 100% { opacity: 0.95; }
      50% { opacity: 0.35; }
    }

    @media (max-width: 767px) {
      .tag { gap: 4px; padding-inline: 6px; }
      .label, .unit, .bars { display: none; }
      .value { min-width: 3.1em; }
    }

    @media (prefers-reduced-motion: reduce) {
      .tag, .tag *, .tag *::after, .tip {
        animation: none !important;
        transition: none !important;
      }
    }
  `

  const host = document.createElement("div")
  host.className = "oc-tps-host"
  host.dataset.session = ""
  host.style.cssText = "display:inline-flex;align-items:center;height:22px;flex:none;"
  const shadow = host.attachShadow({ mode: "open" })

  shadow.innerHTML = `
    <style>${css}</style>
    <div class="tag" data-state="empty" role="button" tabindex="0" aria-pressed="false">
      <span class="dot" aria-hidden="true"></span>
      <span class="label" aria-hidden="true">${copy.label}</span>
      <span class="value">—</span>
      <span class="unit" aria-hidden="true">${copy.unit}</span>
      <span class="bars" aria-hidden="true">
        <i></i><i></i><i></i><i></i><i></i>
      </span>
      <span class="scan" aria-hidden="true"></span>
    </div>
    <div class="tip" role="tooltip">
      <div class="tip-head">
        <span class="dot" aria-hidden="true"></span>
        <span class="tip-heading"></span>
        <button class="pin" type="button" aria-pressed="false" aria-label="${copy.pinOn}" title="${copy.pinOn}">
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M8 1.9a4.7 4.7 0 0 0-4.7 4.7c0 3.4 4.7 7.5 4.7 7.5s4.7-4.1 4.7-7.5A4.7 4.7 0 0 0 8 1.9Z" fill="none" stroke="currentColor" stroke-width="1.3"/>
            <circle cx="8" cy="6.5" r="1.6" fill="currentColor"/>
          </svg>
        </button>
      </div>
      <div class="tip-value">
        <span class="tip-number"></span>
        <span class="tip-unit">${copy.unit}</span>
      </div>
      <div class="chart" data-empty="true">
        <span class="chart-span" aria-hidden="true">${copy.chartLabel}</span>
        <svg viewBox="0 0 214 52" aria-hidden="true">
          <defs>
            <linearGradient id="oc-tps-area" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-opacity="0.3"/>
              <stop offset="100%" stop-opacity="0"/>
            </linearGradient>
          </defs>
          <line class="grid" x1="0" y1="1" x2="214" y2="1"/>
          <path class="area" d=""/>
          <path class="line" d=""/>
          <circle class="edge" cx="0" cy="0" r="2.4"/>
        </svg>
      </div>
      <div class="stats">
        <div class="stat"><span class="k">${copy.statPeak}</span><span class="v" data-k="peak">—</span></div>
        <div class="stat"><span class="k">${copy.statAvg}</span><span class="v" data-k="avg">—</span></div>
        <div class="stat"><span class="k">${copy.statTtft}</span><span class="v" data-k="ttft">—</span></div>
        <div class="stat"><span class="k">${copy.statStep}</span><span class="v" data-k="step">—</span></div>
        <div class="stat"><span class="k">${copy.statTime}</span><span class="v" data-k="time">—</span></div>
        <div class="stat"><span class="k">${copy.statWindow}</span><span class="v" data-k="window">${copy.windowShort}</span></div>
      </div>
      <div class="tip-note"></div>
    </div>
  `

  const tag = shadow.querySelector(".tag")
  const value = shadow.querySelector(".value")
  const bars = [...shadow.querySelectorAll(".bars i")]
  const tip = shadow.querySelector(".tip")
  const tipHeading = shadow.querySelector(".tip-heading")
  const tipNumber = shadow.querySelector(".tip-number")
  const tipNote = shadow.querySelector(".tip-note")
  const pinButton = shadow.querySelector(".pin")
  const chart = shadow.querySelector(".chart")
  const chartArea = shadow.querySelector(".chart .area")
  const chartLine = shadow.querySelector(".chart .line")
  const chartEdge = shadow.querySelector(".chart .edge")
  const stats = Object.fromEntries(
    [...shadow.querySelectorAll(".stat .v")].map((node) => [node.dataset.k, node]),
  )
  const statKeys = [...shadow.querySelectorAll(".stat .k")]
  const chartSpan = shadow.querySelector(".chart-span")

  const state = {
    session: undefined,
    phase: "empty",
    rate: undefined,
    exact: false,
    stepTokens: undefined,
    stepMs: undefined,
    stepPeak: undefined,
    ttft: undefined,
    stepCreated: undefined,
    stepEventCreated: undefined,
    stepEventAt: 0,
    stepMessageID: undefined,
    stepEst: 0,
    lastRate: undefined,
    history: [],
    timeline: [],
    samples: [],
    active: false,
    started: 0,
    firstToken: undefined,
    lastToken: 0,
    capturedStart: false,
    loading: 0,
    totals: { tokens: 0, ms: 0, steps: 0 },
  }

  const now = () => performance.now()

  function estimateTokens(text) {
    let units = 0
    for (const char of text) {
      const code = char.codePointAt(0) ?? 0
      if (code >= 0x2e80) units += 4
      else units += 1
    }
    return units / 4
  }

  function formatRate(value) {
    if (Math.abs(value) >= 1_000) return formatCount(value)
    if (value >= 100) return Math.round(value).toLocaleString()
    return value.toFixed(1)
  }

  function formatCount(value) {
    const magnitude = Math.abs(value)
    if (magnitude >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`
    if (magnitude >= 1_000) return `${(value / 1_000).toFixed(2)}K`
    return Math.round(value).toLocaleString()
  }

  function formatTokens(value) {
    return formatCount(value)
  }

  function formatSeconds(ms) {
    const seconds = ms / 1000
    if (seconds >= 3_600) return `${(seconds / 3_600).toFixed(2)} h`
    if (seconds >= 60) return `${(seconds / 60).toFixed(1)} min`
    return `${seconds.toFixed(seconds < 10 ? 1 : 0)} s`
  }

  function currentSession() {
    const match = location.pathname.match(/\/session\/(ses_[A-Za-z0-9]+)/)
    return match?.[1]
  }

  const stepCreatedCache = new Map()
  const stepCreatedRequests = new Map()

  function loadStepCreated(session, messageID) {
    if (!session || !messageID) return Promise.resolve(undefined)
    if (stepCreatedCache.has(messageID)) return Promise.resolve(stepCreatedCache.get(messageID))
    if (stepCreatedRequests.has(messageID)) return stepCreatedRequests.get(messageID)

    const request = (async () => {
      try {
        const response = await fetch(
          `/api/session/${encodeURIComponent(session)}/message?order=desc&limit=5`,
          { credentials: "include" },
        )
        if (!response.ok) return undefined
        const body = await response.json()
        const messages = Array.isArray(body) ? body : body.data
        if (!Array.isArray(messages)) return undefined
        const message = messages.find((item) => item.id === messageID)
        const created = message?.time?.created
        if (typeof created !== "number") return undefined
        if (stepCreatedCache.size > 50) stepCreatedCache.clear()
        stepCreatedCache.set(messageID, created)
        return created
      } catch {
        return undefined
      }
    })()

    stepCreatedRequests.set(messageID, request)
    void request.finally(() => stepCreatedRequests.delete(messageID))
    return request
  }

  function hydrateStepCreated(messageID, attempt = 0) {
    const session = state.session
    void loadStepCreated(session, messageID).then((created) => {
      if (state.session !== session || state.stepMessageID !== messageID) return
      if (created === undefined) {
        if (attempt < 5 && state.active && state.ttft === undefined) {
          setTimeout(() => hydrateStepCreated(messageID, attempt + 1), 300)
        }
        return
      }
      state.stepCreated = created
      if (state.firstToken !== undefined) {
        state.ttft = stepTtft(state.firstToken)
        render()
      }
    })
  }

  function stepTtft(at) {
    if (state.stepCreated === undefined || state.stepEventCreated === undefined) return undefined
    return Math.max(
      0,
      at - state.stepEventAt + (state.stepEventCreated - state.stepCreated),
    )
  }

  function formatLatency(ms) {
    if (ms < 1000) return `${Math.round(ms)} ms`
    const seconds = ms / 1000
    if (seconds >= 60) return `${(seconds / 60).toFixed(2)} min`
    return `${seconds.toFixed(2)} s`
  }

  function render() {
    const rate = state.rate
    const visible = rate !== undefined
    host.style.display = visible ? "inline-flex" : "none"

    tag.dataset.state = state.phase
    tag.dataset.exact = state.exact ? "true" : "false"
    value.textContent = visible ? formatRate(rate) : "—"
    const label = visible ? copy.aria(formatRate(rate)) : ""
    tag.setAttribute("aria-label", label)

    const recent = state.history.slice(-BARS)
    const peak = Math.max(20, ...recent)
    bars.forEach((bar, index) => {
      const sample = recent[index] ?? 0
      bar.style.transform = `scaleY(${0.18 + 0.82 * Math.min(1, sample / peak)})`
    })

    tip.dataset.state = state.phase
    tipHeading.textContent =
      state.phase === "live"
        ? copy.live
        : state.phase === "running"
          ? copy.running
          : copy.done
    tipNumber.textContent = visible ? formatRate(rate) : "—"

    const exact = state.exact && state.stepTokens !== undefined && state.stepMs !== undefined
    const liveTokens = state.stepEst
    const stepTokens = exact ? state.stepTokens : state.active ? liveTokens : state.stepTokens
    const stepMs = exact
      ? state.stepMs
      : state.active
        ? Math.max(0, now() - state.started)
        : state.stepMs
    const stepAvg = stepTokens > 0 && stepMs > 0 ? stepTokens / (stepMs / 1000) : undefined

    stats.peak.textContent = state.stepPeak ? formatRate(state.stepPeak) : "—"
    stats.avg.textContent = stepAvg ? formatRate(stepAvg) : "—"
    stats.ttft.textContent = state.ttft !== undefined ? formatLatency(state.ttft) : "—"
    stats.step.textContent = stepTokens > 0 ? formatTokens(stepTokens) : "—"
    stats.time.textContent = stepMs > 0 ? formatSeconds(stepMs) : "—"

    tipNote.textContent =
      state.phase === "live"
        ? copy.noteLive
        : state.phase === "running"
          ? copy.noteRunning
          : copy.noteExact

    if (tip.dataset.open === "true" && visible) {
      positionTip()
      drawChart()
    }
  }

  function reset() {
    state.phase = "empty"
    state.rate = undefined
    state.exact = false
    state.stepTokens = undefined
    state.stepMs = undefined
    state.stepPeak = undefined
    state.ttft = undefined
    state.stepCreated = undefined
    state.stepEventCreated = undefined
    state.stepEventAt = 0
    state.stepMessageID = undefined
    state.stepEst = 0
    state.lastRate = undefined
    state.history = []
    state.timeline = []
    state.samples = []
    state.active = false
    state.started = 0
    state.firstToken = undefined
    state.lastToken = 0
    state.capturedStart = false
    state.loading = 0
    render()
  }

  function recompute() {
    const at = now()
    const cutoff = at - WINDOW_MS
    state.samples = state.samples.filter((sample) => sample.at >= cutoff)
    if (state.samples.length === 0) return

    const tokens = state.samples.reduce((sum, sample) => sum + sample.tokens, 0)
    const span = Math.max(300, Math.min(WINDOW_MS, at - state.samples[0].at))
    const rate = tokens / (span / 1000)

    state.rate = rate
    state.exact = false
    state.phase = "live"
    state.stepPeak = Math.max(state.stepPeak ?? 0, rate)
    state.history = [...state.history.slice(-(BARS - 1)), rate]
    render()
  }

  function startStep(captured = false, meta) {
    state.active = true
    state.started = now()
    state.firstToken = undefined
    state.lastToken = 0
    state.samples = []
    state.exact = false
    state.stepTokens = undefined
    state.stepMs = undefined
    state.stepPeak = undefined
    state.ttft = undefined
    state.stepCreated = undefined
    state.stepEventCreated = meta?.created
    state.stepEventAt = meta ? now() : 0
    state.stepMessageID = meta?.messageID
    state.stepEst = 0
    state.phase = "running"
    state.capturedStart = captured
    render()

    if (meta?.messageID) void hydrateStepCreated(meta.messageID)
  }

  function addDelta(text) {
    if (!state.active) startStep(false)
    const at = now()
    if (state.capturedStart && state.ttft === undefined) {
      const value = stepTtft(at)
      if (value !== undefined) {
        state.ttft = value
      } else if (state.stepMessageID) {
        void hydrateStepCreated(state.stepMessageID)
      }
    }
    const tokens = estimateTokens(text ?? "")
    state.firstToken ??= at
    state.lastToken = at
    state.stepEst += tokens
    state.samples.push({ at, tokens })
    recompute()
  }

  function finishStep(tokens) {
    if (!state.active) return
    state.active = false
    const at = now()
    const total =
      tokens ?? state.samples.reduce((sum, sample) => sum + sample.tokens, 0)
    const elapsed = Math.max(0, at - (state.firstToken ?? state.started))

    if (state.capturedStart && total > 0 && elapsed > 0) {
      const rate = total / (elapsed / 1000)
      state.rate = rate
      state.lastRate = rate
      state.exact = true
      state.stepTokens = total
      state.stepMs = elapsed
      state.stepPeak = Math.max(state.stepPeak ?? 0, rate)
      state.history = [...state.history.slice(-(BARS - 1)), rate]
      state.totals.tokens += total
      state.totals.ms += elapsed
      state.totals.steps += 1
    }

    state.phase = "done"
    state.capturedStart = false
    render()

    const session = state.session
    setTimeout(() => {
      if (state.session === session && !state.active) void load(session)
    }, 240)
  }

  function firstOutputTime(message) {
    const first = message.content?.[0]
    if (first && first.type !== "text" && first.time && first.time.created) {
      return first.time.created
    }
    return undefined
  }

  async function load(session) {
    if (!session) return
    const request = ++state.loading
    try {
      const response = await fetch(
        `/api/session/${encodeURIComponent(session)}/message?order=desc&limit=40`,
        { credentials: "include" },
      )
      if (!response.ok || request !== state.loading || state.session !== session) return
      const body = await response.json()
      const messages = Array.isArray(body) ? body : body.data
      if (!Array.isArray(messages)) return

      let latest
      for (const message of messages) {
        if (message.type !== "assistant") continue
        if (!latest || (message.time?.created ?? 0) > (latest.time?.created ?? 0)) {
          latest = message
        }
      }
      if (!latest) return

      const latestTokens =
        (latest.tokens?.output ?? 0) + (latest.tokens?.reasoning ?? 0)
      const streaming = !latest.time?.streamed || latestTokens <= 0
      if (streaming) {
        let previous
        for (const message of messages) {
          if (
            message.id === latest.id ||
            message.type !== "assistant" ||
            !message.time?.streamed ||
            !message.tokens
          ) {
            continue
          }
          if (!previous || (message.time?.created ?? 0) > (previous.time?.created ?? 0)) {
            previous = message
          }
        }

        if (previous && state.rate === undefined) {
          const tokens =
            (previous.tokens.output ?? 0) + (previous.tokens.reasoning ?? 0)
          const start = firstOutputTime(previous) ?? previous.time.created
          const elapsed = previous.time.streamed - start
          if (tokens > 0 && elapsed > 0) {
            const rate = tokens / (elapsed / 1000)
            state.rate = rate
            state.lastRate = rate
            state.exact = true
            state.stepTokens = tokens
            state.stepMs = elapsed
            state.stepPeak = Math.max(state.stepPeak ?? 0, rate)
            state.ttft = Math.max(0, start - previous.time.created)
            state.history = [rate]
          }
        }

        if (state.phase !== "live") {
          state.phase = "running"
          render()
        }
        return
      }

      if (state.active || state.phase === "live") return

      const tokens =
        (latest.tokens?.output ?? 0) + (latest.tokens?.reasoning ?? 0)
      const start = firstOutputTime(latest) ?? latest.time.created
      const elapsed = latest.time.streamed - start
      if (tokens <= 0 || elapsed <= 0) return

      const rate = tokens / (elapsed / 1000)
      state.rate = rate
      state.lastRate = rate
      state.exact = true
      state.stepTokens = tokens
      state.stepMs = elapsed
      state.stepPeak = Math.max(state.stepPeak ?? 0, rate)
      state.ttft = Math.max(0, start - latest.time.created)
      state.history = [rate]
      state.phase = "done"
      render()
    } catch {
      // A reload or a signed-out tab can race the request. The next event recovers.
    }
  }

  function switchSession(session) {
    if (state.session === session) return
    state.session = session
    host.dataset.session = session ?? ""
    setPinned(false)
    reset()
    void load(session)
  }

  function findRing() {
    const title = document.querySelector(
      '[data-slot="session-title-child"], [data-slot="session-title"], h1',
    )
    let node = title
    for (let depth = 0; depth < 8 && node; depth++) {
      const ring = node.querySelector?.('[data-component="progress-circle"]')
      if (ring && title && node.contains(title)) return ring
      node = node.parentElement
    }
    return undefined
  }

  function findTrigger(ring) {
    return (
      ring.closest('[data-component="tooltip-v2-trigger"]') ??
      ring.closest("button")?.parentElement ??
      ring.parentElement
    )
  }

  function ensure() {
    const session = currentSession()
    if (!session) {
      host.remove()
      if (state.session) switchSession(undefined)
      return
    }

    if (state.session !== session) switchSession(session)

    const ring = findRing()
    const trigger = ring && findTrigger(ring)
    if (!trigger) {
      host.remove()
      return
    }

    if (host.previousElementSibling !== trigger || host.parentElement !== trigger.parentElement) {
      trigger.after(host)
    }
    host.style.display = state.rate === undefined ? "none" : "inline-flex"
  }

  function positionTip() {
    const rect = tag.getBoundingClientRect()
    if (rect.bottom < 0 || rect.top > window.innerHeight) {
      tip.style.visibility = "hidden"
      return
    }
    tip.style.visibility = "hidden"
    tip.dataset.open = "true"
    const tipRect = tip.getBoundingClientRect()
    const margin = 8
    let left = Math.min(
      window.innerWidth - tipRect.width - margin,
      Math.max(margin, rect.right - tipRect.width),
    )
    let top = rect.bottom + 8
    if (top + tipRect.height > window.innerHeight - margin) {
      top = rect.top - tipRect.height - 8
    }
    tip.style.left = `${Math.round(left)}px`
    tip.style.top = `${Math.round(Math.max(margin, top))}px`
    tip.style.visibility = "visible"
  }

  function drawChart() {
    if (tip.dataset.open !== "true") return
    const at = now()
    const samples = state.timeline.filter((sample) => sample.at >= at - SPAN_MS)
    if (samples.length < 2) {
      chart.dataset.empty = "true"
      return
    }
    chart.dataset.empty = "false"

    const width = 214
    const height = 52
    const top = 4
    const floor = 2
    const from = Math.max(at - SPAN_MS, samples[0].at)
    const span = Math.max(1_000, at - from)
    let peak = 0
    for (const sample of samples) peak = Math.max(peak, sample.rate)
    const scale = Math.max(20, Math.ceil(peak / 10) * 10)
    const points = samples.map((sample) => {
      const x = (Math.min(span, Math.max(0, sample.at - from)) / span) * width
      const y = height - floor - Math.min(1, sample.rate / scale) * (height - top - floor)
      return [x, y]
    })

    let line = `M${points[0][0].toFixed(2)} ${points[0][1].toFixed(2)}`
    for (let index = 1; index < points.length; index++) {
      line += `L${points[index][0].toFixed(2)} ${points[index][1].toFixed(2)}`
    }
    chartLine.setAttribute("d", line)
    chartArea.setAttribute("d", `${line}L${width} ${height}L${points[0][0].toFixed(2)} ${height}Z`)

    const last = points[points.length - 1]
    chartEdge.setAttribute("cx", last[0].toFixed(2))
    chartEdge.setAttribute("cy", last[1].toFixed(2))
  }

  let pinned = false
  let closeTimer

  function openTip() {
    if (closeTimer) {
      clearTimeout(closeTimer)
      closeTimer = undefined
    }
    if (state.rate === undefined) return
    positionTip()
    drawChart()
  }

  function closeTip(force = false) {
    if (pinned && !force) return
    tip.dataset.open = "false"
  }

  function closeSoon() {
    if (closeTimer) clearTimeout(closeTimer)
    closeTimer = setTimeout(() => {
      closeTimer = undefined
      closeTip()
    }, 140)
  }

  function applyCopy() {
    const keys = [
      copy.statPeak,
      copy.statAvg,
      copy.statTtft,
      copy.statStep,
      copy.statTime,
      copy.statWindow,
    ]
    statKeys.forEach((node, index) => {
      node.textContent = keys[index]
    })
    chartSpan.textContent = copy.chartLabel
    const pinLabel = pinned ? copy.pinOff : copy.pinOn
    pinButton.title = pinLabel
    pinButton.setAttribute("aria-label", pinLabel)
    render()
  }

  function setPinned(next) {
    pinned = next
    tip.dataset.pinned = next ? "true" : "false"
    tag.dataset.pinned = next ? "true" : "false"
    tag.setAttribute("aria-pressed", next ? "true" : "false")
    pinButton.setAttribute("aria-pressed", next ? "true" : "false")
    const label = next ? copy.pinOff : copy.pinOn
    pinButton.setAttribute("aria-label", label)
    pinButton.title = label
    if (next) {
      openTip()
      return
    }
    if (!host.matches(":hover")) closeTip(true)
  }

  host.addEventListener("mouseenter", openTip)
  host.addEventListener("mouseleave", () => closeSoon())

  tag.addEventListener("focus", openTip)
  tag.addEventListener("blur", () => closeSoon())

  tip.addEventListener("focusin", openTip)
  tip.addEventListener("focusout", () => closeSoon())

  tag.addEventListener("click", (event) => {
    event.preventDefault()
    event.stopPropagation()
    setPinned(!pinned)
  })

  tag.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return
    event.preventDefault()
    event.stopPropagation()
    setPinned(!pinned)
  })

  pinButton.addEventListener("click", (event) => {
    event.preventDefault()
    event.stopPropagation()
    setPinned(!pinned)
  })

  document.addEventListener(
    "keydown",
    (event) => {
      if (event.key !== "Escape" || !pinned) return
      setPinned(false)
      tag.focus()
      closeTip(true)
    },
    true,
  )

  window.addEventListener("resize", () => {
    if (tip.dataset.open === "true") positionTip()
  })

  window.addEventListener("scroll", () => {
    if (tip.dataset.open === "true") positionTip()
  }, true)

  const source = new EventSource("/api/event")
  source.onmessage = (message) => {
    let event
    try {
      event = JSON.parse(message.data)
    } catch {
      return
    }

    const session = state.session
    if (!session) return
    if (!event || !event.data || event.data.sessionID !== session) return

    switch (event.type) {
      case "session.step.started":
        startStep(true, {
          messageID: event.data.assistantMessageID,
          created: event.created,
        })
        break
      case "session.text.delta":
      case "session.reasoning.delta":
      case "session.tool.input.delta":
        addDelta(event.data.delta)
        break
      case "session.step.ended":
        finishStep(
          (event.data.tokens?.output ?? 0) + (event.data.tokens?.reasoning ?? 0),
        )
        break
      case "session.step.failed":
        finishStep(
          event.data.tokens
            ? (event.data.tokens.output ?? 0) + (event.data.tokens.reasoning ?? 0)
            : undefined,
        )
        break
      default:
        break
    }
  }

  function pushSample() {
    if (!state.session) return
    const at = now()
    const rate = state.active && state.phase === "live" ? (state.rate ?? 0) : 0
    state.timeline.push({ at, rate, phase: state.phase })
    if (state.timeline.length > MAX_SAMPLES) {
      const cutoff = at - SPAN_MS - 1000
      state.timeline = state.timeline.filter((sample) => sample.at >= cutoff)
    }
  }

  setInterval(() => {
    if (state.active) {
      if (state.lastToken > 0 && now() - state.lastToken > IDLE_MS) {
        state.phase = "running"
      } else {
        recompute()
      }
    }
    pushSample()
    render()
  }, TICK_MS)

  const localeObserver = new MutationObserver(() => {
    const next = resolveLocale()
    if (next === locale) return
    locale = next
    copy = dictionaries[next]
    applyCopy()
  })
  localeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["lang"],
  })

  setInterval(ensure, 500)
  window.addEventListener("popstate", ensure)

  ensure()
  render()
})()
