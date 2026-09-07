import type { ProcessingContext } from '@data-fair/lib-common-types/processings.js'
import type { ProcessingConfig } from '#types/processingConfig/index.ts'
import path from 'node:path'
import fs from 'fs-extra'
import { extractZip, fetchZip } from './download.ts'
import { DEFAULT_VALIDATOR_URL, logValidation, summarize, validateZip } from './validate.ts'
import { hasFile, loadCalendar, loadFrequencies, loadRoutes, loadStops, loadTrips, type Reference } from './gtfs/read.ts'
import { buildStopTimesIndex, writeStopTimes } from './gtfs/stop-times.ts'
import { writeStops } from './gtfs/stops.ts'
import { writeShapes } from './gtfs/shapes.ts'
import { RESOURCE_FILES, RESOURCE_KEYS, RESOURCE_TITLES, SCHEMAS, type ResourceKey } from './schemas.ts'
import {
  assertDatasetExists,
  createDataDataset,
  createMetadataDataset,
  datasetTitle,
  describeError,
  refreshSchemaLabels,
  syncRelatedDatasets,
  uploadAttachments,
  uploadData,
  uploadRealtimeAttachment,
  type DatasetRef
} from './upload.ts'

let shouldBeStopped = false
let validateController: AbortController | undefined

export const stop = async () => {
  shouldBeStopped = true
  // abort an in-flight validation request so stop does not wait for the timeout
  validateController?.abort()
}

const throwIfStopped = () => {
  if (shouldBeStopped) throw new Error('Traitement interrompu.')
}

const DATA_KEYS = ['stops', 'stop-times', 'shapes'] as const

/** Kept in RESOURCE_KEYS order whatever order the form wrote the selection in. */
export const wantedFromResources = (resources: any): ResourceKey[] => {
  // #region deprecated -- v0.3.10 compatibility, drop with the next major
  // A config saved before the roles existed has no selection at all: it produced the
  // four datasets, so an absent one means all four rather than none.
  if (resources === undefined) return [...RESOURCE_KEYS]
  // #endregion deprecated
  const selected: string[] = Array.isArray(resources) ? resources : []
  return RESOURCE_KEYS.filter(key => selected.includes(key))
}

/**
 * One entry per role, kept in RESOURCE_KEYS order and roles without a dataset left out.
 *
 * `[{ resource, dataset: { id, title } }]` is the shape the platform reads to list the
 * datasets a processing feeds: processings looks for a `dataset` object, either at the
 * root of the configuration or inside each entry of a `datasets` array.
 */
export const refsFromConfig = (datasets: any): DatasetRef[] => {
  const entries: any[] = Array.isArray(datasets) ? datasets : []
  const byKey: Record<string, any> = Object.fromEntries(entries.map(entry => [entry?.resource, entry?.dataset]))
  const refs: DatasetRef[] = []
  for (const key of RESOURCE_KEYS) {
    const dataset = byKey[key]
    if (!dataset?.id) continue
    refs.push({ key, id: dataset.id, title: dataset.title || dataset.id })
  }
  return refs
}

/**
 * @deprecated v0.3.10 compatibility, drop with the next major: the fallback on the
 * nested `dataset.title` goes away with the legacy shape, leaving `config.datasetTitle`
 * read directly at the call site.
 */
export const baseDatasetTitle = (config: any) => config.datasetTitle || config.dataset?.title || 'GTFS'

/**
 * One line per role, the dataset filled only for the roles actually produced.
 *
 * The form neither adds nor removes lines: the configuration carries them all, and a
 * line left without a dataset is a role this processing does not produce.
 */
export const datasetsFromRefs = (refs: DatasetRef[]) => {
  const byKey = Object.fromEntries(refs.map(ref => [ref.key, { id: ref.id, title: ref.title }]))
  return RESOURCE_KEYS.map(key => byKey[key] ? { resource: key, dataset: byKey[key] } : { resource: key })
}

/**
 * @deprecated v0.3.10 compatibility, drop with the next major.
 * How the published version derived the id of each dataset from the metadata one.
 */
const LEGACY_SUFFIXES: [ResourceKey, string][] = [
  ['metadata', ''],
  ['stops', '-stops'],
  ['stop-times', '-stop-times'],
  ['shapes', '-shapes']
]

/**
 * @deprecated v0.3.10 compatibility, drop with the next major -- along with the
 * `dataset` property and the legacy `anyOf` branches of processing-config-schema.json,
 * which exist only so those configs stay valid until this function has run once.
 *
 * Adopt a config written by an older version: a single `dataset`, the others being
 * derived by suffix.
 *
 * Done here rather than in prepare: prepare receives no axios, so it could not check
 * that the derived ids exist and would rewrite the config blind. Every derived id is
 * confirmed by a GET, and one that no longer exists is left out rather than assumed.
 */
