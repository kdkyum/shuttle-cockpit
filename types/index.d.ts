export type Telemetry = {
  contextPercent: number | null
  contextTokens: number | null
  contextWindow: number
  costUsd: number | null
  fiveHour: number | null
  sevenDay: number | null
  startedAt: number | null
  measuredAt: number | null
}

export type Flight = {
  model: string | null
  effort: string | number | null
}

export type MissionLog = {
  turns: number
  toolCalls: number
}

declare module 'claude-code' {
  interface PluginState {
    'shuttle-cockpit': { telemetry: Telemetry; flight: Flight; log: MissionLog }
  }
}
