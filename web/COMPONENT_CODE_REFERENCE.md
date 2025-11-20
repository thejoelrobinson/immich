# Immich Form Components - Code Reference & Examples

## Quick Reference Guide

### 1. RadioButton (Needs Update)

#### Current Implementation
**File**: `/src/lib/elements/RadioButton.svelte`
```svelte
<script lang="ts">
  interface Props {
    id: string;
    label: string;
    name: string;
    value: string;
    group?: string | undefined;
  }

  let { id, label, name, value, group = $bindable(undefined) }: Props = $props();
</script>

<div class="flex items-center gap-2">
  <input type="radio" {name} {id} {value} class="focus-visible:ring" bind:group />
  <label for={id}>{label}</label>
</div>
```

**Issues**:
- No custom styling on radio input
- Uses browser default appearance
- Minimal focus styling
- No Walmart branding

#### Recommended Update
```svelte
<script lang="ts">
  interface Props {
    id: string;
    label: string;
    name: string;
    value: string;
    group?: string | undefined;
    disabled?: boolean;
  }

  let { 
    id, 
    label, 
    name, 
    value, 
    group = $bindable(undefined),
    disabled = false 
  }: Props = $props();
</script>

<div class="flex items-center gap-2">
  <input 
    type="radio" 
    {name} 
    {id} 
    {value} 
    {disabled}
    class="appearance-none w-5 h-5 border-2 border-everyday-blue 
           rounded-full cursor-pointer checked:bg-walmart-blue 
           checked:border-walmart-blue focus-visible:ring-2 
           focus-visible:ring-sky-blue focus-visible:ring-offset-2
           disabled:opacity-50 disabled:cursor-not-allowed
           transition-all duration-200"
    bind:group 
  />
  <label for={id} class="text-sm font-medium text-immich-fg dark:text-white cursor-pointer">
    {label}
  </label>
</div>
```

**Improvements**:
- Custom appearance-none styling
- Walmart Blue checked state
- Sky Blue focus ring with offset
- Smooth transitions
- Disabled state handling

---

### 2. Checkbox (@immich/ui - Already Good)

#### Current Usage Example
**File**: `/src/lib/components/shared-components/settings/setting-checkboxes.svelte`
```svelte
<script lang="ts">
  import { Checkbox, Label } from '@immich/ui';
  
  // ...
</script>

<div class="flex flex-col gap-2">
  {#each options as option (option.value)}
    <div class="flex gap-2 items-center">
      <Checkbox
        size="tiny"
        id="{option.value}-checkbox"
        checked={value.includes(option.value)}
        {disabled}
        onCheckedChange={() => handleCheckboxChange(option.value)}
      />
      <Label label={option.text} for="{option.value}-checkbox" />
    </div>
  {/each}
</div>
```

#### Styling Properties
```css
/* @immich/ui/dist/components/Checkbox/Checkbox.svelte */

/* Border radius by size */
tiny:    rounded-md     (4px)
small:   rounded-md     (4px)
medium:  rounded-md     (4px)
large:   rounded-lg     (8px)
giant:   rounded-xl     (12px)

/* Size variants */
tiny:    size-4         (16px)
small:   size-5         (20px)
medium:  size-6         (24px)
large:   size-8         (32px)
giant:   size-10        (40px)

/* Checked state */
data-[state=checked]:bg-primary
```

#### Best Practices
```svelte
<!-- Use size="small" for most settings -->
<Checkbox size="small" />

<!-- Use shape="semi-round" (default) -->
<Checkbox shape="semi-round" />

<!-- Match color to context -->
<Checkbox color="primary" />        <!-- Blue -->
<Checkbox color="success" />        <!-- Green -->
<Checkbox color="danger" />         <!-- Red -->
```

---

### 3. Switch (@immich/ui - Already Good)

