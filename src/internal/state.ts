import type { RadioContext } from './context.js';

/** Remembers selected states before browser click activation changes the input properties. */
export function createRadioState({ root, window }: RadioContext) {
  const tree = root.getRootNode() as Document | ShadowRoot | HTMLElement;
  const checked = new WeakMap<HTMLInputElement, boolean>();
  const timers = new Set<number>();
  let active = true;

  /** Copies actual radio states, including group members outside a scoped setup root. */
  function refresh(): void {
    if (!active) return;
    tree.querySelectorAll<HTMLInputElement>('input[type="radio"]').forEach(input => {
      // Native group selection can uncheck a radio without emitting an event on that radio.
      checked.set(input, input.checked);
    });
    if (tree instanceof window.HTMLInputElement) checked.set(tree, tree.checked);
  }

  /** Reads the prior state, with markup as the fallback for a radio added and clicked in one task. */
  function wasChecked(input: HTMLInputElement): boolean {
    return checked.get(input) ?? input.defaultChecked;
  }

  /** Refreshes after a form reset completes, unless a page listener cancels the reset. */
  function onReset(event: Event): void {
    const timer = window.setTimeout(() => {
      // The reset event fires before the browser restores default selections.
      timers.delete(timer);
      if (!event.defaultPrevented) refresh();
    }, 0);
    timers.add(timer);
  }

  refresh();
  tree.addEventListener('input', refresh, true);
  tree.addEventListener('change', refresh, true);
  tree.addEventListener('reset', onReset, true);
  // New markup can change radio groups without emitting input or change.
  const observer = new window.MutationObserver(refresh);
  observer.observe(tree, { subtree: true, childList: true, attributes: true,
    attributeFilter: ['checked', 'name', 'form', 'type', 'data-uncheckable', 'uncheckable'] });

  /** Stops observation and pending resets without retaining removed radios. */
  function cleanup(): void {
    active = false;
    observer.disconnect();
    tree.removeEventListener('input', refresh, true);
    tree.removeEventListener('change', refresh, true);
    tree.removeEventListener('reset', onReset, true);
    timers.forEach(/* Prevents a deferred reset from refreshing a stopped setup. */ timer => window.clearTimeout(timer));
    timers.clear();
  }

  return { refresh, wasChecked, cleanup };
}
