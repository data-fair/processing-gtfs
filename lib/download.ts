import type { AxiosInstance } from 'axios'
import type { LogFunctions } from '@data-fair/lib-common-types/processings.js'
import path from 'node:path'
import fs from 'fs-extra'
import { fetchFile, type SourceCredentials } from './fetch.ts'
import { runCommand } from './spawn-process.ts'

export const displayBytes = (size: number) => {
  const units = [[1, 'octets'], [1e3, 'ko'], [1e6, 'Mo'], [1e9, 'Go'], [1e12, 'To']] as const
  const abs = Math.abs(size)
  if (abs === 0) return '0 octets'
  for (let i = units.length - 1; i >= 0; i--) {
    if (abs >= units[i][0]) return (abs / units[i][0]).toLocaleString('fr-FR', { maximumFractionDigits: 1 }) + ' ' + units[i][1]
  }
  return `${abs} octets`
}

/**
 * Download the source archive (HTTP, HTTPS, FTP, FTPS or SFTP) into tmpDir.
 * Returns the path of the downloaded zip, without extracting it.
 */
export const fetchZip = async (
  rawUrl: string,
  credentials: SourceCredentials,
  tmpDir: string,
  axios: AxiosInstance,
  log: LogFunctions
): Promise<string> => {
  const url = new URL(rawUrl)
  await log.step('Téléchargement de l\'archive GTFS')
  await log.info(`Source : ${url.origin}${url.pathname}`)
  if (url.protocol === 'ftp:') {
    await log.warning('FTP en clair : les identifiants transitent sans chiffrement, préférez FTPS ou SFTP quand c\'est possible.')
  }

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
  return zipPath
}

/**
 * Extract the archive into a flat directory holding the GTFS .txt files.
 */
export const extractZip = async (zipPath: string, tmpDir: string, log: LogFunctions): Promise<string> => {
  const gtfsDir = path.join(tmpDir, 'gtfs')
  await fs.ensureDir(gtfsDir)
  // -j flattens: some feeds nest their .txt files in a folder inside the archive
  await runCommand('unzip', ['-o', '-j', zipPath, '-d', gtfsDir])

  const files = (await fs.readdir(gtfsDir)).filter(f => f.endsWith('.txt'))
  if (!files.length) throw new Error('L\'archive ne contient aucun fichier GTFS (.txt).')
  await log.info(`Fichiers GTFS extraits : ${files.sort().join(', ')}`)
  return gtfsDir
}
