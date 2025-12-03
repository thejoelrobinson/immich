# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a **Walmart fork** of Immich, a high-performance, self-hosted photo and video management solution. It's organized as a **pnpm workspace monorepo** with Docker-based development.

### Fork Modifications
- **Walmart branding**: Logo replaced with Walmart Spark
- **Document support**: Added ability to upload, view, and search documents (PDF, TXT, EPUB, etc.)

### Git Remote Setup
This fork uses two remotes to stay in sync with the official Immich repo:

| Remote | URL | Purpose |
|--------|-----|---------|
| `origin` | https://github.com/thejoelrobinson/immich.git | Your fork (push here) |
| `upstream` | https://github.com/immich-app/immich.git | Official Immich (pull updates) |

### Syncing with Upstream
When the official Immich repo releases updates:

```bash
# Fetch latest from official Immich
git fetch upstream

# Merge their updates into your branch
git merge upstream/main

# Resolve any conflicts (keep your branding, take their bug fixes)
# Then push to your fork
git push origin main
```

**Conflict Resolution Tips:**
- Walmart branding files: Keep your version
- Document support files: Keep your version, but check for upstream API changes
- Core Immich files: Usually take upstream, unless you've modified them

## Repository Structure

```
immich/
├── server/              # NestJS backend API (TypeScript)
├── web/                 # SvelteKit frontend (TypeScript)
├── mobile/              # Flutter mobile app (Dart)
├── cli/                 # CLI tool (TypeScript)
├── machine-learning/    # Python ML service (CLIP, facial recognition)
├── open-api/            # OpenAPI spec + TypeScript SDK
├── e2e/                 # End-to-end tests (Playwright)
├── docker/              # Docker Compose configurations
└── i18n/                # Internationalization files
```

## Development Commands

### Full Stack Development
```bash
cp docker/example.env docker/.env
# Edit docker/.env - set UPLOAD_LOCATION
make dev                    # Start all services with hot reload
make dev-down               # Stop dev environment
make dev-update             # Rebuild dev environment
```

Access: `http://localhost:3000` (web) | `http://localhost:2283` (API/Swagger)

### Individual Package Commands

**Server:**
```bash
cd server
pnpm run start:dev          # Watch mode
pnpm run test               # Unit tests
pnpm run test:cov           # Tests with coverage
pnpm run lint:fix           # Lint and fix
```

**Web:**
```bash
cd web
pnpm run dev                # Watch mode
pnpm run test               # Unit tests
pnpm run check              # Type check + lint
```

**Mobile:**
```bash
cd mobile
fvm flutter run             # Run app
flutter test                # Unit tests
make translation            # Generate i18n
```

**Machine Learning:**
```bash
cd machine-learning
uv sync --extra cpu         # Install deps (or cuda/rocm/openvino)
```

### Testing
```bash
make test-all               # All packages
make e2e                    # Start e2e environment
cd e2e && pnpm test         # Run e2e tests
```

### Code Quality
```bash
make lint-all               # Lint all packages
make format-all             # Format all packages
```

### Database Migrations
```bash
cd server
npm run migrations:generate # Auto-generate from schema changes
npm run migrations:run      # Run pending migrations
npm run schema:reset        # Drop and recreate (dev only)
```

### API/SDK Generation
```bash
make open-api               # Regenerate OpenAPI spec
make open-api-typescript    # Regenerate TypeScript SDK
```

## Technology Stack

| Component | Framework | Language |
|-----------|-----------|----------|
| Server | NestJS v11, Kysely | TypeScript |
| Web | SvelteKit v2, Tailwind v4 | TypeScript |
| Mobile | Flutter, Riverpod | Dart |
| ML | FastAPI, CLIP | Python |
| Database | PostgreSQL | SQL |
| Queue | BullMQ + Redis | - |

## Architecture Patterns

### Server (`/server/src/`)
- **Controllers**: HTTP request handlers (`/controllers/`)
- **Services**: Business logic (`/services/`)
- **Repositories**: Data access via Kysely (`/repositories/`)
- **DTOs**: Input/output validation (`/dtos/`)
- **Schema**: Database tables (`/schema/tables/`)

Worker-based architecture with separate processes for API, microservices (job processing), and maintenance.

### Web (`/web/src/`)
- **Routes**: SvelteKit file-based routing (`/routes/`)
- **Components**: Reusable UI (`/lib/components/`)
- **Stores**: Svelte stores for state (`/lib/stores/`)
- **Managers**: Complex business logic (`/lib/managers/`)

### Job Queue System
BullMQ handles background jobs: thumbnail generation, video transcoding, facial recognition, search indexing, document text extraction.

