import {
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
  Show,
} from "solid-js"
import {
  createKeyed,
  usePlugin,
  type MountedSession,
} from "@opencode/plugin/gui"
import type { SessionMessageAssistant } from "@opencode/client"

type Phase = "empty" | "live" | "running" | "done"

const WINDOW_MS = 2_000
const TICK_MS = 200
const IDLE_MS = 800
const BARS = 5
const SPAN_MS = 30_000
const MAX_SAMPLES = 220

function estimateTokens(text: string): number {
  let units = 0

  for (const char of text) {
    const code = char.codePointAt(0) ?? 0
    // CJK, kana, hangul and emoji are roughly one token per character. Latin text
    // and punctuation average about four characters per token.
    if (code >= 0x2e80) units += 4
    else units += 1
  }

  return units / 4
}

function firstOutputTime(message: SessionMessageAssistant): number | undefined {
  const first = message.content[0]
  if (first && first.type !== "text" && "time" in first && first.time?.created) {
    return first.time.created
  }

  return undefined
}

function duration(ms: number): string {
  if (ms < 1_000) return `${Math.max(1, Math.round(ms))} ms`
  return `${(ms / 1_000).toFixed(ms < 10_000 ? 1 : 0)} s`
}

function latency(ms: number): string {
  if (ms < 1_000) return `${Math.round(ms)} ms`
  return `${(ms / 1_000).toFixed(2)} s`
}

