/**
 * GTFS validation against a transport-validator daemon
 * (https://github.com/etalab/transport-validator).
 *
 * A dedicated axios instance is used on purpose: the processing context's axios
 * is pre-authenticated against data-fair and would leak the x-apiKey header to
 * a third-party service.
 */
import axios from 'axios'
import type { LogFunctions } from '@data-fair/lib-common-types/processings.js'
import fs from 'fs-extra'

/** The public instance maintained by transport.data.gouv.fr. */
export const DEFAULT_VALIDATOR_URL = 'https://validation.transport.data.gouv.fr/validate'

export interface ValidatorOptions {
  /** URL of the validator's HTTP endpoint, e.g. https://validation.transport.data.gouv.fr/validate */
  validatorUrl: string
  /** Maximum number of detailed issues per type, as understood by the validator's --max-issues flag */
  maxIssues?: number
}

export type Severity = 'Fatal' | 'Error' | 'Warning' | 'Information'

export interface ValidatorIssue {
  severity: Severity
  issue_type: string
  object_id?: string
  object_type?: string
  object_name?: string
  details?: string
}

/**
 * The shape of the validator's JSON response. Parsed leniently: optional keys
 * everywhere, unknown keys ignored.
 */
export interface ValidatorResult {
  metadata?: {
    start_date?: string
    end_date?: string
    networks?: string[]
    modes?: string[]
    issues_count?: Record<string, number>
  }
  validations?: Record<string, ValidatorIssue[]>
}

export interface ValidationSummary {
  counts: Record<Severity, number>
  startDate?: string
  endDate?: string
  networks: string[]
  modes: string[]
}

/**
 * POST the archive to the validator and return its JSON result.
 * The request can be aborted while in flight through the optional signal.
 */
export const validateZip = async (zipPath: string, opts: ValidatorOptions, signal?: AbortSignal): Promise<ValidatorResult> => {
  const res = await axios.post<ValidatorResult>(opts.validatorUrl, fs.createReadStream(zipPath), {
    headers: { 'content-type': 'application/zip' },
    params: opts.maxIssues ? { max_issues: opts.maxIssues } : undefined,
    timeout: 300000,
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
    signal
  })
  return res.data
}

/**
 * Aggregate the validator's result: issue counts by severity, feed validity
 * dates, networks and modes.
 *
 * ``metadata.issues_count`` holds the true totals (the ``validations`` arrays
 * are capped by the validator's max-issues) and the severity of a type is read
 * from its first detailed issue: a check always carries a single severity.
 */
export const summarize = (result: ValidatorResult): ValidationSummary => {
  const counts: Record<Severity, number> = { Fatal: 0, Error: 0, Warning: 0, Information: 0 }
  const issuesCount = result.metadata?.issues_count ?? {}
  const validations = result.validations ?? {}
  for (const [type, count] of Object.entries(issuesCount)) {
    const severity = validations[type]?.[0]?.severity
    if (severity) counts[severity] += count
  }
  return {
    counts,
    startDate: result.metadata?.start_date,
    endDate: result.metadata?.end_date,
    networks: result.metadata?.networks ?? [],
    modes: result.metadata?.modes ?? []
  }
}

const SEVERITY_LABELS: Record<Severity, string> = {
  Fatal: 'anomalies fatales',
  Error: 'erreurs',
  Warning: 'avertissements',
  Information: 'informations'
}

const SEVERITY_ORDER: Severity[] = ['Fatal', 'Error', 'Warning', 'Information']

/**
 * Write the validation summary to the run's log: one line with the counts, one
 * with the feed metadata, one per issue type. The first issues of each type
 * are only logged as debug to keep the run log readable.
 */
export const logValidation = async (result: ValidatorResult, summary: ValidationSummary, log: LogFunctions) => {
  const counts = SEVERITY_ORDER
    .map(severity => `${summary.counts[severity]} ${SEVERITY_LABELS[severity]}`)
    .join(', ')
  await log.info(`Anomalies détectées : ${counts}`)

  if (summary.startDate || summary.endDate) {
    await log.info(`Période de validité : du ${summary.startDate ?? '?'} au ${summary.endDate ?? '?'}`)
  }
  if (summary.networks.length) {
    await log.info(`Réseaux : ${summary.networks.join(', ')}`)
  }
  if (summary.modes.length) {
    await log.info(`Modes : ${summary.modes.join(', ')}`)
  }

  const validations = result.validations ?? {}
  const types = Object.keys(validations).sort((a, b) => {
    const severityDiff = SEVERITY_ORDER.indexOf(validations[a][0]?.severity) - SEVERITY_ORDER.indexOf(validations[b][0]?.severity)
    if (severityDiff !== 0) return severityDiff
    return (result.metadata?.issues_count?.[b] ?? 0) - (result.metadata?.issues_count?.[a] ?? 0)
  })
  for (const type of types) {
    const issues = validations[type]
    const severity = issues[0]?.severity ?? 'Information'
    const total = result.metadata?.issues_count?.[type] ?? issues.length
    await log.info(`${type} (${severity}) : ${total}`)
    for (const issue of issues.slice(0, 3)) {
      const target = [issue.object_type, issue.object_id, issue.object_name].filter(Boolean).join(' ')
      await log.debug(`${type}${target ? ` — ${target}` : ''}${issue.details ? ` : ${issue.details}` : ''}`)
    }
  }
}
