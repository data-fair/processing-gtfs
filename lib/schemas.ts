export interface SchemaProperty {
  key: string
  title: string
  description?: string
  type: string
  format?: string
  separator?: string
  ignoreDetection?: boolean
  'x-refersTo'?: string
  'x-labels'?: Record<string, string>
  'x-capabilities'?: Record<string, boolean>
}

export type ResourceKey = 'metadata' | 'stops' | 'stop-times' | 'shapes'

export const RESOURCE_TITLES: Record<ResourceKey, string> = {
  metadata: 'métadonnées',
  stops: 'arrêts',
  'stop-times': 'horaires',
  shapes: 'tracés'
}

/** The file each data resource is built from, relative to the processing tmp dir. */
export const RESOURCE_FILES: Record<Exclude<ResourceKey, 'metadata'>, string> = {
  stops: 'stops.geojson',
  'stop-times': 'stop_times.csv',
  shapes: 'shapes.geojson'
}

const LABEL = 'http://www.w3.org/2000/01/rdf-schema#label'
const DESCRIPTION = 'http://schema.org/description'
const GEOMETRY = 'https://purl.org/geojson/vocab#geometry'
const WEB_PAGE = 'https://schema.org/WebPage'
const COLOR = 'https://schema.org/color'
const LATITUDE = 'http://schema.org/latitude'
const LONGITUDE = 'http://schema.org/longitude'
const START_DATE = 'https://schema.org/startDate'
const END_DATE = 'https://schema.org/endDate'

// GTFS types identifiers as ID, which is a string. Declaring them integer breaks every
// feed using alphanumeric ids, and ignoreDetection does not help: it suppresses
// detection, not the declared type.
const id = (key: string, title: string, description?: string): SchemaProperty =>
  ({ key, title, description, type: 'string', ignoreDetection: true })

const geometry: SchemaProperty = {
  key: 'geometry',
  title: 'Géométrie',
  type: 'string',
  'x-refersTo': GEOMETRY,
  'x-capabilities': { textAgg: false }
}

// the "undefined" key labels rows where the column is empty: data-fair looks labels up
// with `'' + value`, which turns a missing value into the string "undefined"
const locationType: SchemaProperty = {
  key: 'location_type',
  title: "Type d'emplacement",
  description: "Distingue un arrêt d'une station, d'un accès ou d'une zone d'embarquement.",
  type: 'integer',
  ignoreDetection: true,
  'x-labels': {
    undefined: 'Arrêt ou plateforme',
    0: 'Arrêt ou plateforme',
    1: 'Station',
    2: 'Entrée / sortie',
    3: 'Nœud générique',
    4: "Zone d'embarquement"
  }
}

const wheelchairBoarding: SchemaProperty = {
  key: 'wheelchair_boarding',
  title: 'Accès en fauteuil roulant',
  type: 'integer',
  ignoreDetection: true,
  'x-labels': {
    undefined: 'Information non disponible',
    0: 'Information non disponible',
    1: 'Accès possible pour au moins un passager en fauteuil roulant',
    2: 'Accès impossible'
  }
}

const bikesAllowed: SchemaProperty = {
  key: 'bikes_allowed',
  title: 'Accès avec un vélo',
  type: 'integer',
  ignoreDetection: true,
  'x-labels': {
    undefined: 'Information non disponible',
    0: 'Information non disponible',
    1: 'Accès possible pour au moins un passager avec un vélo',
    2: 'Accès impossible'
  }
}

const routeType: SchemaProperty = {
  key: 'route_type',
  title: 'Mode de transport',
  type: 'integer',
  // no x-labelsRestricted: the extended values below are an open list, a feed may
  // legitimately use one that is not labelled here, and it would then be rejected
  'x-labels': {
    undefined: 'Non renseigné',
    // basic types
    0: 'Tramway ou train léger',
    1: 'Métro',
    2: 'Train',
    3: 'Bus',
    4: 'Ferry',
    5: 'Tramway à câble',
    6: 'Téléphérique',
    7: 'Funiculaire',
    11: 'Trolleybus',
    12: 'Monorail',
    // extended types: widely used across European feeds, where a regional train
    // arrives as 106 and a metro as 401 rather than as 2 and 1
    100: 'Train',
    101: 'Train à grande vitesse',
    102: 'Train grandes lignes',
    103: 'Train interrégional',
    105: 'Train de nuit',
    106: 'Train régional',
    107: 'Train touristique',
    108: 'Navette ferroviaire',
    109: 'Train de banlieue',
    200: 'Autocar',
    201: 'Autocar international',
    202: 'Autocar national',
    204: 'Autocar régional',
    208: 'Autocar express',
    400: 'Train urbain',
    401: 'Métro',
    402: 'Métro souterrain',
    403: 'Train urbain',
    405: 'Monorail',
    700: 'Bus',
    701: 'Bus régional',
    702: 'Bus express',
    704: 'Bus local',
    715: 'Transport à la demande',
    717: 'Taxi collectif',
    800: 'Trolleybus',
    900: 'Tramway',
    1000: 'Transport fluvial',
    1100: 'Transport aérien',
    1200: 'Ferry',
    1300: 'Transport par câble',
    1400: 'Funiculaire',
    1500: 'Taxi',
    1501: 'Taxi communal',
    1700: 'Autre'
  }
}

// GTFS only states that the two values are opposite directions: which one is the
// outbound trip is up to the producer, so the labels must not claim more than that
const directionId: SchemaProperty = {
  key: 'direction_id',
  title: 'Sens de circulation',
  description: 'La correspondance entre le sens et la destination est définie par le producteur du GTFS.',
  type: 'integer',
  ignoreDetection: true,
  'x-labels': {
    undefined: 'Non renseigné',
    0: 'Sens 1',
    1: 'Sens 2'
  }
}