#### Current Usage Example
**File**: `/src/lib/components/shared-components/settings/setting-switch.svelte`
```svelte
<script lang="ts">
  import { Switch } from '@immich/ui';
  
  let checked = $bindable(false);
  let disabled = false;
  
  const handleToggle = (isChecked: boolean) => {
    // Handle toggle
  };
</script>

<div class="flex place-items-center justify-between">
  <div class="me-2">
    <label class="font-medium text-primary text-sm">
      {title}
    </label>
    {#if subtitle}
      <p class="text-sm dark:text-immich-dark-fg">{subtitle}</p>
    {/if}
  </div>
  <Switch 
    id="slider-id" 
    bind:checked 
    {disabled} 
    onCheckedChange={handleToggle}
  />
</div>
```

#### Styling Reference
```css
/* @immich/ui/dist/components/Switch/Switch.svelte */

/* Bar styling */
.bar {
  base: 'h-8 w-13 rounded-full border-2'
  
  /* When OFF (unchecked) */
  bg-gray-300 border-gray-400
  dark:bg-gray-400 dark:border-gray-500
  
  /* When ON (checked) */
  bg-primary/50 dark:bg-primary
}

/* Thumb/dot styling */
.dot {
  base: 'h-4 w-4 rounded-full transition-transform duration-100'
  
  /* Position OFF */ 
  translate-x-2
  
  /* Position ON */
  translate-x-7
  
  /* Scale on interaction */
  scale-150 when checked
}

/* Disabled state */
cursor-not-allowed opacity-38
```

#### Size Info
- **Bar**: 35px width × 32px height
- **Thumb**: 16px diameter
- **Animation**: 100ms transform transition

---

### 4. Select Component

#### Option A: Native Select (Current)
**File**: `/src/lib/components/shared-components/settings/setting-select.svelte`
```svelte
<script lang="ts">
  import { Icon } from '@immich/ui';
  import { mdiChevronDown } from '@mdi/js';

  let value = $bindable();
  const options = [
    { value: 'option1', text: 'Option 1' },
    { value: 'option2', text: 'Option 2' }
  ];
</script>

<div class="grid">
  <Icon
    icon={mdiChevronDown}
    size="1.2em"
    aria-hidden
    class="pointer-events-none end-1 relative col-start-1 row-start-1 
           self-center justify-self-end"
  />
  <select
    class="immich-form-input w-full appearance-none row-start-1 col-start-1 pe-6!"
    bind:value
  >
    {#each options as option (option.value)}
      <option value={option.value}>{option.text}</option>
    {/each}
  </select>
</div>
```

**CSS Applied**:
```css
/* immich-form-input utility from /src/app.css */
rounded-full bg-gray-50 px-4 py-3 text-sm 
border-2 border-gray-300 
focus:border-immich-primary focus:ring-2 focus:ring-sky-blue
placeholder:text-gray-500
disabled:cursor-not-allowed disabled:opacity-50
dark:bg-bentonville-blue/20 dark:text-white 
dark:border-everyday-blue dark:placeholder:text-gray-400 
dark:focus:ring-sky-blue
```

#### Option B: @immich/ui Select (Recommended)
**File**: `/node_modules/@immich/ui/dist/internal/Select.svelte`
```svelte
<script lang="ts">
  import { Select } from '@immich/ui';

  let values = $bindable([]);
  const options = [
    { value: 'opt1', label: 'Option 1' },
    { value: 'opt2', label: 'Option 2' }
  ];
</script>

<Select.Root 
  type="single"
  bind:value={values}
>
  <Select.Trigger>
    <Input
      placeholder="Select option"
      value={values[0]?.label ?? ''}
      readonly
    >
      {#snippet trailingIcon()}
        <IconButton
          variant="ghost"
          shape="round"
          icon={mdiUnfoldMoreHorizontal}
        />
      {/snippet}
    </Input>
  </Select.Trigger>
  <Select.Portal>
    <Select.Content class="rounded-xl border py-3">
      <Select.Viewport>
        {#each options as item}
          <Select.Item value={item.value} label={item.label}>
            {item.label}
          </Select.Item>
        {/each}
      </Select.Viewport>
    </Select.Content>
  </Select.Portal>
</Select.Root>
```

