import type { PrepareFunction, RunFunction } from '@data-fair/lib-common-types/processings.js'
import type { ProcessingConfig } from './types/processingConfig/index.ts'

/**
 * Prepare the processing config (triggered when the config is saved).
 * Moves credentials out of the config and into the secrets store.
 */
export const prepare: PrepareFunction<ProcessingConfig> = async (context) => {
  const prepare = (await import('./lib/prepare.ts')).default
  return prepare(context)
}

/**
 * Execute the processing: download a GTFS archive, convert it and push the
 * selected datasets to data-fair.
 */
export const run: RunFunction<ProcessingConfig> = async (context) => {
  const { run } = await import('./lib/execute.ts')
  return run(context)
}

export const stop = async () => {
  const { stop } = await import('./lib/execute.ts')
  return stop()
}
