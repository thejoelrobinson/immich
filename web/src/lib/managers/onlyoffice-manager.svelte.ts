/**
 * ONLYOFFICE Manager - handles ONLYOFFICE Document Server integration
 *
 * Manages:
 * - Configuration fetching from server
 * - ONLYOFFICE API script loading
 * - Document config generation for viewer
 */

export interface OnlyOfficeConfig {
  enabled: boolean;
  externalUrl: string;
}

export interface OnlyOfficeDocumentConfig {
  documentKey: string;
  documentUrl: string;
  documentType: 'word' | 'cell' | 'slide';
  fileType: string;
  title: string;
  token: string;
}

class OnlyOfficeManager {
  #config: OnlyOfficeConfig | null = $state(null);
  #scriptLoaded = $state(false);
  #scriptLoading = $state(false);
  #initialized = $state(false);

  /**
   * Initialize the manager by fetching ONLYOFFICE config from server
   */
  async init(): Promise<void> {
    if (this.#initialized) {
      return;
    }

    try {
      const response = await fetch('/api/onlyoffice/config', {
        credentials: 'include',
      });

      if (response.ok) {
        this.#config = await response.json();
      } else {
        console.warn('Failed to fetch ONLYOFFICE config:', response.status);
        this.#config = { enabled: false, externalUrl: '' };
      }
    } catch (error) {
      console.warn('ONLYOFFICE config fetch error:', error);
      this.#config = { enabled: false, externalUrl: '' };
    }

    this.#initialized = true;
  }

  /**
   * Check if ONLYOFFICE is enabled and configured
   */
  get isEnabled(): boolean {
    return this.#config?.enabled ?? false;
  }

  /**
   * Get the external URL for ONLYOFFICE Document Server
   */
  get externalUrl(): string {
    return this.#config?.externalUrl ?? '';
  }

  /**
   * Check if the API script has been loaded
   */
  get isScriptLoaded(): boolean {
    return this.#scriptLoaded;
  }

  /**
   * Check if a file extension is supported by ONLYOFFICE
   */
  isSupported(filename: string): boolean {
    const ext = filename.toLowerCase().split('.').pop() || '';
    const supportedExtensions = ['docx', 'doc', 'odt', 'rtf', 'xlsx', 'xls', 'ods', 'csv', 'pptx', 'ppt', 'odp', 'pdf'];
    return supportedExtensions.includes(ext);
  }

  /**
   * Load the ONLYOFFICE API script dynamically
   */
  async loadScript(): Promise<boolean> {
    if (this.#scriptLoaded) {
      return true;
    }

    if (this.#scriptLoading) {
      // Wait for existing load to complete
      return new Promise((resolve) => {
        const checkInterval = setInterval(() => {
          if (!this.#scriptLoading) {
            clearInterval(checkInterval);
            resolve(this.#scriptLoaded);
          }
        }, 100);
      });
    }

    if (!this.#config?.enabled || !this.#config?.externalUrl) {
      return false;
    }

    this.#scriptLoading = true;

    try {
      const scriptUrl = `${this.#config.externalUrl}/web-apps/apps/api/documents/api.js`;

      // Check if script already exists
      const existingScript = document.querySelector(`script[src="${scriptUrl}"]`);
      if (existingScript) {
        this.#scriptLoaded = true;
        this.#scriptLoading = false;
        return true;
      }

      await new Promise<void>((resolve, reject) => {
        const script = document.createElement('script');
        script.src = scriptUrl;
        script.async = true;
        script.onload = () => resolve();
        script.onerror = () => reject(new Error('Failed to load ONLYOFFICE API script'));
        document.head.appendChild(script);
      });

      this.#scriptLoaded = true;
      return true;
    } catch (error) {
      console.error('Failed to load ONLYOFFICE script:', error);
      return false;
    } finally {
      this.#scriptLoading = false;
    }
  }

  /**
   * Get document configuration for the ONLYOFFICE viewer
   */
  async getDocumentConfig(assetId: string): Promise<OnlyOfficeDocumentConfig | null> {
    try {
      const response = await fetch(`/api/onlyoffice/document/${assetId}`, {
        credentials: 'include',
      });

      if (!response.ok) {
        console.error('Failed to get ONLYOFFICE document config:', response.status);
        return null;
      }

      return await response.json();
    } catch (error) {
      console.error('ONLYOFFICE document config error:', error);
      return null;
    }
  }

  /**
   * Check if ONLYOFFICE server is available (health check)
   */
  async checkAvailable(): Promise<boolean> {
    try {
      const response = await fetch('/api/onlyoffice/available', {
        credentials: 'include',
      });

      if (response.ok) {
        const data = await response.json();
        return data.available === true;
      }
      return false;
    } catch {
      return false;
    }
  }
}

export const onlyOfficeManager = new OnlyOfficeManager();
