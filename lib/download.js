const fs = require('fs-extra')
const path = require('path')
const util = require('util')
const exec = util.promisify(require('child_process').exec)
const pump = util.promisify(require('pump'))

const fetchHTTP = async (processingConfig, tmpFile, axios) => {
  const opts = { responseType: 'stream', maxRedirects: 4 }
  if (processingConfig.username && processingConfig.password) {
    opts.auth = {
      username: process.username,
      password: processingConfig.password
    }
  }
  const res = await axios.get(processingConfig.url, opts)
  await pump(res.data, fs.createWriteStream(tmpFile))
  if (res.headers['content-disposition'] && res.headers['content-disposition'].includes('filename=')) {
    if (res.headers['content-disposition'].match(/filename="(.*)"/)) return res.headers['content-disposition'].match(/filename="(.*)"/)[1]
    if (res.headers['content-disposition'].match(/filename=(.*)/)) return res.headers['content-disposition'].match(/filename=(.*)/)[1]
  }
  if (res.request && res.request.res && res.request.res.responseUrl) return decodeURIComponent(path.parse(res.request.res.responseUrl).base)
}

const fetchSFTP = async (processingConfig, tmpFile) => {
  const url = new URL(processingConfig.url)
  const SFTPClient = require('ssh2-sftp-client')
  const sftp = new SFTPClient()
  await sftp.connect({ host: url.host, port: url.port, username: processingConfig.username, password: processingConfig.password })
  await sftp.get(url.pathname, tmpFile)
}

module.exports = async (processingConfig, dir = 'data', axios, log) => {
  await log.step('Téléchargement du fichier')
  const url = new URL(processingConfig.url)
  const fileName = path.parse(new URL(processingConfig.url).pathname).name + '.zip'
  const decodedFileName = decodeURIComponent(fileName)
  const file = path.join(dir, decodedFileName)
  // this is used only in dev
  if (await fs.pathExists(file)) {
    await log.warning(`Le fichier ${file} existe déjà`)
  } else {
    // creating empty file before streaming seems to fix some weird bugs with NFS
    await fs.ensureFile(file)
    await log.info(`Récupération du fichier ${file}`)
    if (url.protocol === 'http:' || url.protocol === 'https:') {
      await fetchHTTP(processingConfig, file, axios)
    } else if (url.protocol === 'sftp:') {
      await fetchSFTP(processingConfig, file)
    } else {
      throw new Error(`protocole non supporté "${url.protocol}"`)
    }
    await log.info(`Fichier récupéré dans ${file}`)
  }
  await log.info(`Extraction de l'archive ${file}`)
  try {
    await exec(`unzip -o ${file} -d ${dir} `)
  } catch (err) {
    log.warning('Impossible d\'extraire l\'archive, le fichier est peut-être déjà extrait')
  }
  // remove the zip file
  // await fs.remove(file)

  await log.info('Extraction terminée')
  return file
}
