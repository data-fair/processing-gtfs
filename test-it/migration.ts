import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'
import { migrateLegacyConfig } from '../lib/execute.ts'

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
    assert.equal(patches[0].datasets.length, 4)
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
    const config: any = { datasetMode: 'update', datasets: [{ key: 'stops', id: 'x' }], dataset: { id: 'kiceo' } }
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
