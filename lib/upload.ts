import type { AxiosInstance } from 'axios'
import type { LogFunctions } from '@data-fair/lib-common-types/processings.js'
import path from 'node:path'
import util from 'node:util'
import fs from 'fs-extra'
import FormData from 'form-data'
import { REFRESHABLE_PROPS, RESOURCE_TITLES, type ResourceKey, type SchemaProperty } from './schemas.ts'
import { displayBytes } from './download.ts'

export interface DatasetRef {
  key: ResourceKey
  id: string
  title: string
}

/** Axios hides the reason given by data-fair inside response.data; JSON.stringify(err) drops it. */
export const describeError = (err: any) => {
  const detail = err.response?.data
  const body = typeof detail === 'string' ? detail : detail ? JSON.stringify(detail) : ''
  return body ? `${err.message} : ${body}` : err.message
}

const sendForm = async (axios: AxiosInstance, url: string, formData: FormData, log: LogFunctions) => {
  const getLength = util.promisify(formData.getLength).bind(formData)
  const contentLength = await getLength()
  await log.info(`Envoi de ${displayBytes(contentLength)}`)
  return await axios({
    method: 'post',
    url,
    data: formData,
    maxContentLength: Infinity,
    maxBodyLength: Infinity,
    headers: { ...formData.getHeaders(), 'content-length': contentLength }
  })
}

export const datasetTitle = (baseTitle: string, key: ResourceKey) => `${baseTitle} - ${RESOURCE_TITLES[key]}`

export const createMetadataDataset = async (axios: AxiosInstance, title: string, log: LogFunctions): Promise<DatasetRef> => {
  // license, description and origin are deliberately left alone: they belong to whoever
  // publishes the data, and overwriting them on every run silently destroys their work
  const dataset = (await axios.post('api/v1/datasets', { title, isMetaOnly: true })).data
  await log.info(`Jeu de données créé : ${dataset.title} (${dataset.id})`)
  return { key: 'metadata', id: dataset.id, title: dataset.title }
}

export const createDataDataset = async (
  axios: AxiosInstance,
  key: ResourceKey,
  title: string,
  filePath: string,
  schema: SchemaProperty[],
  log: LogFunctions
): Promise<DatasetRef> => {
  const formData = new FormData()
  formData.append('title', title)
  formData.append('schema', JSON.stringify(schema))
  formData.append('file', fs.createReadStream(filePath), { filename: path.basename(filePath) })
  const dataset = (await sendForm(axios, 'api/v1/datasets', formData, log)).data
  await log.info(`Jeu de données créé : ${dataset.title} (${dataset.id})`)
  return { key, id: dataset.id, title: dataset.title }
}

export const assertDatasetExists = async (axios: AxiosInstance, ref: DatasetRef) => {
  try {
    return (await axios.get(`api/v1/datasets/${ref.id}`)).data
  } catch (err: any) {
    if (err.response?.status === 404) {
      throw new Error(`Le jeu de données "${RESOURCE_TITLES[ref.key]}" est introuvable (id="${ref.id}"). Corrigez la configuration : il ne sera pas recréé automatiquement, pour ne pas produire de doublon.`)
    }
    throw new Error(describeError(err))
  }
}

/**
 * Refresh only the properties data-fair treats as innocuous. Types, concepts and any
 * x-transform patch applied by hand on the dataset are left as they are: replacing the
 * whole schema would wipe them without a word.
 *
 * Done before pushing the file so the patch never races with an in-flight draft.
 */
