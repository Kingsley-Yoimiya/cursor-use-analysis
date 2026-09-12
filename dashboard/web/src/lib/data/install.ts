import axios, { getAdapter } from 'axios'
import type { AxiosAdapter } from 'axios'
import {
  forcedModeFromEnv,
  probeLocalApi,
  setDataMode,
  type DataMode,
} from './mode'
import { staticAxiosAdapter } from './staticApi'

function isApiRequest(url: string | undefined): boolean {
  if (!url) return false
  try {
    const path = url.startsWith('http')
      ? new URL(url).pathname
      : url.split('?')[0]
    return path === '/api' || path.startsWith('/api/')
  } catch {
    return url.startsWith('/api')
  }
}

export async function installDataPlane(): Promise<DataMode> {
  const forced = forcedModeFromEnv()
  let mode: DataMode
  if (forced === 'fixture' || forced === 'static') {
    mode = forced
  } else if (forced === 'local') {
    mode = 'local'
  } else {
    mode = (await probeLocalApi()) ? 'local' : 'static'
  }
  setDataMode(mode)

  if (mode !== 'local') {
    const fallback = getAdapter(['xhr', 'http']) as AxiosAdapter
    axios.defaults.adapter = async (config) => {
      if (isApiRequest(config.url)) return staticAxiosAdapter(config)
      return fallback(config)
    }
  }

  return mode
}
