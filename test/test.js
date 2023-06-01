process.env.NODE_ENV = 'test'
const config = require('config')
const testUtils = require('@data-fair/processings-test-utils')
const gtfsProcessing = require('../')

describe('GTFS', function () {
  it('should create 4 datasets on the staging', async function () {
    this.timeout(100000)
    const context = testUtils.context({
      pluginConfig: {

      },
      processingConfig: {
        clearFiles: false,
        datasetMode: 'create',
        dataset: { title: 'GTFS Test', id: 'gtfs-test' },
        url: 'https://transport-data-gouv-fr-resource-history-prod.cellar-c2.services.clever-cloud.com/80581/80581.20230120.061118.114098.zip'
      },
      tmpDir: 'data/'
    }, config, false)
    await gtfsProcessing.run(context)
  })
})
