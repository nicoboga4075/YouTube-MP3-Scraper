# 🎵 YouTube MP3 Scraper — Extension Chrome (via Native Messaging)

Extension Chrome qui communique avec un host Node.js local pour télécharger des MP3 depuis YouTube via `yt-dlp`, en utilisant les cookies Firefox.

---

## 📁 Structure du projet

```
C:\yt-dlp\
├── manifest.json                           ← Configuration de l'extension Chrome (MV3)
├── background.js                           ← Service worker : pont popup ↔ host natif
├── popup.html                              ← Interface utilisateur de l'extension
├── popup.css                               ← Styles du popup
├── popup.js                                ← Logique UI : scan, téléchargement, progression
├── icon.png                                ← Icône de l'extension (128×128 px minimum)
├── host.cmd                                ← Point d'entrée Windows appelé par Chrome
├── host.js                                 ← Script Node.js (native host)
├── package.json                            ← Dépendances Node.js (unzipper ^0.12.3)
├── package-lock.json                       ← Versions verrouillées des dépendances
├── com.example.ytdlp_installer.json        ← Déclaration Native Messaging
├── yt-dlp.exe                              ← Binaire yt-dlp (téléchargé automatiquement)
├── .gitignore                              ← Fichiers exclus du dépôt Git
├── README.md                               ← Documentation du projet
├── LICENSE                                 ← Licence du projet
├── host.log                                ← Logs du host natif (diagnostic)
├── stdio.log                               ← Logs stdin/stdout Node.js (débogage)
├── urls.txt                                ← URLs exportées manuellement
├── extension.crx                           ← Extension empaquetée (⚠️ ne pas partager)
├── extension.pem                           ← Clé de signature (⚠️ ne pas partager)
├── node_modules/                           ← Dépendances installées via npm
└── downloads/                              ← Fichiers MP3 téléchargés

C:\ffmpeg\
└── bin\
    ├── ffmpeg.exe                          ← Conversion audio (téléchargé automatiquement)
    ├── ffplay.exe                          ← Lecteur audio (téléchargé automatiquement)
    └── ffprobe.exe                         ← Validation des fichiers audio (téléchargé automatiquement)
```

---

## 1️⃣ Architecture de l'extension

### `manifest.json`

Fichier de configuration obligatoire (Manifest V3, requis depuis 2023). Il déclare les **permissions** nécessaires : `nativeMessaging` pour communiquer avec le host local, `scripting` et `activeTab` pour injecter du code dans l'onglet actif, ainsi que `host_permissions` limité à `https://www.youtube.com/*`. Il référence `background.js` comme service worker, `popup.html` comme interface de l'icône dans la barre Chrome, et `icon.png` comme icône (128×128 px).

> ⚠️ MV3 impose l'utilisation de service workers à la place des background pages persistantes. Le service worker peut être mis en veille par Chrome entre deux actions — la connexion `chrome.runtime.connect` maintient le port actif tant que le popup est ouvert.

---

### `background.js`

Service worker central qui joue le rôle de **pont** entre le popup et le host natif. Il gère deux ports :

