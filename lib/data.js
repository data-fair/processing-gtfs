const trip_id = {
  key: 'trip_id',
  title: 'Identifiant trajet',
  description: 'Identifiant du trajet',
  type: 'integer',
  ignoreDetection: true
}

const arrival_time = {
  key: 'arrival_time',
  title: "Heure d'arrivée",
  description: "Heure d'arrivée à l'arrêt",
  type: 'string'
}

const departure_time = {
  key: 'departure_time',
  title: 'Heure de départ',
  description: "Heure de départ de l'arrêt",
  type: 'string'
}

const stop_sequence = {
  key: 'stop_sequence',
  title: "Séquence de l'arrêt",
  description: 'Ordre des arrêts pour un trajet',
  type: 'integer'
}

const stop_headsign = {
  key: 'stop_headsign',
  title: 'Destination',
  description: "Destination de l'arrêt",
  type: 'string'
}

const pickup_type = {
  key: 'pickup_type',
  title: 'Méthode de ramassage',
  description: 'Méthode de ramassage',
  type: 'integer',
  'x-labels': {
    undefined: 'Ramassage programmé régulièrement',
    0: 'Ramassage programmé régulièrement',
    1: 'Aucun ramassage disponible',
    2: "Ramassage disponible sur demande par téléphone à l'agance",
    3: 'Ramassage disponible sur demande auprès du conducteur'
  }
}

const drop_off_type = {
  key: 'drop_off_type',
  title: 'Méthode de dépose',
  description: 'Méthode de dépose',
  type: 'integer',
  'x-labels': {
    undefined: 'Dépose programmée régulièrement',
    0: 'Dépose programmée régulièrement',
    1: 'Aucune dépose disponible',
    2: "Dépose disponible sur demande par téléphone à l'agance",
    3: 'Dépose disponible sur demande auprès du conducteur'
  }
}

const shape_dist_traveled = {
  key: 'shape_dist_traveled',
  title: 'Distance parcourue',
  description: 'Distance parcourue',
  type: 'number'
}

const shape_id = {
  key: 'shape_id',
  title: 'Identifiant de la forme',
  description: 'Identifiant de la forme',
  type: 'integer',
  ignoreDetection: true
}

const shape_pt_lat = {
  key: 'shape_pt_lat',
  title: 'Latitude',
  description: 'Latitude du point de forme',
  type: 'number'
}

const shape_pt_lon = {
  key: 'shape_pt_lon',
  title: 'Longitude',
  description: 'Longitude du point de forme',
  type: 'number'
}

const shape_pt_sequence = {
  key: 'shape_pt_sequence',
  title: 'Séquence des points de forme',
  description: 'Ordre dans lequel les points de forme se connectent pour former la forme',
  type: 'integer'
}

const stop_id = {
  key: 'stop_id',
  title: "Identifiant de l'arrêt",
  description: "Identifiant de l'arrêt, station, entrée/sortie, noeud générique ou zone d'embarquement",
  type: 'integer',
  ignoreDetection: true
}

const stop_code = {
  key: 'stop_code',
  title: "Code de l'arrêt",
  description: "Code de l'arrêt, station, entrée/sortie, noeud générique ou zone d'embarquement",
  type: 'string'
}

const stop_name = {
  key: 'stop_name',
  title: 'Nom arrêt',
  description: "Nom de l'arrêt, station, entrée/sortie, noeud générique ou zone d'embarquement",
  type: 'string'
}

const stop_desc = {
  key: 'stop_desc',
  title: 'Description arrêt',
  description: "Description de l'arrêt, station, entrée/sortie, noeud générique ou zone d'embarquement",
  type: 'string'
}

const stop_lat = {
  key: 'stop_lat',
  title: 'Latitude',
  description: "Latitude de l'arrêt, station, entrée/sortie, noeud générique ou zone d'embarquement",
  type: 'number'
}

const stop_lon = {
  key: 'stop_lon',
  title: 'Longitude',
  description: "Longitude de l'arrêt, station, entrée/sortie, noeud générique ou zone d'embarquement",
  type: 'number'
}

const zone_id = {
  key: 'zone_id',
  title: 'Identifiant zone',
  description: 'Identifiant de la zone tarifaire',
  type: 'integer',
  ignoreDetection: true
}

const stop_url = {
  key: 'stop_url',
  title: 'URL arrêt',
  description: "URL de l'arrêt, station, entrée/sortie, noeud générique ou zone d'embarquement",
  type: 'string'
}

const location_type = {
  key: 'location_type',
  title: "Type d'emplacement",
  description: "Type d'emplacement",
  type: 'integer',
  'x-labels': {
    undefined: 'Arrêt ou plateforme',
    0: 'Arrêt ou plateforme',
    1: 'Station',
    2: 'Entrée/Sortie',
    3: 'Noeud générique',
    4: "Zone d'embarquement"
  }
}

const parent_station = {
  key: 'parent_station',
  title: 'Emplacement parent',
  description: "Identifiant de l'emplacement parent",
  type: 'integer',
  ignoreDetection: true
}

const stop_timezone = {
  key: 'stop_timezone',
  title: 'Fuseau horaire emplacement',
  description: "Fuseau horaire de l'emplacement, hérite d'un emplacement parent",
  type: 'string'
}

const wheelchair_boarding = {
  key: 'wheelchair_boarding',
  title: 'Accès fauteuil roulant',
  description: "Accès fauteuil roulant à l'emplacement",
  type: 'integer',
  'x-labels': {
    undefined: 'Informations non disponibles',
    0: 'Informations non disponibles',
    1: 'Accès possible sur certains véhicules',
    2: 'Accès impossible'
  }
}

exports.schemas = {
  stop_times: [trip_id, arrival_time, departure_time, stop_id, stop_sequence, stop_headsign, pickup_type, drop_off_type, shape_dist_traveled],
  shapes: [shape_id, shape_pt_lat, shape_pt_lon, shape_pt_sequence, shape_dist_traveled],
  stops: [stop_id, stop_code, stop_name, stop_desc, stop_lat, stop_lon, zone_id, stop_url, location_type, parent_station, stop_timezone, wheelchair_boarding]
}
