---
slug: gradium-text-to-speech-souverain
title: "Gradium : intégrer un text-to-speech souverain dans votre IA vocale"
description: "Guide complet pour intégrer Gradium, le TTS français issu de Kyutai, dans une application web avec Micdrop. Souveraineté des données, conformité RGPD, qualité vocale et stratégie de fallback."
authors: [godefroy]
tags: [gradium, tts, souveraineté, rgpd, ia-vocale, text-to-speech, france]
keywords:
  - Gradium TTS
  - text-to-speech souverain
  - text-to-speech français
  - synthèse vocale IA
  - TTS open source
  - RGPD TTS
  - IA vocale souveraine
  - Micdrop voice AI
  - alternative ElevenLabs
  - TTS européen
  - Kyutai
  - voice AI France
---

La synthèse vocale est un maillon critique de toute IA vocale. Mais quand vos données transitent par des serveurs américains soumis au Cloud Act, la question de la souveraineté se pose. **Gradium**, startup française issue du laboratoire Kyutai, propose un TTS de nouvelle génération avec hébergement européen et conformité RGPD native.

Dans cet article, nous verrons comment intégrer Gradium dans une application web avec Micdrop, pourquoi la souveraineté des données est un enjeu majeur pour les IA vocales, et comment mettre en place une stratégie de fallback pour garantir la résilience de votre service.

<!-- truncate -->

## Qu'est-ce que Gradium ?

