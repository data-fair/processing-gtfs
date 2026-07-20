import type { AxiosInstance } from 'axios'
import type { LogFunctions } from '@data-fair/lib-common-types/processings.js'
import path from 'node:path'
import fs from 'fs-extra'
import { fetchFile, type SourceCredentials } from './fetch.ts'
import { runCommand } from './spawn-process.ts'

export interface DownloadResult {
  /** the archive itself, kept so it can be attached to the metadata dataset */
  zipPath: string
  /** flat directory holding the GTFS .txt files */
  gtfsDir: string
}

export const download = async (
  rawUrl: string,
  credentials: SourceCredentials,
  tmpDir: string,
  axios: AxiosInstance,
  log: LogFunctions
): Promise<DownloadResult> => {
  const url = new URL(rawUrl)
  await log.step('Téléchargement de l\'archive GTFS')
  await log.info(`Source : ${url.origin}${url.pathname}`)

  const zipPath = path.join(tmpDir, 'gtfs.zip')
  await fs.ensureDir(tmpDir)
  await fetchFile(url, credentials, zipPath, axios)

  // flush to disk before handing the file to another process: on NFS the data may
  // still be in flight, and unzip then reads a truncated archive
  const fd = await fs.open(zipPath, 'r')
  await fs.fsync(fd)
  await fs.close(fd)

  const { size } = await fs.stat(zipPath)
  await log.info(`Archive téléchargée (${displayBytes(size)})`)

  const gtfsDir = path.join(tmpDir, 'gtfs')
  await fs.ensureDir(gtfsDir)
  // -j flattens: some feeds nest their .txt files in a folder inside the archive
  await runCommand('unzip', ['-o', '-j', zipPath, '-d', gtfsDir])

  const files = (await fs.readdir(gtfsDir)).filter(f => f.endsWith('.txt'))
  if (!files.length) throw new Error('L\'archive ne contient aucun fichier GTFS (.txt).')
  await log.info(`Fichiers GTFS extraits : ${files.sort().join(', ')}`)

  return { zipPath, gtfsDir }
}

export const displayBytes = (size: number) => {
  const units = [[1, 'octets'], [1e3, 'ko'], [1e6, 'Mo'], [1e9, 'Go'], [1e12, 'To']] as const
  const abs = Math.abs(size)
  if (abs === 0) return '0 octets'
  for (let i = units.length - 1; i >= 0; i--) {
    if (abs >= units[i][0]) return (abs / units[i][0]).toLocaleString('fr-FR', { maximumFractionDigits: 1 }) + ' ' + units[i][1]
  }
  return `${abs} octets`
}
