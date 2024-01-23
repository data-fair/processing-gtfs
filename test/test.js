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
        clearFiles: true,
        downloadZip: false,
        datasetMode: 'create',
        dataset: { title: 'GTFS Test' },
        url: 'https://cotesdarmor.transdev-bretagne.com/sites/default/files/2024-01/GTFS_Kicéo.zip'
      },
      tmpDir: 'data/'
    }, config, false)
    await gtfsProcessing.run(context)
  })
})
