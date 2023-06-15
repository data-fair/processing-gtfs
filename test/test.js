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
        dataset: { title: 'GTFS Test Kiceo' },
        url: 'https://ratpdev-mosaic-prod-bucket-raw.s3-eu-west-1.amazonaws.com/21/exports/1/gtfs.zip'
      },
      tmpDir: 'data/'
    }, config, false)
    await gtfsProcessing.run(context)
  })
})
