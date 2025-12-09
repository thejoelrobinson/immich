# Plan: Move Transcript Following into Info Panel

## Goal
Move the transcript following functionality from a floating overlay panel into the Detail (Info) panel, so it appears as a collapsible section alongside People, Details, Location, etc.

## Current State
- `transcription-panel.svelte` - Floating panel with full transcript UI
- `detail-panel.svelte` - Info sidebar (People, Details, Location, Map, etc.)
- `asset-viewer.svelte` - Renders both separately

## Implementation Steps

### Step 1: Create `detail-panel-transcription.svelte`
Create a new component that contains the transcript content styled for the detail panel:
- Reuse the segment rendering, karaoke highlighting, and click-to-seek logic
- Remove the floating container styling
- Match the section styling of other detail panel sections (like People, Details)
- Include collapsible/expandable behavior (similar to how map or tags work)

**Location**: `web/src/lib/components/asset-viewer/detail-panel-transcription.svelte`

**Props**:
```typescript
interface Props {
  assetId: string;
  currentTime: number;
  onSeek?: (time: number) => void;
}
```

### Step 2: Modify `detail-panel.svelte`
- Add new props: `assetType`, `currentVideoTime`, `onTranscriptionSeek`, `hasTranscription`
- Import and conditionally render `DetailPanelTranscription` for video assets with transcription
- Place it after the Details section (before Location) or as a dedicated section

**Changes**:
```svelte
<!-- Add to props -->
interface Props {
  asset: AssetResponseDto;
  albums?: AlbumResponseDto[];
  currentAlbum?: AlbumResponseDto | null;
  onClose: () => void;
  // New props for transcription
  currentVideoTime?: number;
  onTranscriptionSeek?: (time: number) => void;
  hasTranscription?: boolean;
}

<!-- Add import -->
import DetailPanelTranscription from './detail-panel-transcription.svelte';

<!-- Add rendering (after Details section, around line 437) -->
{#if asset.type === AssetTypeEnum.Video && hasTranscription}
  <DetailPanelTranscription
    assetId={asset.id}
    currentTime={currentVideoTime ?? 0}
    onSeek={onTranscriptionSeek}
  />
{/if}
```

### Step 3: Modify `asset-viewer.svelte`
- Pass new props to `DetailPanel`: `currentVideoTime`, `handleTranscriptionSeek`, `hasTranscription`
- Remove or keep the floating `TranscriptionPanel` (user preference - can keep floating toggle as alternative)
- The bottom-right buttons can remain for quick toggle if desired

**Changes** (around line 771):
```svelte
<DetailPanel
  {asset}
  currentAlbum={album}
  albums={appearsInAlbums}
  onClose={() => ($isShowDetail = false)}
  currentVideoTime={currentVideoTime}
  onTranscriptionSeek={handleTranscriptionSeek}
  {hasTranscription}
/>
```

### Step 4: Style the Transcript Section
The transcript section in detail panel should:
- Have a collapsible header "TRANSCRIPT" (uppercase like other sections)
- Limit height with scrollable content (max-height with overflow-y-auto)
- Maintain karaoke highlighting and auto-scroll functionality
- Match the visual style of other sections (padding, typography)

### Optional: Keep Floating Panel
Can keep the floating panel as an alternative "pop-out" option:
- Button in transcript section header to "pop out" to floating panel
- This gives users flexibility

## Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `detail-panel-transcription.svelte` | Create | New transcript section component |
| `detail-panel.svelte` | Modify | Add props, import, render transcript section |
| `asset-viewer.svelte` | Modify | Pass transcription props to DetailPanel |

## Testing Checklist
- [ ] Transcript appears in Info panel for videos with transcription
- [ ] Karaoke highlighting works (yellow word as video plays)
- [ ] Auto-scroll keeps active segment visible
- [ ] Click on segment/word seeks video
- [ ] Speaker colors render correctly
- [ ] Loading state shows spinner
- [ ] Error state shows message
- [ ] Section is collapsible
- [ ] Does not appear for non-video assets
- [ ] Does not appear when no transcription available
