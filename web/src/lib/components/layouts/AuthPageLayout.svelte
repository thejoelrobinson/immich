<script lang="ts">
  import WalmartLogo from '$lib/components/shared-components/walmart-logo.svelte';
  import { Card, CardBody, CardHeader, Heading, VStack } from '@immich/ui';
  import type { Snippet } from 'svelte';
  interface Props {
    title?: string;
    children?: Snippet;
    withHeader?: boolean;
  }

  let { title, children, withHeader = true }: Props = $props();
</script>

<section class="min-w-dvw flex min-h-dvh items-center justify-center relative">
  <div class="absolute -z-10 w-full h-full flex place-items-center place-content-center">
    <WalmartLogo
      variant="inline"
      size="giant"
      class="max-w-(--breakpoint-md) mx-auto h-full mb-2 antialiased overflow-hidden"
    />
    <div
      class="w-full h-[99%] absolute start-0 top-0 backdrop-blur-[200px] bg-transparent dark:bg-bentonville-blue/20"
    ></div>
  </div>

  <Card color="secondary" class="w-full max-w-lg border m-2">
    {#if withHeader}
      <CardHeader class="mt-6">
        <VStack>
          ​<WalmartLogo variant="icon" size="giant" />
          <Heading size="large" class="font-semibold" color="primary" tag="h1">{title}</Heading>
        </VStack>
      </CardHeader>
    {/if}

    <CardBody class="p-8">
      {@render children?.()}
    </CardBody>
  </Card>
</section>
