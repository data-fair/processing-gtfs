const fs = require('fs-extra')
const path = require('path')
const util = require('util')
const exec = util.promisify(require('child_process').exec)
const pump = util.promisify(require('pump'))

exports.download = async (processingConfig, dir = 'data', axios, log) => {
  await log.step('Téléchargement du fichier')
  const res = await axios.get(processingConfig.url, { responseType: 'stream' })
  const fileName = path.parse(new URL(processingConfig.url).pathname).name + '.zip'
  const file = path.join(dir, fileName)
  // this is used only in dev
  if (await fs.pathExists(file)) {
    await log.warning(`Le fichier ${file} existe déjà`)
  } else {
    // creating empty file before streaming seems to fix some weird bugs with NFS
    await fs.ensureFile(file)
    await log.info(`Récupération du fichier ${file}`)

    await pump(res.data, fs.createWriteStream(file))
    await log.info(`Fichier récupéré dans ${file}`)
  }
  await log.info(`Extraction de l'archive ${file}`)
  try {
    await exec(`unzip -o ${file} -d ${dir} `)
  } catch (err) {
    log.warning('Impossible d\'extraire l\'archive, le fichier est peut-être déjà extrait')
  }
  // remove the zip file
  await fs.remove(file)
  await log.info('Extraction terminée')
}
