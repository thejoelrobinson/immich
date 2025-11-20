# Immich Web Codebase - Form Components Analysis
## Select, Checkbox, Switch, and Radio Button Styling Review

### Executive Summary
The Immich web codebase uses a mix of **@immich/ui library components** and **custom Svelte components** for form inputs. All form components have been styled with **Walmart 2025 brand colors** (Walmart Blue, Bentonville Blue, Sky Blue, etc.).

---

## 1. Component Files Identified

### A. Native/Custom Components in `/src/lib/elements/`

#### RadioButton.svelte
- **Location**: `/src/lib/elements/RadioButton.svelte`
- **Type**: Native HTML `<input type="radio">` wrapper
- **Styling**: 
  - Basic wrapper with `class="flex items-center gap-2"`
  - Focus: `class="focus-visible:ring"` (minimal styling)
  - NO custom styling on the radio input itself
  - Uses default browser radio styling
- **Usage**: 9 files
- **Issue**: Lacks Walmart brand styling

#### Dropdown.svelte
- **Location**: `/src/lib/elements/Dropdown.svelte`
- **Type**: Custom dropdown component (NOT a native `<select>`)
- **Styling**:
  - Border-radius: `rounded-2xl`
  - Background: `bg-gray-100 dark:bg-gray-700`
  - Shadows: `shadow-lg`
  - Focus: `transition-all hover:bg-gray-300 dark:hover:bg-gray-800`
  - Position: `absolute` with menu positioning
- **Usage**: Custom implementation for asset selection controls

### B. Custom Settings Components in `/src/lib/components/shared-components/settings/`

#### setting-switch.svelte
- **Location**: `/src/lib/components/shared-components/settings/setting-switch.svelte`
- **Type**: Settings wrapper for `@immich/ui Switch` component
- **Styling**:
  - Label: `class="font-medium text-primary text-sm"`
  - Container: `class="flex place-items-center justify-between"`
  - Border-radius: `rounded-full` (unsaved change badge)
  - Uses `@immich/ui Switch` component internally
- **Usage**: 27 files (MOST USED)
- **Key Features**:
  - Supports title, subtitle, disabled state
  - Shows "unsaved_change" badge with orange background
  - Calls `@immich/ui Switch` with `onCheckedChange` callback

#### setting-select.svelte
- **Location**: `/src/lib/components/shared-components/settings/setting-select.svelte`
- **Type**: Settings wrapper for native `<select>` element
- **Styling**:
  - Uses `immich-form-input` utility class
  - Dropdown icon: chevron-down with positioning `end-1 col-start-1 row-start-1 self-center justify-self-end`
  - Grid layout: `class="grid"` for icon/select overlay
  - Border-radius: Applied via `immich-form-input` (see app.css)
- **Usage**: 12 files
- **CSS Applied**: `immich-form-input` utility

#### setting-checkboxes.svelte
- **Location**: `/src/lib/components/shared-components/settings/setting-checkboxes.svelte`
- **Type**: Settings wrapper for `@immich/ui Checkbox` component
- **Styling**:
  - Container: `class="flex flex-col gap-2"`
  - Checkbox wrapper: `class="flex gap-2 items-center"`
  - Uses `@immich/ui Checkbox` with `size="tiny"`
  - Uses `@immich/ui Label` for labels
- **Usage**: 1 file (least used, most specialized)

### C. @immich/ui Library Components (node_modules)

#### Switch.svelte
- **Location**: `/node_modules/@immich/ui/dist/components/Switch/Switch.svelte`
- **Type**: Bits-UI wrapper (based on `bits-ui` Switch primitive)
- **Styling**:
  - Base: `rounded-full border-2`
  - Height/Width: `h-8 w-13` (35px)
  - Border colors:
    - Off: `border-gray-400 bg-gray-300 dark:border-gray-500 dark:bg-gray-400`
    - On: `bg-primary/50 dark:bg-primary border-transparent`
  - Thumb/dot: `h-4 w-4 rounded-full transition-transform duration-100`
    - Position: `translate-x-7` (checked) or `translate-x-2` (unchecked)
  - Colors: Supports primary, secondary, success, danger, warning, info
  - Disabled: `cursor-not-allowed opacity-38`
- **Key Features**:
  - Accessible with ARIA labels
  - Supports colors via `color` prop (default: "primary")
  - Handles RTL languages