export function TpsMeter(props: { session: MountedSession; active: boolean }) {
  const ctx = usePlugin()
  const [phase, setPhase] = createSignal<Phase>("empty")
  const [rate, setRate] = createSignal<number>()
  const [history, setHistory] = createSignal<number[]>([])
  const [exact, setExact] = createSignal(false)
  const [stepTokens, setStepTokens] = createSignal<number>()
  const [stepMs, setStepMs] = createSignal<number>()
  const [stepPeak, setStepPeak] = createSignal<number>()
  const [ttft, setTtft] = createSignal<number>()
  const [stepEst, setStepEst] = createSignal(0)
  const [lastRate, setLastRate] = createSignal<number>()
  const [timeline, setTimeline] = createSignal<{ at: number; rate: number }[]>([])
  const [active, setActive] = createSignal(false)
  const [startedAt, setStartedAt] = createSignal(0)
  const [open, setOpen] = createSignal(false)
  const [pinned, setPinned] = createSignal(false)
  const [position, setPosition] = createSignal({ left: 0, top: 0 })

  let root: HTMLSpanElement | undefined
  let tag: HTMLSpanElement | undefined
  let closeTimer: number | undefined

  const locale = () => ctx.locale.locale()
  const number = createMemo(
    () => new Intl.NumberFormat(locale(), { maximumFractionDigits: 0 }),
  )
  const decimal = createMemo(
    () =>
      new Intl.NumberFormat(locale(), {
        maximumFractionDigits: 1,
        minimumFractionDigits: 1,
      }),
  )

  const formatRate = (value: number) =>
    value >= 100 ? number().format(value) : decimal().format(value)

  const formatTokens = (value: number) => number().format(value)

  const completed = createMemo(() => {
    const data = props.session.server.data
    const messages = data.session.message.list(props.session.id)

    for (let index = messages.length - 1; index >= 0; index--) {
      const message = messages[index]
      if (message.type !== "assistant" || !message.time.streamed || !message.tokens) continue

      const tokens = message.tokens.output + message.tokens.reasoning
      if (tokens <= 0) continue

      const start = firstOutputTime(message) ?? message.time.created
      const elapsed = message.time.streamed - start
      if (elapsed <= 0) continue

      return {
        id: message.id,
        rate: tokens / (elapsed / 1_000),
        tokens,
        elapsed,
        ttft: Math.max(0, start - message.time.created),
      }
    }

    return undefined
  })

  createEffect(() => {
    const result = completed()
    if (!result) return

    setLastRate(result.rate)
    if (phase() === "live") return

    setRate(result.rate)
    setExact(true)
    setStepTokens(result.tokens)
    setStepMs(result.elapsed)
    setStepPeak((previous) => Math.max(previous ?? 0, result.rate))
    setTtft(result.ttft)
    setPhase("done")
  })

  createEffect(() => {
    const running =
      props.session.server.data.session.status(props.session.id) === "running"

    if (running && (phase() === "empty" || phase() === "done")) {
      setPhase("running")
    } else if (!running && phase() === "running") {
      setPhase(lastRate() === undefined ? "empty" : "done")
    }
  })

  createEffect(() => {
    props.session.id
    setPinned(false)
    setOpen(false)
    setTimeline([])
    setStepPeak(undefined)
    setTtft(undefined)
    setStepEst(0)
    setActive(false)
    setStartedAt(0)
  })

  createKeyed(
    () => ({ data: props.session.server.data, id: props.session.id }),
    ({ data, id }) => {
      let samples: { at: number; tokens: number }[] = []
      let running = false
      let started = 0
      let firstToken: number | undefined
      let lastToken = 0
      let captured = false
      let ended = 0

      const now = () => performance.now()

      const recompute = () => {
        const at = now()
        const cutoff = at - WINDOW_MS
        samples = samples.filter((sample) => sample.at >= cutoff)
        if (samples.length === 0) return

        const tokens = samples.reduce((sum, sample) => sum + sample.tokens, 0)
        const span = Math.max(300, Math.min(WINDOW_MS, at - samples[0].at))
        const value = tokens / (span / 1_000)

        setRate(value)
        setExact(false)
        setPhase("live")
        setStepPeak((previous) => Math.max(previous ?? 0, value))
        setHistory((previous) => [...previous.slice(-(BARS - 1)), value])
      }

      const start = (at: number, fromEvent: boolean) => {
        running = true
        started = at
        firstToken = undefined
        lastToken = 0
        ended = 0
        captured = fromEvent
        samples = []
        setExact(false)
        setPhase("running")
        setStepTokens(undefined)
        setStepMs(undefined)
        setStepPeak(undefined)
        setTtft(undefined)
        setStepEst(0)
        setActive(true)
        setStartedAt(at)
      }

      const delta = (text: string, at: number) => {
        if (!running) start(at, false)
        if (captured && ttft() === undefined) setTtft(Math.max(0, at - started))
        const tokens = estimateTokens(text)
        firstToken ??= at
        lastToken = at
        setStepEst((previous) => previous + tokens)
        samples.push({ at, tokens })
        recompute()
      }

      const finish = (tokens: number | undefined) => {
        if (!running) return
        running = false
        ended = now()

        const total = tokens ?? samples.reduce((sum, sample) => sum + sample.tokens, 0)
        const elapsed = Math.max(0, ended - (firstToken ?? started))

        if (total > 0 && elapsed > 0) {
          const value = total / (elapsed / 1_000)
          setRate(value)
          setLastRate(value)
          setExact(true)
          setStepTokens(total)
          setStepMs(elapsed)
          setStepPeak((previous) => Math.max(previous ?? 0, value))
          setHistory((previous) => [...previous.slice(-(BARS - 1)), value])
        }

        setActive(false)
        setPhase("done")
      }

      const offs = [
        data.on("session.step.started", (event) => {
          if (event.data.sessionID !== id) return
          start(now(), true)
        }),
        data.on("session.text.delta", (event) => {
          if (event.data.sessionID !== id) return
          delta(event.data.delta, now())
        }),
        data.on("session.reasoning.delta", (event) => {
          if (event.data.sessionID !== id) return
          delta(event.data.delta, now())
        }),
        data.on("session.tool.input.delta", (event) => {
          if (event.data.sessionID !== id) return
          delta(event.data.delta, now())
        }),
        data.on("session.step.streamed", (event) => {
          if (event.data.sessionID !== id) return
          ended = now()
        }),
        data.on("session.step.ended", (event) => {
          if (event.data.sessionID !== id) return
          finish(event.data.tokens.output + event.data.tokens.reasoning)
        }),
        data.on("session.step.failed", (event) => {
          if (event.data.sessionID !== id) return
          const tokens = event.data.tokens
          finish(tokens ? tokens.output + tokens.reasoning : undefined)
        }),
      ]

      const tick = setInterval(() => {
        if (running) {
          if (lastToken > 0 && now() - lastToken > IDLE_MS) {
            setPhase("running")
          } else {
            recompute()
          }
        }

        const at = now()
        const value = running && phase() === "live" ? (rate() ?? 0) : 0
        setTimeline((previous) => {
          if (previous.length >= MAX_SAMPLES) {
            const cutoff = at - SPAN_MS - 1_000
            return [...previous.filter((sample) => sample.at >= cutoff), { at, rate: value }]
          }
          return [...previous, { at, rate: value }]
        })
      }, TICK_MS)

      onCleanup(() => {
        for (const off of offs) off()
        clearInterval(tick)
      })
    },
    {
      equals: (previous, next) =>
        previous.data === next.data && previous.id === next.id,
    },
  )

  const bars = createMemo(() => {
    const values = history()
    const recent = values.slice(-BARS)
    const peak = Math.max(20, ...recent)

    return Array.from({ length: BARS }, (_, index) => {
      const value = recent[index] ?? 0
      return 0.18 + 0.82 * Math.min(1, value / peak)
    })
  })

  const stats = createMemo(() => {
    timeline()

    const isExact = exact() && stepTokens() !== undefined && stepMs() !== undefined
    const tokens = isExact ? stepTokens()! : active() ? stepEst() : (stepTokens() ?? 0)
    const ms = isExact
      ? stepMs()!
      : active()
        ? Math.max(0, performance.now() - startedAt())
        : (stepMs() ?? 0)
    const average = tokens > 0 && ms > 0 ? tokens / (ms / 1_000) : undefined

    return { tokens, ms, average, peak: stepPeak(), ttft: ttft() }
  })

  const chart = createMemo(() => {
    const at = performance.now()
    const samples = timeline().filter((sample) => sample.at >= at - SPAN_MS)
    if (samples.length < 2) return { empty: true, line: "", area: "", cx: 0, cy: 0 }

    const width = 214
    const height = 52
    const top = 4
    const floor = 2
    const from = Math.max(at - SPAN_MS, samples[0].at)
    const span = Math.max(1_000, at - from)
    const peak = samples.reduce((value, sample) => Math.max(value, sample.rate), 0)
    const scale = Math.max(20, Math.ceil(peak / 10) * 10)
    const points = samples.map((sample) => {
      const x = (Math.min(span, Math.max(0, sample.at - from)) / span) * width
      const y = height - floor - Math.min(1, sample.rate / scale) * (height - top - floor)
      return [Math.min(width, Math.max(0, x)), y] as const
    })

    let line = `M${points[0][0].toFixed(2)} ${points[0][1].toFixed(2)}`
    for (let index = 1; index < points.length; index++) {
      line += `L${points[index][0].toFixed(2)} ${points[index][1].toFixed(2)}`
    }

    const last = points[points.length - 1]
    return {
      empty: false,
      line,
      area: `${line}L${width} ${height}L${points[0][0].toFixed(2)} ${height}Z`,
      cx: last[0],
      cy: last[1],
    }
  })

  const place = () => {
    if (!root) return
    const rect = root.getBoundingClientRect()
    const panel = root.querySelector(".tps-panel") as HTMLElement | null
    const width = panel?.offsetWidth ?? 240
    const height = panel?.offsetHeight ?? 220
    const margin = 8
    const left = Math.min(
      window.innerWidth - width - margin,
      Math.max(margin, rect.right - width),
    )
    let top = rect.bottom + 8
    if (top + height > window.innerHeight - margin) top = rect.top - height - 8
    setPosition({ left: Math.round(left), top: Math.round(Math.max(margin, top)) })
  }

  createEffect(() => {
    if (!open()) return
    timeline()
    place()
  })

  const show = () => {
    if (closeTimer !== undefined) {
      clearTimeout(closeTimer)
      closeTimer = undefined
    }
    if (rate() === undefined) return
    setOpen(true)
  }

  const close = (force = false) => {
    if (pinned() && !force) return
    setOpen(false)
  }

  const closeSoon = () => {
    if (closeTimer !== undefined) clearTimeout(closeTimer)
    closeTimer = window.setTimeout(() => {
      closeTimer = undefined
      close()
    }, 140)
  }

  const togglePin = () => {
    const next = !pinned()
    setPinned(next)
    if (next) setOpen(true)
  }

  onMount(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !pinned()) return
      setPinned(false)
      setOpen(false)
      tag?.focus()
    }

    document.addEventListener("keydown", key, true)
    onCleanup(() => {
      document.removeEventListener("keydown", key, true)
      if (closeTimer !== undefined) clearTimeout(closeTimer)
    })
  })

  const label = () => {
    const value = rate()
    if (value === undefined) return ctx.t("aria.empty")
    return ctx.t("aria.value", { rate: formatRate(value) })
  }

  const heading = () =>
    phase() === "live"
      ? ctx.t("tip.live")
      : phase() === "running"
        ? ctx.t("tip.running")
        : ctx.t("tip.done")

  const note = () =>
    phase() === "live"
      ? ctx.t("tip.note.live")
      : phase() === "running"
        ? ctx.t("tip.note.running")
        : ctx.t("tip.note.exact")

  return (
    <Show when={rate() !== undefined}>
      <span
        ref={root}
        class="tps-root"
        onMouseEnter={show}
        onMouseLeave={() => closeSoon()}
      >
        <span
          ref={tag}
          class="tps-tag"
          data-component="tps-meter"
          data-state={phase()}
          data-exact={exact() ? "true" : "false"}
          data-pinned={pinned() ? "true" : "false"}
          role="button"
          tabIndex={0}
          aria-pressed={pinned() ? "true" : "false"}
          aria-label={label()}
          onFocus={show}
          onBlur={() => closeSoon()}
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            togglePin()
          }}
          onKeyDown={(event) => {
            if (event.key !== "Enter" && event.key !== " ") return
            event.preventDefault()
            event.stopPropagation()
            togglePin()
          }}
        >
          <span class="tps-dot" aria-hidden="true" />
          <span class="tps-label" aria-hidden="true">
            TPS
          </span>
          <span class="tps-value">{formatRate(rate()!)}</span>
          <span class="tps-unit" aria-hidden="true">
            tok/s
          </span>
          <span class="tps-bars" aria-hidden="true">
            {bars().map((bar) => (
              <i style={{ transform: `scaleY(${bar})` }} />
            ))}
          </span>
          <span class="tps-scan" aria-hidden="true" />
        </span>

        <Show when={open()}>
          <span
            class="tps-panel"
            data-state={phase()}
            data-pinned={pinned() ? "true" : "false"}
            role="tooltip"
            style={{ left: `${position().left}px`, top: `${position().top}px` }}
            onFocusIn={show}
          >
            <span class="tps-panel-head">
              <span class="tps-dot" aria-hidden="true" />
              <span class="tps-panel-heading">{heading()}</span>
              <button
                class="tps-pin"
                type="button"
                aria-pressed={pinned() ? "true" : "false"}
                aria-label={pinned() ? ctx.t("tip.unpin") : ctx.t("tip.pin")}
                title={pinned() ? ctx.t("tip.unpin") : ctx.t("tip.pin")}
                onClick={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  togglePin()
                }}
              >
                <svg viewBox="0 0 16 16" aria-hidden="true">
                  <path
                    d="M8 1.9a4.7 4.7 0 0 0-4.7 4.7c0 3.4 4.7 7.5 4.7 7.5s4.7-4.1 4.7-7.5A4.7 4.7 0 0 0 8 1.9Z"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.3"
                  />
                  <circle cx="8" cy="6.5" r="1.6" fill="currentColor" />
                </svg>
              </button>
            </span>

            <span class="tps-panel-value">
              <span>{formatRate(rate()!)}</span>
              <span class="tps-panel-unit">{ctx.t("tip.rate")}</span>
            </span>

            <span class="tps-chart" data-empty={chart().empty ? "true" : "false"}>
              <span class="tps-chart-span" aria-hidden="true">
                {ctx.t("tip.chart")}
              </span>
              <svg viewBox="0 0 214 52" aria-hidden="true">
                <defs>
                  <linearGradient id="tps-area-grad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stop-opacity="0.3" />
                    <stop offset="100%" stop-opacity="0" />
                  </linearGradient>
                </defs>
                <line class="tps-chart-grid" x1="0" y1="1" x2="214" y2="1" />
                <path class="tps-chart-area" d={chart().area} />
                <path class="tps-chart-line" d={chart().line} />
                <circle
                  class="tps-chart-edge"
                  cx={chart().cx}
                  cy={chart().cy}
                  r="2.4"
                />
              </svg>
            </span>

            <span class="tps-stats">
              <span class="tps-stat">
                <span class="tps-stat-key">{ctx.t("tip.peak")}</span>
                <span class="tps-stat-value">
                  {stats().peak ? formatRate(stats().peak!) : "—"}
                </span>
              </span>
              <span class="tps-stat">
                <span class="tps-stat-key">{ctx.t("tip.avg")}</span>
                <span class="tps-stat-value">
                  {stats().average ? formatRate(stats().average!) : "—"}
                </span>
              </span>
              <span class="tps-stat">
                <span class="tps-stat-key">{ctx.t("tip.ttft")}</span>
                <span class="tps-stat-value">
                  {stats().ttft !== undefined ? latency(stats().ttft!) : "—"}
                </span>
              </span>
              <span class="tps-stat">
                <span class="tps-stat-key">{ctx.t("tip.step")}</span>
                <span class="tps-stat-value">
                  {stats().tokens > 0 ? formatTokens(stats().tokens) : "—"}
                </span>
              </span>
              <span class="tps-stat">
                <span class="tps-stat-key">{ctx.t("tip.time")}</span>
                <span class="tps-stat-value">
                  {stats().ms > 0 ? duration(stats().ms) : "—"}
                </span>
              </span>
              <span class="tps-stat">
                <span class="tps-stat-key">{ctx.t("tip.window")}</span>
                <span class="tps-stat-value">{ctx.t("tip.windowValue")}</span>
              </span>
            </span>

            <span class="tps-panel-note">{note()}</span>
          </span>
        </Show>
      </span>
    </Show>
  )
}
