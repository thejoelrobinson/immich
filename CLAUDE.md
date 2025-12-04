# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a **Walmart fork** of Immich, a high-performance, self-hosted photo and video management solution. It's organized as a **pnpm workspace monorepo** with Docker-based development.

### Fork Modifications
- **Walmart branding**: Logo replaced with Walmart Spark
- **Document support**: Added ability to upload, view, and search documents (PDF, TXT, EPUB, etc.)
- **ONLYOFFICE integration**: Native Office document viewing for DOCX, XLSX, PPTX (handles large files better than LibreOffice)

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
| Format | Text Extraction | Thumbnail | Viewer |
|--------|-----------------|-----------|--------|
| PDF | Yes (pdf-parse) | First page render (pdftoppm) | Native browser iframe |
| DOCX, DOC, ODT | Yes (mammoth/officeparser) | LibreOffice render | ONLYOFFICE (primary) / LibreOffice PDF (fallback) |
| XLSX, XLS, ODS | Yes (officeparser) | LibreOffice render | ONLYOFFICE (primary) / LibreOffice PDF (fallback) |
| PPTX, PPT, ODP | Yes (officeparser) | LibreOffice render | ONLYOFFICE (primary) / LibreOffice PDF (fallback) |
| TXT, MD, CSV, JSON, XML, HTML | Yes | Placeholder icon | Native browser iframe |
| EPUB | Yes (epub2) | Placeholder icon | Download only |
| RTF | Yes (basic) | Placeholder icon | Native browser iframe |

### Key Components
- **`server/src/services/document.service.ts`** - Text extraction from documents
- **`server/src/services/media.service.ts`** - Thumbnail generation (PDF via pdftoppm, Office via LibreOffice)
- **`server/src/services/asset-media.service.ts`** - `documentPdf()` method for Office-to-PDF conversion
- **`server/src/services/onlyoffice.service.ts`** - ONLYOFFICE JWT token generation and document config
- **`server/src/controllers/asset-media.controller.ts`** - `GET /assets/:id/document/pdf` endpoint
- **`server/src/controllers/onlyoffice.controller.ts`** - ONLYOFFICE API endpoints (`/api/onlyoffice/*`)
- **`server/src/dtos/onlyoffice.dto.ts`** - ONLYOFFICE DTOs and file type mappings
- **`web/src/lib/components/asset-viewer/document-viewer.svelte`** - Multi-format document viewer with ONLYOFFICE fallback
- **`web/src/lib/components/asset-viewer/onlyoffice-viewer.svelte`** - ONLYOFFICE editor component
- **`web/src/lib/managers/onlyoffice-manager.svelte.ts`** - ONLYOFFICE script loading and config management
- **`web/src/lib/utils.ts`** - `getDocumentPdfUrl()` helper
- **`server/src/utils/mime-types.ts`** - Document MIME type detection (`isDocument()`, `isPdf()`)

### Document Viewer Architecture

The document viewer (`document-viewer.svelte`) uses a tiered approach for Office documents:

```
PDF              → Native browser iframe (documentUrl)
Office docs      → ONLYOFFICE (primary) → LibreOffice PDF fallback
(DOCX, DOC, ODT, XLSX, XLS, PPTX, PPT)
Text files       → Native browser iframe (documentUrl)
```

**ONLYOFFICE Integration (Primary for Office docs):**
- Native client-side rendering - no file size limitations
- Handles large files (200MB+) that fail with LibreOffice
- JWT-authenticated document download from Immich server
- Falls back to LibreOffice PDF conversion if ONLYOFFICE unavailable

### How It Works
1. Upload triggers `AssetType.Document` classification via `mimeTypes.assetType()`
2. Thumbnail generation creates PDF first-page render (pdftoppm) or LibreOffice render for Office docs
3. `DocumentTextExtraction` job extracts searchable text
4. Text stored in `ocr_search` table (reuses OCR infrastructure)
5. Documents appear in timeline with document icon overlay
6. Document viewer detects file type by extension and uses appropriate renderer:
   - All Office formats: Server-side LibreOffice PDF conversion (high fidelity)
   - PDF/Text: Native browser rendering

### Document PDF Endpoint

For all Office documents, the server provides a PDF conversion endpoint:

```
GET /assets/:id/document/pdf
```

This endpoint:
1. Returns the original file if it's already a PDF
2. Converts Office documents to PDF using LibreOffice headless mode
3. Creates unique temp directory per conversion to support concurrency
4. Returns the PDF with appropriate caching headers

### ONLYOFFICE Configuration

ONLYOFFICE Document Server provides native Office document viewing. It runs as a separate Docker container.

**Environment Variables (docker/.env):**
```bash
ONLYOFFICE_ENABLED=true
ONLYOFFICE_URL=http://onlyoffice:80              # Internal Docker URL
ONLYOFFICE_EXTERNAL_URL=http://localhost:8080     # Browser-accessible URL
ONLYOFFICE_JWT_SECRET=your-secret-here            # Shared JWT secret
```

**API Endpoints:**
- `GET /api/onlyoffice/config` - Get ONLYOFFICE status
- `GET /api/onlyoffice/available` - Health check
- `GET /api/onlyoffice/document/:id` - Get JWT-signed document config
- `GET /api/onlyoffice/download/:id` - Document download for ONLYOFFICE server

