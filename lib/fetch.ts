import type { AxiosInstance, AxiosRequestConfig } from 'axios'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import fs from 'fs-extra'
import SFTPClient from 'ssh2-sftp-client'

/**
 * Credentials resolved from the secrets store, never read straight from the config.
 */
export interface SourceCredentials {
  username?: string
  password?: string
  sshKey?: string
}

export class FileNotFoundError extends Error {
  constructor (message: string) {
    super(message)
    this.name = 'FileNotFoundError'
  }
}

export const fetchHTTP = async (url: URL, credentials: SourceCredentials, tmpFile: string, axios: AxiosInstance) => {
  const opts: AxiosRequestConfig = { responseType: 'stream', maxRedirects: 4 }
  if (credentials.username && credentials.password) {
    opts.auth = { username: credentials.username, password: credentials.password }
  }
  try {
    const res = await axios.get(url.href, opts)
    await pipeline(res.data, fs.createWriteStream(tmpFile))
  } catch (err: any) {
    if (err.response?.status === 404) throw new FileNotFoundError(`Fichier introuvable : ${url.href}`)
    throw err
  }
}

/**
 * Open a single SFTP connection, meant to be reused across operations to avoid
 * paying the SSH handshake cost more than once.
 */
export const connectSFTP = async (url: URL, credentials: SourceCredentials): Promise<SFTPClient> => {
  const sftp = new SFTPClient()
  await sftp.connect({
    host: url.hostname,
    port: url.port ? Number(url.port) : undefined,
    username: credentials.username,
    password: credentials.password,
    privateKey: credentials.sshKey
  })
  return sftp
}

export const fetchSFTP = async (url: URL, credentials: SourceCredentials, tmpFile: string, sftpClient?: SFTPClient) => {
  const sftp = sftpClient ?? await connectSFTP(url, credentials)
  try {
    await sftp.get(url.pathname, tmpFile)
  } catch (err: any) {
    if (err.message?.includes('no such file') || err.code === 'ENOENT') {
      throw new FileNotFoundError(`Fichier introuvable : ${url.pathname}`)
    }
    throw err
  } finally {
    if (!sftpClient) await sftp.end()
  }
}

/**
 * Download the source archive, whatever the protocol.
 * Returns the name the source suggests for the file, when it suggests one.
 */
export const fetchFile = async (url: URL, credentials: SourceCredentials, tmpFile: string, axios: AxiosInstance) => {
  if (url.protocol === 'http:' || url.protocol === 'https:') {
    await fetchHTTP(url, credentials, tmpFile, axios)
  } else if (url.protocol === 'sftp:') {
    await fetchSFTP(url, credentials, tmpFile)
  } else {
    throw new Error(`Protocole non supporté : "${url.protocol}". Les protocoles supportés sont HTTP, HTTPS et SFTP.`)
  }
  return decodeURIComponent(path.basename(url.pathname))
}
