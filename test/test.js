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
        downloadZip: true,
        datasetMode: 'create',
        dataset: { title: 'GTFS Test' },
        url: 'https://koumoul.com/static/gtfs-gp.zip'
      },
      tmpDir: 'data/'
    }, config, false)
    await gtfsProcessing.run(context)
  })
})
