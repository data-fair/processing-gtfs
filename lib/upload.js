const FormData = require('form-data')
const path = require('path')
const fs = require('fs-extra')
const util = require('util')
const mime = require('mime-types')
const { schemas, names } = require('./data.js')

function displayBytes (aSize) {
  aSize = Math.abs(parseInt(aSize, 10))
  if (aSize === 0) return '0 octets'
  const def = [[1, 'octets'], [1000, 'ko'], [1000 * 1000, 'Mo'], [1000 * 1000 * 1000, 'Go'], [1000 * 1000 * 1000 * 1000, 'To'], [1000 * 1000 * 1000 * 1000 * 1000, 'Po']]
  for (let i = 0; i < def.length; i++) {
    if (aSize < def[i][0]) return (aSize / def[i - 1][0]).toLocaleString() + ' ' + def[i - 1][1]
  }
}

module.exports = async (processingConfig, tmpDir, axios, log) => {
  if (processingConfig.datasetMode === 'update') {
    await log.step('Mise à jour du jeu de données')
  } else {
    await log.step('Création du jeu de données')
  }

  let dataset
  const files = await fs.readdir(tmpDir)
  const attachments = []
  await log.info(`Nombre de fichiers à traiter : ${files.length}`)

  for (const file of files) {
    if (file.includes('.csv')) {
      await log.info(`Chargement du fichier ${file}`)
      const formData = new FormData()
      const id = file.split('.')[0]
      const datasetSchema = schemas[id]
      formData.append('schema', JSON.stringify(datasetSchema))
      formData.append('title', processingConfig.dataset.title + ' - ' + id)
      const filePath = path.join(tmpDir, file)
      formData.append('dataset', fs.createReadStream(filePath), { filename: processingConfig.dataset.title + '-' + file })
      formData.getLength = util.promisify(formData.getLength)
      const contentLength = await formData.getLength()
      await log.info(`chargement de ${displayBytes(contentLength)}`)
      try {
        dataset = (await axios({
          method: 'post',
          url: (processingConfig.dataset && processingConfig.dataset.id) ? `api/v1/datasets/${processingConfig.dataset.id}-${names[id]}` : 'api/v1/datasets',
          data: formData,
          maxContentLength: Infinity,
          maxBodyLength: Infinity,
          headers: { ...formData.getHeaders(), 'content-length': contentLength }
        })).data
      } catch (err) {
        throw new Error(JSON.stringify(err))
      }
      if (processingConfig.datasetMode === 'update') {
        await log.info(`jeu de donnée mis à jour, id="${dataset.id}", title="${dataset.title}"`)
      } else {
        await log.info(`jeu de donnée créé, id="${dataset.id}", title="${dataset.title}"`)
      }
    } else {
      attachments.push(file)
    }
  }

  const baseDataset = {
    isMetaOnly: true,
    description: '',
    origin: '',
    license: {
      title: 'Licence Ouverte / Open Licence',
      href: 'https://www.etalab.gouv.fr/licence-ouverte-open-licence'
    },
    extras: {}
  }

  const body = {
    ...baseDataset,
    title: processingConfig.dataset.title
  }

  let metaDataset
  if (processingConfig.datasetMode === 'create') {
    if (processingConfig.dataset.id) {
      try {
        await axios.get(`api/v1/datasets/${processingConfig.dataset.id}`)
        throw new Error('le jeu de données existe déjà')
      } catch (err) {
        if (err.status !== 404) throw err
      }
      // permet de créer le jeu de donnée éditable avec l'identifiant spécifié
      metaDataset = (await axios.put('api/v1/datasets/' + processingConfig.dataset.id, body)).data
    } else {
      // si aucun identifiant n'est spécifié, on créer le dataset juste à partir de son nom
      metaDataset = (await axios.post('api/v1/datasets', body)).data
    }
    await log.info(`jeu de donnée créé, id="${metaDataset.id}", title="${metaDataset.title}"`)
  } else if (processingConfig.datasetMode === 'update') {
    // permet de vérifier l'existance du jeu de donnée avant de réaliser des opérations dessus
    try {
      metaDataset = (await axios.get(`api/v1/datasets/${processingConfig.dataset.id}`)).data
      await log.info(`le jeu de donnée existe, id="${metaDataset.id}", title="${metaDataset.title}"`)
    } catch (err) {
      if (!metaDataset) throw new Error(`le jeu de données n'existe pas, id="${processingConfig.dataset.id}"`)
    }
  }

  for (const file of attachments) {
    const filePath = path.join(tmpDir, file)
    const newFile = {}
    newFile.type = 'file'
    newFile.title = file
    newFile.name = filePath.base
    newFile.size = await fs.stat(path.join(tmpDir, filePath)).size
    newFile.mimetype = mime.lookup(filePath.base)
    newFile.updatedAt = new Date().toISOString()

    await log.info('Chargement de la pièce jointe ' + newFile.title)
    const formData = new FormData()
    formData.append('title', newFile.title)
    formData.append('attachment', fs.createReadStream(filePath), { filename: newFile.name })
    formData.getLength = util.promisify(formData.getLength)
    const contentLength = await formData.getLength()
    await log.info(`chargement de ${displayBytes(contentLength)}`)
    await axios({
      method: 'post',
      url: `api/v1/datasets/${processingConfig.dataset.id}/metadata-attachments`,
      data: formData,
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
      headers: { ...formData.getHeaders(), 'content-length': contentLength }
    })
  }
  if (processingConfig.clearFiles) {
    await fs.remove(tmpDir)
  }
}
