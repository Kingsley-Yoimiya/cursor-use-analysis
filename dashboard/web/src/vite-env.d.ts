/// <reference types="vite/client" />

declare module 'virtual:model-rates' {
  const rates: {
    autoPool: {
      inputPerMillion: number
      cacheWritePerMillion: number
      cacheReadPerMillion: number
      outputPerMillion: number
    }
    aliases?: Record<string, string>
    models?: Record<
      string,
      {
        displayName?: string
        billingPool?: string
        inputPerMillion: number
        cacheWritePerMillion: number
        cacheReadPerMillion: number
        outputPerMillion: number
        longContextInputTokensThreshold?: number | null
        longContextMultiplier?: number | null
      }
    >
  }
  export default rates
}