export const migrateLegacyConfig = async (
  config: any,
  axios: ProcessingContext['axios'],
  log: ProcessingContext['log'],
  patchConfig: ProcessingContext['patchConfig']
): Promise<DatasetRef[] | null> => {
  // the form fills `datasets` with one empty line per role as soon as it is opened, so
  // the presence of the list says nothing: what matters is whether a line carries a jeu
  if (refsFromConfig(config.datasets).length || !config.dataset?.id) return null

  await log.step('Migration de la configuration')
  await log.warning("Configuration héritée de la version précédente : les jeux de données sont retrouvés à partir de l'identifiant du jeu de métadonnées.")

  const refs: DatasetRef[] = []
  for (const [key, suffix] of LEGACY_SUFFIXES) {
    const id = config.dataset.id + suffix
    try {
      const live = (await axios.get(`api/v1/datasets/${id}`)).data
      refs.push({ key, id, title: live.title || id })
      await log.info(`${RESOURCE_TITLES[key]} : ${id}`)
    } catch (err: any) {
      if (err.response?.status === 404) {
        await log.info(`${RESOURCE_TITLES[key]} : aucun jeu "${id}", ignoré`)
        continue
      }
      throw new Error(describeError(err))
    }
  }

  if (!refs.length) {
    throw new Error(`Aucun jeu de données n'a été retrouvé à partir de "${config.dataset.id}". Configurez les jeux à mettre à jour à la main.`)
  }

  await patchConfig({ datasetMode: 'update', datasets: datasetsFromRefs(refs), dataset: undefined } as any)
  await log.info(`${refs.length} jeux de données repris dans la nouvelle configuration.`)
  return refs
}

