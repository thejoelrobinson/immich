<script lang="ts">
  import empty1Url from '$lib/assets/empty-1.svg';

  interface Props {
    onClick?: undefined | (() => unknown);
    text: string;
    fullWidth?: boolean;
    src?: string;
    title?: string;
    class?: string;
  }

  let { onClick = undefined, text, fullWidth = false, src = empty1Url, title, class: className }: Props = $props();

  let width = $derived(fullWidth ? 'w-full' : 'w-1/2');

  const hoverClasses = onClick
    ? `border border-gray-200 dark:border-everyday-blue hover:bg-walmart-blue/5 dark:hover:bg-walmart-blue/10`
    : '';
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<svelte:element
  this={onClick ? 'button' : 'div'}
  onclick={onClick}
  class="{width} {className} flex flex-col place-content-center place-items-center rounded-3xl bg-gray-50 p-5 dark:bg-bentonville-blue/10 {hoverClasses}"
>
  <img {src} alt="" width="500" draggable="false" />

  {#if title}
    <h2 class="text-xl font-medium my-4">{title}</h2>
  {/if}
  <p class="text-gray-500 dark:text-gray-300 font-light text-center">{text}</p>
</svelte:element>