## Document Support (Fork Feature)

This fork adds document file support beyond images and videos.

### Supported Formats
| Format | Text Extraction | Thumbnail |
|--------|-----------------|-----------|
| PDF | Yes (pdf-parse) | First page render (pdftoppm) |
| TXT, MD, CSV, JSON, XML, HTML | Yes | Placeholder icon |
| EPUB | Yes (epub2) | Placeholder icon |
| RTF | Yes (basic) | Placeholder icon |

### Key Components
- **`server/src/services/document.service.ts`** - Text extraction from documents
- **`server/src/services/media.service.ts`** - PDF thumbnail generation via pdftoppm
- **`web/src/lib/components/asset-viewer/document-viewer.svelte`** - PDF/text viewer
- **`server/src/utils/mime-types.ts`** - Document MIME type detection (`isDocument()`, `isPdf()`)

### How It Works
1. Upload triggers `AssetType.Document` classification via `mimeTypes.assetType()`
2. Thumbnail generation creates PDF first-page render or placeholder icon
3. `DocumentTextExtraction` job extracts searchable text
4. Text stored in `ocr_search` table (reuses OCR infrastructure)
5. Documents appear in timeline with document icon overlay
6. Document viewer uses iframe for PDF rendering, direct display for text files

### Document Thumbnail Aspect Ratio
PDF thumbnails preserve the original page aspect ratio (capped 9:16 to 16:9). The frontend calculates container height from `asset.ratio` for documents to prevent cropping.

### Dependencies Added
- `pdf-parse` - PDF text extraction
- `epub2` - EPUB parsing
- `poppler-utils` - PDF thumbnail rendering (installed in Docker via apt)

## Key Files

- `server/src/services/media.service.ts` - Media processing (thumbnails, transcoding)
- `server/src/services/asset.service.ts` - Asset management
- `server/src/services/library.service.ts` - Library scanning
- `server/src/services/document.service.ts` - Document text extraction (fork)
- `web/src/lib/components/asset-viewer/` - Asset viewing components
- `web/src/lib/components/asset-viewer/document-viewer.svelte` - Document viewer (fork)
- `web/src/lib/components/assets/thumbnail/` - Thumbnail components
- `web/src/lib/managers/timeline-manager/` - Timeline/gallery logic
- `docs/DOCUMENT-SUPPORT.md` - Full document support documentation (fork)

## Docker Development

Dev compose mounts source code directly for hot reload:
```bash
# Restart specific service
docker compose -f docker/docker-compose.dev.yml restart immich-server

# View logs
docker logs -f immich_server

# Shell into container
docker exec -it immich_server sh
```

## Environment Variables

Key variables in `docker/.env`:
- `UPLOAD_LOCATION` - Storage directory for media
- `DB_PASSWORD`, `DB_USERNAME`, `DB_DATABASE_NAME` - PostgreSQL config

## Debugging

- Server debug port: 9230 (Node.js inspector)
- Web: Browser DevTools + Svelte inspector
- API: Swagger UI at `/api`

## Code Style

- 2-space indentation
- Single quotes
- Semicolons required
- ESLint + Prettier enforced

## Troubleshooting

### Server Container Restart Loop (Exit Code 0)

**Problem**: The `immich_server` container keeps restarting with exit code 0, producing no logs.

**Root Cause**: The `docker-compose.dev.yml` command format conflicts with the Dockerfile entrypoint. The Dockerfile.dev has:
```dockerfile
ENTRYPOINT ["tini", "--", "/bin/bash", "-c"]
```

If you use `command: ['/bin/bash', '-c', 'some command']`, it creates a double `/bin/bash -c` wrapper that breaks command parsing.

**Solution**: The command must be a single string (passed as the argument to the existing `/bin/bash -c` entrypoint):
```yaml
command: ["apt-get update -qq && apt-get install -y -qq poppler-utils && immich-dev"]
```

Additionally, the server needs TTY to keep running:
```yaml
tty: true
stdin_open: true
```

**Correct docker-compose.dev.yml server config**:
```yaml
immich-server:
  container_name: immich_server
  command: ["apt-get update -qq && apt-get install -y -qq poppler-utils && immich-dev"]
  image: immich-server-dev:latest
  tty: true
  stdin_open: true
  # ... rest of config
```

### pnpm Lockfile Errors

**Problem**: `ERR_PNPM_OUTDATED_LOCKFILE Cannot install with frozen-lockfile`

**Solution**: Run `pnpm install` from the project root to update the lockfile, then restart dev environment:
```bash
pnpm install
make dev-down && make dev
```
