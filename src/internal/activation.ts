import type { createRadioState } from './state.js';
import { isAvailable, resolveInput, type RadioContext } from './context.js';

interface Activation {
  timer: number;
  click: MouseEvent | null;
}

/** Accepts primary mouse releases and Space releases, which can activate a radio. */
function isSupportedRelease({ window }: RadioContext, event: Event): boolean {
  if (event.defaultPrevented) return false;
  if (event instanceof window.KeyboardEvent) return event.code === 'Space';
  if (event instanceof window.MouseEvent) return event.button === 0;
  return true;
}

/** Clears selection for Space in browsers that omit click on an already selected radio. */
function clearWithoutClick({ window }: RadioContext, input: HTMLInputElement, event: Event): boolean {
  if (!(event instanceof window.KeyboardEvent) || !input.checked) return false;
  input.checked = false;
  return true;
}

/** Decides whether completed activation needs notifications, including rollback after a canceled click. */
function finishSelection(context: RadioContext, input: HTMLInputElement, event: Event, activation: Activation): boolean {
  if (activation.click?.defaultPrevented) {
    // Firefox does not restore a previously selected radio after a listener clears it.
    input.checked = true;
    return false;
  }
  if (activation.click) return !input.checked;
  // A mouse release without click must not clear the radio.
  return clearWithoutClick(context, input, event);
}

/** Notifies page listeners because assigning checked does not emit input or change events. */
function notifyChange({ window }: RadioContext, input: HTMLInputElement): void {
  input.dispatchEvent(new window.Event('input', { bubbles: true, composed: true }));
  input.dispatchEvent(new window.Event('change', { bubbles: true }));
}

/** Tracks activation until click propagation finishes and owns the timers that notify page listeners. */
export function createActivation(
  context: RadioContext,
  describe: (input: HTMLInputElement) => void,
  state: ReturnType<typeof createRadioState>,
) {
  const { window } = context;
  const timers = new Set<number>();
  const pending = new Map<HTMLInputElement, Activation>();
  let active = true;

  /** Completes activation only while the radio still belongs to an active setup. */
  function finish(input: HTMLInputElement, event: Event, activation: Activation): void {
    if (pending.get(input) === activation) pending.delete(input);
    if (!active || !isAvailable(context, input)) return;
    if (event.defaultPrevented && event !== activation.click) return;
    const changed = finishSelection(context, input, event, activation);
    state.refresh();
    if (changed) notifyChange(context, input);
  }

  /** Records selected radios before click activation changes their state. */
  function onRelease(event: Event): void {
    if (!isSupportedRelease(context, event)) return;
    const input = resolveInput(context, event.target);
    if (!input) return;
    describe(input);
    state.refresh();
    if (!input.checked || pending.has(input)) return;
    schedule(input, event);
  }

  /** Queues completion so cancellation and browser activation finish before notifications reach the page. */
  function schedule(input: HTMLInputElement, event: Event): Activation {
    const activation: Activation = { timer: 0, click: null };
    activation.timer = window.setTimeout(() => {
      // Each click owns a timer, including clicks that arrive within the same task.
      timers.delete(activation.timer);
      finish(input, event, activation);
    }, 0);
    timers.add(activation.timer);
    pending.set(input, activation);
    return activation;
  }

  /**
   * Clears a previously selected radio before target and bubbling click listeners read its state.
   * Label clicks reach this handler again as clicks on their associated input.
   */
  function onClick(event: Event): void {
    if (!(event instanceof window.MouseEvent) || event.button !== 0) return;
    const input = resolveInput(context, event.target);
    // The original label event must reach the browser so it can forward a click to the input.
    if (!input || event.target !== input) return;
    describe(input);
    let activation = pending.get(input);
    if (!activation && state.wasChecked(input)) activation = schedule(input, event);
    if (!activation) {
      // Native activation already selected this radio before click capture starts.
      state.refresh();
      scheduleRefresh();
      return;
    }
    pending.delete(input);
    activation.click = event;
    if (!event.defaultPrevented) input.checked = false;
    state.refresh();
  }

  /** Captures browser rollback after a canceled first selection, which emits no input or change. */
  function scheduleRefresh(): void {
    const timer = window.setTimeout(() => {
      // The browser completes canceled activation before this snapshot.
      timers.delete(timer);
      if (active) state.refresh();
    }, 0);
    timers.add(timer);
  }

  /** Stops pending deselection and notifications. Repeated cleanup calls have no effect. */
  function cleanup(): void {
    active = false;
    timers.forEach(/* Cancels each pending activation and state snapshot. */ window.clearTimeout);
    timers.clear();
    pending.clear();
  }

  return { onRelease, onClick, cleanup };
}
