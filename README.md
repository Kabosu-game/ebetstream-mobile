# Ebetstream Mobile

Application mobile **native** (Android / iOS) d’Ebetstream, générée avec **Capacitor** à partir du même projet Vue que la version web.  
**Mêmes styles, mêmes API** : aucune modification côté backend.

---

## Prérequis

- **Node.js** 18+
- **Android** : Android Studio + SDK Android
- **iOS** (Mac uniquement) : Xcode

---

## Installation

```bash
cd ebetstream-mobile
npm install
```

---

## Développement web (navigateur)

```bash
npm run dev
```

Ouvre http://localhost:5173 — même interface que le site, pour tester.

---

## Build et lancement sur téléphone

### 1. Build du projet web

```bash
npm run build
```

### 2. Synchronisation avec les projets natifs

```bash
npx cap sync
```

### 3. Lancer sur Android

```bash
npx cap open android
```

Android Studio s’ouvre. Choisis un émulateur ou connecte un appareil, puis lance l’app (Run).

Ou en une commande :

```bash
npm run android
```

### 4. Lancer sur iOS (sur Mac uniquement)

```bash
npx cap open ios
```

Puis lance depuis Xcode sur simulateur ou appareil.

---

## Démarrage du stream sur téléphone

1. Ouvre l’app sur ton **téléphone** (Android ou iOS).
2. Connecte-toi avec ton compte (même API que le web).
3. Va dans **Streams** → **Create a Stream** (ou **Créer un stream**).
4. Remplis le formulaire (titre, description, catégorie, etc.) et crée le stream.
5. Une fois le stream créé, choisis la **source vidéo** :
   - **Caméra arrière** : jeu / scène
   - **Caméra avant** : selfie / face cam
   - **Partage d’écran** : si supporté (ex. Android Chrome)
6. Appuie sur **Go Live** : l’app demande les permissions **caméra** et **micro** puis démarre le flux.

Le flux utilise le **même signaling WebSocket** et les **mêmes endpoints API** que la version web (démarrage, arrêt, infos stream). Aucune modification API n’est nécessaire.

---

## Configuration API

- En **app native** (Capacitor), l’app utilise automatiquement l’API de production : `https://acmpt.online/api`.
- En **dev** dans le navigateur (`npm run dev`), les appels passent par le proxy vers `http://localhost:8000` si tu lances l’API Laravel en local.

Les URLs sont gérées dans `src/config/constants.ts` (détection `Capacitor` + localhost).

---

## Structure

- `src/` : même code Vue que le projet web (copie).
- `dist/` : build web généré par `npm run build` (servi dans l’app native).
- `android/` : projet Android Studio (Capacitor).
- `ios/` : projet Xcode (Capacitor), après `npx cap add ios` sur Mac.
- `capacitor.config.ts` : config Capacitor (appId, permissions caméra/micro, etc.).

---

## Permissions

- **Android** : caméra et micro déclarées dans `capacitor.config.ts` (plugin `@capacitor/camera`). Les permissions sont demandées au premier « Go Live ».
- **iOS** : `NSCameraUsageDescription` et `NSMicrophoneUsageDescription` sont gérées par les plugins Capacitor.

---

## Commandes utiles

| Commande | Description |
|----------|-------------|
| `npm run dev` | Dev web (navigateur) |
| `npm run build` | Build production |
| `npm run cap:sync` | Build + sync vers Android/iOS |
| `npm run android` | Build + sync + ouvrir Android Studio |
| `npm run ios` | Build + sync + ouvrir Xcode (Mac) |

---

## Dépôt et API

- **Front web** : [Kabosu-game/ebetstream](https://github.com/Kabosu-game/ebetstream)
- **API** : inchangée (acmpt.online ou ton backend Laravel). Aucune modification côté API pour la version mobile.
