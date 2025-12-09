<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import { focusTrap } from '$lib/actions/focus-trap';
  import type { Action, OnAction, PreAction } from '$lib/components/asset-viewer/actions/action';
  import MotionPhotoAction from '$lib/components/asset-viewer/actions/motion-photo-action.svelte';
  import NextAssetAction from '$lib/components/asset-viewer/actions/next-asset-action.svelte';
  import PreviousAssetAction from '$lib/components/asset-viewer/actions/previous-asset-action.svelte';
  import AssetViewerNavBar from '$lib/components/asset-viewer/asset-viewer-nav-bar.svelte';
  import OnEvents from '$lib/components/OnEvents.svelte';
  import { AppRoute, AssetAction, ProjectionType, QueryParameter } from '$lib/constants';
  import { activityManager } from '$lib/managers/activity-manager.svelte';
  import { authManager } from '$lib/managers/auth-manager.svelte';
  import type { TimelineAsset } from '$lib/managers/timeline-manager/types';
  import { closeEditorCofirm } from '$lib/stores/asset-editor.store';
  import { assetViewingStore } from '$lib/stores/asset-viewing.store';
  import { ocrManager } from '$lib/stores/ocr.svelte';
  import { alwaysLoadOriginalVideo, isShowDetail } from '$lib/stores/preferences.store';
  import { SlideshowNavigation, SlideshowState, slideshowStore } from '$lib/stores/slideshow.store';
  import { user } from '$lib/stores/user.store';
  import { websocketEvents } from '$lib/stores/websocket';
  import { getAssetJobMessage, getSharedLink, handlePromiseError } from '$lib/utils';
  import { handleError } from '$lib/utils/handle-error';
  import { SlideshowHistory } from '$lib/utils/slideshow-history';
  import { toTimelineAsset } from '$lib/utils/timeline-util';
  import {
    AssetJobName,
    AssetTypeEnum,
    getAllAlbums,
    getAssetInfo,
    getStack,
    runAssetJobs,
    type AlbumResponseDto,
    type AssetResponseDto,
    type PersonResponseDto,
    type StackResponseDto,
  } from '@immich/sdk';
  import { toastManager } from '@immich/ui';
  import { onDestroy, onMount, untrack } from 'svelte';
  import { t } from 'svelte-i18n';
  import { fly } from 'svelte/transition';
  import Thumbnail from '../assets/thumbnail/thumbnail.svelte';
  import ActivityStatus from './activity-status.svelte';
  import ActivityViewer from './activity-viewer.svelte';
  import DetailPanel from './detail-panel.svelte';
  import DocumentViewer from './document-viewer.svelte';
  import CropArea from './editor/crop-tool/crop-area.svelte';
  import EditorPanel from './editor/editor-panel.svelte';
  import ImagePanoramaViewer from './image-panorama-viewer.svelte';
  import OcrButton from './ocr-button.svelte';
  import PhotoViewer from './photo-viewer.svelte';
  import SlideshowBar from './slideshow-bar.svelte';
  import VideoViewer from './video-wrapper-viewer.svelte';
  import ContentSearchNav from './content-search-nav.svelte';
  import { transcriptionSearchManager } from '$lib/stores/transcription-search.svelte';
  import { isTranscriptionMatch, type AnyContentMatch } from '$lib/stores/content-search.svelte';

  type HasAsset = boolean;

  interface Props {
    asset: AssetResponseDto;
    preloadAssets?: TimelineAsset[];
    showNavigation?: boolean;
    withStacked?: boolean;
    isShared?: boolean;
    album?: AlbumResponseDto | null;
    person?: PersonResponseDto | null;
    preAction?: PreAction | undefined;
    onAction?: OnAction | undefined;
    showCloseButton?: boolean;
    onClose: (asset: AssetResponseDto) => void;
    onNext: () => Promise<HasAsset>;
    onPrevious: () => Promise<HasAsset>;
    onRandom: () => Promise<{ id: string } | undefined>;
    copyImage?: () => Promise<void>;
  }

  let {
    asset = $bindable(),
    preloadAssets = $bindable([]),
    showNavigation = true,
    withStacked = false,
    isShared = false,
    album = null,
    person = null,
    preAction = undefined,
    onAction = undefined,
    showCloseButton,
    onClose,
    onNext,
    onPrevious,
    onRandom,
    copyImage = $bindable(),
  }: Props = $props();

  const { setAssetId } = assetViewingStore;
  const {
    restartProgress: restartSlideshowProgress,
    stopProgress: stopSlideshowProgress,
    slideshowNavigation,
    slideshowState,
    slideshowTransition,
  } = slideshowStore;
  const stackThumbnailSize = 60;
  const stackSelectedThumbnailSize = 65;

  let appearsInAlbums: AlbumResponseDto[] = $state([]);
  let shouldPlayMotionPhoto = $state(false);
  let sharedLink = getSharedLink();
  let enableDetailPanel = asset.hasMetadata;
  let slideshowStateUnsubscribe: () => void;
  let shuffleSlideshowUnsubscribe: () => void;
  let previewStackedAsset: AssetResponseDto | undefined = $state();
  let isShowActivity = $state(false);
  let isShowEditor = $state(false);
  let fullscreenElement = $state<Element>();
  let unsubscribes: (() => void)[] = [];
  let selectedEditType: string = $state('');
  let stack: StackResponseDto | null = $state(null);

  let zoomToggle = $state(() => void 0);
  let playOriginalVideo = $state($alwaysLoadOriginalVideo);

  // Transcription state
  let hasTranscription = $state(false);
  let showTranscriptionSearch = $state(false);
  let transcriptionSearchInput = $state('');
  let videoViewerRef: VideoViewer | undefined = $state();
  let currentVideoTime = $state(0);

  // Document extensions for fallback detection (when asset.type is not set correctly)
  const documentExtensions = ['.pdf', '.txt', '.epub', '.md', '.rtf', '.doc', '.docx', '.odt', '.pptx', '.ppt', '.xlsx', '.xls', '.csv', '.json', '.xml', '.html', '.htm'];

  const isDocumentByExtension = (path: string | undefined) => {
    if (!path) {
      return false;
    }
    const lowerPath = path.toLowerCase();
    return documentExtensions.some((ext) => lowerPath.endsWith(ext));
  };

  // Check if asset is a document either by type or by file extension (for backwards compatibility)
  const isDocumentAsset = $derived(
    asset.type === AssetTypeEnum.Document || isDocumentByExtension(asset.originalPath),
  );

  // Get document search term from URL query parameter
  // Priority: explicit docSearch param > extracted from search query param
  const documentSearchTerm = $derived.by(() => {
    // Check for explicit document search param first
    const explicit = $page.url.searchParams.get(QueryParameter.DOCUMENT_SEARCH);
    if (explicit) {
      console.log('[AssetViewer] Found explicit docSearch param:', explicit);
      return explicit;
    }

    // On search pages, extract search term from the query JSON
    const queryParam = $page.url.searchParams.get(QueryParameter.QUERY);
    if (queryParam) {
      try {
        const parsed = JSON.parse(queryParam);
        // Use smart search query, OCR search term, or content search term
        const term = parsed.query || parsed.ocr || parsed.content || '';
        console.log('[AssetViewer] Extracted search term from query:', term, 'parsed:', parsed);
        return term;
      } catch (error_) {
        console.log('[AssetViewer] Failed to parse query param:', error_);
        return '';
      }
    }

    console.log('[AssetViewer] No search term found in URL');
    return '';
  });

  const setPlayOriginalVideo = (value: boolean) => {
    playOriginalVideo = value;
  };

  const refreshStack = async () => {
    if (authManager.isSharedLink) {
      return;
    }

    if (asset.stack) {
      stack = await getStack({ id: asset.stack.id });
    }

    if (!stack?.assets.some(({ id }) => id === asset.id)) {
      stack = null;
    }

    untrack(() => {
      if (stack && stack?.assets.length > 1) {
        preloadAssets.push(toTimelineAsset(stack.assets[1]));
      }
    });
  };

  const handleFavorite = async () => {
    if (album && album.isActivityEnabled) {
      try {
        await activityManager.toggleLike();
      } catch (error) {
        handleError(error, $t('errors.unable_to_change_favorite'));
      }
    }
  };

  const onAssetUpdate = ({ asset: assetUpdate }: { event: 'upload' | 'update'; asset: AssetResponseDto }) => {
    if (assetUpdate.id === asset.id) {
      asset = assetUpdate;
    }
  };

  onMount(async () => {
    unsubscribes.push(
      websocketEvents.on('on_upload_success', (asset) => onAssetUpdate({ event: 'upload', asset })),
      websocketEvents.on('on_asset_update', (asset) => onAssetUpdate({ event: 'update', asset })),
    );

    slideshowStateUnsubscribe = slideshowState.subscribe((value) => {
      if (value === SlideshowState.PlaySlideshow) {
        slideshowHistory.reset();
        slideshowHistory.queue(toTimelineAsset(asset));
        handlePromiseError(handlePlaySlideshow());
      } else if (value === SlideshowState.StopSlideshow) {
        handlePromiseError(handleStopSlideshow());
      }
    });

    shuffleSlideshowUnsubscribe = slideshowNavigation.subscribe((value) => {
      if (value === SlideshowNavigation.Shuffle) {
        slideshowHistory.reset();
        slideshowHistory.queue(toTimelineAsset(asset));
      }
    });

    if (!sharedLink) {
      await handleGetAllAlbums();
    }
  });

  onDestroy(() => {
    if (slideshowStateUnsubscribe) {
      slideshowStateUnsubscribe();
    }

    if (shuffleSlideshowUnsubscribe) {
      shuffleSlideshowUnsubscribe();
    }

    for (const unsubscribe of unsubscribes) {
      unsubscribe();
    }

    activityManager.reset();
  });

  const handleGetAllAlbums = async () => {
    if (authManager.isSharedLink) {
      return;
    }

    try {
      appearsInAlbums = await getAllAlbums({ assetId: asset.id });
    } catch (error) {
      console.error('Error getting album that asset belong to', error);
    }
  };

  const handleOpenActivity = () => {
    if ($isShowDetail) {
      $isShowDetail = false;
    }
    isShowActivity = !isShowActivity;
  };

  const toggleDetailPanel = () => {
    isShowActivity = false;
    $isShowDetail = !$isShowDetail;
  };

  const closeViewer = () => {
    onClose(asset);
  };

  const closeEditor = () => {
    closeEditorCofirm(() => {
      isShowEditor = false;
    });
  };

  const navigateAsset = async (order?: 'previous' | 'next', e?: Event) => {
    if (!order) {
      if ($slideshowState === SlideshowState.PlaySlideshow) {
        order = $slideshowNavigation === SlideshowNavigation.AscendingOrder ? 'previous' : 'next';
      } else {
        return;
      }
    }

    e?.stopPropagation();

    let hasNext = false;

    if ($slideshowState === SlideshowState.PlaySlideshow && $slideshowNavigation === SlideshowNavigation.Shuffle) {
      hasNext = order === 'previous' ? slideshowHistory.previous() : slideshowHistory.next();
      if (!hasNext) {
        const asset = await onRandom();
        if (asset) {
          slideshowHistory.queue(asset);
          hasNext = true;
        }
      }
    } else {
      hasNext = order === 'previous' ? await onPrevious() : await onNext();
    }

    if ($slideshowState === SlideshowState.PlaySlideshow) {
      if (hasNext) {
        $restartSlideshowProgress = true;
      } else {
        await handleStopSlideshow();
      }
    }
  };

  // const showEditorHandler = () => {
  //   if (isShowActivity) {
  //     isShowActivity = false;
  //   }
  //   isShowEditor = !isShowEditor;
  // };

  const handleRunJob = async (name: AssetJobName) => {
    try {
      await runAssetJobs({ assetJobsDto: { assetIds: [asset.id], name } });
      toastManager.success($getAssetJobMessage(name));
    } catch (error) {
      handleError(error, $t('errors.unable_to_submit_job'));
    }
  };

  /**
   * Slide show mode
   */

  let assetViewerHtmlElement = $state<HTMLElement>();

  const slideshowHistory = new SlideshowHistory((asset) => {
    handlePromiseError(setAssetId(asset.id).then(() => ($restartSlideshowProgress = true)));
  });

  const handleVideoStarted = () => {
    if ($slideshowState === SlideshowState.PlaySlideshow) {
      $stopSlideshowProgress = true;
    }
  };

  const handlePlaySlideshow = async () => {
    try {
      await assetViewerHtmlElement?.requestFullscreen?.();
    } catch (error) {
      handleError(error, $t('errors.unable_to_enter_fullscreen'));
      $slideshowState = SlideshowState.StopSlideshow;
    }
  };

  const handleStopSlideshow = async () => {
    try {
      if (document.fullscreenElement) {
        document.body.style.cursor = '';
        await document.exitFullscreen();
      }
    } catch (error) {
      handleError(error, $t('errors.unable_to_exit_fullscreen'));
    } finally {
      $stopSlideshowProgress = true;
      $slideshowState = SlideshowState.None;
    }
  };

  const handleStackedAssetMouseEvent = (isMouseOver: boolean, asset: AssetResponseDto) => {
    previewStackedAsset = isMouseOver ? asset : undefined;
  };
  const handlePreAction = (action: Action) => {
    preAction?.(action);
  };
  const handleAction = async (action: Action) => {
    switch (action.type) {
      case AssetAction.ADD_TO_ALBUM: {
        await handleGetAllAlbums();
        break;
      }
      case AssetAction.REMOVE_ASSET_FROM_STACK: {
        stack = action.stack;
        if (stack) {
          asset = stack.assets[0];
        }
        break;
      }
      case AssetAction.STACK:
      case AssetAction.SET_STACK_PRIMARY_ASSET: {
        stack = action.stack;
        break;
      }
      case AssetAction.SET_PERSON_FEATURED_PHOTO: {
        const assetInfo = await getAssetInfo({ id: asset.id });
        asset = { ...asset, people: assetInfo.people };
        break;
      }
      case AssetAction.KEEP_THIS_DELETE_OTHERS:
      case AssetAction.UNSTACK: {
        closeViewer();
        break;
      }
    }

    onAction?.(action);
  };

  const handleUpdateSelectedEditType = (type: string) => {
    selectedEditType = type;
  };

  const handleAssetReplace = async ({ oldAssetId, newAssetId }: { oldAssetId: string; newAssetId: string }) => {
    if (oldAssetId !== asset.id) {
      return;
    }

    await new Promise((promise) => setTimeout(promise, 500));
    await goto(`${AppRoute.PHOTOS}/${newAssetId}`);
  };

  let isFullScreen = $derived(fullscreenElement !== null);

  $effect(() => {
    if (asset) {
      previewStackedAsset = undefined;
      handlePromiseError(refreshStack());
    }
  });
  $effect(() => {
    if (album && !album.isActivityEnabled && activityManager.commentCount === 0) {
      isShowActivity = false;
    }
  });
  $effect(() => {
    if (album && isShared && asset.id) {
      handlePromiseError(activityManager.init(album.id, asset.id));
    }
  });

  let currentAssetId = $derived(asset.id);
  $effect(() => {
    if (currentAssetId) {
      untrack(() => handlePromiseError(handleGetAllAlbums()));
      ocrManager.clear();
      handlePromiseError(ocrManager.getAssetOcr(currentAssetId));
    }
  });

  // Check if video has transcription when asset changes
  $effect(() => {
    if (asset.type === AssetTypeEnum.Video && currentAssetId) {
      handlePromiseError(checkVideoTranscription(currentAssetId));
    } else {
      hasTranscription = false;
      transcriptionSearchManager.clear();
    }
  });

  // Transcription functions
  async function checkVideoTranscription(assetId: string) {
    hasTranscription = await transcriptionSearchManager.checkTranscriptionAvailable(assetId);

    // Auto-load transcription search if coming from Content search with a search term
    if (hasTranscription && documentSearchTerm) {
      transcriptionSearchInput = documentSearchTerm;
      handlePromiseError(transcriptionSearchManager.loadMatches(assetId, documentSearchTerm));
    }
  }

  function handleTranscriptionSeek(time: number) {
    videoViewerRef?.seekTo(time);
  }

  function handleTranscriptionSearchNavigate(match: AnyContentMatch) {
    if (isTranscriptionMatch(match)) {
      // Prefer word-level timing for precise karaoke seeking
      const seekTime = match.wordStartTime ?? match.startTime;
      videoViewerRef?.seekTo(seekTime);
    }
  }

  function handleVideoTimeUpdate(time: number) {
    currentVideoTime = time;
  }

  function handleTranscriptionSearch() {
    if (transcriptionSearchInput.trim() && hasTranscription) {
      handlePromiseError(transcriptionSearchManager.loadMatches(asset.id, transcriptionSearchInput.trim()));
    }
  }

  function handleTranscriptionSearchKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter') {
      handleTranscriptionSearch();
    } else if (event.key === 'Escape') {
      showTranscriptionSearch = false;
      transcriptionSearchManager.clear();
    }
  }

  function toggleTranscriptionSearch() {
    showTranscriptionSearch = !showTranscriptionSearch;
    if (!showTranscriptionSearch) {
      transcriptionSearchManager.clear();
      transcriptionSearchInput = '';
    }
  }
