import { strict as assert } from 'node:assert'
import { describe, it, before, after } from 'node:test'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import fs from 'fs-extra'
import { DEFAULT_VALIDATOR_URL, logValidation, summarize, validateZip, type ValidatorResult } from '../lib/validate.ts'
import fixture from './resources/validator-result.json' with { type: 'json' }

const noopLog = () => {}
const recordingLog = () => {
  const lines: Record<string, string[]> = { step: [], info: [], warning: [], error: [], debug: [] }
  return {
    lines,
    log: {
      step: async (msg: string) => { lines.step.push(msg) },
      info: async (msg: string) => { lines.info.push(msg) },
      warning: async (msg: string) => { lines.warning.push(msg) },
      error: async (msg: string) => { lines.error.push(msg) },
      debug: async (msg: string) => { lines.debug.push(msg) },
      task: noopLog,
      progress: noopLog
    }
  }
}

describe('summarize', () => {
  it('compte par sévérité d\'après les totaux, même quand le détail est tronqué', () => {
    const summary = summarize(fixture as ValidatorResult)
    assert.deepEqual(summary.counts, { Fatal: 0, Error: 1, Warning: 181, Information: 4 })
    assert.equal(summary.startDate, '2026-01-01')
    assert.equal(summary.endDate, '2026-12-31')
    assert.deepEqual(summary.networks, ['Réseau Test'])
    assert.deepEqual(summary.modes, ['bus', 'tramway'])
  })

  it('résiste à un résultat vide', () => {
    const summary = summarize({})
    assert.deepEqual(summary.counts, { Fatal: 0, Error: 0, Warning: 0, Information: 0 })
    assert.equal(summary.startDate, undefined)
    assert.deepEqual(summary.networks, [])
  })
})

describe('validateZip', () => {
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', chunk => chunks.push(chunk))
    req.on('end', () => {
      assert.equal(req.method, 'POST')
      assert.match(req.headers['content-type'] ?? '', /^application\/zip/)
      assert.ok(chunks.length > 0, 'le corps de la requête contient l\'archive')
      if (req.url.includes('max_issues=')) {
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify(fixture))
      } else {
        res.statusCode = 400
        res.end('max_issues manquant')
      }
    })
  })
  let url = ''
  let zipPath = ''

  before(async () => {
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    assert.ok(address && typeof address === 'object')
    url = `http://127.0.0.1:${address.port}/validate`
    zipPath = path.join(os.tmpdir(), `validate-test-${process.pid}.zip`)
    await fs.writeFile(zipPath, 'contenu zip de test')
  })

  after(async () => {
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
    await fs.remove(zipPath)
  })

  it('envoie l\'archive en POST et retourne le résultat du validateur', async () => {
    const result = await validateZip(zipPath, { validatorUrl: url, maxIssues: 1000 })
    assert.deepEqual(result, fixture)
  })

  it('propage l\'erreur du validateur', async () => {
    await assert.rejects(
      () => validateZip(zipPath, { validatorUrl: url }),
      /400/
    )
  })
})

describe('logValidation', () => {
  it('écrit le résumé dans le journal, détail des types en debug', async () => {
    const { lines, log } = recordingLog()
    await logValidation(fixture as ValidatorResult, summarize(fixture as ValidatorResult), log)
    assert.equal(lines.step.length, 0)
    assert.ok(lines.info.some(msg => msg.includes('0 anomalies fatales, 1 erreurs, 181 avertissements, 4 informations')))
    assert.ok(lines.info.some(msg => msg.includes('du 2026-01-01 au 2026-12-31')))
    assert.ok(lines.info.some(msg => msg.includes('Réseaux : Réseau Test')))
    assert.ok(lines.info.some(msg => msg.includes('Modes : bus, tramway')))
    assert.ok(lines.info.includes('IdNotAscii (Warning) : 171'))
    assert.ok(lines.info.includes('MissingName (Error) : 1'))
    // détail tronqué à 3 entrées par type alors que le type en compte 171
    assert.equal(lines.debug.filter(msg => msg.startsWith('IdNotAscii')).length, 2)
  })

  it('classe les types par sévérité puis par nombre décroissant', async () => {
    const { lines, log } = recordingLog()
    await logValidation({ metadata: { issues_count: fixture.metadata.issues_count }, validations: fixture.validations }, summarize({ metadata: { issues_count: fixture.metadata.issues_count }, validations: fixture.validations }), log)
    const typeLines = lines.info.filter(msg => / \((Fatal|Error|Warning|Information)\) : /.test(msg))
    assert.deepEqual(typeLines, [
      'MissingName (Error) : 1',
      'IdNotAscii (Warning) : 171',
      'NullDuration (Warning) : 10',
      'UnusedStop (Information) : 4'
    ])
  })

  it('URL du validateur par défaut : instance publique transport.data.gouv.fr', () => {
    assert.equal(DEFAULT_VALIDATOR_URL, 'https://validation.transport.data.gouv.fr/validate')
  })
})