export const refreshSchemaLabels = async (
  axios: AxiosInstance,
  ref: DatasetRef,
  wanted: SchemaProperty[],
  live: any,
  log: LogFunctions
) => {
  const liveSchema: SchemaProperty[] = (live.schema ?? []).filter((p: any) => !p['x-calculated'])
  const wantedByKey = new Map(wanted.map(p => [p.key, p]))
  let changed = false

  const merged = liveSchema.map((property: any) => {
    const target = wantedByKey.get(property.key)
    if (!target) return property
    const next = { ...property }
    for (const prop of REFRESHABLE_PROPS) {
      const value = (target as any)[prop]
      if (value === undefined) continue
      if (JSON.stringify(next[prop]) !== JSON.stringify(value)) {
        next[prop] = value
        changed = true
      }
    }
    return next
  })

  if (!changed) return
  await log.info(`Rafraîchissement des libellés de "${ref.title}"`)
  try {
    await axios.patch(`api/v1/datasets/${ref.id}`, { schema: merged })
  } catch (err: any) {
    throw new Error(`Échec du rafraîchissement du schéma de "${ref.title}" : ${describeError(err)}`)
  }
}

export const uploadData = async (axios: AxiosInstance, ref: DatasetRef, filePath: string, log: LogFunctions) => {
  await log.info(`Mise à jour de "${ref.title}"`)
  const formData = new FormData()
  formData.append('file', fs.createReadStream(filePath), { filename: path.basename(filePath) })
  try {
    await sendForm(axios, `api/v1/datasets/${ref.id}`, formData, log)
  } catch (err: any) {
    throw new Error(`Échec de l'envoi des données vers "${ref.title}" : ${describeError(err)}`)
  }
}

export const uploadAttachments = async (axios: AxiosInstance, ref: DatasetRef, files: string[], log: LogFunctions) => {
  for (const filePath of files) {
    const name = path.basename(filePath)
    await log.info(`Chargement de la pièce jointe ${name}`)
    try {
      const formData = new FormData()
      formData.append('attachment', fs.createReadStream(filePath), { filename: name })
      const response = await sendForm(axios, `api/v1/datasets/${ref.id}/metadata-attachments`, formData, log)

      const dataset = (await axios.get(`api/v1/datasets/${ref.id}`)).data
      const attachments = dataset.attachments ?? []
      const index = attachments.findIndex((a: any) => a.name === response.data.name)
      const previous = index >= 0 ? attachments.splice(index, 1).pop() : {}
      attachments.push({
        ...previous,
        type: 'file',
        name: response.data.name,
        size: response.data.size,
        mimetype: response.data.mimetype,
        updatedAt: response.data.updatedAt,
        title: name
      })
      await axios.patch(`api/v1/datasets/${ref.id}`, { attachments })
    } catch (err: any) {
      throw new Error(`Échec du chargement de la pièce jointe ${name} : ${describeError(err)}`)
    }
  }
}

/**
 * Point every produced dataset at its siblings.
 *
 * The title stored in a link is a snapshot: it does not follow a rename, a move to the
 * trash or a deletion, and data-fair says nothing. Rewriting the family links on every
 * run keeps them honest. Links the user added towards other datasets are preserved.
 */
export const syncRelatedDatasets = async (axios: AxiosInstance, refs: DatasetRef[], log: LogFunctions) => {
  if (refs.length < 2) return
  const familyIds = new Set(refs.map(r => r.id))
  for (const ref of refs) {
    const siblings = refs.filter(r => r.id !== ref.id).map(r => ({ id: r.id, title: r.title }))
    try {
      const dataset = (await axios.get(`api/v1/datasets/${ref.id}`)).data
      const foreign = (dataset.relatedDatasets ?? []).filter((r: any) => !familyIds.has(r.id))
      const related = [...foreign, ...siblings]
      const current = dataset.relatedDatasets ?? []
      if (JSON.stringify(current) === JSON.stringify(related)) continue
      await axios.patch(`api/v1/datasets/${ref.id}`, { relatedDatasets: related })
    } catch (err: any) {
      throw new Error(`Échec de la mise à jour des jeux liés de "${ref.title}" : ${describeError(err)}`)
    }
  }
  await log.info(`Jeux liés mis à jour sur ${refs.length} jeux de données`)
}