#### Checkbox.svelte
- **Location**: `/node_modules/@immich/ui/dist/components/Checkbox/Checkbox.svelte`
- **Type**: Bits-UI wrapper (based on `bits-ui` Checkbox primitive)
- **Styling**:
  - Base: `border-2` with focus ring
  - Border radius: Varies by size
    - tiny/small: `rounded-md`
    - medium: `rounded-md`
    - large: `rounded-lg`
    - giant: `rounded-xl`
  - Sizes: 
    - tiny: `size-4` (16px)
    - small: `size-5` (20px)
    - medium: `size-6` (24px)
    - large: `size-8` (32px)
    - giant: `size-10` (40px)
  - Checked: `data-[state=checked]:bg-primary`
  - Focus: `focus-visible:ring-2 focus-visible:ring-offset-2`
  - Disabled: `disabled:opacity-50`
  - Icon: MDI Check or Minus
- **Color Support**: primary, secondary, success, danger, warning, info
- **Shape Options**: semi-round, round, square

#### Select.svelte
- **Location**: `/node_modules/@immich/ui/dist/internal/Select.svelte`
- **Type**: Bits-UI Select wrapper (complex multi-option component)
- **Styling**:
  - Trigger: `rounded-lg focus-visible:outline-none`
  - Content: `rounded-xl border py-3 outline-none`
  - Background: `bg-light text-dark` (dark-aware)
  - Items: 
    - Base: `hover:bg-subtle data-[selected]:bg-primary/10 flex h-10 w-full items-center px-5 py-3 text-sm`
    - Selected: Check mark with `ms-auto` positioning
    - Disabled: `data-disabled:opacity-50`
  - Max height: `max-h-96`
  - Portal: Rendered outside component tree with sideOffset
- **Variant Support**: Custom shapes and sizes

---

## 2. Current Styling Analysis - immich-form-input Utility

### Location
`/src/app.css` (lines 6-8)

### Full Definition
```css
@utility immich-form-input {
  @apply rounded-full bg-gray-50 px-4 py-3 text-sm border-2 border-gray-300 
         focus:border-immich-primary focus:ring-2 focus:ring-sky-blue 
         placeholder:text-gray-500 disabled:cursor-not-allowed disabled:opacity-50 
         dark:bg-bentonville-blue/20 dark:text-white dark:border-everyday-blue 
         dark:placeholder:text-gray-400 dark:focus:ring-sky-blue;
}
```

### Styling Breakdown
| Aspect | Light Mode | Dark Mode |
|--------|-----------|-----------|
| **Border-radius** | `rounded-full` (pill-shaped) | `rounded-full` |
| **Background** | `bg-gray-50` | `bg-bentonville-blue/20` |
| **Text** | (default) | `dark:text-white` |
| **Border** | `border-2 border-gray-300` | `dark:border-everyday-blue` |
| **Border Color Focus** | `focus:border-immich-primary` (Walmart Blue) | Same |
| **Ring Color** | `focus:ring-sky-blue` | `dark:focus:ring-sky-blue` |
| **Ring Width** | `focus:ring-2` | Same |
| **Placeholder** | `placeholder:text-gray-500` | `dark:placeholder:text-gray-400` |
| **Disabled** | `disabled:opacity-50 disabled:cursor-not-allowed` | Same |

### Walmart Brand Colors Applied
```css
--color-walmart-blue: rgb(0 113 206)           /* Primary */
--color-bentonville-blue: rgb(4 30 66)         /* Dark background */
--color-everyday-blue: rgb(0 120 206)          /* Borders */
--color-sky-blue: rgb(130 206 244)             /* Focus rings */
```

---

## 3. Component Usage Statistics

| Component | Type | Files Using | Location |
|-----------|------|------------|----------|
| **Switch** | @immich/ui | 33 | Direct imports from @immich/ui |
| **setting-switch** | Custom wrapper | 27 | Via import from settings/setting-switch.svelte |
| **setting-select** | Custom wrapper | 12 | Via import from settings/setting-select.svelte |
| **RadioButton** | Native HTML wrapper | 9 | Via import from elements/RadioButton.svelte |
| **Checkbox** | @immich/ui | 8 | Direct imports from @immich/ui |
| **setting-checkboxes** | Custom wrapper | 1 | Via import (highly specialized) |

