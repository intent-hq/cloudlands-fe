<script lang="ts">
  import '../../app.css';
</script>

<div data-testid="ambient-animation-probe"></div>

<style>
  div {
    width: 1rem;
    height: 1rem;
    animation: ambient-probe 10s linear infinite;
  }

  @keyframes ambient-probe {
    to {
      transform: rotate(1turn);
    }
  }
</style>
