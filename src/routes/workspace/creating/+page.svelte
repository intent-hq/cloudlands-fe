<script lang="ts">
  import Fa from 'svelte-fa';
  import { faSpinner } from '@fortawesome/free-solid-svg-icons';
  import { faGithub } from '@fortawesome/free-brands-svg-icons';
</script>

<div class="flex items-center justify-center h-full">
  <div class="text-center space-y-6 max-w-md">
    <div class="flex justify-center">
      <div class="relative">
        <Fa icon={faGithub} size="2x" class="text-primary" />
        <Fa
          icon={faSpinner}
          size="lg"
          class="absolute -bottom-2 -right-2 text-primary animate-spin"
        />
      </div>
    </div>

    <div class="space-y-2">
      <h2 class="text-2xl font-semibold text-foreground">Creating Space</h2>
      <p class="text-muted-foreground">Setting up your space environment...</p>
    </div>

    <div class="space-y-2 text-sm text-muted-foreground">
      <div class="flex items-center justify-center gap-2">
        <div class="w-2 h-2 bg-primary rounded-full animate-pulse"></div>
        <span>Initializing repository</span>
      </div>
      <div class="flex items-center justify-center gap-2">
        <div
          class="w-2 h-2 bg-primary rounded-full animate-pulse"
          style="animation-delay: 0.2s"
        ></div>
        <span>Setting up environment</span>
      </div>
      <div class="flex items-center justify-center gap-2">
        <div
          class="w-2 h-2 bg-primary rounded-full animate-pulse"
          style="animation-delay: 0.4s"
        ></div>
        <span>Configuring space</span>
      </div>
    </div>
  </div>
</div>
