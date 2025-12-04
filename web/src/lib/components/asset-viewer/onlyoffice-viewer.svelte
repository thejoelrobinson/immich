<script lang="ts">
  import { onlyOfficeManager } from '$lib/managers/onlyoffice-manager.svelte';
  import type { AssetResponseDto } from '@immich/sdk';
  import { LoadingSpinner } from '@immich/ui';
  import { onMount, onDestroy } from 'svelte';

  // ONLYOFFICE DocsAPI type
  type DocsAPI = {
    DocEditor: new (
      containerId: string,
      config: Record<string, unknown>,
    ) => {
      destroyEditor: () => void;
    };
  };

  interface Props {
    asset: AssetResponseDto;
    onError?: () => void;
    onPreviousAsset?: (() => void) | null;
    onNextAsset?: (() => void) | null;
  }

  let { asset, onError, onPreviousAsset = null, onNextAsset = null }: Props = $props();

  let loading = $state(true);
  let error = $state<string | null>(null);
  let editorInstance: { destroyEditor: () => void } | null = null;
  let containerId = $state(`onlyoffice-container-${asset.id}`);

  const initEditor = async () => {
    loading = true;
    error = null;

    try {
      // Initialize manager if not already done
      await onlyOfficeManager.init();

      if (!onlyOfficeManager.isEnabled) {
        throw new Error('ONLYOFFICE is not enabled');
      }

      // Load the ONLYOFFICE script
      const scriptLoaded = await onlyOfficeManager.loadScript();
      if (!scriptLoaded) {
        throw new Error('Failed to load ONLYOFFICE script');
      }

      // Get document configuration from server
      const config = await onlyOfficeManager.getDocumentConfig(asset.id);
      if (!config) {
        throw new Error('Failed to get document configuration');
      }

      // Wait for DOM to be ready
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Check if DocsAPI is available
      const docsApi = (window as unknown as { DocsAPI?: DocsAPI }).DocsAPI;
      if (!docsApi) {
        throw new Error('ONLYOFFICE DocsAPI not available');
      }

      // Build ONLYOFFICE editor config
      const editorConfig = {
        document: {
          fileType: config.fileType,
          key: config.documentKey,
          title: config.title,
          url: config.documentUrl,
          permissions: {
            edit: false,
            download: true,
            print: true,
            copy: true,
          },
        },
        documentType: config.documentType,
        token: config.token,
        type: 'embedded', // embedded mode for iframe-like integration
        width: '100%',
        height: '100%',
        editorConfig: {
          mode: 'view',
          lang: 'en',
          customization: {
            chat: false,
            comments: false,
            help: false,
            plugins: false,
            toolbarNoTabs: true,
            compactHeader: true,
            hideRightMenu: true,
            uiTheme: 'theme-dark',
            logo: {
              image: '',
              imageDark: '',
              url: '',
            },
          },
        },
        events: {
          onAppReady: () => {
            loading = false;
          },
          onError: (event: { data: { errorCode: number; errorDescription: string } }) => {
            console.error('ONLYOFFICE error:', event.data);
            error = event.data.errorDescription || 'Document load failed';
            loading = false;
            onError?.();
          },
        },
      };

      // Destroy existing editor if any
      if (editorInstance) {
        try {
          editorInstance.destroyEditor();
        } catch {
          // Ignore destroy errors
        }
        editorInstance = null;
      }

      // Create new editor instance
      editorInstance = new docsApi.DocEditor(containerId, editorConfig);
    } catch (err) {
      console.error('ONLYOFFICE initialization error:', err);
      error = err instanceof Error ? err.message : 'Failed to initialize viewer';
      loading = false;
      onError?.();
    }
  };

  const destroyEditor = () => {
    if (editorInstance) {
      try {
        editorInstance.destroyEditor();
      } catch {
        // Ignore destroy errors
      }
      editorInstance = null;
    }
  };

  const handleKeydown = (event: KeyboardEvent) => {
    if (event.key === 'ArrowLeft' && onPreviousAsset) {
      onPreviousAsset();
    } else if (event.key === 'ArrowRight' && onNextAsset) {
      onNextAsset();
    }
  };

  onMount(() => {
    initEditor();
  });

  onDestroy(() => {
    destroyEditor();
  });

  // Re-initialize when asset changes
  $effect(() => {
    // Track asset.id to trigger re-initialization
    const _assetId = asset.id;
    containerId = `onlyoffice-container-${_assetId}`;

    // Destroy and reinit when asset changes (but not on first mount)
    return () => {
      destroyEditor();
    };
  });
</script>

<svelte:document onkeydown={handleKeydown} />

<div class="h-full w-full flex flex-col bg-gray-900">
  <!-- Spacer for navbar -->
  <div class="h-16 shrink-0"></div>

  <!-- Content area -->
  <div class="flex-1 relative min-h-0">
    {#if loading}
      <div class="absolute inset-0 flex items-center justify-center">
        <LoadingSpinner />
      </div>
    {/if}

    {#if error}
      <div class="absolute inset-0 flex items-center justify-center text-white">
        <div class="text-center p-4">
          <p class="text-red-400 mb-2">Failed to load document</p>
          <p class="text-sm text-gray-400">{error}</p>
        </div>
      </div>
    {:else}
      <div
        id={containerId}
        class="absolute inset-0 w-full h-full"
        class:opacity-0={loading}
        class:opacity-100={!loading}
      ></div>
    {/if}
  </div>
</div>

<style>
  /* Ensure ONLYOFFICE iframe fills container */
  :global(#onlyoffice-container iframe) {
    width: 100% !important;
    height: 100% !important;
    border: none !important;
  }
</style>
