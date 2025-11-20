# AGENTS.md - Immich Development Setup Guide

This document provides comprehensive guidance for Claude instances (agents) working on Immich development, particularly for setting up both the production environment and web UI development workflows.

## Quick Start Checklist

### Running Immich Production (Docker)
- ✅ Rancher Desktop installed (no Docker Desktop needed)
- ✅ `docker` and `docker compose` commands working
- ✅ Immich running at http://localhost:2283
- ✅ Data persisted in Docker named volumes

### Web UI Development
- ✅ Node.js 24+ installed
- ✅ Dependencies installed in `/web`
- ✅ TypeScript SDK built in `/open-api/typescript-sdk`
- ✅ Dev server running at http://localhost:3001
- ✅ Hot-reload enabled for instant UI changes

---

## Part 1: Production Deployment (Rancher Desktop)

### Why Rancher Desktop Instead of Docker Desktop?

Rancher Desktop is a lightweight, open-source container manager that:
- Provides `docker` CLI and `docker compose` compatibility
- Avoids Docker Desktop licensing constraints
- Includes all necessary tools (kubectl, helm, nerdctl)
- Works seamlessly on macOS (Intel and Apple Silicon)

### Installation & Configuration

**System Requirements:**
- macOS 13+
- 16 GB RAM recommended (allocate 6-8 GB to Rancher VM)
- 4+ CPU cores
- SSD storage (critical for database performance)

**Setup Steps:**

1. **Install Rancher Desktop**
   - Download from: https://github.com/rancher-sandbox/rancher-desktop/releases
   - Install to Applications folder

2. **Configure Rancher Settings**
   ```
   Preferences > Virtual Machine:
   - Memory: 6-8 GB
   - CPUs: 4 cores

   Preferences > Container Engine:
   - Runtime: dockerd (moby) - NOT containerd

   Preferences > Kubernetes:
   - Disable (saves resources)
   ```

3. **Verify Setup**
   ```bash
   docker --version    # Should show Docker X.Y.Z-rd
   docker compose version
   docker ps           # Should return empty or list containers
   ```

### Immich Deployment

**Directory Structure:**
```
~/immich-data/
├── docker-compose.yml    # Compose configuration
├── .env                  # Environment variables
├── library/              # Photo/video uploads
└── postgres/             # Database (created by Docker)
```

**Setup Process:**

1. **Create Directory Structure**
   ```bash
   mkdir -p ~/immich-data/{library,postgres}
   ```

2. **Copy Files from Repository**
   ```bash
   cd ~/immich-data
   cp /path/to/Immich/docker/docker-compose.yml .
   cp /path/to/Immich/docker/example.env .env
   ```

3. **Configure Environment (.env)**
   ```bash
   # Edit .env file:
   UPLOAD_LOCATION=./library
   DB_DATA_LOCATION=./postgres     # Note: See Volume Issue below
   TZ=America/Chicago              # Set your timezone
   IMMICH_VERSION=v2
   DB_PASSWORD=YourSecurePassword  # Alphanumeric only
   ```

4. **Critical Fix: Use Docker Named Volumes for Database**

   **ISSUE FOUND:** Rancher Desktop on macOS has permission issues with bind mounts (host directory mounts) for the PostgreSQL database. The container cannot change ownership of `/var/lib/postgresql/data`.

   **SOLUTION:** Modify `docker-compose.yml` to use Docker named volumes instead:

   ```yaml
   # Original (BROKEN on macOS Rancher):
   volumes:
     - ${DB_DATA_LOCATION}:/var/lib/postgresql/data

   # Fixed (WORKING on macOS Rancher):
   volumes:
     - postgres-data:/var/lib/postgresql/data

   # Add at end of file:
   volumes:
     model-cache:
     postgres-data:
   ```

   **Why This Works:** Named volumes are managed by Docker and don't have macOS permission issues.

5. **Launch Containers**
   ```bash
   cd ~/immich-data
   docker compose up -d
   ```

6. **Verify Containers**
   ```bash
   docker compose ps
   # Expected output: 4 containers all "healthy"
   # - immich_server (healthy)
   # - immich_machine_learning (healthy)
   # - immich_redis (healthy)
   # - immich_postgres (healthy)
   ```

