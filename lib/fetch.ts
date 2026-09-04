import type { AxiosInstance, AxiosRequestConfig } from 'axios'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import fs from 'fs-extra'
import SFTPClient from 'ssh2-sftp-client'
import { Client as FTPClient } from 'basic-ftp'

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

export interface FTPAccessOptions {
  host: string
  port: number
  user: string
  password: string
  secure: boolean | 'implicit'
}

/**
 * Resolve connection options for FTP / FTPS.
 * - No username means anonymous access (user "anonymous").
 * - Credentials may also come from userinfo embedded in the URL.
 * - basic-ftp only supports passive mode (no active mode).
 * - FTPS on port 990 uses implicit TLS, otherwise explicit TLS.
 * - Certificate verification is left strict (rejectUnauthorized): a
 *   self-signed certificate fails instead of being silently trusted.
 */
export const ftpAccessOptions = (url: URL, credentials: SourceCredentials): FTPAccessOptions => {
  const username = credentials.username || (url.username ? decodeURIComponent(url.username) : '') || 'anonymous'
  const password = credentials.password ?? (url.password ? decodeURIComponent(url.password) : '') ?? ''
  if (url.protocol === 'ftps:' && url.port === '990') {
    return { host: url.hostname, port: 990, user: username, password: password || 'guest', secure: 'implicit' }
  }
  if (url.protocol === 'ftps:') {
    return { host: url.hostname, port: url.port ? Number(url.port) : 21, user: username, password: password || 'guest', secure: true }
  }
  return { host: url.hostname, port: url.port ? Number(url.port) : 21, user: username, password: password || 'guest', secure: false }
}

/**
 * Open a single FTP(S) connection, meant to be reused across operations.
 */
export const connectFTP = async (url: URL, credentials: SourceCredentials): Promise<FTPClient> => {
  const client = new FTPClient(30000)
  const { host, port, user, password, secure } = ftpAccessOptions(url, credentials)
  await client.access({ host, port, user, password, secure })
  return client
}

export const fetchFTP = async (url: URL, credentials: SourceCredentials, tmpFile: string, ftpClient?: FTPClient) => {
  const client = ftpClient ?? await connectFTP(url, credentials)
  try {
    await client.downloadTo(tmpFile, decodeURIComponent(url.pathname))
  } catch (err: any) {
    if (err.code === 550 || err.message?.includes('550') || err.message?.includes('No such file') || err.message?.includes('not found') || err.code === 'ENOENT') {
      throw new FileNotFoundError(`Fichier introuvable : ${url.pathname}`)
    }
    throw err
  } finally {
    if (!ftpClient) client.close()
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
  } else if (url.protocol === 'ftp:' || url.protocol === 'ftps:') {
    await fetchFTP(url, credentials, tmpFile)
  } else {
    throw new Error(`Protocole non supporté : "${url.protocol}". Les protocoles supportés sont HTTP, HTTPS, FTP, FTPS et SFTP.`)
  }
  return decodeURIComponent(path.basename(url.pathname))
}
