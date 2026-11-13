<script lang="ts">
  /**
   * The hidden description a provider ⋯ menu row points `aria-describedby` at.
   * It sits outside the row so it never joins the row's accessible name.
   */
  interface Props {
    id: string;
    text: string;
  }

  let { id, text }: Props = $props();
</script>

<span {id} hidden>{text}</span>
