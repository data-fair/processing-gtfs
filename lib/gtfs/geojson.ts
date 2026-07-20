import fs from 'fs-extra'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'

export interface Feature {
  type: 'Feature'
  properties: Record<string, string>
  geometry: { type: 'Point', coordinates: [number, number] } | { type: 'LineString', coordinates: [number, number][] }
}

/**
 * Write a FeatureCollection without ever holding it whole in memory: large networks
 * produce tens of thousands of features and the collection is only ever streamed to disk.
 */
export const writeFeatureCollection = async (file: string, features: Iterable<Feature> | AsyncIterable<Feature>) => {
  async function * chunks () {
    yield '{"type":"FeatureCollection","features":['
    let first = true
    for await (const feature of features) {
      yield (first ? '' : ',') + JSON.stringify(feature)
      first = false
    }
    yield ']}'
  }
  await pipeline(Readable.from(chunks()), fs.createWriteStream(file, { encoding: 'utf8' }))
}
