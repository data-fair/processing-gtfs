import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'
import testUtils from '@data-fair/lib-processing-dev/tests-utils.js'
import processingSchema from '../processing-config-schema.json' with { type: 'json' }
import * as gtfsProcessing from '../index.ts'

// #config refuses to load without a data-fair instance declared in
// config/local-test.mjs, which is gitignored: the integration test is then skipped
let config: any = null
try {
  config = (await import('#config')).default
} catch {
  config = null
}

describe('processing-gtfs', () => {
  it('expose son schéma de configuration', () => {
    assert.ok(processingSchema)
    assert.equal(processingSchema.type, 'object')
    assert.equal(processingSchema.layout, 'tabs')
  })

  it('liste les jeux à mettre à jour dans la forme que la plateforme sait lire', () => {
    // processings ne relie un traitement à ses jeux que par un objet `dataset`, à la
    // racine de la configuration ou dans chaque entrée d'un tableau `datasets`
    const updateBranch = (processingSchema.allOf as any[])[2].allOf[0].then.oneOf[1]
    const datasets = updateBranch.properties.datasets
    assert.equal(datasets.type, 'array')
    assert.deepEqual(datasets.items.required, ['resource'])
    assert.ok(datasets.items.properties.dataset)
    // les rôles proposés sont ceux que la création sait produire
    const created = (processingSchema.allOf as any[])[2].allOf[0].then.oneOf[0].properties.resources.items.oneOf
    assert.deepEqual(
      datasets.items.properties.resource.oneOf.map((role: any) => role.const),
      created.map((role: any) => role.const)
    )
    // une ligne par rôle, ni ajoutée ni supprimée dans le formulaire : le rôle est en
    // lecture seule, seul le jeu de données se choisit
    assert.deepEqual(datasets.default.map((entry: any) => entry.resource), created.map((role: any) => role.const))
    assert.deepEqual(datasets.layout.listActions, [])
    assert.equal(datasets.items.properties.resource.layout.props.readonly, true)
  })

  it('lit la liste des jeux configurés et la réécrit à l\'identique', async () => {
    const { refsFromConfig, datasetsFromRefs } = await import('../lib/execute.ts')
    const refs = [{ key: 'metadata', id: 'ds1', title: 'GTFS' }, { key: 'stops', id: 'ds2', title: 'Arrêts' }]
    // quel que soit l'ordre dans la configuration, les rôles reviennent dans l'ordre de production
    assert.deepEqual(refsFromConfig([
      { resource: 'stops', dataset: { id: 'ds2', title: 'Arrêts' } },
      { resource: 'metadata', dataset: { id: 'ds1', title: 'GTFS' } }
    ]), refs)
    // une ligne dont le jeu n'est pas renseigné ne produit rien
    assert.deepEqual(refsFromConfig([{ resource: 'metadata', dataset: { id: 'ds1', title: 'GTFS' } }, { resource: 'stops' }]), [refs[0]])
    assert.deepEqual(refsFromConfig(undefined), [])
    // la configuration écrite porte toutes les lignes, jeu de données ou non
    assert.deepEqual(datasetsFromRefs(refs as any), [
      { resource: 'metadata', dataset: { id: 'ds1', title: 'GTFS' } },
      { resource: 'stops', dataset: { id: 'ds2', title: 'Arrêts' } },
      { resource: 'stop-times' },
      { resource: 'shapes' }
    ])
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
        resources: ['metadata', 'stops', 'stop-times', 'shapes'],
        url: 'sftp://localhost:2222/upload/gtfs-gp.zip',
        username: 'test'
      },
      secrets: { password: 'testmotdepasse' }
    }, config, false)

    await gtfsProcessing.run(context as any)

    const datasets = (context.processingConfig as any).datasets as any[]
    assert.equal(context.processingConfig.datasetMode, 'update')
    assert.deepEqual(datasets.map(entry => entry.resource), ['metadata', 'stops', 'stop-times', 'shapes'])
    for (const entry of datasets) assert.ok(entry.dataset.id, `${entry.resource} doit avoir un identifiant`)
  })

  // Needs a real data-fair and the FTP container from docker-compose.yml.
  it('crée les jeux de données demandés depuis FTP', { skip: !config?.dataFairUrl }, async () => {
    const context = testUtils.context({
      processingConfig: {
        datasetMode: 'create',
        datasetTitle: 'GTFS Test FTP',
        resources: ['metadata', 'stops', 'stop-times', 'shapes'],
        url: 'ftp://localhost:2121/upload/gtfs-gp.zip',
        username: 'test'
      },
      secrets: { password: 'testmotdepasse' }
    }, config, false)

    await gtfsProcessing.run(context as any)

    const datasets = (context.processingConfig as any).datasets as any[]
    assert.equal(context.processingConfig.datasetMode, 'update')
    assert.deepEqual(datasets.map(entry => entry.resource), ['metadata', 'stops', 'stop-times', 'shapes'])
    for (const entry of datasets) assert.ok(entry.dataset.id, `${entry.resource} doit avoir un identifiant`)
  })

  // Needs a real data-fair (for the test context), the SFTP container, and access
  // to the public transport-validator instance.
  it('valide une archive sans produire de jeu de données', { skip: !config?.dataFairUrl }, async () => {
    const context = testUtils.context({
      processingConfig: {
        mode: 'validate',
        url: 'sftp://localhost:2222/upload/gtfs-gp.zip',
        username: 'test'
      },
      secrets: { password: 'testmotdepasse' }
    }, config, false)

    await gtfsProcessing.run(context as any)

    // aucun patchConfig : aucun jeu créé, datasetMode reste indéfini
    assert.equal(context.processingConfig.datasetMode, undefined)
    assert.equal((context.processingConfig as any).datasets, undefined)
  })
})
