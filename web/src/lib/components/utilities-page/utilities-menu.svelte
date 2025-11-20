<script lang="ts">
  import { AppRoute } from '$lib/constants';
  import AppDownloadModal from '$lib/modals/AppDownloadModal.svelte';
  import ObtainiumConfigModal from '$lib/modals/ObtainiumConfigModal.svelte';
  import { Icon, modalManager } from '@immich/ui';
  import {
    mdiCellphoneArrowDownVariant,
    mdiContentDuplicate,
    mdiCrosshairsGps,
    mdiImageSizeSelectLarge,
    mdiLinkEdit,
  } from '@mdi/js';
  import { t } from 'svelte-i18n';

  const links = [
    { href: AppRoute.DUPLICATES, icon: mdiContentDuplicate, label: $t('review_duplicates') },
    { href: AppRoute.LARGE_FILES, icon: mdiImageSizeSelectLarge, label: $t('review_large_files') },
    { href: AppRoute.GEOLOCATION, icon: mdiCrosshairsGps, label: $t('manage_geolocation') },
  ];
</script>

<div class="border border-gray-300 dark:border-bentonville-blue rounded-3xl pt-1 pb-6 dark:text-white">
  <p class="uppercase text-xs font-medium p-4">{$t('organize_your_library')}</p>

  {#each links as link (link.href)}
    <a href={link.href} class="w-full hover:bg-gray-100 dark:hover:bg-bentonville-blue flex items-center gap-4 p-4">
      <span><Icon icon={link.icon} class="text-walmart-blue" size="24" /> </span>
      {link.label}
    </a>
  {/each}
</div>
<br />
<div class="border border-gray-300 dark:border-bentonville-blue rounded-3xl pt-1 pb-6 dark:text-white">
  <p class="uppercase text-xs font-medium p-4">{$t('download')}</p>
  <button
    type="button"
    onclick={() => modalManager.show(ObtainiumConfigModal, {})}
    class="w-full hover:bg-gray-100 dark:hover:bg-bentonville-blue flex items-center gap-4 p-4"
  >
    <span>
      <Icon icon={mdiLinkEdit} class="text-walmart-blue dark:text-sky-blue" size="24" />
    </span>
    {$t('obtainium_configurator')}
  </button>
  <button
    type="button"
    onclick={() => modalManager.show(AppDownloadModal, {})}
    class="w-full hover:bg-gray-100 dark:hover:bg-bentonville-blue flex items-center gap-4 p-4"
  >
    <span>
      <Icon icon={mdiCellphoneArrowDownVariant} class="text-walmart-blue dark:text-sky-blue" size="24" />
    </span>
    {$t('app_download_links')}
  </button>
</div>
