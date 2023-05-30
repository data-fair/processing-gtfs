process.env.NODE_ENV = 'test'
const config = require('config')
const testUtils = require('@data-fair/processings-test-utils')
const { download } = require('../lib/download.js')

describe('Download', function () {
  it('should download a zip', async function () {
    const context = testUtils.context({
      pluginConfig: {

      },
      processingConfig: {
        url: 'https://transport-data-gouv-fr-resource-history-prod.cellar-c2.services.clever-cloud.com/80581/80581.20230120.061118.114098.zip'
      },
      tmpDir: 'data/'
    }, config, false)
    await download(context.processingConfig, context.tmpDir, context.axios, context.log)
  })
})