export const run = async (context: ProcessingContext<ProcessingConfig>) => {
  shouldBeStopped = false
  const { processingConfig, secrets, tmpDir, axios, log, patchConfig } = context
  const config = processingConfig as any

  const credentials = {
    username: config.username,
    password: secrets?.password ?? config.password,
    sshKey: secrets?.sshKey ?? config.sshKey
  }

  const mode = config.mode ?? 'import'
  const zipPath = await fetchZip(config.url, credentials, tmpDir, axios, log)
  throwIfStopped()

  // validate mode: the summary is the whole result, nothing else is produced.
  // import mode: the validation is optional and, with failOnError, blocks the import.
  if (mode === 'validate' || config.validationEnabled !== false) {
    await log.step('Validation GTFS')
    validateController = new AbortController()
    let result
    try {
      result = await validateZip(zipPath, {
        validatorUrl: config.validatorUrl ?? DEFAULT_VALIDATOR_URL,
        maxIssues: config.maxIssues
      }, validateController.signal)
    } catch (err: any) {
      if (err.name === 'CanceledError' || err.code === 'ERR_CANCELED') throw new Error('Traitement interrompu.')
      throw err
    } finally {
      validateController = undefined
    }
    throwIfStopped()

    const summary = summarize(result)
    await logValidation(result, summary, log)

    if (mode === 'validate') {
      if (summary.counts.Fatal > 0) {
        throw new Error(`Archive GTFS inexploitable : ${summary.counts.Fatal} anomalie(s) fatale(s).`)
      }
      await log.info('Validation terminée.')
      return
    }
    if (config.failOnError && (summary.counts.Fatal > 0 || summary.counts.Error > 0)) {
      throw new Error(`L'archive contient des anomalies bloquantes (${summary.counts.Fatal} fatale(s), ${summary.counts.Error} erreur(s)) : import interrompu (option « échouer sur anomalies » active).`)
    }
  }

  const create = config.datasetMode === 'create'
  // the migrateLegacyConfig call is deprecated v0.3.10 compatibility: with the next
  // major it goes away and refsFromConfig is left alone
  const configuredRefs = create
    ? []
    : (await migrateLegacyConfig(config, axios, log, patchConfig)) ?? refsFromConfig(config.datasets)
  const wanted = create ? wantedFromResources(config.resources) : configuredRefs.map(r => r.key)
  if (!wanted.length) {
    throw new Error(create
      ? 'Aucun jeu de données à produire : sélectionnez au moins une donnée.'
      : 'Aucun jeu de données à mettre à jour : renseignez au moins un rôle.')
  }

  await log.step('Configuration')
  await log.info(`Jeux de données à produire : ${wanted.map(k => RESOURCE_TITLES[k]).join(', ')}`)

  const gtfsDir = await extractZip(zipPath, tmpDir, log)
  throwIfStopped()

  const dataKeys = DATA_KEYS.filter(key => wanted.includes(key))
  const produced = new Map<ResourceKey, string>()

  if (dataKeys.length) {
    await log.step('Conversion des fichiers GTFS')
    const needStops = dataKeys.includes('stops') || dataKeys.includes('stop-times')
    const wantStopTimes = dataKeys.includes('stop-times')
    const reference: Reference = {
      routes: await loadRoutes(gtfsDir),
      stops: needStops ? await loadStops(gtfsDir) : new Map(),
      trips: await loadTrips(gtfsDir),
      calendar: wantStopTimes ? await loadCalendar(gtfsDir, log) : new Map(),
      frequencies: wantStopTimes ? await loadFrequencies(gtfsDir) : new Map()
    }
    throwIfStopped()

    let stopRoutes: Map<string, Set<string>> | undefined
    const needIndex = dataKeys.includes('stop-times') || dataKeys.includes('stops')
    if (needIndex && hasFile(gtfsDir, 'stop_times.txt')) {
      const index = await buildStopTimesIndex(gtfsDir, reference, { collectStopRoutes: dataKeys.includes('stops') }, log)
      stopRoutes = index.stopRoutes
      throwIfStopped()
      if (dataKeys.includes('stop-times')) {
        const out = path.join(tmpDir, RESOURCE_FILES['stop-times'])
        await writeStopTimes(gtfsDir, reference, index.tripEnds, out, log)
        produced.set('stop-times', out)
      }
    } else if (dataKeys.includes('stop-times')) {
      throw new Error("Le fichier stop_times.txt est absent de l'archive GTFS, il est nécessaire pour produire les horaires.")
    } else {
      await log.warning('stop_times.txt est absent : les arrêts seront produits sans les lignes desservies.')
    }
    throwIfStopped()

    if (dataKeys.includes('stops')) {
      const out = path.join(tmpDir, RESOURCE_FILES.stops)
      await writeStops(reference, stopRoutes, out, log)
      produced.set('stops', out)
    }
    throwIfStopped()

    if (dataKeys.includes('shapes')) {
      const out = path.join(tmpDir, RESOURCE_FILES.shapes)
      await writeShapes(gtfsDir, reference, out, log)
      produced.set('shapes', out)
    }
  }
  throwIfStopped()

  const refs: DatasetRef[] = []

  if (create) {
    await log.step('Création des jeux de données')
    for (const key of wanted) {
      throwIfStopped()
      const title = datasetTitle(baseDatasetTitle(config), key)
      if (key === 'metadata') {
        refs.push(await createMetadataDataset(axios, title, log))
      } else {
        refs.push(await createDataDataset(axios, key, title, produced.get(key)!, SCHEMAS[key], log))
      }
    }
    // recorded before anything else can fail: without this the next run would create
    // a second family of datasets instead of updating this one
    await patchConfig({ datasetMode: 'update', datasets: datasetsFromRefs(refs) } as any)
  } else {
    await log.step('Mise à jour des jeux de données')
    for (const ref of configuredRefs) {
      throwIfStopped()
      const live = await assertDatasetExists(axios, ref)
      const resolved: DatasetRef = { ...ref, title: live.title || ref.title }
      if (ref.key !== 'metadata') {
        await refreshSchemaLabels(axios, resolved, SCHEMAS[ref.key as Exclude<ResourceKey, 'metadata'>], live, log)
        await uploadData(axios, resolved, produced.get(ref.key)!, log)
      }
      refs.push(resolved)
    }
  }
  throwIfStopped()

  const metadataRef = refs.find(r => r.key === 'metadata')
  if (metadataRef) {
    await log.step('Pièces jointes')
    const attachments = config.downloadZip
      ? [zipPath]
      : (await fs.readdir(gtfsDir)).filter(f => f.endsWith('.txt')).sort().map(f => path.join(gtfsDir, f))
    await uploadAttachments(axios, metadataRef, attachments, log)
    if (config.realtimeUrl) {
      await uploadRealtimeAttachment(axios, metadataRef, config.realtimeUrl, log)
    }
  }
  throwIfStopped()

  await log.step('Jeux liés')
  await syncRelatedDatasets(axios, refs, log)

  // no cleanup here: the worker creates tmpDir per run and removes it in a finally
  await log.info('Traitement terminé.')
}