**Advantages**:
- Better UX (arrow indicators, scrolling)
- Consistent with other @immich/ui components
- More accessible
- Portal rendering (better layering)

---

### 5. Dropdown Component (Custom)

#### Current Implementation
**File**: `/src/lib/elements/Dropdown.svelte`
```svelte
<script lang="ts">
  import { Button, Icon } from '@immich/ui';
  import { mdiCheck } from '@mdi/js';
  import { fly } from 'svelte/transition';

  let showMenu = $bindable(false);
  let selectedOption = $bindable(options[0]);

  const handleSelectOption = (option) => {
    onSelect(option);
    selectedOption = option;
    showMenu = false;
  };
</script>

<div>
  <Button onclick={() => (showMenu = true)}>
    {selectedOption.title}
  </Button>

  {#if showMenu}
    <div
      transition:fly={{ y: -30, duration: 250 }}
      class="absolute min-w-75 max-h-[70vh] overflow-y-auto 
             rounded-2xl bg-gray-100 py-2 text-black 
             shadow-lg dark:bg-gray-700 dark:text-white"
    >
      {#each options as option}
        <button
          type="button"
          class="grid grid-cols-[36px_1fr] place-items-center p-2 
                 hover:bg-gray-300 dark:hover:bg-gray-800"
          onclick={() => handleSelectOption(option)}
        >
          {#if isEqual(selectedOption, option)}
            <Icon icon={mdiCheck} class="text-primary" />
            <p class="justify-self-start text-primary">
              {option.title}
            </p>
          {:else}
            <p class="justify-self-start">
              {option.title}
            </p>
          {/if}
        </button>
      {/each}
    </div>
  {/if}
</div>
```

**Styling Issues**:
- `rounded-2xl` is different from form inputs
- Should be `rounded-lg` or `rounded-xl`
- `bg-gray-100` vs `bg-gray-50` inconsistency

#### Recommended Update
```css
/* Change this: */
rounded-2xl -> rounded-lg
bg-gray-100 -> bg-gray-50
dark:bg-gray-700 -> dark:bg-gray-600

/* Add transitions */
class="transition-all duration-200"
```

---

## CSS Utilities Reference

### Current Form Input Utility
**Location**: `/src/app.css:6-8`

```css
@utility immich-form-input {
  @apply rounded-full bg-gray-50 px-4 py-3 text-sm border-2 border-gray-300
         focus:border-immich-primary focus:ring-2 focus:ring-sky-blue
         placeholder:text-gray-500 disabled:cursor-not-allowed disabled:opacity-50
         dark:bg-bentonville-blue/20 dark:text-white dark:border-everyday-blue
         dark:placeholder:text-gray-400 dark:focus:ring-sky-blue;
}
```

### Proposed Enhancement
```css
/* Add new standard utility */
@utility form-focus-ring {
  @apply focus:border-walmart-blue focus:ring-2 focus:ring-sky-blue
         focus-visible:outline-none focus:ring-offset-2 
         transition-all duration-200;
}

/* Alternative: Update border-radius */
@utility immich-form-input-lg {
  @apply rounded-lg bg-gray-50 px-4 py-3 text-sm border-2 border-gray-300
         focus:border-immich-primary focus:ring-2 focus:ring-sky-blue
         placeholder:text-gray-500 disabled:cursor-not-allowed disabled:opacity-50
         dark:bg-bentonville-blue/20 dark:text-white dark:border-everyday-blue
         dark:placeholder:text-gray-400 dark:focus:ring-sky-blue
         transition-all duration-200;
}
```

---

## Walmart Color Scheme

### Defined in `/src/app.css:50-57`

```css
--color-walmart-blue: rgb(0 113 206)           /* #0071CE */
--color-bentonville-blue: rgb(4 30 66)         /* #041E42 */
--color-everyday-blue: rgb(0 120 206)          /* #0078CE */
--color-sky-blue: rgb(130 206 244)             /* #82CEF4 */
--color-walmart-green: rgb(29 185 84)          /* #1DB954 */
--color-walmart-yellow: rgb(255 194 32)        /* #FFC220 */
```

