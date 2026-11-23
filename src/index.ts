import { createRadioState } from './internal/state.js';
import { createActivation } from './internal/activation.js';
import { createContext, type RadioRoot } from './internal/context.js';

/** A callable cleanup function with an explicit refresh for changes that emit no DOM events. */
export interface DeselectableRadioHandle {
  (): void;
  /** Copies actual selected states after direct checked assignments or immediate markup changes. */
  refresh(): void;
}

/**
 * Lets users clear a selected radio with another primary click or Space press.
 * Native radios normally stay selected until another radio in the group replaces them.
 * Only radios with data-deselectable or deselectable receive this extra behavior.
 *
 * The root limits which radios this call manages. Listeners on the root also cover
 * radios that the page adds later. Each root needs one call with no overlap.
 *
 * A capture listener clears the radio before target and bubbling click handlers run.
 * The returned cleanup function stops listeners and pending notifications.
 * Its refresh method copies selected states after programmatic changes that emit no events.
 * Importing this module alone does not access the DOM or install listeners.
 */
export function enableDeselectableRadio(root: RadioRoot = document): DeselectableRadioHandle {
  const context = createContext(root);
  const state = createRadioState(context);
  const activation = createActivation(context, state);
  const listeners = [
    ['keyup', activation.onRelease],
    ['mouseup', activation.onRelease],
    ['click', activation.onClick],
  ] as const;
  for (const [type, handler] of listeners) root.addEventListener(type, handler, true);

  // Cleanup is safe to call more than once.
  const cleanup = () => {
    for (const [type, handler] of listeners) root.removeEventListener(type, handler, true);
    activation.cleanup();
    state.cleanup();
  };

  // Refresh changes from direct checked assignments before the next click-only activation.
  return Object.assign(cleanup, { refresh: state.refresh });
}

export default enableDeselectableRadio;
