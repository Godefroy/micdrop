# IA Vocale Souveraine 🇫🇷🇪🇺

Micdrop permet de construire une solution d'**IA vocale entièrement souveraine**, en combinant des fournisseurs d'IA français et européens. Aucune donnée ne quitte l'Union Européenne.

## Pourquoi une IA vocale souveraine ?

### Souveraineté des données

Les solutions vocales classiques (OpenAI, Google, etc.) font transiter vos données par des serveurs américains, soumis au [Cloud Act](https://fr.wikipedia.org/wiki/CLOUD_Act). Pour les entreprises européennes, les administrations, la santé, ou l'éducation, cela pose des problèmes majeurs :

- **Conformité RGPD** : les données vocales sont des données personnelles sensibles
- **Confidentialité** : les conversations peuvent contenir des informations stratégiques
- **Dépendance technologique** : dépendre d'un fournisseur non-européen crée un risque géopolitique

### La stack souveraine française

Micdrop intègre nativement trois fournisseurs français qui couvrent l'ensemble de la chaîne vocale :

| Composant | Fournisseur | Rôle |
|-----------|-------------|------|
| **Agent (LLM)** | [Mistral](/docs/ai-integration/provided-integrations/mistral) | Modèle de langage français de classe mondiale |
| **Speech-to-Text** | [Gladia](/docs/ai-integration/provided-integrations/gladia) | Transcription en temps réel, 90+ langues, excellent en français |
| **Text-to-Speech** | [Gradium](/docs/ai-integration/provided-integrations/gradium) | Synthèse vocale naturelle avec des voix françaises |

Ces trois entreprises sont françaises, hébergent leurs données en Europe et sont conformes au RGPD.

## Mise en place

### Installation

```bash
npm install @micdrop/server @micdrop/client @micdrop/mistral @micdrop/gladia @micdrop/gradium
```

### Configuration du serveur

```typescript
import { MicdropServer } from '@micdrop/server'
import { MistralAgent } from '@micdrop/mistral'
import { GladiaSTT } from '@micdrop/gladia'
import { GradiumTTS } from '@micdrop/gradium'

// Agent conversationnel avec Mistral
const agent = new MistralAgent({
  apiKey: process.env.MISTRAL_API_KEY || '',
  model: 'mistral-large-latest',
  systemPrompt: 'Tu es un assistant vocal en français. Réponds de manière concise et naturelle.',
})

// Reconnaissance vocale avec Gladia
const stt = new GladiaSTT({
  apiKey: process.env.GLADIA_API_KEY || '',
  settings: {
    language_config: {
      languages: ['fr'],
    },
  },
})

// Synthèse vocale avec Gradium
const tts = new GradiumTTS({
  apiKey: process.env.GRADIUM_API_KEY || '',
  voiceId: 'YOUR_FRENCH_VOICE_ID',
  region: 'eu',
})

// Assembler le tout avec MicdropServer
new MicdropServer(socket, {
  agent,
  stt,
  tts,
})
```

### Configuration du client

```typescript
import { MicdropClient } from '@micdrop/client'

const client = new MicdropClient({
  url: 'wss://votre-serveur.fr/micdrop',
})

// Démarrer la conversation vocale
await client.start()
```

## Cas d'usage

### Administration et service public

Les services publics français peuvent déployer des assistants vocaux conformes aux exigences de l'ANSSI et de la CNIL, sans aucune dépendance aux GAFAM.

### Santé

Les données de santé nécessitent un hébergement HDS (Hébergeur de Données de Santé). Avec une stack souveraine, les données vocales des patients restent en France.

### Entreprises

Protégez vos données stratégiques et assurez la conformité RGPD sans compromis sur la qualité de l'IA.

### Éducation

Offrez aux établissements scolaires des outils d'IA vocale sans exposer les données des élèves à des entreprises extra-européennes.

## Avantages de cette approche

- **Aucune donnée hors UE** : toute la chaîne de traitement reste en Europe
- **Conformité RGPD native** : pas de transfert de données vers des pays tiers
- **Latence réduite** : les serveurs européens sont plus proches de vos utilisateurs
- **Qualité française** : Mistral, Gladia et Gradium sont spécialement optimisés pour le français
- **Open-source** : Micdrop est MIT, vous gardez le contrôle total de votre infrastructure
- **Interchangeable** : grâce à l'architecture modulaire de Micdrop, vous pouvez remplacer n'importe quel composant à tout moment
