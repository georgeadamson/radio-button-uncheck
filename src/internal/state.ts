import type { RadioContext } from './context.js';

/** Saves the state before native click activation selects the radio. */
export function createRadioState({ root, window }: RadioContext) {
  const tree = root.getRootNode();
  const checked = new WeakMap<HTMLInputElement, boolean>();
  let active = true;

  function refresh(): void {
    if (!active) return;
    const inputs = root.querySelectorAll<HTMLInputElement>('input[type="radio"]:is([data-deselectable], [deselectable])');
    for (const input of inputs) checked.set(input, input.checked);
    if (root instanceof window.HTMLInputElement) checked.set(root, root.checked);
  }

  // An ordinary radio outside root can uncheck a managed radio in the same group.
  function onChange(event: Event): void {
    if (event.target instanceof window.HTMLInputElement && event.target.type === 'radio') refresh();
  }

  // Reset fires before the browser restores checked values. A canceled reset needs no special handling.
  function onReset(): void {
    window.setTimeout(refresh, 0);
  }

  refresh();
  tree.addEventListener('change', onChange, true);
  tree.addEventListener('reset', onReset, true);
  const observer = new window.MutationObserver(refresh);
  observer.observe(tree, { subtree: true, childList: true, attributes: true,
    attributeFilter: ['checked', 'name', 'form', 'type', 'data-deselectable', 'deselectable'] });

  function cleanup(): void {
    active = false;
    observer.disconnect();
    tree.removeEventListener('change', onChange, true);
    tree.removeEventListener('reset', onReset, true);
  }

  return { refresh, wasChecked: (input: HTMLInputElement) => checked.get(input) ?? input.defaultChecked, cleanup };
}