</script>

<OnEvents onAssetReplace={handleAssetReplace} />

<svelte:document bind:fullscreenElement />

<!-- Transcription search navigation overlay -->
{#if transcriptionSearchManager.searchTerm}
  <ContentSearchNav
    searchState={transcriptionSearchManager}
    onNavigate={handleTranscriptionSearchNavigate}
    onClose={() => {
      showTranscriptionSearch = false;
      transcriptionSearchManager.clear();
      transcriptionSearchInput = '';
    }}
  />
{/if}

<section
  id="immich-asset-viewer"
  class="fixed start-0 top-0 grid size-full grid-cols-4 grid-rows-[64px_1fr] overflow-hidden bg-black"
  use:focusTrap
  bind:this={assetViewerHtmlElement}
>
  <!-- Top navigation bar -->
  {#if $slideshowState === SlideshowState.None && !isShowEditor}
    <div class="col-span-4 col-start-1 row-span-1 row-start-1 transition-transform">
      <AssetViewerNavBar
        {asset}
        {album}
        {person}
        {stack}
        {showCloseButton}
        showDetailButton={enableDetailPanel}
        showSlideshow={true}
        onZoomImage={zoomToggle}
        onCopyImage={copyImage}
        preAction={handlePreAction}
        onAction={handleAction}
        onRunJob={handleRunJob}
        onPlaySlideshow={() => ($slideshowState = SlideshowState.PlaySlideshow)}
        onShowDetail={toggleDetailPanel}
        onClose={closeViewer}
        {playOriginalVideo}
        {setPlayOriginalVideo}
      >
        {#snippet motionPhoto()}
          <MotionPhotoAction
            isPlaying={shouldPlayMotionPhoto}
            onClick={(shouldPlay) => (shouldPlayMotionPhoto = shouldPlay)}
          />
        {/snippet}
      </AssetViewerNavBar>
    </div>
  {/if}

  {#if $slideshowState != SlideshowState.None}
    <div class="absolute w-full flex">
      <SlideshowBar
        {isFullScreen}
        onSetToFullScreen={() => assetViewerHtmlElement?.requestFullscreen?.()}
        onPrevious={() => navigateAsset('previous')}
        onNext={() => navigateAsset('next')}
        onClose={() => ($slideshowState = SlideshowState.StopSlideshow)}
      />
    </div>
  {/if}

  {#if $slideshowState === SlideshowState.None && showNavigation && !isShowEditor}
    <div class="my-auto column-span-1 col-start-1 row-span-full row-start-1 justify-self-start">
      <PreviousAssetAction onPreviousAsset={() => navigateAsset('previous')} />
    </div>
  {/if}

  <!-- Asset Viewer -->
  <div class="z-[-1] relative col-start-1 col-span-4 row-start-1 row-span-full">
    {#if previewStackedAsset}
      {#key previewStackedAsset.id}
        {#if previewStackedAsset.type === AssetTypeEnum.Image}
          <PhotoViewer
            bind:zoomToggle
            bind:copyImage
            asset={previewStackedAsset}
            {preloadAssets}
            onPreviousAsset={() => navigateAsset('previous')}
            onNextAsset={() => navigateAsset('next')}
            haveFadeTransition={false}
            {sharedLink}
          />
        {:else}
          <VideoViewer
            assetId={previewStackedAsset.id}
            cacheKey={previewStackedAsset.thumbhash}
            projectionType={previewStackedAsset.exifInfo?.projectionType}
            loopVideo={true}
            onPreviousAsset={() => navigateAsset('previous')}
            onNextAsset={() => navigateAsset('next')}
            onClose={closeViewer}
            onVideoEnded={() => navigateAsset()}
            onVideoStarted={handleVideoStarted}
            {playOriginalVideo}
          />
        {/if}
      {/key}
    {:else}
      {#key asset.id}
        {#if asset.type === AssetTypeEnum.Image}
          {#if shouldPlayMotionPhoto && asset.livePhotoVideoId}
            <VideoViewer
              assetId={asset.livePhotoVideoId}
              cacheKey={asset.thumbhash}
              projectionType={asset.exifInfo?.projectionType}
              loopVideo={$slideshowState !== SlideshowState.PlaySlideshow}
              onPreviousAsset={() => navigateAsset('previous')}
              onNextAsset={() => navigateAsset('next')}
              onVideoEnded={() => (shouldPlayMotionPhoto = false)}
              {playOriginalVideo}
            />
          {:else if asset.exifInfo?.projectionType === ProjectionType.EQUIRECTANGULAR || (asset.originalPath && asset.originalPath
                .toLowerCase()
                .endsWith('.insp'))}
            <ImagePanoramaViewer {asset} />
          {:else if isShowEditor && selectedEditType === 'crop'}
            <CropArea {asset} />
          {:else}
            <PhotoViewer
              bind:zoomToggle
              bind:copyImage
              {asset}
              {preloadAssets}
              onPreviousAsset={() => navigateAsset('previous')}
              onNextAsset={() => navigateAsset('next')}
              {sharedLink}
              haveFadeTransition={$slideshowState !== SlideshowState.None && $slideshowTransition}
            />
          {/if}
        {:else if isDocumentAsset}
          <DocumentViewer
            {asset}
            searchTerm={documentSearchTerm}
            onPreviousAsset={() => navigateAsset('previous')}
            onNextAsset={() => navigateAsset('next')}
          />
        {:else}
          <VideoViewer
            bind:this={videoViewerRef}
            assetId={asset.id}
            cacheKey={asset.thumbhash}
            projectionType={asset.exifInfo?.projectionType}
            loopVideo={$slideshowState !== SlideshowState.PlaySlideshow}
            onPreviousAsset={() => navigateAsset('previous')}
            onNextAsset={() => navigateAsset('next')}
            onClose={closeViewer}
            onVideoEnded={() => navigateAsset()}
            onVideoStarted={handleVideoStarted}
            onTimeUpdate={handleVideoTimeUpdate}
            {playOriginalVideo}
            {hasTranscription}
            showSubtitles={true}
          />
        {/if}

        {#if $slideshowState === SlideshowState.None && isShared && ((album && album.isActivityEnabled) || activityManager.commentCount > 0) && !activityManager.isLoading}
          <div class="absolute bottom-0 end-0 mb-20 me-8">
            <ActivityStatus
              disabled={!album?.isActivityEnabled}
              isLiked={activityManager.isLiked}
              numberOfComments={activityManager.commentCount}
              numberOfLikes={activityManager.likeCount}
              onFavorite={handleFavorite}
              onOpenActivityTab={handleOpenActivity}
            />
          </div>
        {/if}

        {#if $slideshowState === SlideshowState.None && asset.type === AssetTypeEnum.Image && !isShowEditor && ocrManager.hasOcrData}
          <div class="absolute bottom-0 end-0 mb-6 me-6">
            <OcrButton />
          </div>
        {/if}

        <!-- Transcription buttons for videos -->
        {#if $slideshowState === SlideshowState.None && asset.type === AssetTypeEnum.Video && hasTranscription && !isShowEditor}
          <div class="absolute bottom-0 end-0 mb-6 me-6 flex flex-col gap-2 items-end">
            {#if showTranscriptionSearch}
              <div class="flex items-center gap-2 bg-gray-800/90 rounded-lg px-3 py-2">
                <input
                  type="text"
                  bind:value={transcriptionSearchInput}
                  onkeydown={handleTranscriptionSearchKeydown}
                  placeholder="Search transcript..."
                  class="bg-transparent text-white text-sm outline-none w-48 placeholder-gray-400"
                />
                <button
                  type="button"
                  onclick={handleTranscriptionSearch}
                  class="text-white hover:text-blue-400 transition-colors"
                  title="Search"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                    <path fill-rule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clip-rule="evenodd" />
                  </svg>
                </button>
              </div>
            {/if}
            <!-- Search transcription button -->
            <button
              type="button"
              onclick={toggleTranscriptionSearch}
              class="p-2 bg-gray-800/80 hover:bg-gray-700 rounded-full transition-colors text-white"
              title={showTranscriptionSearch ? 'Close search' : 'Search transcription (Ctrl+F)'}
            >
              <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" viewBox="0 0 24 24" fill="currentColor">
                <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H6l-2 2V4h16v12z"/>
                <path d="M7 9h2v2H7zm4 0h2v2h-2zm4 0h2v2h-2z"/>
              </svg>
            </button>
          </div>
        {/if}
      {/key}
    {/if}
  </div>

  {#if $slideshowState === SlideshowState.None && showNavigation && !isShowEditor}
    <div class="my-auto col-span-1 col-start-4 row-span-full row-start-1 justify-self-end">
      <NextAssetAction onNextAsset={() => navigateAsset('next')} />
    </div>
  {/if}

  {#if enableDetailPanel && $slideshowState === SlideshowState.None && $isShowDetail && !isShowEditor}
    <div
      transition:fly={{ duration: 150 }}
      id="detail-panel"
      class="row-start-1 row-span-4 w-[360px] overflow-y-auto transition-all dark:border-l dark:border-s-everyday-blue bg-light"
      translate="yes"
    >
      <DetailPanel
        {asset}
        currentAlbum={album}
        albums={appearsInAlbums}
        onClose={() => ($isShowDetail = false)}
        currentVideoTime={currentVideoTime}
        onTranscriptionSeek={handleTranscriptionSeek}
        {hasTranscription}
      />
    </div>
  {/if}

  {#if isShowEditor}
    <div
      transition:fly={{ duration: 150 }}
      id="editor-panel"
      class="row-start-1 row-span-4 w-[400px] overflow-y-auto transition-all dark:border-l dark:border-s-everyday-blue"
      translate="yes"
    >
      <EditorPanel {asset} onUpdateSelectedType={handleUpdateSelectedEditType} onClose={closeEditor} />
    </div>
  {/if}

  {#if stack && withStacked}
    {@const stackedAssets = stack.assets}
    <div id="stack-slideshow" class="absolute bottom-0 w-full col-span-4 col-start-1">
      <div class="relative flex flex-row no-wrap overflow-x-auto overflow-y-hidden horizontal-scrollbar">
        {#each stackedAssets as stackedAsset (stackedAsset.id)}
          <div
            class={['inline-block px-1 relative transition-all pb-2']}
            style:bottom={stackedAsset.id === asset.id ? '0' : '-10px'}
          >
            <Thumbnail
              imageClass={{ 'border-2 border-white': stackedAsset.id === asset.id }}
              brokenAssetClass="text-xs"
              dimmed={stackedAsset.id !== asset.id}
              asset={toTimelineAsset(stackedAsset)}
              onClick={() => {
                asset = stackedAsset;
                previewStackedAsset = undefined;
              }}
              onMouseEvent={({ isMouseOver }) => handleStackedAssetMouseEvent(isMouseOver, stackedAsset)}
              readonly
              thumbnailSize={stackedAsset.id === asset.id ? stackSelectedThumbnailSize : stackThumbnailSize}
              showStackedIcon={false}
              disableLinkMouseOver
            />

            {#if stackedAsset.id === asset.id}
              <div class="w-full flex place-items-center place-content-center">
                <div class="w-2 h-2 bg-white rounded-full flex mt-0.5"></div>
              </div>
            {/if}
          </div>
        {/each}
      </div>
    </div>
  {/if}

  {#if isShared && album && isShowActivity && $user}
    <div
      transition:fly={{ duration: 150 }}
      id="activity-panel"
      class="row-start-1 row-span-5 w-[360px] md:w-[460px] overflow-y-auto transition-all dark:border-l dark:border-s-everyday-blue"
      translate="yes"
    >
      <ActivityViewer
        user={$user}
        disabled={!album.isActivityEnabled}
        assetType={asset.type}
        albumOwnerId={album.ownerId}
        albumId={album.id}
        assetId={asset.id}
        onClose={() => (isShowActivity = false)}
      />
    </div>
  {/if}
</section>

<style>
  #immich-asset-viewer {
    contain: layout;
  }

  .horizontal-scrollbar::-webkit-scrollbar {
    width: 8px;
    height: 10px;
  }

  /* Track */
  .horizontal-scrollbar::-webkit-scrollbar-track {
    background: #000000;
    border-radius: 16px;
  }

  /* Handle */
  .horizontal-scrollbar::-webkit-scrollbar-thumb {
    background: rgba(159, 159, 159, 0.408);
    border-radius: 16px;
  }

  /* Handle on hover */
  .horizontal-scrollbar::-webkit-scrollbar-thumb:hover {
    background: #adcbfa;
    border-radius: 16px;
  }
</style>
