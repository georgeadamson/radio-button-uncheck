import { resolveInput, type RadioContext } from './context.js';

let descriptionId = 0;

/** Reads the element IDs that connect a radio to its accessible descriptions. */
function descriptionIds(input: HTMLInputElement): string[] {
  return (input.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean);
}

/** Creates hidden instructions in the same document or shadow tree as the radio. */
function createDescription({ doc, window }: RadioContext, input: HTMLInputElement, text: string): HTMLSpanElement {
  const el = doc.createElement('span');
  // Explicitly referenced hidden text contributes to accessible descriptions.
  el.hidden = true;
  el.textContent = text;
  const tree = input.getRootNode() as Document | ShadowRoot;
  do { el.id = `radio-uncheck-${++descriptionId}`; }
  while (tree.getElementById(el.id));
  (tree instanceof window.Document ? tree.body : tree).appendChild(el);
  return el;
}

/** Removes only the library description, including its ID, while preserving descriptions supplied by the page. */
function removeDescription(el: HTMLSpanElement, input: HTMLInputElement): void {
  const ids = descriptionIds(input).filter(/* Keeps IDs that belong to the page. */ id => id !== el.id);
  if (ids.length) input.setAttribute('aria-describedby', ids.join(' '));
  else input.removeAttribute('aria-describedby');
  el.remove();
}

/** Owns optional screen reader instructions and removes them when this setup stops. */
export function createDescriptions(context: RadioContext) {
  const descriptions = new Map<HTMLInputElement, HTMLSpanElement>();

  /**
   * Explains that a selected radio can be cleared, which differs from native radio behavior.
   * aria-describedby contains element IDs, so the text needs a separate hidden element.
   */
  function describe(input: HTMLInputElement): void {
    if (descriptions.has(input)) return;
    const text = input.closest('[data-describe-deselectable-radio]')
      ?.getAttribute('data-describe-deselectable-radio');
    if (!text) return;
    const el = createDescription(context, input, text);
    input.setAttribute('aria-describedby', [...descriptionIds(input), el.id].join(' '));
    descriptions.set(input, el);
  }

  /** Adds instructions to existing opted-in radios before users can focus them. */
  function initialize(): void {
    context.root.querySelectorAll<HTMLInputElement>('input[type="radio"]').forEach(input => {
      // Other radios retain their native descriptions and behavior.
      if (resolveInput(context, input)) describe(input);
    });
  }

  /** Removes descriptions from this setup without changing the selected radio. */
  function cleanup(): void {
    descriptions.forEach(removeDescription);
    descriptions.clear();
  }

  return { describe, initialize, cleanup };
}
