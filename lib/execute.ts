import type { ProcessingContext } from '@data-fair/lib-common-types/processings.js'
import type { ProcessingConfig } from '#types/processingConfig/index.ts'
import path from 'node:path'
import fs from 'fs-extra'
import { download } from './download.ts'
import { hasFile, loadCalendar, loadRoutes, loadStops, loadTrips, type Reference } from './gtfs/read.ts'
import { buildStopTimesIndex, writeStopTimes } from './gtfs/stop-times.ts'
import { writeStops } from './gtfs/stops.ts'
import { writeShapes } from './gtfs/shapes.ts'
import { RESOURCE_FILES, RESOURCE_TITLES, buildSchemas, type ResourceKey } from './schemas.ts'
import {
  assertDatasetExists,
  createDataDataset,
  createMetadataDataset,
  datasetTitle,
  refreshSchemaLabels,
  syncRelatedDatasets,
  uploadAttachments,
  uploadData,
  type DatasetRef
} from './upload.ts'

let shouldBeStopped = false

export const stop = async () => { shouldBeStopped = true }

const throwIfStopped = () => {
  if (shouldBeStopped) throw new Error('Traitement interrompu.')
}

const DATA_KEYS = ['stops', 'stop-times', 'shapes'] as const

const wantedFromResources = (resources: any = {}): ResourceKey[] => {
  const flags: [ResourceKey, boolean][] = [
    ['metadata', !!resources.metadata],
    ['stops', !!resources.stops],
    ['stop-times', !!resources.stopTimes],
    ['shapes', !!resources.shapes]
  ]
  return flags.filter(([, on]) => on).map(([key]) => key)
}

const refsFromConfig = (datasets: any[]): DatasetRef[] => {
  const seen = new Set<string>()
  return datasets.map((entry) => {
    if (!entry?.key || !entry?.id) throw new Error('Chaque jeu de données à mettre à jour doit avoir un rôle et un identifiant.')
    if (seen.has(entry.key)) throw new Error(`Le rôle "${RESOURCE_TITLES[entry.key as ResourceKey]}" est configuré plusieurs fois.`)
    seen.add(entry.key)
    return { key: entry.key as ResourceKey, id: entry.id, title: entry.title || entry.id }
  })
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

  const create = config.datasetMode === 'create'
  const configuredRefs = create ? [] : refsFromConfig(config.datasets ?? [])
  const wanted = create ? wantedFromResources(config.resources) : configuredRefs.map(r => r.key)
  if (!wanted.length) throw new Error('Aucun jeu de données à produire : cochez au moins une ressource.')

  await log.step('Configuration')
  await log.info(`Jeux de données à produire : ${wanted.map(k => RESOURCE_TITLES[k]).join(', ')}`)

  const { zipPath, gtfsDir } = await download(config.url, credentials, tmpDir, axios, log)
  throwIfStopped()

  const dataKeys = DATA_KEYS.filter(key => wanted.includes(key))
  const produced = new Map<ResourceKey, string>()

  if (dataKeys.length) {
    await log.step('Conversion des fichiers GTFS')
    const needStops = dataKeys.includes('stops') || dataKeys.includes('stop-times')
    const reference: Reference = {
      routes: await loadRoutes(gtfsDir),
      stops: needStops ? await loadStops(gtfsDir) : new Map(),
      trips: await loadTrips(gtfsDir),
      calendar: dataKeys.includes('stop-times') ? await loadCalendar(gtfsDir) : new Map()
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

  const schemas = buildSchemas({ stopConcept: config.stopConcept, routeConcept: config.routeConcept })
  const refs: DatasetRef[] = []

  if (create) {
    await log.step('Création des jeux de données')
    for (const key of wanted) {
      throwIfStopped()
      const title = datasetTitle(config.datasetTitle, key)
      if (key === 'metadata') {
        refs.push(await createMetadataDataset(axios, title, log))
      } else {
        refs.push(await createDataDataset(axios, key, title, produced.get(key)!, schemas[key], log))
      }
    }
    // recorded before anything else can fail: without this the next run would create
    // a second family of datasets instead of updating this one
    await patchConfig({
      datasetMode: 'update',
      datasets: refs.map(r => ({ key: r.key, id: r.id, title: r.title }))
    } as any)
  } else {
    await log.step('Mise à jour des jeux de données')
    for (const ref of configuredRefs) {
      throwIfStopped()
      const live = await assertDatasetExists(axios, ref)
      const resolved: DatasetRef = { ...ref, title: live.title || ref.title }
      if (ref.key !== 'metadata') {
        await refreshSchemaLabels(axios, resolved, schemas[ref.key as Exclude<ResourceKey, 'metadata'>], live, log)
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
  }
  throwIfStopped()

  await log.step('Jeux liés')
  await syncRelatedDatasets(axios, refs, log)

  if (config.clearFiles) await fs.remove(tmpDir)
  await log.info('Traitement terminé.')
}
