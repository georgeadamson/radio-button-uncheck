import { createRadioState } from './internal/state.js';
import { createActivation } from './internal/activation.js';
import { createContext, resolveInput, type RadioContext, type RadioRoot } from './internal/context.js';
import { createDescriptions } from './internal/descriptions.js';

/** A callable cleanup function with an explicit refresh for changes that emit no DOM events. */
export interface UncheckableRadioHandle {
  (): void;
  /** Copies actual selected states after direct checked assignments or immediate markup changes. */
  refresh(): void;
}

/** Connects root listeners so radios added later receive the same behavior as existing radios. */
function listen(
  context: RadioContext,
  describe: (input: HTMLInputElement) => void,
  activation: ReturnType<typeof createActivation>,
): () => void {
  const { root } = context;

  /** Gives newly focused radios their instructions before the user activates them. */
  function onFocus(event: Event): void {
    const input = resolveInput(context, event.target);
    if (input) describe(input);
  }

  root.addEventListener('focusin', onFocus);
  root.addEventListener('keyup', activation.onRelease, true);
  root.addEventListener('mouseup', activation.onRelease, true);
  root.addEventListener('click', activation.onClick, true);

  // Removes exactly the listeners installed by this setup.
  return () => {
    root.removeEventListener('focusin', onFocus);
    root.removeEventListener('keyup', activation.onRelease, true);
    root.removeEventListener('mouseup', activation.onRelease, true);
    root.removeEventListener('click', activation.onClick, true);
  };
}

/**
 * Lets users clear a selected radio with another primary click or Space press.
 * Native radios normally stay selected until another radio in the group replaces them.
 * Only radios with data-uncheckable or uncheckable receive this extra behavior.
 *
 * The root limits which radios this call manages. Listeners on the root also cover
 * radios that the page adds later. Each root needs one call with no overlap.
 *
 * A capture listener clears the radio before target and bubbling click handlers run.
 * The returned cleanup function stops listeners and pending notifications.
 * Its refresh method copies selected states after programmatic changes that emit no events.
 * Importing this module alone does not access the DOM or install listeners.
 */
export function enableUncheckableRadio(root: RadioRoot = document): UncheckableRadioHandle {
  const context = createContext(root);
  const descriptions = createDescriptions(context);
  const state = createRadioState(context);
  const activation = createActivation(context, descriptions.describe, state);
  descriptions.initialize();
  const stopListening = listen(context, descriptions.describe, activation);

  // Stops listeners, pending activation, and library descriptions. Each cleanup step can safely repeat.
  const cleanup = () => {
    stopListening();
    activation.cleanup();
    state.cleanup();
    descriptions.cleanup();
  };

  // Refresh changes from direct checked assignments before the next click-only activation.
  return Object.assign(cleanup, { refresh: state.refresh });
}

export default enableUncheckableRadio;
