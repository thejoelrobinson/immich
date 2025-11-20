# Walmart Reskin Implementation Plan

**Status**: Ready for Implementation
**Created**: November 20, 2025
**Target**: Complete Walmart 2025 brand identity transformation
**Estimated Duration**: 5-7 days with QA

---

## Table of Contents
1. [Quick Reference](#quick-reference)
2. [Walmart Design System](#walmart-design-system)
3. [Implementation Phases](#implementation-phases)
4. [File Manifest](#file-manifest)
5. [QA & Testing](#qa--testing)
6. [Engineering Excellence](#engineering-excellence)
7. [Risk Mitigation](#risk-mitigation)
8. [Success Criteria](#success-criteria)

---

## Quick Reference

### Walmart Brand Colors
```
Primary Colors:
- True Blue: #0071ce (RGB 0, 113, 206)
- Spark Yellow: #ffc220 (RGB 255, 194, 32)
- White: #ffffff (RGB 255, 255, 255)

Secondary Blues:
- Bentonville Blue: #041e42 (RGB 4, 30, 66) - Typography, dark bg
- Everyday Blue: #0078ce (RGB 0, 120, 206) - Hierarchy, accents
- Sky Blue: #82cef4 (RGB 130, 206, 244) - Accents, highlights

Accent:
- Walmart Green: #1db954 (RGB 29, 185, 84) - Success states
```

### Typography
- **Font**: Everyday Sans → System fonts (-apple-system, BlinkMacSystemFont, Segoe UI, Roboto)
- **Weights**: Light (300), Regular (400), Medium (500), Bold (700), Black (900)
- **Rule**: 50/50 rule - each hierarchy level max 50% larger than neighbor
- **Color**: Bentonville Blue for body, True Blue for headlines

### Component Standards
- **Buttons**: Pill-shaped (`rounded-full`)
- **Forms**: Rounded inputs (`rounded-full`)
- **Cards**: Rounded corners (`rounded-2xl` to `rounded-3xl`)
- **Modals**: Rounded (`rounded-3xl`)
- **Spacing**: Generous whitespace following Walmart digital-first approach

### CSS Variable Mapping

**Old → New**
```css
--immich-primary: 66 80 175 → 0 113 206         /* True Blue */
--immich-dark-primary: 172 203 250 → 130 206 244 /* Sky Blue */
--immich-dark-bg: 10 10 10 → 4 30 66            /* Bentonville Blue */
--immich-dark-fg: 229 231 235 → 255 255 255     /* White text */
--immich-dark-gray: 33 33 33 → 0 120 206        /* Everyday Blue */
--immich-fg: 0 0 0 → 4 30 66                    /* Bentonville Blue text */
```

---

## Walmart Design System

### Design Philosophy
- **Trust-driven**: Deep blues convey reliability and professionalism
- **Affordability-focused**: Spark yellow highlights value and savings
- **Accessibility-first**: WCAG AAA compliant color contrasts
- **Digital-first**: Clean, modern, minimal complexity
- **Scalable**: Consistent across web, mobile, in-store

### Color Contrast Compliance
- True Blue on white: 4.55:1 (AA compliant)
- Bentonville Blue on white: 14.05:1 (AAA compliant)
- Spark Yellow on Bentonville: Must verify (check during QA)

### Typography Hierarchy
| Level | Size | Weight | Use Case |
|-------|------|--------|----------|
| XL Headline | 3rem (48px) | Light (300) | Page titles |
| Headline | 2.25rem (36px) | Medium (500) | Section headers |
| Subhead | 1.875rem (30px) | Medium (500) | Subsections |
| Body | 1rem (16px) | Regular (400) | Main content |
| Small text | 0.875rem (14px) | Regular (400) | Labels, captions |
| Tiny | 0.75rem (12px) | Regular (400) | Metadata |

### Component Specifications
**Buttons**
- Shape: Pill-shaped (border-radius: 9999px / rounded-full)
- Variants: Filled, Outline, Ghost
- Colors: Primary (True Blue), Success (Green), Danger (Red), Warning (Yellow)
- Sizes: Tiny, Small, Medium, Large, Giant

**Form Inputs**
- Shape: Pill-shaped inputs
- Border: 2px, color = gray-300 (light) / everyday-blue (dark)
- Focus: Ring of Sky Blue, border turns True Blue
- Background: gray-50 (light) / bentonville-blue/20 (dark)

**Cards**
- Border radius: 2xl to 3xl
- Border: 2px solid, gray-200 (light) / everyday-blue (dark)
- Hover: Border color changes to Walmart Blue
- Shadow: Subtle, minimal depth

---

## Implementation Phases

### Phase 1: Core Theme Variables (0.5 days)

**Objective**: Establish color foundation for entire app

**File**: `/web/src/app.css`

**Changes**:
1. Update `:root` CSS variables
2. Update `.dark` mode variables
3. Add Walmart-specific color variables
4. Update `@immich/ui` color mappings

**Specific Changes**:
```css
/* Light mode */
:root {
  --immich-primary: 0 113 206;           /* True Blue */
  --immich-bg: 255 255 255;              /* White */
  --immich-fg: 4 30 66;                  /* Bentonville Blue */
  --immich-gray: 246 246 246;            /* Light gray */
}

/* Dark mode */
:root.dark {
  --immich-primary: 130 206 244;         /* Sky Blue */
  --immich-dark-primary: 130 206 244;
  --immich-dark-bg: 4 30 66;             /* Bentonville Blue */
  --immich-dark-fg: 255 255 255;         /* White */
  --immich-dark-gray: 0 120 206;         /* Everyday Blue */
}

/* Walmart-specific */
@theme inline {
  --color-walmart-blue: rgb(0 113 206);
  --color-walmart-yellow: rgb(255 194 32);
  --color-bentonville-blue: rgb(4 30 66);
  --color-everyday-blue: rgb(0 120 206);
  --color-sky-blue: rgb(130 206 244);
  --color-walmart-green: rgb(29 185 84);
}
```

**QA Checklist**:
- [ ] Colors render correctly in browser
- [ ] Dark mode variables apply correctly
- [ ] HMR updates live in dev server
- [ ] No console errors

---

### Phase 2: Typography (0.5 days)

**Objective**: Replace fonts and establish hierarchy

**Files**: `/web/src/app.css`

**Changes**:
1. Remove Overpass font declarations
2. Add system font stack
3. Update text size hierarchy (50/50 rule)
4. Update font weight classes
5. Update text color defaults

**Specific Changes**:
```css
/* Remove @font-face for Overpass */
/* Delete:
@font-face {
  font-family: 'Overpass';
  src: url('$lib/assets/fonts/overpass/Overpass.ttf');
}
*/

/* Add system font stack */
:root {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
               "Helvetica Neue", Arial, sans-serif;
}

/* Update monospace */
:root.monospace {
  font-family: "SF Mono", Monaco, "Cascadia Code", "Roboto Mono", Consolas,
               "Courier New", monospace;
}

/* Remove .monospace font-face */
```

**Typography Sizes** (update if custom Tailwind config exists):
```css
/* Maintain Tailwind defaults - they align well with 50/50 rule */
text-xs: 0.75rem
text-sm: 0.875rem
text-base: 1rem
text-lg: 1.125rem
text-xl: 1.25rem
text-2xl: 1.5rem
text-3xl: 1.875rem
text-4xl: 2.25rem
text-5xl: 3rem
```

**QA Checklist**:
- [ ] System fonts load correctly
- [ ] Font rendering is crisp (no blurriness)
- [ ] Font weight hierarchy clear
- [ ] Dark mode text color readable (white on Bentonville)
- [ ] Mobile text sizes appropriate

---

### Phase 3: Button Redesign (1 day)

**Objective**: Convert all buttons to pill shape

**Files**:
- `/web/src/app.css` (global button styles)
- 137+ component files with buttons

**Changes**:
1. Add global button styling for rounded-full
2. Update @immich/ui Button component classes
3. Update IconButton component classes
4. Update color mappings (primary = True Blue)

**Global Changes** (`app.css`):
```css
/* Override default button radius */
button:not(.square-button):not([data-shape="square"]) {
  @apply rounded-full;
}

/* Ensure icon buttons stay circular */
[role="button"][data-icon-button="true"] {
  @apply rounded-full;
}

/* Button hover states */
button:not(:disabled):hover {
  @apply transition-all duration-200;
}
```

**Component Pattern**:
```svelte
<!-- Update all occurrences like this -->
<!-- BEFORE -->
<Button shape="round" color="primary">Click me</Button>

<!-- AFTER (add class override if needed) -->
<Button shape="round" color="primary" class="!rounded-full">Click me</Button>

<!-- IconButton - ensure circular -->
<IconButton shape="round" class="!rounded-full">
```

**Files to Update** (137+ files):
- All files in `/web/src/lib/components/` using `<Button>`
- All files in `/web/src/lib/modals/` using `<Button>`
- All files in `/web/src/routes/` using `<Button>`
- Pattern: Search for `<Button` and update accordingly

**QA Checklist**:
- [ ] All buttons are pill-shaped
- [ ] Primary color is True Blue
- [ ] Hover states work
- [ ] Disabled state styling correct
- [ ] Icon buttons are circular
- [ ] No button styling regressions

---

### Phase 4: Form Elements (0.5 days)

**Objective**: Update input, select, checkbox styles

**Files**: `/web/src/app.css`, form component files

**Changes**:
1. Update `immich-form-input` utility
2. Update `immich-form-label` utility
3. Update select styling
4. Update checkbox/switch colors

**CSS Updates**:
```css
/* BEFORE */
@utility immich-form-input {
  @apply rounded-xl bg-slate-200 px-3 py-3 text-sm
         focus:border-immich-primary
         dark:bg-gray-600 dark:text-immich-dark-fg
         dark:disabled:bg-gray-800 dark:disabled:text-gray-200;
}

/* AFTER */
@utility immich-form-input {
  @apply rounded-full bg-gray-50 px-4 py-3 text-sm
         border-2 border-gray-300
         focus:border-walmart-blue focus:ring-2 focus:ring-sky-blue
         placeholder:text-gray-500
         dark:bg-bentonville-blue/20 dark:text-white
         dark:border-everyday-blue dark:placeholder:text-gray-400
         dark:focus:border-walmart-blue dark:focus:ring-sky-blue
         disabled:cursor-not-allowed disabled:opacity-50;
}

@utility immich-form-label {
  @apply font-medium text-bentonville-blue text-sm
         dark:text-white;
}
```

**Select Styling**:
```css
select {
  @apply rounded-full border-2 border-gray-300
         focus:border-walmart-blue focus:ring-2 focus:ring-sky-blue
         dark:bg-bentonville-blue/20 dark:border-everyday-blue
         dark:text-white;
}
```

**Checkbox/Switch**:
- Accent color: True Blue (#0071ce)
- Check color: Walmart Green (#1db954) for success states
- Update via @immich/ui color mappings

**QA Checklist**:
- [ ] Inputs are pill-shaped
- [ ] Focus states visible (Sky Blue ring)
- [ ] Dark mode contrast sufficient
- [ ] Placeholder text visible
- [ ] Disabled state clear
- [ ] Select dropdown works
- [ ] Checkboxes/switches color correct

---

### Phase 5: Cards & Modals (1 day)

**Objective**: Update card and modal styling

**Files**:
- `/web/src/app.css` (global card styles)
- `/web/src/lib/modals/` (52+ modal files)
- `/web/src/lib/components/` (40+ card files)

**Global CSS Changes** (`app.css`):
```css
/* Modal base styling */
[role="dialog"] {
  @apply rounded-3xl bg-white dark:bg-bentonville-blue
         border-2 border-gray-200 dark:border-everyday-blue
         shadow-xl;
}

/* Card styling */
.card {
  @apply rounded-2xl bg-white dark:bg-bentonville-blue/50
         border-2 border-gray-200 dark:border-everyday-blue
         transition-all duration-200;
}

.card:hover {
  @apply border-walmart-blue dark:border-sky-blue;
}
```

**Component Pattern**:
```svelte
<!-- Modal example -->
<div class="rounded-3xl bg-white dark:bg-bentonville-blue
            border-2 border-gray-200 dark:border-everyday-blue
            shadow-xl p-6">
</div>

<!-- Card example -->
<div class="rounded-2xl bg-white dark:bg-bentonville-blue/50
            border-2 border-gray-200 dark:border-everyday-blue
            p-5 hover:border-walmart-blue transition-colors">
</div>
```

**Files to Update** (92+ files):
- All files in `/web/src/lib/modals/` directory
- Album card components
- People cards
- Place cards
- All card-like components

**QA Checklist**:
- [ ] Modals have correct radius and borders
- [ ] Cards have correct styling
- [ ] Hover effects work
- [ ] Dark mode displays correctly
- [ ] Shadows are subtle
- [ ] Text contrast sufficient

---

### Phase 6: Navigation & Layout (1 day)

**Objective**: Update navbar, sidebar, logo

**Files**:
- `/web/src/lib/components/shared-components/navigation-bar/`
- `/web/src/lib/components/shared-components/side-bar/`
- `/web/src/lib/components/Logo.svelte`

**Navigation Bar Updates** (`navigation-bar.svelte`):
```svelte
<nav class="bg-white dark:bg-bentonville-blue
           border-b-2 border-gray-200 dark:border-everyday-blue
           shadow-sm">
  <!-- Logo - update fill color to Walmart blue -->
  <Logo class="text-walmart-blue" />

  <!-- Search bar - pill-shaped -->
  <SearchBar class="rounded-full" />

  <!-- Action buttons - ensure Walmart blue primary -->
  <Button color="primary" class="!rounded-full bg-walmart-blue
                               hover:bg-everyday-blue">
</nav>
```

**Sidebar Updates** (`user-sidebar.svelte`):
```svelte
<aside class="bg-gray-50 dark:bg-bentonville-blue/90
             border-r-2 border-gray-200 dark:border-everyday-blue">
  <!-- Active link styling -->
  <SideBarLink
    activeClass="bg-walmart-blue/10 text-walmart-blue border-l-4
                border-walmart-blue rounded-r-full"
    inactiveClass="text-bentonville-blue dark:text-white
                  hover:bg-gray-100 dark:hover:bg-everyday-blue/10">
  />
</aside>
```

**Logo Component Updates**:
- Update SVG fill colors to Walmart Blue
- Remove Immich purple tones
- Consider adding subtle Spark Yellow accent (optional)

**Related Files to Update** (12 files):
- navigation-bar.svelte
- account-info-panel.svelte
- notification-panel.svelte
- user-sidebar.svelte
- side-bar-link.svelte
- bottom-info.svelte
- server-status.svelte
- storage-space.svelte
- recent-albums.svelte
- ErrorLayout.svelte
- AuthPageLayout.svelte
- Logo.svelte

**QA Checklist**:
- [ ] Navbar displays correctly (light & dark)
- [ ] Sidebar active state clear
- [ ] Logo colors correct
- [ ] Navigation links highlighted properly
- [ ] Responsive on mobile (sidebar collapse)
- [ ] Hover states work

---

### Phase 7: Gallery & Timeline (1 day)

**Objective**: Update gallery views, timeline, asset viewer

**Files**:
- `/web/src/lib/components/timeline/` (8+ files)
- `/web/src/lib/components/photos-page/` (4+ files)
- `/web/src/lib/components/gallery-viewer/` (3+ files)
- `/web/src/lib/components/asset-viewer/` (30+ files)

**Timeline Updates**:
```svelte
<!-- timeline-day-header.svelte -->
<div class="sticky top-0 bg-walmart-blue/95 text-white px-4 py-2 rounded-full">
  <time class="font-medium text-white">{date}</time>
</div>

<!-- Timeline item hover -->
<div class="hover:bg-gray-100 dark:hover:bg-everyday-blue/10
           rounded-xl transition-colors">
</div>
```

**Gallery Thumbnail Updates**:
```css
.thumbnail {
  @apply rounded-xl border-2 border-transparent
         hover:border-walmart-blue hover:shadow-md
         transition-all duration-200;
}

.thumbnail.selected {
  @apply ring-4 ring-walmart-blue ring-opacity-50;
}
```

**Asset Viewer Updates**:
- Update action buttons to Walmart blue
- Update hover states for controls
- Ensure UI overlays use Bentonville blue for text

**Files to Update** (15+ gallery, 30+ asset viewer):
- All timeline components
- Photo grid components
- Thumbnail hover states
- Detail panel styling
- Video player controls
- Photo editor UI

**QA Checklist**:
- [ ] Timeline headers styled correctly
- [ ] Thumbnails have hover effects
- [ ] Selected assets highlighted (Walmart blue)
- [ ] Asset viewer controls visible
- [ ] Photo detail panel styled
- [ ] Video player looks good
- [ ] Responsive on different screen sizes

---

### Phase 8: Specific Components (1 day)

**Objective**: Update remaining specific components

**Components to Update** (60+ files):

**Upload Panel**:
```svelte
<div class="bg-white dark:bg-bentonville-blue rounded-2xl border-2 border-dashed
           border-gray-300 dark:border-everyday-blue
           hover:border-walmart-blue transition-colors p-8">
  <Icon path={mdiTrayArrowUp} class="text-walmart-blue mx-auto mb-2" size="48" />
  <p class="text-bentonville-blue dark:text-white">Drop files here</p>
</div>
```

**Progress Bars**:
```svelte
<div class="h-2 bg-gray-200 dark:bg-bentonville-blue/20 rounded-full overflow-hidden">
  <div class="h-full bg-gradient-to-r from-walmart-blue to-everyday-blue
             rounded-full transition-all"
       style="width: {percent}%">
  </div>
</div>
```

**Badges & Pills**:
```svelte
<!-- Success badge -->
<span class="rounded-full bg-walmart-green text-white px-3 py-1 text-xs font-bold">
  Uploaded
</span>

<!-- Warning badge -->
<span class="rounded-full bg-walmart-yellow text-bentonville-blue px-3 py-1
           text-xs font-bold">
  Processing
</span>

<!-- Info badge -->
<span class="rounded-full bg-sky-blue text-white px-3 py-1 text-xs font-bold">
  Syncing
</span>
```

**Search Bar**:
```svelte
<div class="relative">
  <input class="rounded-full w-full pl-12 pr-4 py-2.5
               bg-gray-50 dark:bg-bentonville-blue/20
               border-2 border-gray-200 dark:border-everyday-blue
               focus:border-walmart-blue focus:ring-2 focus:ring-sky-blue
               text-bentonville-blue dark:text-white
               placeholder:text-gray-500"
        placeholder="Search photos, albums, people..."
  />
  <Icon path={mdiMagnify}
        class="absolute left-4 top-1/2 -translate-y-1/2 text-walmart-blue" />
</div>
```

**Context Menus**:
```svelte
<div class="rounded-2xl bg-white dark:bg-bentonville-blue
           border-2 border-gray-200 dark:border-everyday-blue
           shadow-xl overflow-hidden">
  <button class="w-full px-4 py-2 text-left text-bentonville-blue
                dark:text-white
                hover:bg-gray-100 dark:hover:bg-everyday-blue/20
                transition-colors">
</button>
</div>
```

**Albums** (18 files):
- Album card styling (rounded-2xl, borders)
- Album cover styling
- Album actions buttons

**Settings** (45 files):
- Setting inputs (immich-form-input utility)
- Setting sections styling
- Admin settings cards
- User preference panels

**Other Components**:
- QR Code displays (white bg, proper borders)
- Maps (border styling)
- Combobox dropdowns (rounded-2xl)
- Tree components (hover states)
- Various utility components

**QA Checklist**:
- [ ] Upload panel styled correctly
- [ ] Progress bars show gradient
- [ ] Badges have correct colors
- [ ] Search bar functional
- [ ] Context menus display correctly
- [ ] Album cards look good
- [ ] Settings pages functional
- [ ] All components responsive

---

## File Manifest

### Core Styling Files (3 files - CRITICAL)
```
/web/src/app.css                    # PRIMARY - All theme variables
/web/src/app.html                   # Update meta theme-color
/web/src/app.d.ts                   # Update color type definitions if any
```

### Navigation & Layout (12 files)
```
/web/src/routes/+layout.svelte
/web/src/lib/components/shared-components/navigation-bar/
  - navigation-bar.svelte
  - account-info-panel.svelte
  - notification-panel.svelte
  - search-bar.svelte (may also be in search-bar folder)
/web/src/lib/components/shared-components/side-bar/
  - user-sidebar.svelte
  - side-bar-link.svelte
  - bottom-info.svelte
  - server-status.svelte
  - storage-space.svelte
  - recent-albums.svelte
/web/src/lib/components/layouts/
  - ErrorLayout.svelte
  - AuthPageLayout.svelte
/web/src/lib/components/shared-components/
  - Logo.svelte (UPDATE COLOR)
```

### Search Components (14 files)
```
/web/src/lib/components/shared-components/search-bar/
  - search-bar.svelte
  - search-history-box.svelte
  - search-filter.svelte
  - (all other files in this directory)
```

### Gallery & Timeline (15 files)
```
/web/src/lib/components/timeline/
  - (all .svelte files)
/web/src/lib/components/photos-page/
  - (all .svelte files)
/web/src/lib/components/shared-components/gallery-viewer/
  - (all .svelte files)
```

### Asset Viewer (30+ files)
```
/web/src/lib/components/asset-viewer/
  - (all .svelte files in this directory)
```

### Album Components (18 files)
```
/web/src/lib/components/album-page/
  - (all .svelte files)
```

### Settings (45 files)
```
/web/src/lib/components/admin-settings/
  - (all .svelte files)
/web/src/lib/components/user-settings-page/
  - (all .svelte files)
/web/src/lib/components/shared-components/settings/
  - (all .svelte files)
```

### Modals (52+ files)
```
/web/src/lib/modals/
  - (ALL .svelte files - update card/modal styling)
  - Key modals:
    - AlbumPickerModal.svelte
    - AlbumShareModal.svelte
    - SearchFilterModal.svelte
    - UserEditModal.svelte
    - (etc.)
```

### Additional Components (60+ files)
```
/web/src/lib/components/shared-components/
  - upload-panel.svelte
  - drag-and-drop-upload-overlay.svelte
  - empty-placeholder.svelte
  - theme-button.svelte
  - progress-bar/ (3 files)
  - context-menu/ (6 files)
  - map/ (3 files)
  - (all other components with visual styling)

/web/src/lib/elements/
  - (all basic UI elements if any)

/web/src/routes/
  - (all page-level components - +page.svelte files)
```

### Page Routes (30+ files)
```
/web/src/routes/(user)/+page.svelte
/web/src/routes/(user)/photos/+page.svelte
/web/src/routes/(user)/albums/+page.svelte
/web/src/routes/(user)/search/+page.svelte
/web/src/routes/(user)/explore/+page.svelte
/web/src/routes/(user)/map/+page.svelte
/web/src/routes/(user)/people/+page.svelte
/web/src/routes/(user)/favorites/+page.svelte
/web/src/routes/(user)/archive/+page.svelte
/web/src/routes/(user)/trash/+page.svelte
/web/src/routes/(user)/locked/+page.svelte
/web/src/routes/(user)/tags/+page.svelte
/web/src/routes/(user)/folders/+page.svelte
/web/src/routes/(user)/utilities/+page.svelte
/web/src/routes/(user)/sharing/+page.svelte
/web/src/routes/(user)/shared-links/+page.svelte
/web/src/routes/(user)/user-settings/+page.svelte
/web/src/routes/admin/+page.svelte
/web/src/routes/admin/system-settings/+page.svelte
/web/src/routes/admin/users/+page.svelte
/web/src/routes/admin/jobs-status/+page.svelte
/web/src/routes/auth/login/+page.svelte
/web/src/routes/auth/register/+page.svelte
(all other route files with styling)
```

### TOTAL: 320+ Files

---

## QA & Testing

### QA Phase 1: Visual Regression Testing

**After Each Phase:**

1. **Take Screenshots**
   - Before: Open http://localhost:3000 (old styling)
   - After: Refresh after changes
   - Save comparison images

2. **Areas to Screenshot**
   - [ ] Homepage/timeline
   - [ ] Album list
   - [ ] Album detail view
   - [ ] Search results
   - [ ] User settings
   - [ ] Admin settings
   - [ ] Modals (create album, share, etc.)
   - [ ] Navigation bar (light & dark)
   - [ ] Sidebar (light & dark)
   - [ ] Mobile view (responsive)

3. **Color Verification**
   - Use browser color picker tool
   - Verify colors match Walmart palette
   - Check both light and dark modes
   - Verify button colors

### QA Phase 2: Accessibility Audit

**Tools**: axe DevTools, WAVE, Lighthouse

**Checks**:

1. **Color Contrast Ratios** (WCAG AAA)
   ```
   True Blue (#0071ce) on White: 4.55:1 ✓ AA
   Bentonville Blue (#041e42) on White: 14.05:1 ✓ AAA
   Spark Yellow (#ffc220) on Bentonville: MUST CHECK
   Sky Blue (#82cef4) on White: MUST CHECK
   ```

2. **Keyboard Navigation**
   - [ ] All buttons focusable with Tab
   - [ ] All links focusable with Tab
   - [ ] Focus indicators visible (blue ring)
   - [ ] Can submit forms with keyboard
   - [ ] No keyboard traps

3. **Screen Reader Testing**
   - [ ] ARIA labels unchanged
   - [ ] Color-only indicators have text/icons
   - [ ] Alt text on images present
   - [ ] Form labels associated correctly

4. **Mobile Accessibility**
   - [ ] Touch targets at least 44x44px
   - [ ] No horizontal scroll
   - [ ] Readable on small screens
   - [ ] Form inputs easily selectable

**Pass Criteria**:
- No WCAG AAA violations
- Lighthouse Accessibility score ≥ 95

### QA Phase 3: Functional Testing

**Test Matrix**:

| Feature | Test Case | Expected | Status |
|---------|-----------|----------|--------|
| Upload | Drag-drop photos | Photos upload | [ ] |
| Upload | Click upload button | File picker opens | [ ] |
| Album | Create new album | Album created | [ ] |
| Album | Edit album name | Name updated | [ ] |
| Album | Add photos to album | Photos added | [ ] |
| Album | Share album | Sharing UI appears | [ ] |
| Search | Text search | Results display | [ ] |
| Search | Filter search | Filtered results | [ ] |
| Photos | View timeline | Photos organized by date | [ ] |
| Photos | View photo detail | Detail panel opens | [ ] |
| Settings | Change theme | Dark/light mode toggles | [ ] |
| Settings | Update profile | Changes saved | [ ] |
| Admin | View users | User list displays | [ ] |
| Admin | View jobs | Jobs status shows | [ ] |

**All Must Pass Before QA Complete**

### QA Phase 4: Cross-Browser Testing

**Browsers to Test**:
- [ ] Chrome/Edge (Windows/Mac)
- [ ] Firefox (Windows/Mac)
- [ ] Safari (macOS)
- [ ] Safari (iOS)
- [ ] Chrome (Android)

**Test Points**:
- [ ] CSS custom properties support
- [ ] Border-radius rendering (pill shapes)
- [ ] Font rendering (system fonts)
- [ ] Dark mode CSS variables
- [ ] Responsive design
- [ ] Touch interactions
- [ ] Performance (no lag)

### QA Phase 5: Performance Testing

**Tools**: Lighthouse, DevTools Performance tab

**Metrics**:
- [ ] First Contentful Paint (FCP): No regression
- [ ] Largest Contentful Paint (LCP): No regression
- [ ] Time to Interactive (TTI): No regression
- [ ] Cumulative Layout Shift (CLS): < 0.1
- [ ] Bundle size impact: < 5% increase
- [ ] Lighthouse score: ≥ 90

**Actions**:
- Run `npm run build`
- Verify bundle size
- Test on throttled network
- Test on low-end device simulation

---

## Engineering Excellence

### Code Quality Checks

#### Check 1: CSS Quality
```bash
# Manual verification:
- [ ] No hardcoded hex colors (use CSS variables)
- [ ] Consistent naming (--walmart-* prefix)
- [ ] Proper dark mode support (.dark class)
- [ ] No !important except where necessary
- [ ] Tailwind utilities used correctly
- [ ] Custom utilities documented
- [ ] No duplicate style definitions
```

#### Check 2: Component Quality
```
- [ ] Props/types unchanged (backward compatible)
- [ ] No logic changes (visual only)
- [ ] Svelte reactivity preserved
- [ ] Event handlers intact
- [ ] Accessibility attributes preserved
- [ ] Component APIs unchanged
```

#### Check 3: Build & Runtime Validation
```bash
# Run these commands:
npm run check:typescript       # [ ] No TypeScript errors
npm run check:svelte          # [ ] No Svelte errors
npm run lint                  # [ ] No ESLint errors
npm run format                # [ ] Code formatted
npm run build                 # [ ] Production build succeeds
npm run test                  # [ ] All tests pass
```

#### Check 4: Git Hygiene
```
- [ ] Commits are atomic (one phase per commit)
- [ ] Commit messages descriptive and clear
- [ ] No unrelated changes included
- [ ] Feature branch used (not main)
- [ ] Ready for PR review
```

### Code Review Template

```markdown
## Walmart Reskin - Phase [X] Review

### Changes
- [ ] [Phase description]
- [ ] All [X] files updated
- [ ] No logic changes, visual only
- [ ] Backward compatible

### Quality
- [ ] TypeScript checks pass
- [ ] Svelte checks pass
- [ ] ESLint passes
- [ ] Code formatted
- [ ] No console errors

### Testing
- [ ] Visual regression tested
- [ ] Accessibility verified
- [ ] Responsive design works
- [ ] Dark mode works
- [ ] No performance regression

### Accessibility
- [ ] Color contrast WCAG AAA
- [ ] Keyboard navigation works
- [ ] Screen reader compatible
- [ ] No focus traps

### Sign-off
- [ ] Ready for merge
- [ ] Ready for deployment
- [ ] Documentation updated
```

---

## Risk Mitigation

### Risk 1: Breaking Existing Functionality
**Likelihood**: Medium | **Impact**: High

**Mitigation**:
- Only modify visual classes, not component logic
- Test each phase before proceeding to next
- Keep git history clean for easy rollback
- Use feature branch (separate from main)
- Run full test suite after each phase

**Monitoring**:
- Check console for errors after each phase
- Test all major workflows
- Get stakeholder feedback early

### Risk 2: Accessibility Regression
**Likelihood**: Medium | **Impact**: Medium

**Mitigation**:
- Run axe/WAVE after each major phase
- Verify contrast ratios programmatically
- Test keyboard navigation continuously
- Add text alternatives for color-only indicators
- Use ARIA labels correctly

**Monitoring**:
- Lighthouse Accessibility score ≥ 95
- No WCAG AAA violations reported

### Risk 3: Performance Degradation
**Likelihood**: Low | **Impact**: Medium

**Mitigation**:
- Monitor bundle size (target: < 5% increase)
- Use system fonts (no additional font downloads)
- Optimize CSS (no redundant rules)
- Test on low-end devices
- Use Lighthouse for continuous monitoring

**Monitoring**:
- FCP/LCP not worse than baseline
- Bundle size tracked
- Lighthouse score remains ≥ 90

### Risk 4: Dark Mode Inconsistency
**Likelihood**: Medium | **Impact**: Low

**Mitigation**:
- Define all dark mode variables upfront
- Test in dark mode after every component change
- Use Tailwind's `dark:` prefix consistently
- Keep light/dark mode definitions paired

**Monitoring**:
- Toggle dark mode frequently during dev
- Screenshot comparison light vs dark
- Use browser dark mode setting test

### Risk 5: Font Rendering Issues
**Likelihood**: Low | **Impact**: Low

**Mitigation**:
- Test system font stack on all major OS
- Keep fallback chain complete
- Monitor for FOUT/FOIT (Flash of Unstyled/Invisible Text)
- Test web font alternatives if system fonts have issues

**Monitoring**:
- Cross-browser font rendering tests
- User feedback on font appearance

### Risk 6: Color Palette Mismatches
**Likelihood**: Low | **Impact**: Medium

**Mitigation**:
- Use standardized RGB values (verified from Walmart)
- Create color reference document
- Use browser color picker to verify
- Test on multiple monitors/devices

**Monitoring**:
- Color accuracy verification after each phase
- User feedback on color appearance

---

## Success Criteria

### Visual Alignment ✓
- [ ] All colors match Walmart palette (±5% tolerance)
  - True Blue: #0071ce
  - Spark Yellow: #ffc220
  - Bentonville Blue: #041e42
  - Everyday Blue: #0078ce
  - Sky Blue: #82cef4
  - Walmart Green: #1db954
- [ ] Typography follows Walmart hierarchy (50/50 rule)
- [ ] All buttons are pill-shaped (rounded-full)
- [ ] Dark mode uses Bentonville/Everyday blues correctly
- [ ] Consistency across all 320+ files

### Functionality ✓
- [ ] Zero regressions in existing features
- [ ] All user workflows work identically
- [ ] No console errors or warnings
- [ ] Build succeeds with no errors
- [ ] All tests pass
- [ ] HMR still works during development

### Accessibility ✓
- [ ] WCAG AA minimum standard met (AAA preferred)
- [ ] Color contrast ratios pass all checks
- [ ] Keyboard navigation fully functional
- [ ] Screen reader compatible
- [ ] No color-only information
- [ ] Lighthouse Accessibility score ≥ 95

### Performance ✓
- [ ] No significant performance degradation
- [ ] Bundle size increase < 5%
- [ ] FCP/LCP/TTI metrics maintained or improved
- [ ] Lighthouse score ≥ 90
- [ ] CLS < 0.1
- [ ] No memory leaks

### Code Quality ✓
- [ ] All TypeScript checks pass
- [ ] All Svelte checks pass
- [ ] ESLint passes with 0 errors
- [ ] Code formatted consistently
- [ ] Production build succeeds
- [ ] All tests pass
- [ ] Git history clean and organized

### Delivery ✓
- [ ] All 320+ files updated
- [ ] Documentation up to date
- [ ] Ready for production deployment
- [ ] Team trained on new theme
- [ ] No tech debt introduced

---

## Quick Start Commands

```bash
# Start development
cd /path/to/Immich/web
IMMICH_SERVER_URL=http://localhost:2283 npm run dev

# Quality checks
npm run check:typescript       # Type checking
npm run check:svelte          # Svelte validation
npm run lint                  # Linting
npm run format                # Code formatting
npm run build                 # Production build
npm run test                  # Unit tests

# Color verification
# Open DevTools → Color Picker tool
# Check CSS variable values
# Compare with Walmart palette
```

---

## References

### Walmart Brand Resources
- Brand Center: https://brandcenter.walmart.com/
- Color Palette: https://brandcenter.walmart.com/brand/brand-identity/color
- Typography: https://brandcenter.walmart.com/brand/brand-identity/typography

### Technical References
- SvelteKit: https://kit.svelte.dev/
- Tailwind CSS: https://tailwindcss.com/
- @immich/ui: Package used in Immich

### Documentation
- This Plan: `/WALMART_RESKIN_PLAN.md`
- Development Guide: `/AGENTS.md`
- Original Analysis: See Immich web UI components

---

## Implementation Checklist

### Pre-Implementation
- [ ] Read this entire plan
- [ ] Review Walmart design system section
- [ ] Understand phase dependencies
- [ ] Set up feature branch in git
- [ ] Have color palette reference open
- [ ] Start dev server: `npm run dev`

### During Implementation
- [ ] Follow phases in order (Phase 1→2→3...)
- [ ] Test HMR after each file change
- [ ] Commit after each phase
- [ ] Run quality checks frequently
- [ ] Take screenshots for QA comparison
- [ ] Document any deviations from plan

### After Each Phase
- [ ] [ ] Run TypeScript checks
- [ ] [ ] Run linter
- [ ] [ ] Take screenshots
- [ ] [ ] Test dark mode
- [ ] [ ] Verify colors accurate
- [ ] [ ] Test responsive design
- [ ] [ ] Commit changes

### QA Phase
- [ ] Visual regression testing complete
- [ ] Accessibility audit passed
- [ ] Functional tests passed
- [ ] Cross-browser tests passed
- [ ] Performance tests passed
- [ ] All code reviews passed

### Final Steps
- [ ] All 320+ files updated
- [ ] All tests passing
- [ ] Production build succeeds
- [ ] Documentation complete
- [ ] Ready for deployment

---

**Last Updated**: November 20, 2025
**Status**: Ready for Implementation
**Total Estimated Duration**: 5-7 days including QA
