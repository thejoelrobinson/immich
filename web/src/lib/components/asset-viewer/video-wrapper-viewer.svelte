<script lang="ts">
  import VideoNativeViewer from '$lib/components/asset-viewer/video-native-viewer.svelte';
  import VideoPanoramaViewer from '$lib/components/asset-viewer/video-panorama-viewer.svelte';
  import { ProjectionType } from '$lib/constants';

  interface Props {
    assetId: string;
    projectionType: string | null | undefined;
    cacheKey: string | null;
    loopVideo: boolean;
    playOriginalVideo: boolean;
    showSubtitles?: boolean;
    hasTranscription?: boolean;
    onClose?: () => void;
    onPreviousAsset?: () => void;
    onNextAsset?: () => void;
    onVideoEnded?: () => void;
    onVideoStarted?: () => void;
    onTimeUpdate?: (currentTime: number) => void;
  }

  let {
    assetId,
    projectionType,
    cacheKey,
    loopVideo,
    playOriginalVideo,
    showSubtitles = true,
    hasTranscription = false,
    onPreviousAsset,
    onClose,
    onNextAsset,
    onVideoEnded,
    onVideoStarted,
    onTimeUpdate,
  }: Props = $props();

  let videoViewer: VideoNativeViewer | undefined = $state();

  // Expose seek function for external control
  export function seekTo(time: number) {
    videoViewer?.seekTo(time);
  }

  export function getCurrentTime(): number {
    return videoViewer?.getCurrentTime() ?? 0;
  }
</script>

{#if projectionType === ProjectionType.EQUIRECTANGULAR}
  <VideoPanoramaViewer {assetId} />
{:else}
  <VideoNativeViewer
    bind:this={videoViewer}
    {loopVideo}
    {cacheKey}
    {assetId}
    {playOriginalVideo}
    {showSubtitles}
    {hasTranscription}
    {onPreviousAsset}
    {onNextAsset}
    {onVideoEnded}
    {onVideoStarted}
    {onTimeUpdate}
    {onClose}
  />
{/if}