### Total Files Affected
- **80+ files** use form components in `/src` directory
- Most usage is through wrapper components (setting-*)
- Heavy reliance on @immich/ui library

---

## 4. Current Styling Patterns

### A. Border Radius Patterns
- **Pill-shaped** (`rounded-full`): Most form inputs (select, checkboxes in settings)
- **Rounded corners** (`rounded-2xl`, `rounded-xl`, `rounded-lg`): Dropdowns and @immich/ui components
- **Small rounded** (`rounded-md`): Checkbox sizes (tiny/small)

### B. Color Patterns
- **Primary**: Walmart Blue (`rgb(0 113 206)`)
- **Secondary**: Gray shades with Walmart Blue accents
- **Focus states**: Sky Blue with ring
- **Disabled**: Opacity reduction

### C. Focus States
- Text inputs: `border-immich-primary focus:ring-2 focus:ring-sky-blue`
- Checkboxes: `focus-visible:ring-2 focus-visible:ring-offset-2`
- Switches: Partial styling (ring-offset-background)

### D. Accessibility Features
- ARIA labels and descriptions
- `aria-labelledby` and `aria-describedby` attributes
- `focus-visible` pseudo-class usage
- Disabled state handling

---

## 5. Issues & Inconsistencies Found

### Critical Issues
1. **RadioButton component lacks styling**
   - Uses native input with minimal styling
   - No Walmart brand styling applied
   - Only basic `focus-visible:ring` applied

2. **Inconsistent border-radius**
   - Inputs: `rounded-full` (pill)
   - Checkboxes: `rounded-md` or `rounded-lg` (medium-rounded)
   - Switches: `rounded-full` (pill)
   - Dropdowns: `rounded-2xl` (large rounded)

3. **Dropdown component styling differs from inputs**
   - Custom implementation doesn't use `immich-form-input` utility
   - Uses `rounded-2xl` instead of `rounded-full`
   - Background: `bg-gray-100` vs `bg-gray-50`

4. **Native select in setting-select**
   - Styled with `immich-form-input`
   - Looks different from @immich/ui Select
   - No custom visual appearance

5. **@immich/ui Select advanced features unused**
   - More feature-rich Select exists but isn't used in settings
   - Inconsistent component choices

### Minor Issues
1. Color consistency: Mix of `immich-primary`, Walmart Blue, Sky Blue references
2. Focus ring patterns: Different implementations across components
3. Size prop handling: Varies between @immich/ui components
4. Documentation gaps: No unified component selection guide

---

## 6. Recommended Walmart Styling Approach

### Unified Design System
```
┌─────────────────────────────────────────────────┐
│ IMMICH WALMART DESIGN SYSTEM - FORM CONTROLS   │
├─────────────────────────────────────────────────┤
│ Border Radius:     rounded-lg (standard)        │
│ Focus Ring:        2px Sky Blue (#82cef4)       │
│ Focus Border:      Walmart Blue (#0071ce)       │
│ Disabled Opacity:  50%                          │
│ Transition:        duration-200 (smooth)        │
│ Spacing:           Consistent gaps (8px/12px)   │
└─────────────────────────────────────────────────┘
```

### Specific Component Updates

#### 1. RadioButton Component
**Current**: Basic native input
**Recommended**:
```svelte
<!-- Add custom styling wrapper -->
<div class="relative flex items-center gap-2">
  <input 
    type="radio" 
    class="appearance-none w-5 h-5 border-2 border-everyday-blue 
           rounded-full cursor-pointer checked:bg-walmart-blue 
           checked:border-walmart-blue focus-visible:ring-2 
           focus-visible:ring-sky-blue focus-visible:ring-offset-2
           disabled:opacity-50 disabled:cursor-not-allowed"
    bind:group 
  />
  <label class="text-sm font-medium text-immich-fg dark:text-white">
    {label}
  </label>
</div>
```

#### 2. Select Component
**Current**: Native `<select>` with `immich-form-input`
**Recommended**: Use @immich/ui Select for consistency
- Migrate `setting-select` to use @immich/ui Select
- Maintain wrapper for settings context
- Ensures visual consistency