- `popupPort` — connexion longue durée établie par `popup.js` via `chrome.runtime.onConnect`, remis à `null` à la déconnexion du popup
- `nativePort` — connexion avec le host natif via `chrome.runtime.connectNative`, ouverte à chaque commande `install` (une connexion précédente éventuelle est d'abord déconnectée proprement)

**Flux de messages :**

| Commande reçue | Action |
|---|---|
| `handcheck` | Répond immédiatement `{ message: "HANDCHECK_OK" }` pour confirmer que le service worker est actif |
| `install` (avec ou sans `urls`) | Ouvre une nouvelle connexion native, relaie tous les messages du host vers le popup en temps réel, puis envoie `{ type: "NATIVE_DISCONNECT", error }` à la déconnexion |

Tous les messages typés du host (`DOWNLOAD_START`, `DOWNLOAD_DONE`, `DOWNLOAD_SKIPPED`, `DOWNLOAD_ERROR`, `ALL_TOOLS_INSTALLED`) sont relayés tels quels vers le popup via `popupPort.postMessage`.

---

### `popup.html` / `popup.js`

Interface de style terminal composée de plusieurs zones :

- **Titlebar** — affiche le nom de l'extension avec un bouton **✕ Close**
- **App header** — informations de version : auteur, répertoire d'installation (`C:\yt-dlp`), numéro de version et date de release
- **Bouton Scan** — pleine largeur, avec sous-titre descriptif
- **Terminal** (`#outputTerminal`) — zone de texte en lecture seule affichant les logs en temps réel, stylisée avec trois points de couleur (rouge, jaune, vert) et un label `Node · Chrome`
- **Status** (`#statusTerminal`) — ligne d'état sous le terminal (ex : `Status: Idle`, `Status: Scanning…`)
- **Boutons Export / Download** — disposés côte à côte, chacun avec icône et sous-titre
- **Barre de progression** (`#progressContainer`) — label, pourcentage, barre et métadonnées (ex : `3/12`)

Au chargement, `popup.js` établit une connexion permanente avec le background (`chrome.runtime.connect({ name: "popup" })`) et envoie un `handcheck` pour s'assurer que le service worker répond.

#### Bouton Scan

Injecte un script dans l'onglet YouTube actif via `chrome.scripting.executeScript`. Deux comportements selon la page :

- **Page vidéo** (`/watch?v=...`) — récupère immédiatement l'URL, le titre, l'artiste et la durée de la vidéo en cours
- **Page playlist** — scrolle automatiquement jusqu'en bas, collecte toutes les occurrences de `ytd-playlist-video-renderer` avec leurs métadonnées, et remonte le compteur en temps réel via `chrome.runtime.sendMessage`

> 💡 Le script injecté ne peut pas accéder aux variables du popup (pas de closure). Les données nécessaires sont passées via `args` et les résultats remontés via la valeur de retour de la Promise.

#### Bouton Export

Exporte les URLs affichées dans le terminal sous forme de fichier `urls.txt` téléchargé via le navigateur (Blob + `<a download>`).

#### Bouton Download

Déclenche le téléchargement selon l'un des trois modes ci-dessous.

---

## 2️⃣ Modes de téléchargement

### Mode 1 — Vidéo en cours

L'utilisateur est sur une page `/watch?v=...`. En cliquant **Download**, le popup envoie directement l'URL de l'onglet actif. Optionnellement, **Scan** puis **Export** permettent d'exporter l'URL dans `urls.txt`.

### Mode 2 — Après un Scan (session courante)

L'utilisateur clique **Scan** sur une playlist, attend la fin de la collecte, puis clique **Download**. Les URLs présentes dans le terminal sont envoyées en mémoire au host via `{ command: "install", urls: [...] }`. Aucun fichier disque n'est nécessaire — c'est le mode le plus direct.

### Mode 3 — Depuis `urls.txt` (session précédente)

Le terminal est vide ou ne contient pas d'URLs YouTube valides. Le popup envoie `{ command: "install" }` sans le champ `urls`. Le host détecte l'absence du champ, lit `C:\yt-dlp\urls.txt` depuis le disque et traite chaque ligne. Si le fichier est introuvable, une erreur explicite est renvoyée au popup.

---

## 3️⃣ Host Natif (côté Windows)

### `host.cmd`

Point d'entrée appelé directement par Chrome. Gère la résolution de Node.js selon l'environnement de l'utilisateur, dans cet ordre de priorité :

1. **Node.js dans le PATH système** — détecté via `node -v`, utilisé directement
2. **nvm (Node Version Manager)** — si présent dans `%LOCALAPPDATA%\nvm`, utilise la première version installée ou installe automatiquement la `22.22.0`
3. **Node.js portable** — si aucune installation n'est trouvée, télécharge et extrait `node-v22.22.0-win-x64.zip` depuis nodejs.org dans `%LOCALAPPDATA%\Programs\nodejs`

Toutes les tentatives et versions détectées sont journalisées dans `stdio.log`. Les erreurs du script Node.js sont également redirigées vers ce fichier.

> ⚠️ Le chemin vers `host.js` est absolu (`C:\yt-dlp\host.js`). Toute erreur de résolution Node.js sera visible dans `stdio.log`.

---

### `host.js`

Cœur du traitement. Communique avec Chrome via **stdin/stdout** selon le protocole Native Messaging (préfixe 4 octets little-endian + JSON). Tous les événements sont écrits dans `host.log`.

#### Démarrage

Vérifie la présence de `node_modules/` et lance `npm install --no-audit --no-fund` automatiquement si nécessaire.

**Dépendances :**

| Module | Version | Type | Rôle |
|---|---|---|---|
| `unzipper` | `^0.12.3` | npm | Extraction des archives `.zip` (ffmpeg) |
| `https` | natif Node.js | built-in | Téléchargement des outils avec gestion des redirections |
| `fs` | natif Node.js | built-in | Lecture/écriture fichiers (`urls.txt`, logs, binaires) |
| `path` | natif Node.js | built-in | Manipulation des chemins de fichiers |
| `child_process` | natif Node.js | built-in | Exécution de `yt-dlp`, `ffprobe`, `npm install` (`execSync`, `execFile`) |
| `util` | natif Node.js | built-in | Promisification de `execFile` via `util.promisify` |

> Version Node.js cible : **22.22.0** (installée automatiquement par `host.cmd` si absente).

#### Étape 1 — Installation des outils

Vérifie la présence de `yt-dlp.exe` (`C:\yt-dlp\`), `ffmpeg.exe`, `ffplay.exe` et `ffprobe.exe` (`C:\ffmpeg\bin\`). Pour chaque outil manquant :

- `yt-dlp.exe` — téléchargé directement depuis GitHub Releases
- `ffmpeg` / `ffprobe` / `ffplay` — téléchargés depuis `gyan.dev` (build `ffmpeg-release-essentials.zip`), extraits via `unzipper`, le `.zip` temporaire est supprimé après extraction

Les redirections HTTP sont gérées automatiquement. La progression est communiquée au popup en temps réel. Une fois tous les outils prêts, envoie `ALL_TOOLS_INSTALLED`.

#### Étape 2 — Lecture des URLs

Utilise le champ `urls` du message si présent, sinon lit `C:\yt-dlp\urls.txt` (séparation `\r?\n`). Renvoie `NATIVE_DISCONNECT` avec une erreur explicite si le fichier est absent.

#### Étape 3 — Téléchargement par URL

Pour chaque URL, avec `--cookies-from-browser firefox`, `--js-runtimes node` et `--extractor-args youtube:player_client=android,web` :

1. `yt-dlp --dump-json` — récupère les métadonnées (titre, durée, catégories, artiste, album, genre) sans télécharger
2. Filtre : les vidéos sans catégorie `Music` sont ignorées → `DOWNLOAD_SKIPPED`
3. Vérifie si `<titre>.mp3` existe déjà dans `downloads/` → `DOWNLOAD_SKIPPED` si oui
4. Lance le téléchargement avec `-x --audio-format mp3 --audio-quality 0`, `--concurrent-fragments 5`, `--retries 3`, métadonnées ID3 embarquées via `--parse-metadata` et `--embed-metadata`
5. Récupère le chemin final du fichier via `--print after_move:filepath`
6. Valide le fichier avec `ffprobe --show_streams` — vérifie la présence d'un flux audio (`codec_type: audio`) → supprime le fichier et envoie `DOWNLOAD_SKIPPED` si invalide

#### Étape 4 — Gestion des erreurs

| Type d'erreur | Comportement |
|---|---|
| Vidéo privée, indisponible, format non disponible, HTTP 403 | Non fatale → `DOWNLOAD_ERROR` (fatal: false) → passe à l'URL suivante |
| Perte réseau, crash inattendu | Fatale → `DOWNLOAD_ERROR` (fatal: true) → stoppe le traitement |

À la fin du traitement (toutes URLs parcourues ou erreur fatale), envoie `NATIVE_DISCONNECT` avec `error: null` en cas de succès, ou le message d'erreur en cas d'échec. Un résumé (nombre de vidéos traitées, répartition Music / Other, durée totale) est écrit dans `host.log`.

---

## 4️⃣ Déclaration Native Messaging

### `com.example.ytdlp_installer.json`

```json
{
  "name": "com.example.ytdlp_installer",
  "description": "Install YT-DLP & Download MP3",
  "path": "C:\\yt-dlp\\host.cmd",
  "type": "stdio",
  "allowed_origins": [
    "chrome-extension://VOTRE_EXTENSION_ID/"
  ]
}
```

> 🔑 Remplacez `VOTRE_EXTENSION_ID` par l'ID réel (voir section 6). Le slash final est **obligatoire**.

Sauvegardez ce fichier dans `C:\yt-dlp\`.

---

## 5️⃣ Déclaration dans le Registre Windows

Chrome doit connaître le chemin vers le JSON de déclaration via le registre.

### Via l'Éditeur du Registre (regedit)

1. `Win + R` → `regedit`
2. Naviguer vers `HKEY_CURRENT_USER\SOFTWARE\Google\Chrome\NativeMessagingHosts`
3. Créer une nouvelle clé : `com.example.ytdlp_installer`
4. Modifier la valeur **(Par défaut)** : `C:\yt-dlp\com.example.ytdlp_installer.json`

### Via un fichier `.reg`

```reg
Windows Registry Editor Version 5.00

[HKEY_CURRENT_USER\SOFTWARE\Google\Chrome\NativeMessagingHosts\com.example.ytdlp_installer]
@="C:\\yt-dlp\\com.example.ytdlp_installer.json"
```

Double-cliquez sur le fichier pour l'appliquer.

### Via PowerShell

```powershell
$regPath = "HKCU:\SOFTWARE\Google\Chrome\NativeMessagingHosts\com.example.ytdlp_installer"
New-Item -Path $regPath -Force
Set-ItemProperty -Path $regPath -Name "(Default)" -Value "C:\yt-dlp\com.example.ytdlp_installer.json"
```

---

## 6️⃣ Obtenir l'ID de l'extension et la clé `.pem`

### Charger l'extension en mode développeur (recommandé pour les tests)

1. Ouvrir Chrome → `chrome://extensions/`
2. Activer **Mode développeur** (toggle en haut à droite)
3. Cliquer **"Charger l'extension non empaquetée"** → sélectionner `C:\yt-dlp`
4. L'ID s'affiche directement sous le nom de l'extension

> L'ID est stable tant que vous rechargez depuis le même dossier. Aucun `.crx` ni `.pem` n'est généré en mode développeur.

### Empaqueter l'extension (distribution)

1. Dans `chrome://extensions/`, cliquer **"Empaqueter l'extension"**
2. *Dossier racine* → `C:\yt-dlp`
3. *Fichier de clé privée* → laisser **vide** pour la première fois (Chrome génère `extension.pem`)
4. Pour les mises à jour suivantes → fournir le `extension.pem` existant pour conserver le même ID

Génère dans `C:\` :
- `extension.crx` — fichier distribuable
- `extension.pem` — clé de signature (**à conserver précieusement, ne jamais perdre**)

### Via ligne de commande

```bash
# Générer une clé RSA 2048 bits
openssl genrsa -out extension.pem 2048

# Empaqueter
"C:\Program Files\Google\Chrome\Application\chrome.exe" ^
  --pack-extension="C:\yt-dlp" ^
  --pack-extension-key="C:\yt-dlp\extension.pem"
```

---

## 7️⃣ Mettre à jour `allowed_origins`

Une fois l'ID connu, mettez à jour le JSON :

```json
{
  "allowed_origins": [
    "chrome-extension://kkkecnkcclgpmpemghnpldifblmmhepc/"
  ]
}
```

Puis relancez Chrome ou rechargez l'extension depuis `chrome://extensions/` pour que la modification soit prise en compte.

---

## 8️⃣ Publication sur le Chrome Web Store

### Prérequis

- Compte développeur ([inscription](https://chrome.google.com/webstore/devconsole)) — frais unique de **5 USD**
- Icône 128×128 px (PNG)
- Au moins une capture d'écran (1280×800 ou 640×400)

### Étapes

1. Créer un `.zip` contenant uniquement les fichiers de l'extension (**sans** `extension.pem`, `host.js`, `node_modules/`, `downloads/`) :
   ```
   manifest.json, background.js, popup.html, popup.js, popup.css, icon.png
   ```
2. Aller sur [chrome.google.com/webstore/devconsole](https://chrome.google.com/webstore/devconsole)
3. **"Ajouter un article"** → uploader le `.zip`
4. Remplir la fiche : description, captures, catégorie
5. Soumettre pour révision (délai : 1 à 7 jours)
6. Après approbation → mettre à jour `allowed_origins` avec l'ID définitif du Web Store

---

## 9️⃣ Distribution locale (sans Chrome Web Store)

### Option A — Policy (recommandé en entreprise)

Via GPO ou registre :
```
HKLM\SOFTWARE\Policies\Google\Chrome\ExtensionInstallForcelist
```

### Option B — Mode développeur

L'utilisateur active le mode développeur sur `chrome://extensions/` et glisse-dépose le `.crx`.

---

## 🔁 Flux complet

```
[Popup s'ouvre]
  └─ popup.js → connect({ name: "popup" }) → background.js
  └─ popup.js → postMessage({ command: "handcheck" })
  └─ background.js → postMessage({ message: "HANDCHECK_OK" })

[Scan]
  └─ chrome.scripting.executeScript() → scroll + collecte URLs
  └─ URLs affichées dans le terminal

[Export — optionnel]
  └─ Télécharge urls.txt dans le navigateur

[Download]
  └─ popup.js → postMessage({ command: "install", urls: [...] })
  └─ background.js → connectNative("com.example.ytdlp_installer")
  └─ Chrome → registre → JSON → host.cmd → node host.js
  └─ host.js → installe yt-dlp / ffmpeg si absents
  └─ host.js → pour chaque URL :
       ├─ dump-json → filtre Music
       ├─ vérifie si .mp3 existe
       ├─ télécharge + métadonnées ID3
       └─ valide avec ffprobe
  └─ Événements → background.js → popup.js → barre de progression + terminal
  └─ NATIVE_DISCONNECT → statut final
```

---

## ✅ Checklist de déploiement

- [ ] Node.js disponible (dans le PATH, via nvm, ou sera installé automatiquement en v22.22.0 par `host.cmd`)
- [ ] `host.cmd` pointe vers `C:\yt-dlp\host.js` avec un chemin absolu
- [ ] `com.example.ytdlp_installer.json` présent dans `C:\yt-dlp\`
- [ ] Clé de registre créée sous `HKCU\...\NativeMessagingHosts\com.example.ytdlp_installer`
- [ ] Extension chargée depuis `chrome://extensions/` (mode développeur)
- [ ] ID de l'extension copié et renseigné dans `allowed_origins` du JSON
- [ ] `node_modules/` présent dans `C:\yt-dlp\` (ou généré automatiquement au premier lancement)
- [ ] Test Scan : ouvrir une playlist YouTube → cliquer Scan → URLs détectées dans le terminal
- [ ] Test Download : cliquer Download → vérifier `downloads/` et `host.log`
- [ ] En cas d'erreur Node.js : vérifier que `node` est bien dans le PATH système (pas seulement utilisateur)

---

## 🐛 Diagnostic

| Symptôme | Cause probable | Solution |
|---|---|---|
| `Status: Error` immédiat au chargement | Service worker inactif ou crash | Vérifier `chrome://extensions/` → erreurs du service worker |
| `Check if Node.js is installed...` | `node` introuvable dans le PATH et installation automatique échouée | Vérifier `stdio.log` pour identifier l'étape bloquante |
| `No results found` au Scan | Mauvaise page ou sélecteurs YouTube obsolètes | Vérifier que la page est bien une playlist ou une vidéo YouTube |
| Téléchargement bloqué sur une URL | Vidéo privée ou restriction géographique | Consulter `host.log` pour le détail de l'erreur yt-dlp |
| `NATIVE_DISCONNECT` sans message | `host.cmd` introuvable ou erreur de registre | Vérifier le chemin dans le JSON et la clé de registre |
| Fichier MP3 absent après téléchargement | Validation ffprobe échouée | Consulter `host.log` → le fichier a été supprimé car invalide |