**Architecture Flow:**
1. Frontend checks `/api/onlyoffice/config` for availability
2. Frontend loads ONLYOFFICE API script from `ONLYOFFICE_EXTERNAL_URL`
3. Frontend requests document config from `/api/onlyoffice/document/:id`
4. Server generates JWT-signed config with download URL
5. ONLYOFFICE server fetches document from `/api/onlyoffice/download/:id`
6. Document renders client-side in browser

**File Size Limits:**
Default ONLYOFFICE limits are 100MB. This fork automatically increases them to 500MB via the init script (`docker/onlyoffice-init.sh`).

The init script:
1. Runs in background on container startup
2. Waits for ONLYOFFICE config file to be created
3. Updates `limits_tempfile_upload` and `maxDownloadBytes` to 500MB
4. Restarts the converter service to apply changes
5. Skips modification if already configured (idempotent)

**Manual override (if needed):**
```bash
docker exec immich_onlyoffice sed -i 's/"limits_tempfile_upload": 104857600/"limits_tempfile_upload": 524288000/' /etc/onlyoffice/documentserver/default.json
docker exec immich_onlyoffice sed -i 's/"maxDownloadBytes": 104857600/"maxDownloadBytes": 524288000/' /etc/onlyoffice/documentserver/default.json
docker exec immich_onlyoffice supervisorctl restart ds:converter
```

**Custom Fonts:**
Corporate fonts (Bogle, EverydaySans) are automatically installed from the `/Fonts` directory:
- Mounted at `/custom-fonts` in the container
- Copied to `/usr/share/fonts/truetype/custom/`
- Font list regenerated via `documentserver-generate-allfonts.sh`
- Installation is tracked with a marker file to avoid redundant regeneration

To add more fonts, place `.otf` or `.ttf` files in the `/Fonts` directory and recreate the container.

**Document Key Requirements:**
ONLYOFFICE document keys must only contain `0-9-.a-zA-Z_=` characters. The service automatically sanitizes keys.

### Document Thumbnail Aspect Ratio
PDF thumbnails preserve the original page aspect ratio (capped 9:16 to 16:9). The frontend calculates container height from `asset.ratio` for documents to prevent cropping.

### Dependencies Added

**Server (npm):**
- `pdf-parse` - PDF text extraction
- `epub2` - EPUB parsing
- `mammoth` - DOCX text extraction
- `officeparser` - Office document text extraction (DOC, PPT, XLS, etc.)

**Server (apt - installed in Docker):**
- `poppler-utils` - PDF thumbnail rendering (pdftoppm)
- `libreoffice` - Office document thumbnail generation and PDF conversion for viewing

## Key Files

- `server/src/services/media.service.ts` - Media processing (thumbnails, transcoding)
- `server/src/services/asset.service.ts` - Asset management
- `server/src/services/asset-media.service.ts` - Asset media operations including `documentPdf()` (fork)
- `server/src/services/library.service.ts` - Library scanning
- `server/src/services/document.service.ts` - Document text extraction (fork)
- `server/src/controllers/asset-media.controller.ts` - Asset media endpoints including `/document/pdf` (fork)
- `web/src/lib/components/asset-viewer/` - Asset viewing components
- `web/src/lib/components/asset-viewer/asset-viewer.svelte` - Main asset viewer with document type detection
- `web/src/lib/components/asset-viewer/document-viewer.svelte` - Multi-format document viewer (fork)
- `web/src/lib/utils.ts` - Utility functions including `getDocumentPdfUrl()` (fork)
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
- `ONLYOFFICE_ENABLED` - Enable ONLYOFFICE integration (true/false)
- `ONLYOFFICE_URL` - Internal Docker URL for ONLYOFFICE
- `ONLYOFFICE_EXTERNAL_URL` - Browser-accessible URL for ONLYOFFICE
- `ONLYOFFICE_JWT_SECRET` - Shared JWT secret for document authentication

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

### ONLYOFFICE Troubleshooting

**Problem**: ONLYOFFICE viewer fails with "invalid signature" JWT error

**Solution**: Ensure JWT secrets match between Immich and ONLYOFFICE:
```bash
# Check Immich JWT secret
docker exec immich_server printenv | grep ONLYOFFICE_JWT_SECRET

# Check ONLYOFFICE JWT secret
docker exec immich_onlyoffice printenv | grep JWT_SECRET
```

**Problem**: Large files fail with EMSGSIZE error

**Solution**: ONLYOFFICE default limit is 100MB. Increase limits:
```bash
docker exec immich_onlyoffice sed -i 's/"limits_tempfile_upload": 104857600/"limits_tempfile_upload": 524288000/' /etc/onlyoffice/documentserver/default.json
docker exec immich_onlyoffice sed -i 's/"maxDownloadBytes": 104857600/"maxDownloadBytes": 524288000/' /etc/onlyoffice/documentserver/default.json
docker exec immich_onlyoffice supervisorctl restart ds:docservice ds:converter
```
Note: These changes are lost on container restart.

**Problem**: ONLYOFFICE container unhealthy with "nc: port number invalid" errors

**Solution**: The local.json config file is malformed. Remove it and restart:
```bash
docker exec immich_onlyoffice rm -f /etc/onlyoffice/documentserver/local.json
docker restart immich_onlyoffice
```

**Problem**: Document keys contain invalid characters (+ or /)

**Solution**: ONLYOFFICE only accepts `0-9-.a-zA-Z_=` in document keys. The `onlyoffice.service.ts` automatically sanitizes these by replacing `+` → `A` and `/` → `B`.