const routeColor: SchemaProperty = {
  key: 'route_color',
  title: 'Couleur de la ligne',
  description: 'Couleur officielle de la ligne, au format hexadécimal.',
  type: 'string',
  'x-refersTo': COLOR
}

export interface ConceptOverrides {
  /** URI of a private-vocabulary concept identifying a stop, applied to stop_id */
  stopConcept?: string
  /** URI of a private-vocabulary concept identifying a route */
  routeConcept?: string
}

const withConcept = (property: SchemaProperty, uri?: string): SchemaProperty =>
  uri ? { ...property, 'x-refersTo': uri } : property

export const buildSchemas = (concepts: ConceptOverrides = {}): Record<Exclude<ResourceKey, 'metadata'>, SchemaProperty[]> => ({
  stops: [
    geometry,
    withConcept(id('stop_id', "Identifiant de l'arrêt"), concepts.stopConcept),
    { key: 'stop_code', title: "Code de l'arrêt", description: 'Code court communiqué aux voyageurs.', type: 'string' },
    { key: 'stop_name', title: "Nom de l'arrêt", type: 'string', 'x-refersTo': LABEL },
    { key: 'stop_desc', title: "Description de l'arrêt", type: 'string', 'x-refersTo': DESCRIPTION },
    id('zone_id', 'Identifiant de la zone tarifaire'),
    { key: 'stop_url', title: "Page de l'arrêt", type: 'string', 'x-refersTo': WEB_PAGE },
    withConcept({ key: 'routes', title: 'Lignes desservies', type: 'string', separator: ';' }, concepts.routeConcept),
    locationType,
    id('parent_station', 'Emplacement parent', "Identifiant de la station à laquelle l'emplacement appartient."),
    { key: 'stop_timezone', title: 'Fuseau horaire', description: "Hérité de l'emplacement parent lorsqu'il est vide.", type: 'string' },
    wheelchairBoarding
  ],
  'stop-times': [
    id('trip_id', 'Identifiant de la course'),
    { key: 'arrival_time', title: 'Arrivée', description: 'Peut dépasser 24:00:00 pour un service qui se poursuit après minuit.', type: 'string' },
    { key: 'departure_time', title: 'Départ', description: 'Peut dépasser 24:00:00 pour un service qui se poursuit après minuit.', type: 'string' },
    withConcept(id('stop_id', "Identifiant de l'arrêt"), concepts.stopConcept),
    { key: 'stop_name', title: "Nom de l'arrêt", type: 'string', 'x-refersTo': LABEL },
    { key: 'stop_sequence', title: "Rang de l'arrêt", description: 'Ordre de desserte au sein de la course.', type: 'integer', ignoreDetection: true },
    { key: 'stop_origin', title: 'Origine', description: 'Premier arrêt de la course.', type: 'string' },
    { key: 'stop_destination', title: 'Destination', description: 'Dernier arrêt de la course.', type: 'string' },
    { key: 'route_name', title: 'Ligne', type: 'string' },
    routeColor,
    directionId,
    {
      key: 'timepoint',
      title: 'Précision de l\'horaire',
      type: 'integer',
      ignoreDetection: true,
      // an empty timepoint means the time is exact, per the GTFS spec
      'x-labels': {
        undefined: 'Horaire garanti',
        0: 'Horaire approximatif',
        1: 'Horaire garanti'
      }
    },
    { key: 'week', title: 'Jours de circulation', type: 'string', separator: ';' },
    { key: 'start_date', title: 'Début de validité', type: 'string', format: 'date', 'x-refersTo': START_DATE },
    { key: 'end_date', title: 'Fin de validité', type: 'string', format: 'date', 'x-refersTo': END_DATE },
    { key: 'stop_lat', title: "Latitude de l'arrêt", type: 'number', 'x-refersTo': LATITUDE },
    { key: 'stop_lng', title: "Longitude de l'arrêt", type: 'number', 'x-refersTo': LONGITUDE },
    locationType,
    wheelchairBoarding,
    {
      key: 'pickup_type',
      title: 'Modalité de montée',
      type: 'integer',
      ignoreDetection: true,
      'x-labels': {
        undefined: 'Montée régulière',
        0: 'Montée régulière',
        1: 'Aucune montée possible',
        2: "Montée sur réservation auprès de l'agence",
        3: 'Montée sur demande auprès du conducteur'
      }
    },
    {
      key: 'drop_off_type',
      title: 'Modalité de descente',
      type: 'integer',
      ignoreDetection: true,
      'x-labels': {
        undefined: 'Descente régulière',
        0: 'Descente régulière',
        1: 'Aucune descente possible',
        2: "Descente sur réservation auprès de l'agence",
        3: 'Descente sur demande auprès du conducteur'
      }
    }
  ],
  shapes: [
    geometry,
    id('shape_id', 'Identifiant du tracé'),
    id('route_id', 'Identifiant de la ligne'),
    withConcept({ key: 'route_short_name', title: 'Nom court de la ligne', type: 'string' }, concepts.routeConcept),
    { key: 'route_long_name', title: 'Nom complet de la ligne', type: 'string', 'x-refersTo': LABEL },
    { key: 'route_desc', title: 'Description de la ligne', type: 'string', 'x-refersTo': DESCRIPTION },
    routeType,
    routeColor,
    directionId,
    wheelchairBoarding,
    bikesAllowed
  ]
})

/**
 * Properties data-fair considers innocuous, so they can be refreshed on an existing
 * dataset without breaking its schema. Everything else (types, concepts, x-transform
 * patches applied by hand) is left untouched.
 */
export const REFRESHABLE_PROPS = ['title', 'description', 'x-labels'] as const
