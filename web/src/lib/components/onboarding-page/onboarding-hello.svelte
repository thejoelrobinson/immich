<script lang="ts">
  import { serverConfigManager } from '$lib/managers/server-config-manager.svelte';
  import { OnboardingRole } from '$lib/models/onboarding-role';
  import { user } from '$lib/stores/user.store';
  import WalmartLogo from '$lib/components/shared-components/walmart-logo.svelte';
  import { t } from 'svelte-i18n';

  let userRole = $derived(
    $user.isAdmin && !serverConfigManager.value.isOnboarded ? OnboardingRole.SERVER : OnboardingRole.USER,
  );
</script>

<div class="gap-4">
  <WalmartLogo variant="icon" size="giant" class="mb-2" />
  <p class="font-medium mb-6 text-6xl text-walmart-blue">
    {$t('onboarding_welcome_user', { values: { user: $user.name } })}
  </p>
  <p class="text-3xl pb-6 font-light">
    {userRole == OnboardingRole.SERVER
      ? $t('onboarding_server_welcome_description')
      : $t('onboarding_user_welcome_description')}
  </p>
</div>
