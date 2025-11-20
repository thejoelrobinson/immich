<script lang="ts">
  import sparkYellowUrl from '$lib/assets/logos/WMT-Spark-SparkYellow-RGB.svg';
  import sparkWhiteUrl from '$lib/assets/logos/WMT-Spark-White-RGB.svg';
  import wordmarkTrueBlueUrl from '$lib/assets/logos/WMT-Wordmark-Standard-TrueBlue-RGB.svg';
  import wordmarkWhiteUrl from '$lib/assets/logos/WMT-Wordmark-Standard-White-RGB.svg';
  import { mobileDevice } from '$lib/stores/mobile-device.svelte';
  import type { ClassValue } from 'svelte/elements';

  interface Props {
    variant?: 'icon' | 'inline';
    size?: 'tiny' | 'small' | 'sm' | 'lg' | 'giant';
    class?: ClassValue;
  }

  let { variant = 'icon', size = 'small', class: className = '' }: Props = $props();

  let isDarkMode = $derived(typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches);

  // Determine which logo to show based on variant and theme
  let logoSrc = $derived.by(() => {
    if (variant === 'inline') {
      return isDarkMode ? wordmarkWhiteUrl : wordmarkTrueBlueUrl;
    } else {
      // icon variant - use Spark logo
      return isDarkMode ? sparkWhiteUrl : sparkYellowUrl;
    }
  });

  let altText = $derived(variant === 'inline' ? 'Walmart Wordmark' : 'Walmart Spark');
  let sizeClass = $derived.by(() => {
    switch (size) {
      case 'tiny':
        return 'h-6';
      case 'small':
      case 'sm':
        return 'h-8';
      case 'lg':
        return 'h-12';
      case 'giant':
        return 'h-32';
      default:
        return 'h-8';
    }
  });
</script>

<img src={logoSrc} alt={altText} class="{sizeClass} {className}" draggable="false" />
