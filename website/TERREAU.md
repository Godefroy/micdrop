# TERREAU.md — référentiel du site pour les skills Terreau

Ce fichier centralise **tout ce qui est spécifique à ce site** pour les skills `terreau-*` :
identité, positionnement, ICP, angles différenciants, concurrents à exclure, pages canoniques,
ciblage des mots-clés, organisation du contenu, conventions visuelles et pages evergreen.

Les skills `terreau-*` sont génériques et partagées entre tous les sites : elles ne contiennent
aucune valeur de ce fichier, elles le lisent.

---

## 1. Identité du site

- **Marque** : Micdrop
- **Domaine** : micdrop.dev
- **URL de base** : https://micdrop.dev
- **Année de fondation** : 2025 (premier commit public août 2025)
- **Localisation** : France
- **Nature** : bibliothèque open source (MIT), suite de packages npm TypeScript. Pas de SaaS, pas
  de plan payant, pas de compte utilisateur : le produit s'installe et tourne chez l'utilisateur,
  avec ses propres clés API des fournisseurs IA (BYOK).
- **Auteur / mainteneur** : Godefroy de Compreignac (https://github.com/Godefroy)
- **Dépôt public** : https://github.com/Godefroy/micdrop
- **Langue du contenu** : anglais par défaut (site monolingue, `og:locale` et `inLanguage` = `en`,
  URL sans préfixe de langue). Le français reste possible **au cas par cas** pour les sujets
  souveraineté et marché français (Gradium, Mistral, RGPD, hébergement UE) : dans ce cas l'article
  entier est en français, frontmatter compris, mais le site ne duplique pas un contenu dans les
  deux langues.

Ces valeurs alimentent les schémas `Organization` / `LocalBusiness`, les URL absolues et le ton.

---

## 2. Positionnement & ICP

Micdrop est un ensemble de packages TypeScript open source pour construire des conversations
vocales temps réel avec des agents IA, dans une webapp. Il prend en charge la plomberie côté
navigateur et côté serveur (micro, haut-parleur, VAD, WebSocket, interruptions, streaming audio) et
fournit des intégrations prêtes à l'emploi (agent LLM, STT, TTS) que l'on peut mélanger ou
remplacer par les siennes.

Ce que Micdrop n'est pas : une plateforme hébergée, un service facturé à la minute, un fournisseur
de voix ou de modèles, un no-code de standard téléphonique. Micdrop ne remplace pas les
fournisseurs IA, il les orchestre.

**Mapping ICP par thème** : quel ICP nommer selon le sujet traité.

| Thème du contenu | ICP à nommer |
|---|---|
| Intégration voix dans une webapp, SDK, React hooks | développeurs front-end et full-stack TypeScript qui ajoutent un mode vocal à leur produit web |
| Architecture serveur, protocole, fallback, outils (tools) | développeurs back-end Node.js et équipes plateforme qui opèrent le pipeline vocal |
| Comparatifs de frameworks (Pipecat, LiveKit Agents, SDK temps réel) | équipes techniques qui choisissent une brique voix pour leur produit |
| Souveraineté, RGPD, hébergement UE | équipes techniques et responsables produit européens soumis à des contraintes de données |
| Coût, latence, qualité vocale, choix de fournisseurs | développeurs et CTO de startups qui arbitrent entre fournisseurs STT / LLM / TTS |

Interdits de vocabulaire ICP (termes à ne jamais employer pour désigner l'audience) : « clients »,
« prospects », « utilisateurs finaux », « non-techniciens », « débutants ». L'audience est faite de
développeurs et d'équipes techniques, on les nomme ainsi.

**Types de page et intention de recherche** :

- **Pages commerciales** : `/` (page produit), `/docs/getting-started`, les pages d'intégration
  `/docs/ai-integration/provided-integrations/<fournisseur>`, `/docs/client`, `/docs/server`, et
  `/docs/ai-integration/sovereign-voice-ai`. Ce sont les pages qui portent l'adoption : elles
  ciblent quelqu'un prêt à installer.
- **Pages « alternative à »** : les articles de `/blog` qui comparent Micdrop à un concurrent nommé
  (`/blog/alternative-to-pipecat` aujourd'hui), produits par `terreau-write-alternative`. Elles
  vivent dans le blog par leur emplacement et jouent le rôle d'une page commerciale par leur
  intention, puisqu'elles s'adressent à quelqu'un qui cherche déjà à changer d'outil. Elles portent
  donc elles-mêmes les keywords transactionnels de la marque comparée.
- **Pages informationnelles** : les articles de `/blog`, qui expliquent un concept, comparent des
  approches techniques ou déroulent un cas d'usage, et renvoient vers la page commerciale du thème.

**Action de conversion** (utilisée par `terreau-write-product-landing`) :

- **Principale** : commencer l'intégration, vers `/docs/getting-started` (libellé du hero :
  « Start Building (5 min) »).
- **Secondaire** : voir le dépôt sur GitHub (https://github.com/Godefroy/micdrop), visuellement
  subordonné à l'action principale.

---

## 3. Arguments différenciants / angles défendables

À mobiliser dans les contenus comparatifs et les paragraphes de positionnement, **dans cet ordre de
priorité**. Privilégier les faits vérifiables (chiffres, dates, références publiques, actifs open
source) aux affirmations génériques.

1. **TypeScript de bout en bout, navigateur et serveur.** Un seul langage pour l'app web et le
   pipeline vocal, avec des types partagés, là où l'essentiel de l'écosystème voix temps réel est
   en Python. Preuve : les packages `@micdrop/client` et `@micdrop/server`, plus `@micdrop/react`
   pour les hooks.
2. **Open source MIT, BYOK, sans service hébergé.** Le code tourne sur l'infrastructure de
   l'utilisateur avec ses propres clés fournisseurs : pas de facturation à la minute, pas de
   dépendance à un intermédiaire. Preuve : dépôt public https://github.com/Godefroy/micdrop.
3. **Agnostique aux fournisseurs IA, avec fallback intégré.** OpenAI, Mistral, ElevenLabs,
   Cartesia, Gladia, Gradium, AI SDK, plus des interfaces abstraites pour brancher les siens ; les
   classes `FallbackTTS` / fallback agent et STT basculent sur un second fournisseur en cas de
   panne. Preuve : `/docs/ai-integration/fallback-strategies/*`.
4. **Stack souveraine possible à 100 %.** Combiner Mistral, Gladia et Gradium garde la donnée en
   Europe, sans changer une ligne d'orchestration. Preuve :
   `/docs/ai-integration/sovereign-voice-ai`.
5. **La plomberie temps réel est déjà faite.** VAD, détection sémantique de fin de tour,
   interruptions, filtrage du bruit, reprise de conversation, appels d'outils, gestion des
   périphériques. Preuve : les pages `/docs/server/semantic-turn-detection`,
   `/docs/server/noise-filtering`, `/docs/client/vad`.
6. **Des produits tournent dessus en production.** Deux exemples citables, jamais présentés comme
   la liste complète : [Raconte.ai](https://raconte.ai), des entretiens vocaux menés par une IA, et
   [Cibli](https://cibli.fr), une plateforme de recrutement où les candidats répondent à la voix.
   Les deux embarquent les packages navigateur et serveur ensemble. Écrire « des produits comme
   Raconte et Cibli », jamais « les deux produits qui utilisent Micdrop » : compter les références
   sous-estime l'usage réel et se périme au premier déploiement suivant. Raconte.ai est construit
   par le mainteneur de Micdrop : le dire quand on cite la référence, sinon la preuve se retourne.
   Cibli est porté par une autre équipe. Vérifiable dans les dépôts voisins `../raconte` et
   `../cibli`, qui déclarent `@micdrop/client` et `@micdrop/server` en dépendances.

**Effort d'intégration** (chiffre réutilisable, à ne jamais réestimer au jugé) : brancher Micdrop
dans une application existante se compte en heures, pas en jours. Le guide de démarrage donne un
premier appel en cinq minutes. Ce qui prend plus longtemps est ce qu'une plateforme hébergée
fournissait et qu'il faut désormais écrire soi-même, à savoir le stockage des transcriptions,
l'historique d'appels et le tableau de bord.

Éléments à ne pas mettre en avant à tort :

- Aucune promesse chiffrée de latence, de précision de transcription ou de coût par minute : ces
  chiffres appartiennent aux fournisseurs, pas à Micdrop, et varient avec le choix de stack.
- Pas de revendication de production à grande échelle, de nombre d'utilisateurs, d'étoiles GitHub
  ou de niveau d'adoption : le projet est jeune (2025). Seule exception, les produits nommés
  ci-dessus, qui se citent en exemple et jamais comme un portefeuille clients ni comme un décompte.
- Pas de conformité présentée comme garantie (RGPD, HIPAA, SOC 2). Micdrop rend une architecture
  souveraine possible, la conformité reste celle du déploiement et des fournisseurs choisis.
- Pas d'équipe, de société ni de support commercial : le projet est porté par un mainteneur.

---

## 4. Concurrents

### À ne jamais citer

Ne jamais mentionner ces entreprises dans les contenus (listicles, blog, comparatifs, ads, pages
SEO), même dans un format dont l'objectif est de citer honnêtement des concurrents.

- (aucun pour l'instant)

### Catégories comparables

Le paysage concurrentiel du site, par catégorie : sur quoi chacune concurrence vraiment le produit,
et laquelle mérite un « le produit ne remplace pas X » honnête. Utilisé par
`terreau-write-alternative` pour nommer la catégorie comparée, et par `terreau-write-listicle` pour
cadrer un classement.

- **Frameworks d'agents vocaux open source** (Pipecat, LiveKit Agents, Vocode) : même terrain que
  Micdrop, orchestration d'un pipeline STT → LLM → TTS que l'on héberge soi-même. Ils couvrent des
  pipelines riches et souvent la téléphonie, majoritairement en Python ; ils ne couvrent pas une
  intégration TypeScript native côté navigateur et serveur avec des types partagés.
- **Plateformes auto-hébergeables open source** (Dograh) : forme de plateforme plutôt que de
  bibliothèque, avec constructeur de workflow visuel, téléphonie et déploiement Docker, sous licence
  permissive. C'est la réponse à « alternative open source à Vapi / Retell », donc à citer chaque
  fois qu'un contenu affirme ce qui existe en open source. Elles ne couvrent pas la conversation
  vocale intégrée dans une webapp TypeScript existante.
- **Plateformes d'agents vocaux hébergées** (Vapi, Retell AI, Bland) : couvrent la mise en
  production clés en main, le routage téléphonique et un tableau de bord, contre une facturation à
  la minute et l'exécution chez l'éditeur. Micdrop ne remplace pas une plateforme hébergée : il ne
  fournit ni infrastructure, ni SLA, ni numéros de téléphone.
- **API temps réel des fournisseurs de modèles** (OpenAI Realtime API, Gemini Live) : couvrent le
  modèle vocal de bout en bout dans un seul appel, sans choix de STT ni de TTS. Micdrop ne
  remplace pas ces API, il sait les utiliser tout en gardant le contrôle du pipeline et la
  possibilité de mélanger les fournisseurs.
- **Fournisseurs de briques** (ElevenLabs, Cartesia, Deepgram, Gladia, Gradium, Mistral) : ce sont
  des intégrations, pas des concurrents. Ne jamais les cadrer comme des alternatives à Micdrop.
- **Widgets de chat vocal clés en main** (assistants embarqués propriétaires) : couvrent un cas
  d'usage figé sans code ; ils ne couvrent pas la personnalisation de l'UX ni les appels d'outils
  dans l'application.

### Partenaires

Les projets open source dont Micdrop dépend. Jamais suivis comme concurrents, jamais de page
« alternative à », et à citer avec un lien dès qu'un contenu touche à leur brique. Une ligne par
partenaire, à compléter au fil des dépendances.

- **ricky0123** ([vad](https://github.com/ricky0123/vad)) : le VAD navigateur suit son algorithme
  et charge son modèle Silero. À citer dans les contenus VAD, Silero et détection de parole.

---

## 5. Pages canoniques par thème

Pour un thème donné, la page canonique est celle de la documentation qui le porte déjà. Tout
contenu qui traite le thème doit la lire avant de rédiger et lier vers elle.

| Thème | Page canonique |
|---|---|
| Démarrer, installer, premier appel vocal | `/docs/getting-started` |
| Navigateur, micro, haut-parleur, VAD, périphériques | `/docs/client` |
| Serveur, orchestration, protocole, interruptions | `/docs/server` |
| Choix et branchement des fournisseurs IA | `/docs/ai-integration` |
| Un fournisseur donné (OpenAI, Mistral, ElevenLabs, Cartesia, Gladia, Gradium, AI SDK) | `/docs/ai-integration/provided-integrations/<fournisseur>` |
| Écrire sa propre intégration agent / STT / TTS | `/docs/ai-integration/custom-integrations/*` |
| Résilience, bascule de fournisseur | `/docs/ai-integration/fallback-strategies/*` |
| Souveraineté, RGPD, hébergement européen | `/docs/ai-integration/sovereign-voice-ai` |
| React | `/docs/client/react-hooks` |
| Appels d'outils (tools) | `/docs/server/tools` et `/docs/client/handling-tool-calls` |
| Fin de tour, filtrage du bruit, reprise de conversation | `/docs/server/semantic-turn-detection`, `/docs/server/noise-filtering`, `/docs/server/resume-conversation` |
| Intégration à un framework serveur | `/docs/server/with-fastify`, `/docs/server/with-nestjs` |
| Page produit générale | `/` (source : `src/content/pages/index.mdx`) |

**Ciblage keyword d'un article** : un article informationnel cible sa propre page ; un keyword
transactionnel pointe vers la page canonique du thème que l'article booste (le plus souvent
`/docs/getting-started` ou la page d'intégration du fournisseur concerné).

Une page « alternative à » fait exception et garde ses propres keywords transactionnels
(`<concurrent> alternative`, `<concurrent> typescript`, `<concurrent> vs micdrop`, `<concurrent>
nodejs`), parce qu'elle est elle-même la page d'atterrissage de cette intention. Elle lie vers
`/docs/getting-started` sans lui céder son ciblage. Le cas est vérifié en Search Console sur
`/blog/alternative-to-pipecat`, qui se classe entre la 3e et la 6e place sur `pipecat typescript`,
`pipecat alternatives` et `pipecat alternative`, avec des clics à la clé.

Pages « alternative à » publiées : `/blog/alternative-to-pipecat`, `/blog/alternative-to-livekit-agents`,
`/blog/alternative-to-vapi`. Conventions du site pour ce format, en complément de la skill
`terreau-write-alternative` :

- Le concurrent est **lié** vers son site à la première mention (`[Vapi](https://vapi.ai)`), et
  Micdrop est lié vers `/` à la sienne, pour que les deux produits soient traités pareil.
- La miniature est une illustration générée selon la section 8, jamais la page d'accueil du
  concurrent, qui mettrait son logo sur la carte de partage de l'article.
- Le screenshot du concurrent est co-localisé dans le dossier de l'article (section 9), même si un
  autre article en a déjà un : chaque article date le sien.

---

## 6. Ciblage des mots-clés par type de page

- **Pages informationnelles** (blog) : keywords informationnels, formulés comme un développeur les
  tape — « how to add voice to a web app », « what is VAD », « semantic turn detection »,
  « streaming TTS latency », « X vs Y », « voice AI architecture ».
- **Pages commerciales** (page produit et documentation) : keywords **transactionnels**, marqueurs
  de ce site (produit open source destiné à des développeurs) :
  - `voice AI SDK`, `voice AI library`, `TypeScript voice AI`, `Node.js voice agent`
  - `open source voice agent framework`, `self-hosted voice AI`
  - `<provider> Node.js integration`, `<provider> TypeScript SDK`, `add voice to React app`
  - `npm install`, `getting started`, `quickstart` accolés au domaine voix
- **Pages « alternative à »** : keywords transactionnels de la marque comparée,
  `alternative to <framework>`, `<framework> alternative`, `<framework> typescript`,
  `<framework> vs micdrop`. Ils restent sur l'article, ils ne remontent pas vers la page produit.
  Tant que l'article n'existe pas, la seed se pose sur `/` et se repointe à la publication.

Test : le chercheur est-il prêt à passer à l'action ? Si oui, bonne seed transactionnelle. S'il
apprend un concept, c'est informationnel → blog.

**Volume** : ne jamais suivre un terme à 0 volume confirmé.

---

## 7. Où vit le contenu

Le site est un Astro 6 + MDX + Tailwind v4, dans `website/` du monorepo `micdrop`. Contenu en Git,
pas de backend.

- **Collections éditoriales** (`website/src/content/`) :
  - `docs/` : la documentation. Le chemin du fichier est l'URL (`docs/client/vad.mdx` →
    `/docs/client/vad`), chaque dossier est un groupe de la sidebar dont `index.mdx` est la page
    pointée.

  **Tout contenu est en `.mdx`**, dans les quatre collections, jamais en `.md` : n'importe quelle
  page peut ainsi appeler un composant sans être renommée. MDX est plus strict que Markdown, donc
  hors blocs de code `{` ouvre une expression JS, `<` ouvre une balise, et les commentaires HTML
  sont invalides (utiliser `{/* … */}`).
  - `blog/` : les articles, **un dossier par article** (`<slug>/index.mdx`) avec ses images
    co-localisées.
  - `pages/` : les pages éditoriales, un fichier par URL, `index` = la page d'accueil. MDX
    n'appelant que des composants.
  - `authors.yaml` : les auteurs du blog, clés utilisées par le champ `author` d'un article
    (`godefroy` aujourd'hui).
- **Schémas de collection** : `website/src/content.config.ts` (source de vérité des champs de
  frontmatter).
- **Templates de page** : `website/src/layouts/` (`BaseLayout`, `BlogLayout`, `BlogPost`,
  `DocsLayout`, `DocPage`) et `website/src/pages/`.
- **Composants JSON-LD** : `website/src/components/JsonLd.astro` (émetteur générique).
  `BlogPost.astro` émet le `BlogPosting`, `Breadcrumb.astro` le `BreadcrumbList`, `FaqList.astro`
  la `FAQPage`, `SiteJsonLd.astro` les `Organization` / `WebSite` / `SoftwareApplication` de la page
  d'accueil. Les tags Open Graph / Twitter sont dans `SocialPreview.astro`.
- **Navigation** : `website/src/navigation.ts` (header et footer), valeurs de marque dans
  `website/website.config.ts`.
- **Redirections** : renommer ou supprimer une page implique une redirection, dans
  `website/src/redirects.ts` (un pour un) ou `website/public/_redirects` (motifs Netlify).
- **Contraintes MDX** (voir `CLAUDE.md` du dépôt, section « MDX discipline ») : contenu pur, pas
  d'`import`, pas d'`export const` ni de bloc script, pas de HTML brut (`<div>`, `<h2>`, `<img>`),
  pas de `class` / `style`, pas de tableau JSON ni de logique JS. Les composants de
  `src/components/` sont auto-découverts. Images en syntaxe markdown `![alt](./image.jpg)` avec le
  fichier à côté du contenu. Callouts : `<Callout type="info|warning|tip">`. Boutons : `<Button>`
  avec la prop `label`.

**Frontmatter d'un article de blog** (noms exacts du schéma, `blog` dans `src/content.config.ts`) :

```yaml
title: "…"        # requis. Titre du document, <title> et headline JSON-LD. ≤ 60 caractères
h1: "…"           # optionnel. Remplace le H1 visible quand il doit différer du title SEO
summary: "…"      # requis. Sert de meta description et de chapô. ≤ 160 caractères
date: 2026-08-13  # optionnel. Date de publication
update: 2026-08-13 # optionnel. Date de mise à jour, affichée et envoyée en dateModified
image: ./thumbnail.jpg # optionnel. Chemin relatif au dossier de l'article, résolu par Astro
author: godefroy  # optionnel. Clé de src/content/authors.yaml
keywords: []      # liste de chaînes, meta keywords
similarPosts: []  # liste de slugs d'articles (nom du dossier), rendus en fin d'article
takeaways: []     # liste de chaînes, encadré « points clés » en haut de l'article
draft: false      # true exclut l'article de l'index et des pages générées
```

Il n'y a **pas** de champ `description` sur le blog : la meta description vient de `summary`.

**Frontmatter d'une page éditoriale** (collection `pages`) : `title` (requis), `description`
(optionnel, meta description), `fullWidth` (booléen, la page d'accueil est en `true`).

**Frontmatter d'une page de doc** (collection `docs`) : `title` (requis), `description`
(optionnel), `sidebarLabel` (optionnel), `order` (numéroté une seule fois sur toute la sidebar, pas
par dossier). Le `# Titre` en tête de fichier est retiré au build, le layout affiche le titre du
frontmatter.

**Skills d'édition par type de page** : aucune skill propre au site, les skills `terreau-*` sont le
seul point d'entrée.

---

## 8. Génération d'images

La génération passe par l'API Terreau (`POST /images/generate`), via la skill
`terreau-generate-image`. Le site n'a pas de script local : ce qui est propre au site, c'est le bloc
de style ci-dessous, que la skill copie verbatim dans le prompt (bloc 2).

**Bloc de style (à copier verbatim)** :

```text
Marque Micdrop : bibliothèque open source TypeScript pour les conversations vocales temps réel avec
des IA. Identité sombre, technique, calme. Accent principal émeraude (#10b981, éclats #34d399),
accent secondaire bleu ciel (#0ea5e9), surfaces ardoise très sombres (#020617, #0f172a, #1e293b).

Thumbnails et visuels d'article :
- Fond : ardoise quasi noire (#020617 à #0f172a), profond et uniforme, avec une légère vignette.
- Palette et accent focal : un seul accent émeraude lumineux (#10b981 / #34d399) qui porte le
  sujet, le bleu ciel (#0ea5e9) en soutien discret. Aucune autre couleur saturée. Zéro violet,
  zéro dégradé arc-en-ciel, zéro rose.
- Lumière : émission douce depuis le sujet lui-même, halo maîtrisé sur le fond sombre, contraste
  net entre le sujet éclairé et le fond.
- Style de rendu : rendu 3D propre et minimal, ou illustration vectorielle géométrique. Surfaces
  mates, arêtes nettes, pas de texture bruitée, pas de photoréalisme, pas de style croquis.
- Sujets à privilégier : formes d'onde audio, spectre sonore, ondes concentriques, microphone
  stylisé, casque, nœuds et arêtes d'un pipeline, flux entre deux points, blocs modulaires
  connectés, latence et temps réel suggérés par le mouvement.
- Sujets à éviter : visages humains, mains, robots humanoïdes, cerveaux, ampoules, engrenages,
  logos de marques tierces, texte et lettrage de toute sorte, interface d'application simulée,
  clichés de la « voix IA » type assistant domestique.
- Point focal unique, silhouette forte, lisible à 300 px de large.
```

Formats courants : thumbnail d'article 1200x630, infographie d'article 1600x900.

L'image d'un article se place **dans le dossier de l'article** (`src/content/blog/<slug>/`) et se
référence en chemin relatif dans le frontmatter `image`, jamais dans `public/`.

---

## 9. Screenshots

- **Screenshots Micdrop partagés** entre plusieurs contenus : `src/assets/screenshots/`
  (`micdrop-homepage.png`, source https://micdrop.dev), référencés depuis un MDX de blog par
  `![...](../../../assets/screenshots/micdrop-homepage.png)`. Un nouveau screenshot Micdrop va dans
  ce dossier, jamais dans le dossier d'un article.
- **Screenshots de concurrents pour un article** : co-localisés avec le MDX dans
  `src/content/blog/<slug>/<concurrent>.png`, nommés d'après le produit (`pipecat.png`,
  `livekit-agents.png`) et référencés par `![...](./<concurrent>.png)`. Prendre la page d'accueil du
  produit, sans cookie banner.
- **Screenshots ponctuels** : co-localisés avec le contenu qui les affiche. `public/` ne contient
  que le favicon, `robots.txt` et `_redirects`, jamais d'image d'article.

---

## 10. Pages evergreen

Pages à garder factuellement à jour, avec leur cadence. La skill `terreau-update-evergreen`
respecte la fenêtre de cooldown.

**Trimestriel (1 refresh max par 90 jours)** — pages définitionnelles / conceptuelles, et pages
comparatives :

- `/blog/voice-activity-detection-browser`
- `/blog/open-source-voice-agent-frameworks`
- `/blog/alternative-to-vapi`
- `/blog/alternative-to-pipecat`
- `/blog/alternative-to-livekit-agents`

**Mensuel (1 refresh max par 30 jours)** — pages dont les chiffres bougent très vite :

- (aucune pour l'instant)

---

## 11. Publication et vérifications

- **Build** : `pnpm --filter @micdrop/website build` depuis la racine du dépôt (ou `pnpm build`
  depuis `website/`). Typecheck : `pnpm --filter @micdrop/website typecheck` (`astro check`).
- **Serveur de dev** : supposé déjà lancé, ne pas en démarrer un autre.
- **Social preview** : pas de script dédié. La preview vient de `SocialPreview.astro`, alimenté par
  `title` / `summary` / `image` de l'article ; vérifier que l'article porte bien une `image` pour
  obtenir une carte `summary_large_image`.
- **Sitemap** : le jeu d'URL publiées doit rester un sur-ensemble de celui de l'ancien site
  Docusaurus. Vérifier `dist/sitemap-0.xml` après un build quand des URL bougent.
- **Cache Astro** : vider le cache implique aussi `node_modules/.astro`, sinon des rendus obsolètes
  survivent.
- **Longueurs SERP** : titre SEO ≤ 60 caractères, description (`summary`) ≤ 160 caractères.
- **Style rédactionnel** (voir `CLAUDE.md` du dépôt) : pas de tiret cadratin ni de tiret simple
  comme ponctuation, formulations positives plutôt que négatives, pas de motif « Libellé : » type
  « Objectif : », l'information s'intègre dans la phrase.
- **Analytics** : Umami, chargé uniquement dans les builds de production
  (`PUBLIC_UMAMI_WEBSITE_ID` dans `.env`).
- **Commit** : jamais sans validation humaine.

---

## 12. Checks d'audit acceptés

Checks de l'audit on-page que les revues ne corrigent pas et ne rapportent plus.

- `has_render_blocking_resources` : il vient de l'unique feuille `/_astro/BaseLayout.*.css` (57 Ko,
  11 Ko gzip, servie en cache `immutable` un an). L'inliner fait passer le HTML de
  `/docs/getting-started` de 10 à 21 Ko gzip, et chaque page vue retélécharge alors le CSS au lieu de
  le lire en cache.
