export type RadioRoot = Document | HTMLElement | ShadowRoot;

export interface RadioContext {
  root: RadioRoot;
  window: NonNullable<Document['defaultView']>;
}

/** Supplies the document and window that own the radios, including radios inside another window. */
export function createContext(root: RadioRoot): RadioContext {
  const doc = root.nodeType === 9 ? root as Document : root.ownerDocument!;
  const window = doc.defaultView;
  if (!window) throw new Error('Radio uncheck requires a document with a window.');
  return { root, window };
}

/** Checks whether a radio belongs to this setup and can respond to user activation. */
export function isAvailable({ root }: RadioContext, input: HTMLInputElement): boolean {
  return input.isConnected && root.contains(input) && !input.matches(':disabled');
}

/**
 * Finds the radio behind an input, its label, or text inside its label.
 * The label.control property supports both enclosing labels and labels with a for attribute.
 * Disabled radios, radios outside this root, and radios without an opt-in attribute stay unchanged.
 */
export function resolveInput(context: RadioContext, target: EventTarget | null): HTMLInputElement | null {
  const { root, window } = context;
  if (!(target instanceof window.Element)) return null;
  const input = target.matches('input[type="radio"]')
    ? target
    : target.closest('label')?.control;
  if (!(input instanceof window.HTMLInputElement)) return null;
  if (input.type !== 'radio' || input.matches(':disabled')) return null;
  return root.contains(input) && input.matches('[data-deselectable], [deselectable]') ? input : null;
}