[Gradium](https://gradium.ai) est une startup parisienne fondée par d'anciens chercheurs de Meta, Google DeepMind, Google Brain et Jane Street. Issue du laboratoire de recherche français [Kyutai](https://kyutai.org), elle a levé 70 millions de dollars en seed fin 2025 auprès de FirstMark Capital, Eurazeo et d'investisseurs comme Eric Schmidt et Yann LeCun.

Gradium développe des **modèles de langage audio-natifs** pour le text-to-speech et le speech-to-text en temps réel.

### Caractéristiques clés

| Caractéristique | Détail |
|---|---|
| **Voix disponibles** | 150+ voix dans 5 langues (FR, EN, DE, ES, PT) |
| **Clonage vocal** | À partir de 10 secondes d'audio |
| **Streaming** | WebSocket temps réel avec timestamps mot par mot |
| **Régions** | Serveurs EU et US au choix |
| **Formats audio** | PCM (8/16/24/48 kHz), WAV, Opus, µ-law, A-law |
| **Latence** | < 300 ms (time-to-first-byte) |
| **Code-switching** | Changement de langue en milieu de phrase |

### Pourquoi Gradium pour la souveraineté ?

C'est le point central : Gradium est une **entreprise française**, soumise au droit européen, qui héberge ses données en Europe. Contrairement à ElevenLabs (New York) ou Cartesia (San Francisco), Gradium offre :

- **Hébergement EU-first** : les données restent dans l'Union Européenne
- **Zéro rétention de données** sur les plans Enterprise
- **Cloud privé** : déploiement on-premise possible
- **Conformité RGPD native** : pas de transfert vers des pays tiers
- **Pas de Cloud Act** : les autorités américaines ne peuvent pas exiger l'accès à vos données

Pour les entreprises, administrations, établissements de santé et acteurs de l'éducation, c'est un avantage décisif.

## Intégration avec Micdrop

[Micdrop](https://micdrop.dev) est un framework TypeScript open source pour ajouter des conversations vocales IA dans les applications web. L'intégration de Gradium se fait en quelques lignes grâce au package `@micdrop/gradium`.

### Installation

```bash
npm install @micdrop/server @micdrop/gradium
```

### Configuration de base

```typescript
import { MicdropServer } from '@micdrop/server'
import { GradiumTTS } from '@micdrop/gradium'

const tts = new GradiumTTS({
  apiKey: process.env.GRADIUM_API_KEY || '',
  voiceId: 'YOUR_VOICE_ID',
  region: 'eu', // Serveurs européens
  outputFormat: 'pcm_16000',
})

new MicdropServer(socket, {
  tts,
  agent, // Votre agent LLM
  stt,   // Votre provider STT
})
```

La région `eu` est la valeur par défaut : vos données ne quittent jamais l'Union Européenne sans action explicite de votre part.

### Configuration avancée de la voix

Gradium permet un contrôle fin de la génération vocale :

```typescript
const tts = new GradiumTTS({
  apiKey: process.env.GRADIUM_API_KEY || '',
  voiceId: 'YOUR_VOICE_ID',
  region: 'eu',
  outputFormat: 'pcm_16000',
  jsonConfig: {
    temp: 0.7,          // Expressivité (0 → monotone, 1.4 → très expressif)
    cfg_coef: 2.0,      // Fidélité à la voix originale (1.0 → libre, 4.0 → fidèle)
    padding_bonus: 0,   // Vitesse (-4.0 → rapide, 4.0 → lent)
  },
})
```

## La stack souveraine complète

L'intérêt de Gradium se décuple quand on l'associe aux autres fournisseurs français pour construire une **stack IA vocale entièrement souveraine** :

| Composant | Fournisseur | Rôle |
|-----------|-------------|------|
| **Agent (LLM)** | [Mistral](https://mistral.ai) | Modèle de langage français de classe mondiale |
| **Speech-to-Text** | [Gladia](https://gladia.io) | Transcription temps réel, 90+ langues |
| **Text-to-Speech** | [Gradium](https://gradium.ai) | Synthèse vocale naturelle |

### Exemple complet

```typescript
import { MicdropServer } from '@micdrop/server'
import { MistralAgent } from '@micdrop/mistral'
import { GladiaSTT } from '@micdrop/gladia'
import { GradiumTTS } from '@micdrop/gradium'

const agent = new MistralAgent({
  apiKey: process.env.MISTRAL_API_KEY || '',
  model: 'mistral-large-latest',
  systemPrompt:
    'Tu es un assistant vocal en français. Réponds de manière concise et naturelle.',
})

const stt = new GladiaSTT({
  apiKey: process.env.GLADIA_API_KEY || '',
  settings: {
    language_config: { languages: ['fr'] },
  },
})

const tts = new GradiumTTS({
  apiKey: process.env.GRADIUM_API_KEY || '',
  voiceId: 'YOUR_FRENCH_VOICE_ID',
  region: 'eu',
})

new MicdropServer(socket, { agent, stt, tts })
```

Avec cette configuration, **aucune donnée ne quitte l'Union Européenne**. Pas de Cloud Act, pas de transfert vers des pays tiers, conformité RGPD totale.

## Stratégie de fallback pour la résilience

En production, la fiabilité est non négociable. Micdrop intègre un mécanisme de **fallback automatique** entre fournisseurs TTS. Si Gradium rencontre un problème, le système bascule automatiquement vers un provider de secours sans interruption pour l'utilisateur.

### TTS avec fallback

```typescript
import { FallbackTTS } from '@micdrop/server'
import { GradiumTTS } from '@micdrop/gradium'
import { ElevenLabsTTS } from '@micdrop/elevenlabs'

const tts = new FallbackTTS({
  factories: [
    // Provider principal : Gradium (souverain)
    () =>
      new GradiumTTS({
        apiKey: process.env.GRADIUM_API_KEY || '',
        voiceId: process.env.GRADIUM_VOICE_ID || '',
        region: 'eu',
        maxRetry: 2,
      }),
    // Backup : ElevenLabs
    () =>
      new ElevenLabsTTS({
        apiKey: process.env.ELEVENLABS_API_KEY || '',
        voiceId: process.env.ELEVENLABS_VOICE_ID || '',
        maxRetry: 3,
      }),
  ],
})
```

Le `FallbackTTS` fonctionne ainsi :

1. Il utilise le premier provider (Gradium) par défaut
2. Si Gradium échoue après ses retries, il **bufferise le texte** en cours
3. Il bascule automatiquement sur ElevenLabs
4. Le texte bufferisé est **rejoué** sur le nouveau provider
5. L'utilisateur ne perçoit qu'une micro-interruption

Cette approche vous permet de **privilégier la souveraineté** au quotidien tout en garantissant la disponibilité du service.

## Comparaison avec les alternatives

| Critère | Gradium | ElevenLabs | Cartesia |
|---------|---------|------------|----------|
| **Siège** | Paris, France | New York, USA | San Francisco, USA |
| **Serveurs EU** | Natif | Non prioritaire | Non |
| **Rétention données** | Zéro (Enterprise) | Standard US | Standard US |
| **Cloud Act** | Non soumis | Soumis | Soumis |
| **Langues** | 5 | 70+ | 15 |
| **Clonage vocal** | 10s | 30s | 3s |
| **Streaming WebSocket** | Oui | Oui | Oui |
| **Tarification** | Par caractère | Par caractère | Par caractère |

ElevenLabs reste supérieur en nombre de langues supportées. Cartesia offre un clonage vocal plus rapide. Mais **aucun des deux ne peut garantir que vos données restent en Europe**.

## Cas d'usage

### Service public et administration

Les administrations françaises soumises aux recommandations de l'ANSSI et de la CNIL peuvent déployer un assistant vocal sans dépendance aux GAFAM. Les données des citoyens restent sur le sol européen.

### Santé et HDS

Les données de santé exigent un hébergement HDS (Hébergeur de Données de Santé). Avec Gradium en région EU et un hébergement conforme, les données vocales des patients ne quittent jamais la France.

### Entreprise et confidentialité

Les conversations internes, les interactions avec les clients, les données stratégiques : tout reste en Europe. Pas de risque d'accès par des autorités étrangères.

### Éducation

Les établissements scolaires peuvent proposer des outils d'IA vocale sans exposer les données des élèves à des entreprises extra-européennes.

## Pour aller plus loin

- [Documentation Gradium dans Micdrop](/docs/ai-integration/provided-integrations/gradium)
- [Guide IA Vocale Souveraine](/docs/ai-integration/sovereign-voice-ai)
- [Stratégies de fallback TTS](/docs/ai-integration/fallback-strategies/tts-fallback)
- [Site officiel Gradium](https://gradium.ai)

---

La souveraineté des données n'est plus un luxe, c'est une nécessité. Avec Gradium et Micdrop, vous pouvez construire une IA vocale de qualité professionnelle sans compromis sur la conformité RGPD. Et grâce au système de fallback, vous ne sacrifiez jamais la résilience au profit de la souveraineté.
