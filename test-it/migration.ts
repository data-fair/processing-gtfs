import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'
import { baseDatasetTitle, migrateLegacyConfig, wantedFromResources } from '../lib/execute.ts'

const noopLog: any = {
  step: async () => {},
  info: async () => {},
  warning: async () => {},
  error: async () => {},
  debug: async () => {},
  task: async () => {},
  progress: async () => {}
}

/** Stub standing in for data-fair: only the listed ids exist. */
const fakeAxios = (existing: Record<string, string>): any => ({
  get: async (url: string) => {
    const id = url.replace('api/v1/datasets/', '')
    if (!(id in existing)) {
      const err: any = new Error('Not found')
      err.response = { status: 404 }
      throw err
    }
    return { data: { id, title: existing[id] } }
  }
})

// @deprecated v0.3.10 compatibility: this whole suite goes with migrateLegacyConfig
// at the next major
describe('migration depuis la configuration héritée', () => {
  it('retrouve les quatre jeux dérivés et réécrit la configuration', async () => {
    const config: any = { datasetMode: 'update', dataset: { id: 'kiceo', title: 'Kicéo' } }
    const patches: any[] = []
    const axios = fakeAxios({
      kiceo: 'Kicéo',
      'kiceo-stops': 'Kicéo - stops',
      'kiceo-stop-times': 'Kicéo - stop-times',
      'kiceo-shapes': 'Kicéo - shapes'
    })

    const refs = await migrateLegacyConfig(config, axios, noopLog, async (p: any) => { patches.push(p) })

    assert.equal(refs?.length, 4)
    assert.deepEqual(refs?.map(r => r.key), ['metadata', 'stops', 'stop-times', 'shapes'])
    assert.deepEqual(refs?.map(r => r.id), ['kiceo', 'kiceo-stops', 'kiceo-stop-times', 'kiceo-shapes'])
    // le titre vient du live, pas de l'ancienne configuration
    assert.equal(refs?.[1].title, 'Kicéo - stops')
    assert.equal(patches.length, 1)
    assert.equal(patches[0].datasetMode, 'update')
    assert.deepEqual(Object.keys(patches[0].datasets), ['metadata', 'stops', 'stop-times', 'shapes'])
    assert.deepEqual(patches[0].datasets.stops, { id: 'kiceo-stops', title: 'Kicéo - stops' })
  })

  it('ignore les jeux qui n\'existent plus au lieu de les inventer', async () => {
    const config: any = { datasetMode: 'update', dataset: { id: 'kiceo' } }
    const axios = fakeAxios({ kiceo: 'Kicéo', 'kiceo-stops': 'Kicéo - stops' })

    const refs = await migrateLegacyConfig(config, axios, noopLog, async () => {})

    assert.deepEqual(refs?.map(r => r.key), ['metadata', 'stops'])
  })

  it('échoue plutôt que de repartir de zéro si plus rien n\'existe', async () => {
    const config: any = { datasetMode: 'update', dataset: { id: 'disparu' } }
    await assert.rejects(
      () => migrateLegacyConfig(config, fakeAxios({}), noopLog, async () => {}),
      /Aucun jeu de données n'a été retrouvé/
    )
  })

  it('ne touche pas à une configuration déjà migrée', async () => {
    const config: any = { datasetMode: 'update', datasets: { stops: { id: 'x' } }, dataset: { id: 'kiceo' } }
    const patches: any[] = []
    const refs = await migrateLegacyConfig(config, fakeAxios({}), noopLog, async (p: any) => { patches.push(p) })
    assert.equal(refs, null)
    assert.equal(patches.length, 0)
  })

  it('ne fait rien sur une configuration neuve', async () => {
    const config: any = { datasetMode: 'create', datasetTitle: 'Neuf' }
    assert.equal(await migrateLegacyConfig(config, fakeAxios({}), noopLog, async () => {}), null)
  })

  it('ne masque pas une panne réseau en jeu absent', async () => {
    const axios: any = {
      get: async () => {
        const err: any = new Error('Service Unavailable')
        err.response = { status: 503, data: 'upstream down' }
        throw err
      }
    }
    const config: any = { datasetMode: 'update', dataset: { id: 'kiceo' } }
    await assert.rejects(
      () => migrateLegacyConfig(config, axios, noopLog, async () => {}),
      /upstream down/
    )
  })
})

describe('jeux à produire en mode création', () => {
  it('respecte la sélection, dans l\'ordre de production', () => {
    assert.deepEqual(wantedFromResources(['shapes', 'metadata']), ['metadata', 'shapes'])
  })

  // @deprecated v0.3.10 compatibility
  it('produit les quatre jeux quand la configuration est antérieure aux rôles', () => {
    // la version publiée ne connaissait pas resources et créait toujours les quatre jeux
    assert.deepEqual(wantedFromResources(undefined), ['metadata', 'stops', 'stop-times', 'shapes'])
  })

  it('ne produit rien sur une sélection explicitement vide', () => {
    assert.deepEqual(wantedFromResources([]), [])
  })
})

describe('titre de base des jeux créés', () => {
  it('prend le titre du formulaire actuel', () => {
    assert.equal(baseDatasetTitle({ datasetTitle: 'Kicéo' }), 'Kicéo')
  })

  // @deprecated v0.3.10 compatibility
  it("reprend le titre imbriqué d'une configuration publiée", () => {
    assert.equal(baseDatasetTitle({ datasetMode: 'create', dataset: { title: 'Kicéo' } }), 'Kicéo')
  })

  it('ne fabrique pas un titre « undefined » quand il n\'y en a aucun', () => {
    assert.equal(baseDatasetTitle({}), 'GTFS')
  })
})
