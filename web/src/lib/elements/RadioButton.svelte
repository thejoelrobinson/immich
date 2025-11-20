<script lang="ts">
  interface Props {
    id: string;
    label: string;
    name: string;
    value: string;
    group?: string | undefined;
  }

  let { id, label, name, value, group = $bindable(undefined) }: Props = $props();
</script>

<div class="flex items-center gap-2">
  <input
    type="radio"
    {name}
    {id}
    {value}
    class="cursor-pointer appearance-none w-5 h-5 border-2 border-gray-300 rounded-full bg-white accent-walmart-blue checked:bg-walmart-blue checked:border-walmart-blue focus-visible:ring-2 focus-visible:ring-sky-blue focus-visible:ring-offset-1 focus-visible:outline-none dark:bg-bentonville-blue/20 dark:border-everyday-blue dark:checked:bg-sky-blue dark:checked:border-sky-blue transition-all duration-200"
    bind:group
  />
  <label for={id} class="font-medium text-bentonville-blue dark:text-white cursor-pointer">{label}</label>
</div>

<style>
  /* Custom radio button styling for better visual appearance */
  input[type="radio"] {
    -webkit-appearance: none;
    appearance: none;
  }

  input[type="radio"]:checked::after {
    content: '';
    display: block;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: white;
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
  }

  input[type="radio"]:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  input[type="radio"]:disabled + label {
    opacity: 0.5;
    cursor: not-allowed;
  }

  /* Dark mode improvements */
  :global(.dark) input[type="radio"]:checked::after {
    background: rgb(4 30 66);
  }
</style>
