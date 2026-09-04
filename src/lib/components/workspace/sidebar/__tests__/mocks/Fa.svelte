<script lang="ts">
  let props: any = $props();
</script>

<span class="fa-icon {props.class ?? ''}" data-icon={props.icon?.iconName ?? ''}></span>
