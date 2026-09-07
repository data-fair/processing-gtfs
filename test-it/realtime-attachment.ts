import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'
import { REALTIME_ATTACHMENT_NAME, uploadRealtimeAttachment } from '../lib/upload.ts'

const noopLog: any = {
  step: async () => {},
  info: async () => {},
  warning: async () => {},
  error: async () => {},
  debug: async () => {},
  task: async () => {},
  progress: async () => {}
}

const ref = { key: 'metadata' as const, id: 'kiceo', title: 'Kicéo - métadonnées' }

describe('pièce jointe GTFS-RT', () => {
  it('déclare une pièce jointe distante en remplaçant une entrée existante', async () => {
    const patches: any[] = []
    const axios: any = {
      get: async () => ({
        data: {
          attachments: [
            { type: 'file', name: 'gtfs.zip', title: 'gtfs.zip' },
            { type: 'remoteFile', name: REALTIME_ATTACHMENT_NAME, title: 'ancien titre' }
          ]
        }
      }),
      patch: async (url: string, body: any) => { patches.push(body) }
    }

    await uploadRealtimeAttachment(axios, ref, 'https://exemple.invalid/rt', noopLog)

    assert.equal(patches.length, 1)
    const attachments = patches[0].attachments
    assert.equal(attachments.length, 2)
    const rt = attachments.find((a: any) => a.name === REALTIME_ATTACHMENT_NAME)
    assert.equal(rt.type, 'remoteFile')
    assert.equal(rt.targetUrl, 'https://exemple.invalid/rt')
    // la pièce jointe fichier est conservée telle quelle
    assert.deepEqual(attachments.find((a: any) => a.name === 'gtfs.zip'), { type: 'file', name: 'gtfs.zip', title: 'gtfs.zip' })
  })

  it('ajoute simplement la pièce jointe sur un jeu sans attachement', async () => {
    const patches: any[] = []
    const axios: any = {
      get: async () => ({ data: {} }),
      patch: async (url: string, body: any) => { patches.push(body) }
    }

    await uploadRealtimeAttachment(axios, ref, 'https://exemple.invalid/rt', noopLog)

    assert.equal(patches[0].attachments.length, 1)
    assert.equal(patches[0].attachments[0].targetUrl, 'https://exemple.invalid/rt')
  })

  it('échoue avec un message lisible si data-fair refuse le patch', async () => {
    const axios: any = {
      get: async () => ({ data: {} }),
      patch: async () => {
        const err: any = new Error('Bad Request')
        err.response = { status: 400, data: 'attachments cannot be added while integrity is active' }
        throw err
      }
    }

    await assert.rejects(
      () => uploadRealtimeAttachment(axios, ref, 'https://exemple.invalid/rt', noopLog),
      /Échec de la déclaration de la pièce jointe distante.*integrity/
    )
  })
})
