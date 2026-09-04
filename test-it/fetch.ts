import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'
import { fetchFTP, fetchFile, ftpAccessOptions, FileNotFoundError } from '../lib/fetch.ts'

describe('ftpAccessOptions', () => {
  it('ftp sans identifiants veut dire anonyme', () => {
    const opts = ftpAccessOptions(new URL('ftp://ftp.example.fr/gtfs.zip'), {})
    assert.equal(opts.host, 'ftp.example.fr')
    assert.equal(opts.port, 21)
    assert.equal(opts.user, 'anonymous')
    assert.equal(opts.secure, false)
  })

  it('ftp avec port et identifiants explicites', () => {
    const opts = ftpAccessOptions(new URL('ftp://ftp.example.fr:2121/upload/gtfs.zip'), { username: 'test', password: 'secret' })
    assert.equal(opts.port, 2121)
    assert.equal(opts.user, 'test')
    assert.equal(opts.password, 'secret')
    assert.equal(opts.secure, false)
  })

  it('ftps sans port veut dire explicite sur 21', () => {
    const opts = ftpAccessOptions(new URL('ftps://ftp.example.fr/gtfs.zip'), { username: 'test', password: 'secret' })
    assert.equal(opts.port, 21)
    assert.equal(opts.secure, true)
  })

  it('ftps sur 990 veut dire implicite', () => {
    const opts = ftpAccessOptions(new URL('ftps://ftp.example.fr:990/gtfs.zip'), { username: 'test', password: 'secret' })
    assert.equal(opts.port, 990)
    assert.equal(opts.secure, 'implicit')
  })

  it('ftps avec port personnalisé reste explicite', () => {
    const opts = ftpAccessOptions(new URL('ftps://ftp.example.fr:2121/gtfs.zip'), { username: 'test', password: 'secret' })
    assert.equal(opts.port, 2121)
    assert.equal(opts.secure, true)
  })

  it('reprend le userinfo de l’URL en fallback', () => {
    const opts = ftpAccessOptions(new URL('ftp://bob:s3cr3t@ftp.example.fr/gtfs.zip'), {})
    assert.equal(opts.user, 'bob')
    assert.equal(opts.password, 's3cr3t')
  })
})

describe('fetchFTP', () => {
  it('télécharge vers le fichier demandé avec le chemin décodé', async () => {
    const calls: Array<[string, string]> = []
    const fakeClient: any = {
      downloadTo: async (local: string, remote: string) => { calls.push([local, remote]) },
      close: () => { throw new Error('ne doit pas fermer un client réutilisé') }
    }
    await fetchFTP(new URL('ftp://ftp.example.fr/upload/mon%20fichier.zip'), { username: 'test', password: 'secret' }, '/tmp/gtfs.zip', fakeClient)
    assert.deepEqual(calls, [['/tmp/gtfs.zip', '/upload/mon fichier.zip']])
  })

  it('convertit une 550 en FileNotFoundError', async () => {
    const fakeClient: any = {
      downloadTo: async () => {
        const err: any = new Error('550 File unavailable')
        err.code = 550
        throw err
      },
      close: async () => {}
    }
    await assert.rejects(
      () => fetchFTP(new URL('ftp://ftp.example.fr/absent.zip'), {}, '/tmp/gtfs.zip', fakeClient),
      (err: any) => err instanceof FileNotFoundError && /introuvable/.test(err.message)
    )
  })

  it('laisse passer les autres erreurs FTP', async () => {
    const fakeClient: any = {
      downloadTo: async () => { throw new Error('530 Login incorrect') },
      close: async () => {}
    }
    await assert.rejects(() => fetchFTP(new URL('ftp://ftp.example.fr/gtfs.zip'), {}, '/tmp/gtfs.zip', fakeClient), /530/)
  })
})

describe('fetchFile', () => {
  it('rejette un protocole inconnu en listant FTP et FTPS', async () => {
    await assert.rejects(
      () => fetchFile(new URL('gopher://example.fr/gtfs.zip'), {}, '/tmp/gtfs.zip', {} as any),
      /FTP, FTPS et SFTP/
    )
  })
})
