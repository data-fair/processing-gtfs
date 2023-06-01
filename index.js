const download = require('./lib/download')
const process = require('./lib/process')
const upload = require('./lib/upload')

exports.run = async ({ processingConfig, tmpDir, axios, log, patchConfig }) => {
  await log.step('Configuration')
  await log.info(`Fichier à traiter : ${processingConfig.url}`)

  await download(processingConfig, tmpDir, axios, log)
  await process(tmpDir, log)
  await upload(processingConfig, tmpDir, axios, log)
}
