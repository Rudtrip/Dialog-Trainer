# Dialog Trainer - Phase 1 Architecture (Stack Agnostic)

## 1. Product Model

Dialog Trainer is a third-party builder service for interactive dialog simulators.

Primary capabilities:
- Let an instructional designer/teacher/producer create a simulator in an admin console.
- Configure scenario graph, branching logic, scoring rules, and visual theme.
- Publish a simulator.
- Export runtime artifacts:
  - Self-contained HTML (online mode, scenario embedded into HTML).
  - LMS embed code (iframe and script embed options).

## 2. Core Subsystems

### A. Admin Console (Builder)
Responsibilities:
- Identity and access: email/password registration and login.
- Simulator workspace management.
- Scenario editor (nodes, transitions, conditions).
- Scoring and feedback rules editor.
- Visual styling editor.
- Publish and export actions.

### B. Runtime Player
Responsibilities:
- Render simulator in browser.
- Execute branching/conditions.
- Track progress and scoring.
- Emit attempt and analytics events.

### C. Delivery and Export Service
Responsibilities:
- Build self-contained HTML package from published scenario.
- Generate embed snippets:
  - iframe URL embed.
  - script-based container embed.
- Version and integrity metadata for published builds.

### D. Data and Analytics
Responsibilities:
- Store simulator definitions and published versions.
- Store learner attempts and event logs.
- Provide completion and score summaries.

## 3. Roles and Access

- Owner: workspace billing, members, all permissions.
- Editor: create/edit scenarios and publish.
- Viewer: read-only access to simulator definitions and analytics.

## 4. Domain Entities

- Workspace
- User
- Membership (workspace role)
- Simulator
- ScenarioVersion (draft/published snapshot)
- Node (message/question/system step)
- Transition (edge with condition)
- ScoreRule
- ThemeConfig
- Asset (image/audio/video)
- Publication
- ExportArtifact (self-contained HTML, iframe config, script config)
- Attempt
- AttemptEvent

## 5. Lifecycle

1. User creates simulator in Draft state.
2. User edits scenario/theme/rules and saves draft versions.
3. User publishes version N.
4. Platform generates export artifacts for version N.
5. LMS/website consumes iframe/script embed or hosted self-contained HTML.
6. Learner attempts produce events and score summaries.

## 6. Auth Contract (Phase 1)

### Register
- Endpoint: `POST /api/v1/auth/register`
- Payload:
  - `fullName` (string, required, min 2)
  - `email` (string, required, valid email)
  - `password` (string, required, min 8)
  - `acceptTerms` (boolean, required true)
- Result:
  - `201 Created` + user profile + session token OR verification pending flag.

### Login
- Endpoint: `POST /api/v1/auth/login`
- Payload:
  - `email`
  - `password`
- Result:
  - `200 OK` + session token.

### Session
- Endpoint: `POST /api/v1/auth/logout`
- Endpoint: `GET /api/v1/auth/me`

## 7. Export Artifacts

### Self-contained HTML
- Single HTML file.
- Includes runtime JS/CSS and scenario JSON payload inline.
- No external API dependency for core playback.

### LMS Embed
- iframe snippet:
  - `<iframe src="https://player.example.com/p/{publicationId}" ...></iframe>`
- script snippet:
  - `<script src="https://player.example.com/embed.js" data-publication="{publicationId}"></script>`

## 8. Phase 1 Scope

Included now:
- Architecture document.
- `/register` UI page with client-side validation and UX interactions.

Deferred:
- Backend implementation.
- Scenario editor and publishing flow.
- Analytics dashboards.
