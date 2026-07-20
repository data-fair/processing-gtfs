import type { PrepareFunction } from '@data-fair/lib-common-types/processings.js'
import type { ProcessingConfig } from '#types/processingConfig/index.ts'

const secretFields = ['password', 'sshKey'] as const

/**
 * Credentials must not stay in the config: they are moved to the secrets store and
 * replaced by a placeholder. An emptied field removes the stored secret.
 */
const prepare: PrepareFunction<ProcessingConfig> = async ({ processingConfig, secrets }) => {
  for (const field of secretFields) {
    const value = processingConfig[field]
    if (value && value !== '********') {
      secrets[field] = value
      processingConfig[field] = '********'
    } else if (secrets[field] && value === '') {
      delete secrets[field]
      delete processingConfig[field]
    }
  }

  return { processingConfig, secrets }
}

export default prepare