7. **Access Immich**
   ```
   http://localhost:2283
   ```

### Important: Database Persistence

**Data Survival:**
- ✅ Safe: `docker compose restart`, `docker compose stop`, `docker compose down`
- ✅ All data persists in named volume `immich_postgres-data`
- ❌ Deletes Data: `docker compose down -v`, `docker volume rm immich_postgres-data`

**To Backup Database:**
```bash
docker exec immich_postgres pg_dump -U postgres immich > backup.sql
```

---

## Part 2: Web UI Development

### Prerequisites

**Node.js Version:**
- Required: 24.11.0 (specified in volta config)
- Check: `node --version`
- Install via: nvm or Homebrew

**Running Services:**
- Immich backend must be running (http://localhost:2283)
- Dev server will proxy all API calls to backend

### Setup Steps

#### 1. Install Web Dependencies

```bash
cd /path/to/Immich/web
npm install
```

**Typical Output:**
- 785 packages installed
- Some deprecation warnings (OK to ignore)
- Minor vulnerabilities (not blocking)

#### 2. Build TypeScript SDK

**CRITICAL:** The web app depends on the TypeScript SDK. It must be built first.

```bash
cd /path/to/Immich/open-api/typescript-sdk
npm install
npm run build
```

**Why This Step:**
- The SDK generates TypeScript definitions from the OpenAPI spec
- Web imports `@immich/sdk` which comes from this build
- Without this, you'll see: `Failed to resolve "@oazapfts/runtime"`

#### 3. Start Development Server

```bash
cd /path/to/Immich/web
IMMICH_SERVER_URL=http://localhost:2283 npm run dev
```

**Expected Output:**
```
VITE v7.2.4 ready in X ms

  ➜  Local:   http://localhost:3000/
  ➜  Network: http://192.168.86.22:3000/
```

**Port Note:** If 3000 is in use, Vite automatically uses 3001+

### Technology Stack

| Component | Technology | Version |
|-----------|-----------|---------|
| **Framework** | SvelteKit | 2.27.1 |
| **Language** | Svelte 5 | 5.43.0 |
| **Styling** | TailwindCSS | 4.1.7 |
| **Build** | Vite | 7.1.2 |
| **Testing** | Vitest | 3.0.0 |

### Project Structure

```
web/src/
├── app.css                 # Global styles, theme variables
├── app.html               # HTML shell
├── +layout.svelte         # Root layout component
├── routes/                # SvelteKit file-based routing
│   ├── (user)/           # User-facing pages
│   ├── admin/            # Admin pages
│   └── auth/             # Authentication pages
├── lib/
│   ├── components/       # 31+ reusable components
│   ├── elements/         # Basic UI elements
│   ├── actions/          # Server-side actions
│   ├── stores/           # Svelte stores (state management)
│   ├── services/         # Business logic
│   └── utils/            # Helper functions
└── test-data/            # Test fixtures
```

### Development Commands

```bash
# Start development server (with hot-reload)
npm run dev

# Production build
npm run build

# Preview production build
npm run preview

# Code quality checks
npm run format          # Check Prettier formatting
npm run format:fix      # Auto-format code
npm run lint           # ESLint checks
npm run lint:fix       # Auto-fix linting issues
npm run check:svelte   # Type-check Svelte components
npm run check:typescript # TypeScript validation

# Testing
npm run test           # Run tests once
npm run test:watch     # Watch mode
npm run test:cov       # Coverage report
```

### Common UI Customization Points

#### 1. Theme Colors

**File:** `/web/src/app.css` (lines 68-76)

```css
:root {
  /* light mode */
  --immich-primary: 66 80 175;      /* Primary blue */
  --immich-bg: 255 255 255;         /* White background */
  --immich-fg: 0 0 0;               /* Black text */

  /* dark mode */
  --immich-dark-primary: 172 203 250;
  --immich-dark-bg: 10 10 10;
  --immich-dark-fg: 229 231 235;
}
```

Format: RGB values (space-separated, not comma-separated)

#### 2. TailwindCSS Theme Configuration

**File:** `/web/src/app.css` (lines 51-63)

Define custom spacing, breakpoints, and utilities:

```css
@theme {
  --font-immich-mono: Overpass Mono, monospace;
  --spacing-18: 4.5rem;
  --breakpoint-sidebar: 850px;
}
```

#### 3. Global Styles

**File:** `/web/src/app.css` (lines 65-191)

Base styles, scrollbar styling, utility classes

#### 4. Component Styling

**File:** `/web/src/lib/components/` (example: `/ImageGrid.svelte`)

Components use:
- TailwindCSS class names: `<div class="flex gap-4 bg-slate-100">`
- Scoped styles: `<style>` blocks in `.svelte` files
- Stores for reactive state

### Hot Module Replacement (HMR)

**How It Works:**
1. Edit any `.svelte` or `.ts` file
2. Save file
3. Browser automatically refreshes (usually < 1 second)
4. Component state often preserved

**If HMR Doesn't Work:**
- Manual refresh (Cmd+R) usually sufficient
- Check browser console for errors
- Restart dev server if needed: `npm run dev`

### Backend API Connection

**How Proxying Works:**

```
Dev Server (localhost:3000)
         ↓
    Vite Proxy
         ↓
Backend API (localhost:2283)
```

**Proxy Configuration:** `vite.config.ts` (lines 9-21)

```typescript
const upstream = {
  target: process.env.IMMICH_SERVER_URL || 'http://immich-server:2283/',
  changeOrigin: true,
  ws: true,  // WebSocket support
};

const proxy = {
  '/api': upstream,
  '/.well-known/immich': upstream,
};
```

**Testing API Connectivity:**
```bash
curl http://localhost:3000/api/auth/me
# Should return auth status from backend
```

### Debugging Tips

#### 1. Check Dev Server Logs
```bash
# Already running in terminal - watch for errors
npm run dev
```

#### 2. Browser DevTools
- **Console Tab:** Shows client-side errors and logs
- **Network Tab:** Shows API calls to backend (filter by `/api`)
- **Sources Tab:** Debug TypeScript/Svelte code

#### 3. Type Checking Without Building
```bash
npm run check:svelte      # Check Svelte files
npm run check:typescript  # Check TypeScript files
```

#### 4. Common Issues

| Issue | Solution |
|-------|----------|
| SDK import errors | `cd open-api/typescript-sdk && npm run build` |
| API calls failing | Check backend is running: `curl http://localhost:2283` |
| Port already in use | Kill process or use different port: `npm run dev -- --port 3002` |
| Styles not updating | Clear browser cache or hard refresh (Cmd+Shift+R) |
| Components not rendering | Check browser console for TypeScript errors |

---

## Part 3: Workflow for Future Development

### Starting a Dev Session

1. **Ensure Services Are Running**
   ```bash
   # Terminal 1: Immich backend
   cd ~/immich-data && docker compose ps

   # Terminal 2: Web dev server
   cd /path/to/Immich/web && npm run dev
   ```

2. **Access Application**
   - Frontend: http://localhost:3001 (or 3000+)
   - Backend: http://localhost:2283

3. **Make Changes**
   - Edit files in `/web/src/`
   - Watch for HMR updates (< 1 second)
   - Test in browser

### Stopping Dev Session

```bash
# Stop dev server (Ctrl+C in terminal)
# Stop backend
cd ~/immich-data && docker compose stop
```

### Updating Immich Version

```bash
# Update backend containers
cd ~/immich-data
docker compose pull
docker compose up -d

# No action needed for web UI (always latest from source)
```

### Building for Production

```bash
cd /path/to/Immich/web
npm run build

# Output in: web/.svelte-kit/output/
```

---

## Part 4: Architecture Notes

### Monorepo Structure

Immich is a pnpm monorepo with:
- `/web/` - SvelteKit frontend
- `/server/` - NestJS backend API
- `/mobile/` - Flutter mobile app
- `/machine-learning/` - Python ML services
- `/open-api/` - OpenAPI spec and SDK generation

### SDK Generation Pipeline

```
OpenAPI Spec (immich-openapi-specs.json)
        ↓
    oazapfts code generator
        ↓
TypeScript SDK (/open-api/typescript-sdk/src)
        ↓
npm run build (TypeScript compilation)
        ↓
SDK build output (/open-api/typescript-sdk/build)
        ↓
Web imports: @immich/sdk
```

### State Management

**Stores Used:** Svelte stores (reactive variables)
- Located in: `/web/src/lib/stores/`
- No Redux/MobX - Svelte's built-in reactivity is sufficient

### Testing Strategy

**Testing Pyramid:**
- Unit tests: `/web/src/**/*.spec.ts`
- Component tests: Using `@testing-library/svelte`
- E2E tests: Separate repo (`/e2e`)

---

## Troubleshooting Reference

### Docker/Rancher Issues

| Problem | Solution |
|---------|----------|
| "Cannot connect to Docker" | Verify Rancher Desktop is running; check `docker ps` |
| Database won't start | Use named volumes (not bind mounts); see Part 1 fix |
| Port 2283 already in use | Change `ports:` in docker-compose.yml |
| Out of disk space | `docker system prune -a` removes unused images/volumes |

### Web Dev Issues

| Problem | Solution |
|---------|----------|
| `@oazapfts/runtime not found` | Rebuild SDK: `cd open-api/typescript-sdk && npm run build` |
| HMR not working | Manual refresh (Cmd+R) or restart dev server |
| Backend API calls 404 | Confirm backend running and IMMICH_SERVER_URL set correctly |
| Port 3000/3001 in use | Kill process: `lsof -i :3000` then `kill -9 PID` |
| Svelte components have errors | Run `npm run check:svelte` for detailed errors |

---

## Development Best Practices

### Code Quality

1. **Format Code Before Committing**
   ```bash
   npm run format:fix && npm run lint:fix
   ```

2. **Run Full Checks**
   ```bash
   npm run check:code
   ```

3. **Test Changes**
   ```bash
   npm run test
   ```

### Git Workflow

1. Create feature branch from `main`
2. Make changes with hot-reload feedback
3. Run quality checks (`npm run check:code`)
4. Commit with descriptive message
5. Push and create PR

### Component Creation

1. Locate appropriate directory (`/components/`, `/elements/`, `/routes/`)
2. Create `.svelte` file with TypeScript and styling
3. Export named export for reusability
4. Add prop types for better DX
5. Test with hot-reload

---

## Environment Variables

### Immich Backend (.env in ~/immich-data)
```bash
UPLOAD_LOCATION=./library              # Photo storage
DB_DATA_LOCATION=./postgres            # Database (Docker volume name)
TZ=America/Chicago                     # Timezone
IMMICH_VERSION=v2                      # Version pin
DB_PASSWORD=YourSecurePassword         # Database password (alphanumeric)
DB_USERNAME=postgres                   # Don't change
DB_DATABASE_NAME=immich                # Don't change
```

### Web Dev (.env in /web)
```bash
IMMICH_SERVER_URL=http://localhost:2283  # Backend URL for proxying
```

---

## References

- **Immich Docs:** https://docs.immich.app/
- **SvelteKit Docs:** https://kit.svelte.dev/
- **Rancher Desktop:** https://docs.rancherdesktop.io/
- **Vite:** https://vitejs.dev/
- **TailwindCSS:** https://tailwindcss.com/

---

## Quick Command Reference

```bash
# Backend (from ~/immich-data)
docker compose up -d         # Start
docker compose ps            # Status
docker compose logs -f immich-server  # Logs
docker compose down          # Stop (keep data)
docker compose down -v       # Stop (delete data)

# Frontend (from /web)
npm run dev                  # Dev server
npm run build                # Production build
npm run format:fix           # Auto-format code
npm run lint:fix             # Auto-fix lint issues
npm run check:code           # Full quality check

# SDK (from /open-api/typescript-sdk)
npm run build                # Rebuild SDK

# Debugging
curl http://localhost:2283/api/auth/me        # Test backend
curl http://localhost:3000/api/auth/me        # Test proxy
lsof -i :2283                                 # Check port usage
docker stats                                  # Container resource usage
```

---

**Last Updated:** November 20, 2025
**Status:** Tested and verified with Immich v2.3.1