### Usage by Component

| Component | Light | Dark |
|-----------|-------|------|
| **Primary** | walmart-blue | sky-blue |
| **Borders** | gray-300 | everyday-blue |
| **Backgrounds** | gray-50 | bentonville-blue/20 |
| **Focus Ring** | sky-blue | sky-blue |
| **Success** | walmart-green | walmart-green |
| **Warning** | walmart-yellow | walmart-yellow |

---

## Import Patterns

### From @immich/ui
```svelte
import { Switch, Checkbox, Select, Input, Button } from '@immich/ui';
```

### From Local Components
```svelte
import RadioButton from '$lib/elements/RadioButton.svelte';
import Dropdown from '$lib/elements/Dropdown.svelte';
import SettingSwitch from '$lib/components/shared-components/settings/setting-switch.svelte';
import SettingSelect from '$lib/components/shared-components/settings/setting-select.svelte';
import SettingCheckboxes from '$lib/components/shared-components/settings/setting-checkboxes.svelte';
```

---

## Testing Checklist

When updating components, verify:

- [ ] Light mode appearance
- [ ] Dark mode appearance
- [ ] Focus states visible (2px ring)
- [ ] Disabled states (50% opacity)
- [ ] Keyboard navigation works
- [ ] Screen reader announces label
- [ ] Touch targets at least 44×44px
- [ ] Contrast ratio meets WCAG AA (4.5:1)
- [ ] Transitions smooth (200ms)
- [ ] Mobile responsive

---

## File Dependencies

### RadioButton Dependencies
```
RadioButton.svelte
└── Used in: 9 files
    ├── user-settings-page/*
    ├── modals/*
    └── admin-settings/*
```

### Setting Components Dependencies
```
setting-switch.svelte
└── Used in: 27 files (most common)
    ├── AlbumOptionsModal.svelte
    ├── SlideshowSettingsModal.svelte
    ├── onboarding-page/* (5 files)
    └── admin-settings/* (multiple)

setting-select.svelte
└── Used in: 12 files
    ├── LibraryUserPickerModal.svelte
    ├── ObtainiumConfigModal.svelte
    ├── MapSettingsModal.svelte
    └── admin-settings/*

setting-checkboxes.svelte
└── Used in: 1 file (specialized)
    └── (Rarely used component)
```

### @immich/ui Dependencies
```
Switch
└── Used in: 33 files
    ├── setting-switch.svelte (wrapper)
    ├── Direct imports in:
    │   ├── SharedLinkUpdateModal.svelte
    │   ├── MapSettingsModal.svelte
    │   ├── etc.
    └── (Multiple settings & modals)

Checkbox
└── Used in: 8 files
    ├── setting-checkboxes.svelte (wrapper)
    ├── Direct imports in:
    │   ├── UserDeleteConfirmModal.svelte
    │   ├── ApiKeyPermissionsPicker.svelte
    │   └── (Fewer than Switch)
```

---

## Migration Path

### Phase 1: RadioButton Enhancement
- Update `/src/lib/elements/RadioButton.svelte`
- Test in 9 affected files
- Estimated: 1-2 hours

### Phase 2: Select Standardization
- Update `/src/lib/components/shared-components/settings/setting-select.svelte` 
- Migrate to @immich/ui Select
- Update 12 affected files
- Estimated: 3-4 hours

### Phase 3: Border Radius Standardization
- Update `/src/app.css` immich-form-input
- Change `rounded-full` to `rounded-lg`
- Update `/src/lib/elements/Dropdown.svelte`
- Regression test 80+ files
- Estimated: 4-6 hours

### Phase 4: Focus State Consistency
- Add focus state utility to app.css
- Apply across all 80+ files
- Estimated: 2-3 hours

**Total Estimated Effort**: 10-15 hours (2-3 days development + testing)

