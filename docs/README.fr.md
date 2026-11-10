<div align="center">

![LittleAIBox Logo](../public/images/pwa-192x192.png)

# LittleAIBox

**Un Assistant de Conversation IA Moderne et Multiplateforme**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Platform](https://img.shields.io/badge/Platform-Web%20%7C%20PWA%20%7C%20Android-orange)](https://github.com/diandiancha/LittleAIBox)
[![Language](https://img.shields.io/badge/Language-Multi--language-blue)](https://github.com/diandiancha/LittleAIBox)
[![Product Hunt](https://img.shields.io/badge/Product%20Hunt-LittleAIBox-orange?logo=product-hunt)](https://www.producthunt.com/products/littleaibox)

[中文](README.zh-CN.md) | [English](../README.md) | [日本語](README.ja.md) | [한국어](README.ko.md) | [Español](README.es.md) | [Français](README.fr.md)

Ce projet est construit avec l'**API Google Gemini** pour des interactions d'IA conversationnelle, offrant une expérience d'IA intelligente.

</div>

> **Périmètre et mise à jour :** ce document présente les fonctions et l’architecture du projet complet. Le dépôt publie une sélection du frontend, sans serveurs, paiements, règles commerciales ni identifiants. La version 3.1.0 actualise les diagrammes, formules, Workers de documents et le clavier. L’analyse locale et l’envoi au modèle sont distincts. Voir le [README anglais](../README.md) pour les conditions et mécanismes à jour.

---

> 🎓 Ce projet est développé à des fins éducatives et de recherche.  

> 💼 Les déploiements commerciaux et les services premium sont exploités séparément par l'auteur pour assurer la sécurité et la durabilité.

---

## 🎯 À Qui S'adresse Ce Projet ?

LittleAIBox est parfait pour :

- **Utilisateurs dans des Régions Restreintes** : Solutions de relais de service intégrées pour vous connecter facilement à Gemini
- **Étudiants et Chercheurs** : Analysez des articles, des présentations et des documents sans quitter votre navigateur
- **Développeurs** : Obtenez de l'aide pour le code avec le contexte des fichiers, des explications de code et une assistance technique
- **Créateurs de Contenu** : Générez et éditez du contenu markdown avec le support de l'IA
- **Utilisateurs Soucieux de la Vie Privée** : Tout le traitement se fait localement ; vous contrôlez vos données

---

### 🚀 Démonstration en Direct

<div align="center">

**Essayez maintenant :**  

[![Visiter l'Application](https://img.shields.io/badge/Ouvrir%20LittleAIBox-Cliquez%20Ici-brightgreen?style=for-the-badge)](https://littleaibox.com)

</div>

### 💡 Pourquoi LittleAIBox ?

**Qu'est-ce qui rend ce projet différent ?**

| Fonctionnalité | LittleAIBox | Autres |
|---------|-------------|--------|
| Traitement de Fichiers | 📄 Support PPTX, DOCX, PDF, XLSX | Limité ou côté serveur uniquement |
| Vie Privée | 🔒 Traitement côté client, pas de téléchargement | Nécessite souvent le téléchargement de fichiers |
| Support Hors Ligne | 📱 PWA complète, fonctionne hors ligne | Capacités hors ligne limitées |
| Multiplateforme | 🌐 Web + PWA + Android natif | Généralement web ou mobile uniquement |
| Framework | ⚡ Vanilla JS, zéro surcharge | Souvent dépendances React/Vue |
| Accès Régional | 🌍 Solution de relais de service intégrée | Peut être restreint régionalement |
| **Haute Disponibilité** | 🛡️ **Pool d'API de niveau entreprise** avec vérifications de santé et basculement automatique | ❌ Dépendance API unique, sujet aux pannes |
| Open Source | ✅ 100% frontend open-source | Variable |
| Coût | 💰 Utilisez votre propre clé API | Souvent basé sur abonnement |

**Choisissez LittleAIBox si vous voulez** : Confidentialité maximale, conception hors ligne d'abord, zéro dépendance de framework et contrôle total sur vos conversations IA.

### 🌟 Description Officielle

> **Plateforme de Chat IA Privée et Globale**

> LittleAIBox est une application de chat IA Gemini full-stack et multiplateforme (construite avec Vite/Capacitor/Cloudflare) dotée d'un backend intelligent de mise en commun d'API et de proxy qui contourne les restrictions régionales pour un accès global stable. Les fonctionnalités clés incluent :

> - Analyse côté client (support PDF/DOCX/PPTX)
> - Rendu Mermaid/LaTeX/Vega-Lite avec export de graphiques
> - Recherche web en temps réel et mode recherche Semantic Scholar
> - Navigation chronologique des conversations
> - Gestion de double clé API avec équilibrage de charge intelligent
> - Paramètres IA personnalisables et préréglages de tâches

> Les documents sont analysés et affichés dans le navigateur. Les messages et les fonctions cloud peuvent transmettre le contenu sélectionné au service configuré et au fournisseur du modèle. Une analyse locale ne signifie pas une inférence hors ligne.

> *[Voir sur Product Hunt →](https://www.producthunt.com/products/littleaibox)*

### 📱 Captures d'Écran de l'Application

#### Page Principale

![Page Principale - Français](../appshow/main_fr.png)

#### Page d'Exemple

![Page d'Exemple - Français](../appshow/example_fr.png)

#### Page de Confidentialité

![Page de Confidentialité - Français](../appshow/privacy_fr.png)

---

## ✨ Fonctionnalités Principales

### 🎯 **Traitement Intelligent des Fichiers**
- **Documents Office** : Analysez des fichiers Word (.docx), PDF, Excel (.xlsx, .xls, .csv) et **PowerPoint (.pptx)** directement dans le navigateur
- **Médias Enrichis** : Support pour les images et les fichiers Markdown
- **Fichiers Texte Brut** : Support pour divers formats de fichiers texte
- **Visionneuse de Fichiers** : Visionneuse intégrée avec coloration syntaxique pour les fichiers de code, aperçu des images et rendu de texte enrichi
- **Zéro Téléchargement Requis** : Tout le traitement des fichiers se fait côté client pour une confidentialité maximale

### 🔐 **Conception Axée sur la Vie Privée**
- **Pas d'Inscription Requise** : Commencez à utiliser immédiatement sans créer de compte
- **Options de Connexion Multiples** : Email/mot de passe, OAuth (Google, GitHub) ou mode invité
- **Authentification Multi-Facteurs (MFA)** : Support optionnel d'application d'authentification TOTP avec codes de secours
- **Gestion de Double Clé API** : Configurez deux clés API avec mode mixte intelligent (équilibrage de charge) ou mode unique (basculement de secours)
- **Auto-Configuration de Clé API** : Utilisez votre propre clé API Gemini, avec contrôle total des données
- **Stockage Flexible** : Les clés API des utilisateurs enregistrés sont persistées pour la synchronisation multi-appareils ; les clés des utilisateurs invités sont stockées localement uniquement et automatiquement effacées lors du rafraîchissement de la page, garantissant la confidentialité
- **Gestion des Mots de Passe** : Réinitialisation sécurisée du mot de passe via vérification par email
- **Avatar Personnalisé** : Téléchargez et gérez votre avatar de profil

### 🌍 **Accès Universel**
- **Solution de Restriction Régionale** : Routage de relais de service intégré pour contourner les limitations géographiques
- **Hors Ligne d'Abord** : Support PWA complet avec capacités hors ligne
- **Multiplateforme** : Fonctionne parfaitement sur Web, PWA et applications Android natives

### 💬 **Rendu Markdown Avancé**
- **Coloration de Code** : Support pour plus de 40 langages de programmation
- **Expressions Mathématiques** : Beau rendu mathématique avec KaTeX
- **Diagrammes** : Support de diagrammes Mermaid interactifs avec export PNG/SVG
- **Visualisation de Données** : Rendu de graphiques Vega-Lite avec graphiques interactifs et export PNG
- **Rendu Mindmap** : Rendu et aperçu de cartes mentales basés sur Markmap
- **Export de Graphiques** : Téléchargez les graphiques générés (diagrammes Mermaid et visualisations Vega-Lite) en fichiers PNG ou SVG
- **GitHub Flavored Markdown** : Support complet GFM avec coloration syntaxique
- **Rythme du Streaming** : Réutilise le régulateur du projet complet pour adapter la sortie aux arrivées de texte et à la file des familles de modèles prises en charge, en conservant la saisie de repli pour les autres modèles
- **Contenu Riche Incrémental** : Réutilise les utilitaires de mise à jour du DOM et d’état des formules du projet complet pour ajouter du contenu, conserver les nœuds rendus réutilisables et restaurer le défilement horizontal des formules correspondantes après remplacement d’une zone

### 🛠️ **Fonctionnalités IA Avancées**
- **Modes d'Interaction Multiples** :
  - **Mode Recherche** : Intégration de recherche web en temps réel pour des informations à jour
  - **Mode Recherche Académique** : Recherche académique alimentée par l'API Semantic Scholar - recherche et cite automatiquement des articles académiques pertinents, structure les réponses avec le format Résumé/Introduction/Méthodes/Résultats/Discussion/Conclusion, et fournit des citations dans le texte [1], [2]...
  - **Mode Génération d'Images** : Création d'images alimentée par l'IA
- **Paramètres IA Personnalisables** : Ajustez le comportement de l'IA avec :
  - Prompts système pour la personnalisation des rôles
  - Contrôle de température (créativité vs. cohérence)
  - Paramètres avancés (topK, topP)
  - Préréglages de tâches (assistant de codage, assistant d'écriture, traduction, recherche en chinois classique, guide de voyage, jeu de rôle créatif)

### 🧾 **Export Productivité**
- **Export Multi-format** : Exportez chats/contenu en DOCX / PDF / PPTX / XLSX
- **Préservation de Structure** : Conserve titres, listes, code, formules, tableaux, diagrammes et images

### 🔗 **Collaboration Bridge**
- **Continuité de Contexte** : Hérite du contexte des conversations sources pour poursuivre l'échange

### 📲 **Expérience de Mise à Jour Native**
- **Détection APK** : Détecte les nouvelles versions et bascule vers la page de téléchargement si nécessaire

### 📌 **Portée Open-Source**
- **Frontend Uniquement** : Ce dépôt publie uniquement le frontend ; backend abonnement/paiement omis

### 🌐 **Support Multilingue**
- **6 Langues** : Chinois (Simplifié/Traditionnel), Anglais, Japonais, Coréen, Espagnol, Français
- **Détection Intelligente** : Détection automatique de la langue basée sur les paramètres du navigateur
- **Chargement Optimisé** : Mise en cache intelligente des traductions pour un changement de langue instantané

### 🎨 **Belle Interface UI/UX**
- **Mode Sombre/Clair** : Changement de thème fluide
- **Polices Personnalisées** : Choisissez entre la police système par défaut, serif, monospace ou cursive élégante
- **Design Responsive** : Parfait sur bureau, tablette et mobile
- **Sensation Native** : Intégration Capacitor pour une expérience mobile native
- **Chronologie de Conversation** : Navigation chronologique flottante pour un accès rapide aux messages de l'assistant

### ⚡ **Optimisé pour la Performance**
- **Chargement Rapide** : Build alimenté par Vite avec division de code
- **Mise en Cache Intelligente** : Service Worker avec stratégies de cache intelligentes
- **Léger** : JavaScript pur (pas de frameworks lourds)

### 🛡️ **Architecture Backend de Niveau Entreprise**
- **Pool Élastique de Clés API** : Rotation multi-clés de niveau production avec équilibrage de charge automatique
- **Vérification de Santé et Disjoncteur** : Surveillance en temps réel et protection de basculement intelligent
- **Dégradation Intelligente à 4 Niveaux** : Continuité de service fluide même en cas de pannes
- **Haute Disponibilité** : Disponibilité garantie avec contournement automatique des restrictions régionales

---

## 🏗️ Architecture

### 🏗️ Diagramme du Système

```mermaid
flowchart TB
    %% The complete project is shown; the public frontend snapshot is partial.
    subgraph FRONTEND["Complete frontend: Web / PWA / Capacitor; public snapshot is partial"]
        direction TB
        subgraph INTERACTION["Interaction and platform adapters"]
            F_ENTRY["Application entry / routing / settings"]
            F_COMPOSER["Composer / attachments / mode selection"]
            F_KEYBOARD["Native and browser keyboard drivers"]
            F_VIEWPORT["Viewport sampling / scroll anchoring"]
            F_I18N["Locales / themes / resource loading"]
            F_NATIVE["Native bridge / files / sharing / updates"]
        end
        subgraph DOCUMENTS["Document and multimodal processing"]
            F_READERS["PDF / Office / text readers"]
            F_WORKERS["PDF / spreadsheet Workers and fallback"]
            F_IMAGES["Image blobs / hashes / CID references"]
            F_DOC_PLAN["Document intent / task routing / chunks"]
            F_DOC_PROCESS["Summary / retrieval / code structure"]
            F_VISION["Relevant image selection / visual review"]
        end
        subgraph ORCHESTRATION["Request and retrieval orchestration"]
            F_HISTORY["Conversation history / context budget"]
            F_RETRIEVAL["Search / research planning and evidence"]
            F_CONTEXT["Document / image / conversation context"]
            F_ASSEMBLER["Messages / model parameters / request IDs"]
            F_TRANSPORT["Request transport / cancellation / errors"]
        end
        subgraph PRESENTATION["Streaming and productivity"]
            F_STREAM["Response stream / pacing / incremental DOM"]
            F_MARKDOWN["Markdown / highlighting / math protection"]
            F_CHARTS["KaTeX / Mermaid / Vega / mind maps"]
            F_IMAGE_VIEW["CID resolution / generated image layout"]
            F_EXPORT["Word / Excel / PPT / PDF export"]
            F_EXTENSIONS["Canvas / entertainment modules: not synced"]
        end
        subgraph CLIENT_STATE["Conversation and local state"]
            F_CHAT["Conversations / turns / message identity"]
            F_SYNC["Save queue / sync state / remote changes"]
            F_CACHE["IndexedDB / cache policy / eviction"]
            F_PWA["Service Worker / PWA cache and updates"]
            F_BRIDGE["Parent-child conversation context bridge"]
        end
    end

    subgraph SHARED["Frontend/backend contracts: shared-runtime"]
        S_MODELS["Model metadata / request and context policy"]
        S_ATTACH["Image protocol / attachment hashes and persistence"]
        S_SYNC["Conversation / turn order and sync state"]
    end

    subgraph SERVICE["Cloudflare Pages Functions: backend source not included"]
        B_GATEWAY["Unified entry / version checks / routing"]
        B_SESSION["Sessions / visitor identity / access control"]
        B_AUTH["Email login / OAuth / MFA / password flows"]
        B_DATA["Conversation / turn / attachment / share APIs"]
        B_MODEL["Model requests / tools / streamed responses"]
        B_SEARCH["Web / image / academic retrieval"]
        B_RESOURCE["Image generation / resource proxying"]
        B_STORAGE["Message commits / titles / attachment lifecycle"]
    end

    subgraph MODEL_RELIABILITY["Model integration and reliability responsibilities"]
        M_ADAPTER["Model catalog / parameters / provider adapters"]
        M_KEYS["User keys / server pools / health statistics"]
        M_RETRY["Retry / circuit breaking / controlled fallback"]
        M_LIMITER["Rate limiter Worker / Durable Object"]
    end

    subgraph INFRASTRUCTURE["Storage and background maintenance"]
        D_DATABASE["D1: users / sessions / messages / settings"]
        D_OBJECTS["R2: document sources / images / avatars"]
        D_KV["KV: session state / cache / temporary state"]
        D_QUEUE["Cleanup queue / delayed retries"]
        D_CLEANUP["Cleanup consumer / referenced-resource checks"]
        D_CRON["Scheduled maintenance / retry scheduling"]
        D_DLQ["Dead-letter queue / manual investigation"]
    end

    subgraph EXTERNAL["External identity, data and model providers"]
        X_MODELS["Gemini / OpenAI-compatible / Claude services"]
        X_WEB["Brave web and image search"]
        X_ACADEMIC["Semantic Scholar / OpenAlex"]
        X_IMAGE["Image generation providers"]
        X_IDENTITY["Google / GitHub OAuth"]
        X_EMAIL["Email delivery service"]
    end

    S_MODELS -.-> F_HISTORY
    S_MODELS -.-> M_ADAPTER
    S_ATTACH -.-> F_IMAGES
    S_ATTACH -.-> B_STORAGE
    S_SYNC -.-> F_SYNC
    S_SYNC -.-> B_STORAGE

    %% Solid links: main data/request paths; dotted links: coordination or lifecycle work.
    F_ENTRY --> F_COMPOSER
    F_I18N -.-> F_ENTRY
    F_ENTRY -.-> F_EXTENSIONS
    F_NATIVE -.-> F_COMPOSER
    F_KEYBOARD --> F_VIEWPORT
    F_VIEWPORT -.-> F_ENTRY
    F_COMPOSER --> F_READERS
    F_READERS --> F_WORKERS
    F_READERS --> F_IMAGES
    F_READERS --> F_DOC_PLAN
    F_DOC_PLAN --> F_DOC_PROCESS
    F_IMAGES --> F_VISION
    F_DOC_PROCESS --> F_CONTEXT
    F_DOC_PROCESS -.-> F_TRANSPORT
    F_VISION -.-> F_TRANSPORT
    F_VISION --> F_CONTEXT
    F_COMPOSER --> F_CONTEXT
    F_HISTORY --> F_CONTEXT
    F_RETRIEVAL --> F_CONTEXT
    F_BRIDGE --> F_HISTORY
    F_CONTEXT --> F_ASSEMBLER --> F_TRANSPORT
    F_TRANSPORT --> B_GATEWAY
    F_RETRIEVAL --> B_GATEWAY
    B_MODEL --> F_STREAM
    F_STREAM --> F_MARKDOWN
    F_MARKDOWN --> F_CHARTS
    F_STREAM --> F_IMAGE_VIEW
    F_CHARTS --> F_ENTRY
    F_IMAGE_VIEW --> F_ENTRY
    F_MARKDOWN --> F_EXPORT
    F_MARKDOWN -.-> F_EXTENSIONS
    F_STREAM --> F_CHAT
    F_CHAT --> F_HISTORY
    F_CHAT --> F_SYNC
    F_SYNC <--> F_CACHE
    F_IMAGES --> F_CACHE
    F_PWA -.-> F_ENTRY
    F_SYNC <--> B_GATEWAY
    B_GATEWAY --> B_SESSION
    B_GATEWAY --> B_AUTH
    B_SESSION --> B_DATA
    B_SESSION --> B_MODEL
    B_SESSION --> B_SEARCH
    B_SESSION --> B_RESOURCE
    B_AUTH --> X_IDENTITY
    B_AUTH --> X_EMAIL
    B_AUTH --> D_DATABASE
    B_SESSION --> D_KV
    B_DATA --> B_STORAGE
    B_STORAGE --> D_DATABASE
    B_STORAGE --> D_OBJECTS
    B_MODEL --> M_ADAPTER
    M_ADAPTER --> M_RETRY
    M_KEYS -.-> M_RETRY
    M_LIMITER -.-> B_MODEL
    M_RETRY --> X_MODELS
    B_SEARCH --> X_WEB
    B_SEARCH --> X_ACADEMIC
    B_RESOURCE --> X_IMAGE
    B_RESOURCE --> D_OBJECTS
    B_SEARCH -.-> D_KV
    B_STORAGE -.-> D_QUEUE
    D_CRON --> D_QUEUE
    D_QUEUE --> D_CLEANUP
    D_CLEANUP --> D_DATABASE
    D_CLEANUP --> D_OBJECTS
    D_CLEANUP -.-> D_DLQ

    classDef frontend fill:#e8f1ff,stroke:#5276a7,color:#172b4d
    classDef backend fill:#fff3dc,stroke:#ab7d32,color:#49330d
    classDef storage fill:#edf3ef,stroke:#63836c,color:#203e2b
    classDef external fill:#f0eafa,stroke:#8466a6,color:#39244f
    classDef shared fill:#eff3f7,stroke:#748598,color:#25384b
    classDef extension fill:#f7edf3,stroke:#ad6d91,color:#54243f
    class F_ENTRY,F_COMPOSER,F_KEYBOARD,F_VIEWPORT,F_I18N,F_NATIVE frontend
    class F_READERS,F_WORKERS,F_IMAGES,F_DOC_PLAN,F_DOC_PROCESS,F_VISION frontend
    class F_HISTORY,F_RETRIEVAL,F_CONTEXT,F_ASSEMBLER,F_TRANSPORT frontend
    class F_STREAM,F_MARKDOWN,F_CHARTS,F_IMAGE_VIEW,F_EXPORT frontend
    class F_CHAT,F_SYNC,F_CACHE,F_PWA,F_BRIDGE frontend
    class B_GATEWAY,B_SESSION,B_AUTH,B_DATA,B_MODEL,B_SEARCH,B_RESOURCE,B_STORAGE,M_ADAPTER,M_KEYS,M_RETRY,M_LIMITER backend
    class D_DATABASE,D_OBJECTS,D_KV,D_QUEUE,D_CLEANUP,D_CRON,D_DLQ storage
    class X_MODELS,X_WEB,X_ACADEMIC,X_IMAGE,X_IDENTITY,X_EMAIL external
    class F_EXTENSIONS extension
    class S_MODELS,S_ATTACH,S_SYNC shared
```

### 🧩 Stack Frontend

**Technologies Principales**
- **Outil de Build** : Vite 7.x
- **Framework** : JavaScript Vanilla (Modules ES6+) - Zéro surcharge de framework
- **Styles** : Tailwind CSS 4.x
- **Mobile** : Capacitor 7.x (support Android)

**Bibliothèques Clés**
- **Markdown** : marked.js + DOMPurify
- **Coloration de Code** : highlight.js (plus de 40 langages)
- **Rendu Mathématique** : KaTeX
- **Graphiques** : Mermaid, Vega-Lite
- **Analyse de Fichiers** : mammoth (Word), PDF.js, xlsx, pptx2html
- **Stockage** : IndexedDB + localStorage
- **Authentification** : Sessions côté serveur et OAuth 2.0 (Google, GitHub)
- **Sécurité** : Support MFA/TOTP avec codes de secours

### 💾 Traitement Côté Client

Toute l'analyse et le traitement des fichiers se fait entièrement dans le navigateur :
- **Analyse PPTX** : Extraction complète du contenu PowerPoint
- **Lecture PDF** : Extraction de texte et métadonnées
- **Traitement Excel** : Analyse de données de feuilles de calcul (.xlsx, .xls, .csv)
- **Documents Word** : Analyse de fichiers DOCX avec préservation du formatage
- **Gestion d'Images** : Traitement d'images côté client et encodage base64

### Support Hors Ligne

- **Service Worker** : Stratégies de cache personnalisées
- **IndexedDB** : Stockage local de l'historique de chat et des paramètres
- **Application Web Progressive** : Installable et fonctionne hors ligne

### 🛡️ Architecture Backend

Le backend du projet est construit sur **Cloudflare Pages**, exploitant une architecture serverless moderne. 

**Pourquoi le backend est-il fermé ?**

Bien que je sois engagé pour la transparence, le backend reste fermé pour plusieurs raisons importantes :

1. **Sécurité** : Protection des données utilisateur, des clés API et des mécanismes d'authentification
2. **Contrôle des Coûts** : Prévention de l'abus des clés API et assurance de coûts de service durables
3. **Infrastructure** : Protection des stratégies d'optimisation propriétaires et des systèmes de basculement
4. **Conformité** : Respect des exigences régionales tout en maintenant la qualité du service

**Qu'est-ce qui est transparent ?**

- ✅ Tout le code frontend est open-source et sous licence MIT
- ✅ Tous les endpoints API sont publics et bien documentés
- ✅ Vous pouvez inspecter toutes les requêtes réseau
- ✅ Le traitement côté client est entièrement auditable
- ✅ Pas de suivi caché ni de collecte de données

**Pour les développeurs** : Le code frontend démontre toutes les interactions backend, et vous pouvez construire votre propre backend ou auto-héberger toute la pile. Toutes les API sont publiques et stables.

#### Couche de Base de Données Principale

**Cloudflare D1 (SQLite)**
- Système d'authentification utilisateur complet avec plusieurs méthodes de connexion :
  - Email/mot de passe avec hachage PBKDF2 sécurisé
  - Intégration OAuth 2.0 (Google, GitHub)
  - Mode invité pour utilisation anonyme
- Support d'Authentification Multi-Facteurs (MFA) :
  - Intégration d'application d'authentification TOTP
  - Génération et gestion de codes de secours
- Sessions enregistrées côté serveur avec expiration, invalidation et connexion multi-appareils
- Flux de réinitialisation de mot de passe avec vérification par email
- Persistance de l'historique de chat avec support de requête et récupération
- Gestion de configuration et préférences utilisateur

#### Principal : Pool Élastique de Clés API (APIKeyPool)

Ce système dispose d'un système de gestion de clés API de niveau production et haute disponibilité :

- **Rotation Multi-Clés** : Gestion intelligente de plusieurs clés API Gemini et Brave Search avec équilibrage de charge automatique
- **Mécanisme de Vérification de Santé** : Surveillance en temps réel de la disponibilité et de la qualité de réponse de chaque clé
- **Basculement Automatique** : Changement fluide vers les clés de secours quand une clé échoue ou atteint les limites de taux
- **Protection Disjoncteur** : Empêche les requêtes répétées vers les clés en échec, protégeant les ressources système
- **Stratégie de Réessai Intelligente** : Algorithme de recul exponentiel pour maximiser les taux de succès des requêtes

#### Principal : Système de Basculement et Dégradation Intelligent

Architecture de dégradation intelligente à quatre niveaux soigneusement conçue, assurant haute disponibilité et continuité de service :

1. **Priorité Clé Utilisateur** : Priorise les clés API configurées par l'utilisateur
2. **Mode Hybride** : Complète intelligemment avec les clés serveur quand nécessaire
3. **Mode Clé Unique** : Clé serveur comme solution de secours
4. **Basculement Serveur** : Protection finale assurant la continuité de service

Le système détecte et contourne automatiquement les restrictions régionales, les clés invalides, les pannes réseau et autres problèmes, fournissant aux utilisateurs un service cohérent et stable.

#### Écosystème de Services Intégrés

**Services Email**
- **Resend** : Pour les flux sécurisés de vérification d'email et de réinitialisation de mot de passe
- Support des templates HTML et du contenu email internationalisé
- Récupération et vérification de compte basées sur email

**Recherche et Contenu**
- **Brave Search API** : Résultats de recherche web de haute qualité pour améliorer la compréhension du contexte IA
- **Sources académiques** : Le service complet actuel intègre Semantic Scholar et OpenAlex

**Génération d'Images**
- **pollinations.ai** : Service de génération d'images haute performance supportant plusieurs styles artistiques
- Service proxy côté client pour la protection de la vie privée des utilisateurs

**Stockage Cloud**
- **Cloudflare R2** : Stockage d'objets compatible S3 pour les avatars et pièces jointes utilisateur
- Accélération CDN globale avec accès à faible latence
- **Cloudflare KV** : Stockage clé-valeur haute performance pour le cache, la gestion des sessions et le suivi des limites d'utilisation

---

## 📚 Documentation

<div align="center">

**Navigation Rapide vers les Ressources du Projet**

[![Guide d'Apprentissage](https://img.shields.io/badge/📘_Guide_d'Apprentissage-Cliquez_Ici-blue?style=for-the-badge&logo=bookstack)](../LEARN.md) 
[![Contribuer](https://img.shields.io/badge/🤝_Contribuer-Guide-orange?style=for-the-badge&logo=github)](CONTRIBUTING.es.md) 
[![Code de Conduite](https://img.shields.io/badge/🧠_Code_de_Conduite-Voir-green?style=for-the-badge&logo=checklist)](../.github/CODE_OF_CONDUCT.md) 
[![Sécurité](https://img.shields.io/badge/🛡️_Sécurité-Politique-red?style=for-the-badge&logo=shield-check)](../.github/SECURITY.md)

**📖 [Index Complet de la Documentation](../docs/)**

</div>

---

## 📁 Structure du Projet

```
LittleAIBox/
├── src/                    # Code source
│   ├── main.js            # Logique principale de l'application
│   ├── stream-pacer.js    # Régulateur adaptatif copié du projet complet
│   ├── stream-text-update.js # Planification et application des mises à jour incrémentales du DOM
│   ├── api-config.js      # Configuration de l'API
│   ├── auth-oauth.js      # Authentification OAuth (Google, GitHub)
│   ├── auth-template.js   # Templates UI d'authentification
│   ├── auth.css           # Styles d'authentification
│   ├── db.js              # Wrapper IndexedDB
│   ├── i18n.js            # Internationalisation
│   ├── mermaid-renderer.js # Rendu de diagrammes
│   ├── vega-renderer.js    # Rendu de graphiques Vega-Lite
│   ├── floating-timeline.js # Navigation chronologique de conversation
│   ├── floating-timeline.css # Styles de chronologie
│   ├── mfa-login.js       # Authentification multi-facteurs
│   ├── oauth-flow.js      # Gestion du flux OAuth
│   ├── router.js          # Routage côté client
│   ├── style.css          # Styles globaux
│   └── sw-custom.js       # Service Worker
├── public/                 # Ressources statiques
│   ├── locales/           # Fichiers de traduction (6 langues)
│   ├── libs/              # Bibliothèques tierces
│   ├── images/            # Images et icônes
│   └── manifest.webmanifest # Manifeste PWA
├── appshow/                # Captures d'écran par langue
├── docs/                   # Documentation (multi-langue)
├── capacitor.config.json   # Configuration de l'app mobile
├── vite.config.js          # Configuration de build
├── tailwind.config.js      # Configuration Tailwind CSS
└── package.json            # Dépendances
```

---

## 🚀 Démarrage

### 📝 Note d'Utilisation

**Note d'Utilisation** : Nous recommandons de configurer votre propre clé API Gemini pour la meilleure expérience. Pas d'inscription nécessaire - entrez simplement votre clé API dans la page des paramètres pour commencer.

Obtenir une Clé API : [Google AI Studio](https://aistudio.google.com/api-keys)

### Prérequis

- Node.js **^20.19.0 || >=22.12.0**
- npm ou yarn
- Une clé API Gemini (optionnel, mais recommandé pour la meilleure expérience)

> **Note** : Bien que le service puisse fonctionner avec des clés API partagées, nous recommandons fortement d'utiliser votre propre clé API pour de meilleures performances et confidentialité.

### Installation

```bash
# Cloner le dépôt
git clone https://github.com/diandiancha/LittleAIBox.git
cd LittleAIBox

# Installer les dépendances
npm install

# Démarrer le serveur de développement
npm run dev

# Build pour la production
npm run build
```

### Configuration

1. **Obtenez Votre Clé API** (si vous n'en avez pas) :
   - Visitez [Google AI Studio](https://aistudio.google.com/api-keys)
   - Créez une nouvelle clé API
   - Copiez la clé pour l'utiliser dans l'application

2. **Configurez dans l'Application** :
   - Ouvrez l'application : [LittleAIBox](https://littleaibox.com)
   - Allez dans Paramètres
   - Entrez votre clé API Gemini
   - Enregistrez et commencez à discuter !

3. **Options de Compte** (Optionnel) :
   - **Créer un Compte** : Inscrivez-vous avec email/mot de passe ou utilisez OAuth (Google/GitHub)
   - **Activer MFA** : Allez dans Paramètres → Sécurité pour configurer l'application d'authentification TOTP
   - **Mode Invité** : Utilisez sans inscription (les clés API sont stockées localement uniquement)

### Dépannage

**Problèmes Courants :**

| Problème | Solution |
|---------|----------|
| La clé API ne fonctionne pas | Assurez-vous que votre clé provient de Google AI Studio et a du quota restant |
| Les fichiers ne s'analysent pas | Vérifiez la console du navigateur pour les erreurs ; assurez-vous que le format de fichier est supporté |
| Réponses lentes | Vérifiez votre connexion réseau ; envisagez d'utiliser votre propre clé API |
| Le build mobile échoue | Assurez-vous qu'Android Studio est installé et que l'environnement est correctement configuré |

**Besoin d'Aide ?**
- Consultez [Issues](https://github.com/diandiancha/LittleAIBox/issues) pour les problèmes connus
- Ouvrez un nouvel issue avec les détails de votre problème

### Build pour Mobile

```bash
# Ajouter la plateforme Android
npx cap add android

# Synchroniser les fichiers
npx cap sync

# Ouvrir dans Android Studio
npx cap open android
```

---

## 🎯 Cas d'Utilisation

- **Recherche Académique** : Analyser des articles de recherche, des présentations
- **Création de Contenu** : Générer et éditer du contenu markdown avec l'IA
- **Assistance au Code** : Obtenir de l'aide pour les tâches de programmation et les explications de code
- **Analyse de Documents** : Extraire des insights de documents Office
- **Outil d'Apprentissage** : Tutorat IA interactif avec pièces jointes

---

## 🤝 Contribuer

Les contributions sont les bienvenues ! Que vous corrigiez des bugs, ajoutiez des fonctionnalités ou amélioriez la documentation, chaque contribution rend LittleAIBox meilleur.

### Comment Contribuer

1. **Forkez le dépôt** et clonez-le localement
2. **Créez une branche** : `git checkout -b feature/votre-nom-de-fonctionnalite`
3. **Faites vos modifications** et testez-les minutieusement
4. **Committez vos modifications** : `git commit -m "Add: description de vos modifications"`
5. **Pushez vers votre fork** : `git push origin feature/votre-nom-de-fonctionnalite`
6. **Ouvrez une Pull Request** avec une description claire de vos modifications

### Directives

- Suivez le style et les conventions de code existants
- Ajoutez des commentaires pour la logique complexe
- Mettez à jour la documentation pour les nouvelles fonctionnalités
- Écrivez des messages de commit clairs
- Testez vos modifications avant de soumettre

### Feuille de Route

Je travaille activement sur :

- 🌐 Support iOS (Capacitor)
- 📊 Plus de formats de fichiers supportés
- 🎨 Thèmes personnalisés
- 🔌 Système de plugins
- 🌍 Plus de langues
- 📱 Fonctionnalités mobiles améliorées

Vous avez des idées ? [Ouvrez un issue](https://github.com/diandiancha/LittleAIBox/issues) ou lancez une discussion !

---

## 🔒 Vie Privée et Sécurité

- **Traitement Côté Client** : L'analyse des fichiers se fait dans votre navigateur
- **Stockage Local** : L'historique de chat est stocké localement (synchronisation cloud optionnelle)
- **Authentification Sécurisée** :
  - Options de connexion multiples (email/mot de passe, OAuth)
  - MFA/TOTP optionnel pour une sécurité renforcée
  - Réinitialisation sécurisée du mot de passe via vérification par email
- **Pas de Suivi** : Conception axée sur la vie privée
- **Open Source** : Code transparent et auditable
- **Gestion des Clés API** : Ce sont des paramètres sensibles ; ne les placez pas dans les variables publiques de compilation ni dans les commits

🧠 **Analyse locale, requêtes au modèle et synchronisation sont distinctes. Les fonctions réseau transmettent du contenu hors de l’appareil.**

---

## 📄 Licence

Ce projet est sous licence [Licence MIT](../LICENSE).

Copyright (c) 2025 diandiancha

---

<div align="center">

Fait avec ❤️ par diandiancha

**Mettez une ⭐ à ce repo si vous le trouvez utile !**

💬 **Des questions ou des commentaires ? [Ouvrez un issue](https://github.com/diandiancha/LittleAIBox/issues) — je lis chacun d'entre eux !**

</div>
