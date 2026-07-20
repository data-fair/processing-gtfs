# @data-fair/processing-gtfs

Charge une archive GTFS dans data-fair.

Le traitement télécharge un zip GTFS (HTTP, HTTPS ou SFTP), le convertit, et alimente
jusqu'à quatre jeux de données, chacun activable indépendamment :

| Jeu | Contenu |
|---|---|
| Métadonnées | jeu sans données, porteur du zip ou des `.txt` en pièces jointes |
| Arrêts | points GeoJSON, un par arrêt, avec les lignes qui le desservent |
| Horaires | passages dénormalisés (arrêt, ligne, période de validité) |
| Tracés | LineString GeoJSON, un par `shape_id` |

Les jeux produits sont reliés entre eux par `relatedDatasets`, et ces liens sont
rafraîchis à chaque exécution.

## Développement

```sh
npm install
npm run build-types   # génère les types depuis processing-config-schema.json
npm run lint
npm run test
```

Les tests unitaires n'ont besoin de rien. Le test d'intégration a besoin d'une instance
data-fair, à déclarer dans `config/local-test.mjs` (git-ignoré) :

```js
export default {
  dataFairUrl: 'https://staging-koumoul.com/data-fair',
  dataFairAPIKey: '...'
}
```

Le test SFTP a besoin du conteneur fourni :

```sh
docker compose up -d
```

## Publication

`npm version minor && git push --follow-tags`. Un push sur `main` publie vers le registre
de staging, un tag `v*` publie en production.
