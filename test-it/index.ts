import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'
import testUtils from '@data-fair/lib-processing-dev/tests-utils.js'
import processingSchema from '../processing-config-schema.json' with { type: 'json' }
import * as gtfsProcessing from '../index.ts'

// lib/config.ts refuses to load without a data-fair instance declared in
// config/local-test.mjs, which is gitignored: the integration test is then skipped
let config: any = null
try {
  config = (await import('../lib/config.ts')).default
} catch {
  config = null
}

describe('processing-gtfs', () => {
  it('expose son schéma de configuration', () => {
    assert.ok(processingSchema)
    assert.equal(processingSchema.type, 'object')
    assert.equal(processingSchema.layout, 'tabs')
  })

  it('expose les hooks attendus par la plateforme', () => {
    assert.equal(typeof gtfsProcessing.run, 'function')
    assert.equal(typeof gtfsProcessing.prepare, 'function')
    assert.equal(typeof gtfsProcessing.stop, 'function')
  })

  // Needs a real data-fair and the SFTP container from docker-compose.yml.
  // Declare the instance in config/local-test.mjs to enable it.
  it('crée les jeux de données demandés', { skip: !config?.dataFairUrl }, async () => {
    const context = testUtils.context({
      processingConfig: {
        datasetMode: 'create',
        datasetTitle: 'GTFS Test',
        resources: { metadata: true, stops: true, stopTimes: true, shapes: true },
        url: 'sftp://localhost:2222/upload/gtfs-gp.zip',
        username: 'test',
        clearFiles: true,
        downloadZip: true
      },
      secrets: { password: 'testmotdepasse' }
    }, config, false)

    await gtfsProcessing.run(context as any)

    const datasets = (context.processingConfig as any).datasets
    assert.equal(context.processingConfig.datasetMode, 'update')
    assert.equal(datasets.length, 4)
    assert.deepEqual(datasets.map((d: any) => d.key).sort(), ['metadata', 'shapes', 'stop-times', 'stops'])
    for (const dataset of datasets) assert.ok(dataset.id, `${dataset.key} doit avoir un identifiant`)
  })
})
