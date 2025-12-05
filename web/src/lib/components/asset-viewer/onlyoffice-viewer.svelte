<script lang="ts">
  import { onlyOfficeManager } from '$lib/managers/onlyoffice-manager.svelte';
  import { documentSearchManager } from '$lib/stores/document-search.svelte';
  import type { AssetResponseDto } from '@immich/sdk';
  import { LoadingSpinner } from '@immich/ui';
  import { onMount, onDestroy, untrack } from 'svelte';

  // ONLYOFFICE DocsAPI type with connector support
  type Connector = {
    callCommand: (callback: () => unknown, resultCallback?: (result: unknown) => void) => void;
    executeMethod: (method: string, args?: unknown[], resultCallback?: (result: unknown) => void) => void;
  };

  type DocEditorInstance = {
    destroyEditor: () => void;
    createConnector: () => Connector;
  };

  type DocsAPI = {
    DocEditor: new (containerId: string, config: Record<string, unknown>) => DocEditorInstance;
  };

  interface Props {
    asset: AssetResponseDto;
    searchTerm?: string;
    onError?: () => void;
    onPreviousAsset?: (() => void) | null;
    onNextAsset?: (() => void) | null;
  }

  let { asset, searchTerm = '', onError, onPreviousAsset = null, onNextAsset = null }: Props = $props();

  let loading = $state(true);
  let error = $state<string | null>(null);
  let editorInstance: DocEditorInstance | null = null;
  let connector: Connector | null = null;
  let containerId = $state(`onlyoffice-container-${asset.id}`);
  let searchPerformed = $state(false);
  let localMatchCount = $state(0);
  let localCurrentIndex = $state(0);

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
            // Initialize connector and perform search if search term provided
            if (editorInstance && searchTerm) {
              initConnectorAndSearch();
            }
          },
          onDocumentReady: () => {
            // Document is fully loaded, connector can be used now
            if (editorInstance && searchTerm && !connector) {
              initConnectorAndSearch();
            }
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
      connector = null;
    }
  };

  // Initialize connector and perform search with highlighting
  const initConnectorAndSearch = () => {
    if (!editorInstance) return;

    try {
      connector = editorInstance.createConnector();
      if (searchTerm) {
        performSearch(searchTerm);
      }
    } catch (err) {
      console.error('Failed to create ONLYOFFICE connector:', err);
    }
  };

  // Perform search and highlight matches using Document Builder API
  const performSearch = (term: string) => {
    if (!connector) return;

    // Get the file extension to determine document type
    const filename = (asset.originalPath || asset.originalFileName || '').toLowerCase();
    const isSpreadsheet = filename.endsWith('.xlsx') || filename.endsWith('.xls') || filename.endsWith('.ods');

    if (isSpreadsheet) {
      // For spreadsheets, use different API
      performSpreadsheetSearch(term);
    } else {
      // For Word/PowerPoint documents
      performDocumentSearch(term);
    }
  };

  // Search and highlight in Word/PowerPoint documents
  const performDocumentSearch = (term: string) => {
    if (!connector) {
      console.warn('[ONLYOFFICE] No connector available for search');
      return;
    }

    console.log('[ONLYOFFICE] Starting document search for:', term);

    // Set search term immediately so nav bar shows
    documentSearchManager.setSearchTerm(term);

    // Try using executeMethod to trigger ONLYOFFICE's built-in search
    // This uses the editor's native search functionality
    try {
      connector.executeMethod('StartTextSearch', [term, false], (result: unknown) => {
        console.log('[ONLYOFFICE] StartTextSearch result:', result);
      });
    } catch (e) {
      console.warn('[ONLYOFFICE] executeMethod StartTextSearch failed:', e);
    }

    // Also try the Document Builder API as a fallback
    const searchScript = `
      (function() {
        var searchTerm = "${term.replace(/"/g, '\\"')}";
        try {
          var doc = Api.GetDocument();
          if (!doc) {
            return { error: "No document", matchCount: 0 };
          }
          if (!doc.Search) {
            return { error: "Search method not available", matchCount: 0 };
          }

          var ranges = doc.Search(searchTerm, false);
          var matchCount = ranges ? ranges.length : 0;

          if (ranges && ranges.length > 0) {
            for (var i = 0; i < ranges.length; i++) {
              try {
                ranges[i].SetHighlight("yellow");
              } catch(e) {}
            }
            try {
              ranges[0].Select();
            } catch(e) {}
          }

          return { matchCount: matchCount };
        } catch(e) {
          return { error: e.toString(), matchCount: 0 };
        }
      })()
    `;

    connector.callCommand(
      // eslint-disable-next-line @typescript-eslint/no-implied-eval
      new Function('Api', searchScript) as () => unknown,
      (result: unknown) => {
        console.log('[ONLYOFFICE] callCommand search result:', result);
        const data = result as { matchCount?: number; error?: string } | null;
        if (data?.error) {
          console.warn('[ONLYOFFICE] Document Builder search error:', data.error);
        }
        localMatchCount = data?.matchCount ?? 0;
        localCurrentIndex = 0;
        searchPerformed = true;

        const matches = Array.from({ length: localMatchCount }, (_, i) => ({
          pageNumber: 1,
          textSnippet: term,
          matchStart: i,
          matchEnd: i + term.length,
        }));
        documentSearchManager.setMatches(matches);
      },
    );
  };

  // Search and highlight in spreadsheets
  const performSpreadsheetSearch = (term: string) => {
    if (!connector) return;

    const searchScript = `
      (function() {
        var searchTerm = "${term.replace(/"/g, '\\"')}";
        var sheet = Api.GetActiveSheet();
        if (!sheet) {
          return { error: "No active sheet" };
        }

        var usedRange = sheet.GetUsedRange();
        if (!usedRange) {
          return { error: "No used range" };
        }

        var matchCount = 0;
        var firstMatch = null;

        // Find all cells containing the search term
        try {
          var cell = usedRange.Find(searchTerm, null, false, false);
          if (cell) {
            firstMatch = cell;
            matchCount = 1;
            // Highlight and count all matches
            cell.SetFillColor(Api.CreateColorFromRGB(255, 255, 0)); // Yellow

            var nextCell = usedRange.Find(searchTerm, cell, false, false);
            while (nextCell && nextCell.GetAddress() !== firstMatch.GetAddress()) {
              nextCell.SetFillColor(Api.CreateColorFromRGB(255, 255, 0));
              matchCount++;
              nextCell = usedRange.Find(searchTerm, nextCell, false, false);
            }

            // Select first match
            firstMatch.Select();
          }
        } catch(e) {
          return { error: e.toString() };
        }

        return { matchCount: matchCount };
      })()
    `;

    // Set search term immediately so nav bar shows "Searching..."
    documentSearchManager.setSearchTerm(term);

    connector.callCommand(
      // eslint-disable-next-line @typescript-eslint/no-implied-eval
      new Function('Api', searchScript) as () => unknown,
      (result: unknown) => {
        const data = result as { matchCount?: number; error?: string } | null;
        if (data?.error) {
          console.warn('ONLYOFFICE spreadsheet search error:', data.error);
        }
        localMatchCount = data?.matchCount ?? 0;
        localCurrentIndex = 0;
        searchPerformed = true;

        // Update the shared document search manager with matches
        const matches = Array.from({ length: localMatchCount }, (_, i) => ({
          pageNumber: 1,
          textSnippet: term,
          matchStart: i,
          matchEnd: i + term.length,
        }));
        documentSearchManager.setMatches(matches);
      },
    );
  };

  // Navigate to a specific match index
  const goToMatch = (index: number) => {
    if (!connector || localMatchCount === 0) return;

    localCurrentIndex = index;

    const filename = (asset.originalPath || asset.originalFileName || '').toLowerCase();
    const isSpreadsheet = filename.endsWith('.xlsx') || filename.endsWith('.xls') || filename.endsWith('.ods');

    if (isSpreadsheet) {
      // For spreadsheets, re-run Find to get to the nth match
      const navScript = `
        (function() {
          var searchTerm = "${searchTerm.replace(/"/g, '\\"')}";
          var targetIndex = ${index};
          var sheet = Api.GetActiveSheet();
          var usedRange = sheet.GetUsedRange();

          var cell = usedRange.Find(searchTerm, null, false, false);
          for (var i = 0; i < targetIndex && cell; i++) {
            cell = usedRange.Find(searchTerm, cell, false, false);
          }

          if (cell) {
            cell.Select();
          }
          return { success: !!cell };
        })()
      `;

      connector.callCommand(
        // eslint-disable-next-line @typescript-eslint/no-implied-eval
        new Function('Api', navScript) as () => unknown,
      );
    } else {
      // For Word/PowerPoint
      const navScript = `
        (function() {
          var searchTerm = "${searchTerm.replace(/"/g, '\\"')}";
          var targetIndex = ${index};
          var doc = Api.GetDocument();
          var ranges = doc.Search(searchTerm, false);

          if (ranges && ranges[targetIndex]) {
            ranges[targetIndex].Select();
          }
          return { success: !!ranges && !!ranges[targetIndex] };
        })()
      `;

      connector.callCommand(
        // eslint-disable-next-line @typescript-eslint/no-implied-eval
        new Function('Api', navScript) as () => unknown,
      );
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
    console.log('[ONLYOFFICE] Component mounted, searchTerm:', searchTerm);
    // Set search term immediately so nav bar shows while ONLYOFFICE loads
    if (searchTerm) {
      console.log('[ONLYOFFICE] Setting search term in manager:', searchTerm);
      documentSearchManager.setSearchTerm(searchTerm);
      console.log('[ONLYOFFICE] Manager searchTerm after set:', documentSearchManager.searchTerm);
    }
    initEditor();
  });

  onDestroy(() => {
    destroyEditor();
    // Clear search state when leaving
    if (searchTerm) {
      documentSearchManager.clear();
    }
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

  // Sync with document search manager for navigation
  $effect(() => {
    const managerIndex = documentSearchManager.currentMatchIndex;
    if (searchPerformed && connector && managerIndex !== localCurrentIndex) {
      untrack(() => goToMatch(managerIndex));
    }
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