#### 3. Checkbox & Switch
**Current**: Uses @immich/ui with shape="semi-round"
**Recommendation**: 
- Keep @immich/ui components (well-implemented)
- Standardize to `shape="semi-round"` for all
- Ensure consistent border-radius: `rounded-lg`

#### 4. Border Radius Standardization
- **All inputs**: `rounded-lg` (instead of `rounded-full`)
- **All components**: Consistent 8-12px radius
- **Rationale**: More professional, easier scanning, better mobile

#### 5. Focus State Standardization
```css
@utility form-input-focus {
  @apply focus:border-walmart-blue focus:ring-2 focus:ring-sky-blue
         focus-visible:outline-none focus:ring-offset-2;
}
```

---

## 7. Files to Modify (Priority Order)

### High Priority (Breaking changes)
1. `/src/lib/elements/RadioButton.svelte` - Add Walmart styling
2. `/src/lib/components/shared-components/settings/setting-select.svelte` - Migrate to @immich/ui
3. `/src/app.css` - Update `immich-form-input` utility

### Medium Priority (Consistency)
4. `/src/lib/elements/Dropdown.svelte` - Standardize border-radius
5. `/src/lib/components/shared-components/settings/setting-checkboxes.svelte` - Verify styling
6. All 33 Switch import files - Test focus states

### Low Priority (Optional enhancements)
7. Add transitions to all components
8. Add hover states for interactive elements
9. Create centralized component docs

---

## 8. Import Patterns by File Type

### Most Common (setting-switch usage)
```svelte
import SettingSwitch from '$lib/components/shared-components/settings/setting-switch.svelte';
```
Found in: 27 files (settings pages, onboarding, modals)

### Common (setting-select usage)
```svelte
import SettingSelect from '$lib/components/shared-components/settings/setting-select.svelte';
```
Found in: 12 files

### Direct @immich/ui imports
```svelte
import { Switch, Checkbox, Select } from '@immich/ui';
```
Found in: 33 files (Switch), 8 files (Checkbox)

---

## 9. Dark Mode Considerations

### Current Implementation
- All components support dark mode via `dark:` utilities
- Walmart brand colors adapted for dark:
  - Dark backgrounds: `bentonville-blue/20`
  - Dark borders: `everyday-blue`
  - Dark text: `white`
  - Focus rings: Consistent `sky-blue`

### Verification Needed
- Test all components in dark mode
- Ensure contrast ratios meet WCAG AA (4.5:1 min)
- Verify Sky Blue (`#82cef4`) is visible on dark backgrounds

---

## 10. Summary Table - All Form Components

| Component | File | Styling | Border Radius | Files Used | Status |
|-----------|------|---------|---------------|------------|--------|
| RadioButton | `elements/RadioButton.svelte` | Native + `focus-visible:ring` | default | 9 | ❌ Needs work |
| Checkbox | `@immich/ui/Checkbox.svelte` | @immich/ui with tv() | `rounded-md/lg` | 8 | ✅ Good |
| Switch | `@immich/ui/Switch.svelte` | @immich/ui with tv() | `rounded-full` | 33 | ✅ Good |
| Select (native) | `@immich/ui/Select.svelte` | @immich/ui bits-ui | `rounded-lg/xl` | 0 (unused in settings) | ⚠️ Available |
| Dropdown (custom) | `elements/Dropdown.svelte` | Custom CSS classes | `rounded-2xl` | Variable | ⚠️ Inconsistent |
| SettingSwitch | `settings/setting-switch.svelte` | Wrapper + @immich/ui Switch | `rounded-full` | 27 | ✅ Good |
| SettingSelect | `settings/setting-select.svelte` | `immich-form-input` | `rounded-full` | 12 | ⚠️ Inconsistent |
| SettingCheckboxes | `settings/setting-checkboxes.svelte` | Wrapper + @immich/ui Checkbox | `rounded-md` | 1 | ✅ Good |

---

## Conclusion

The Immich codebase has **good component infrastructure** with @immich/ui providing solid foundations. However, there are **style inconsistencies** primarily in:
1. RadioButton (no custom styling)
2. Border-radius standardization (mix of full/lg/2xl)
3. Native select vs @immich/ui Select choice

**Walmart brand colors are already integrated** throughout, but **standardizing component shapes and focus states** would significantly improve visual consistency and user experience.

**Estimated effort**: 2-3 days for full standardization and testing across 80+ files.
