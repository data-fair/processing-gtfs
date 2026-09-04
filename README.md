# @data-fair/processing-gtfs

Charge une archive GTFS dans data-fair.

Le traitement télécharge un zip GTFS (HTTP, HTTPS, FTP, FTPS ou SFTP), le convertit, et alimente
jusqu'à quatre jeux de données, chacun activable indépendamment :

| Jeu | Contenu |
|---|---|
| Métadonnées | jeu sans données, porteur du zip ou des `.txt` en pièces jointes |
| Arrêts | points GeoJSON, un par arrêt, avec les lignes qui le desservent |
| Horaires | passages dénormalisés (arrêt, ligne, période de validité) |
| Tracés | LineString GeoJSON, un par `shape_id` |

Les jeux produits sont reliés entre eux par `relatedDatasets`, et ces liens sont
rafraîchis à chaque exécution.

## Mode validation

Le mode « Valider uniquement l'archive » envoie le zip à un service compatible
[transport-validator](https://github.com/etalab/transport-validator) (l'outil de
transport.data.gouv.fr) et écrit le résumé dans le journal du traitement : anomalies
par sévérité, période de validité, réseaux et modes. Aucun jeu de données n'est
produit, l'archive n'est même pas dézippée.

Des anomalies fatales (archive inexploitable) font échouer l'exécution. En mode
import, la validation avant import est activable (`validationEnabled`, activée par
défaut) et peut bloquer le traitement en cas d'anomalies (`failOnError`).

Par défaut, l'instance publique `https://validation.transport.data.gouv.fr/validate`
est utilisée : endpoint non documenté, sans authentification ni SLA, l'archive lui
est envoyée en clair dans le corps de la requête. C'est acceptable car c'est la
destination finale prévue de la donnée, mais un auto-hébergement du validateur
(`validatorUrl`) reste possible.

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

FTP / FTPS : seul le mode passif est supporté (limite de `basic-ftp`, pas de mode actif).
Le FTPS sur le port 990 utilise le TLS implicite, sinon le TLS explicite.
La vérification des certificats reste stricte : un certificat auto-signé fait échouer
le téléchargement. Le FTP en clair fait transiter les identifiants sans chiffrement :
préférez FTPS ou SFTP quand c'est possible. Sans utilisateur, l'accès FTP est anonyme.
Le conteneur `ftp` de `docker compose up -d` expose `ftp://localhost:2121/upload/gtfs-gp.zip`
(login `test` / `testmotdepasse`).

## Publication

`npm version minor && git push --follow-tags`. Un push sur `main` publie vers le registre
de staging, un tag `v*` publie en production.
