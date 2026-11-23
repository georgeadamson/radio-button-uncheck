# radio-button-uncheck

Small, zero-runtime-dependency TypeScript library that lets users deselect opted-in native radio buttons. Based on the original CodePen: https://codepen.io/georgeadamson/pen/ZEVOOGJ.

## Install

The package is prepared for npm but has **not been published**. For local development, run `npm install` in this folder. Another project can install it using `npm install /absolute/path/to/radio-button-uncheck`.

Once published, installation will be `npm install radio-button-uncheck` (subject to npm name availability).

## Usage

```js
import { enableDeselectableRadio } from 'radio-button-uncheck';

const cleanup = enableDeselectableRadio();

// After direct checked assignments that emit no events:
// radio.checked = true;
// cleanup.refresh();

// When the view is removed:
// cleanup();
```

```html
<fieldset data-describe-deselectable-radio="Click again or press Space to deselect.">
  <legend>Choose one</legend>
    <label><input type="radio" name="choice" value="one" data-deselectable> One</label>
    <label><input type="radio" name="choice" value="two" deselectable> Two</label>
  <label><input type="radio" name="choice" value="three"> Three (normal behavior)</label>
</fieldset>
```

Put `data-deselectable` or `deselectable` on each radio that can be deselected. Both are presence-based attributes; even `deselectable="false"` opts in. Ancestor attributes and the old `data-allow-radio-uncheck` attribute do not opt in. Prefer `data-deselectable` for valid custom HTML. Optional `data-describe-deselectable-radio` text is added as an accessible description while preserving existing description IDs. Use normal labels and a fieldset/legend for the group.

`enableDeselectableRadio(root = document)` accepts a Document, HTMLElement or ShadowRoot. Call once per root, with non-overlapping roots. Importing is safe during server rendering; call setup only in the browser, after the markup exists. New radios are supported through delegated events; their optional descriptions are attached on focus or interaction. The returned function also exposes `cleanup.refresh()` to copy current selected states after silent programmatic changes. Cleanup removes listeners, cancels pending deselection and removes only descriptions created by that setup.

## Behavior and limitations

The library tracks radio selection from setup, input/change events, form resets, and markup changes. It also reads the actual selected state on primary `mouseup` or Space `keyup`. This saved state lets click-only activation, including `.click()`, clear an already selected radio. A capture-phase `click` listener clears an already selected radio before its target and bubbling click listeners run. The browser still selects unselected radios and maintains the radio group.

Deselection dispatches bubbling synthetic `input` and `change` events after click propagation, in a timer. Synthetic events have `isTrusted === false`. Canceled radio clicks restore the prior selection after propagation and emit no deselection notifications. For browsers that omit click on Space, the timer also clears the radio.

Capture listeners that run before the library can still see the native selected state. A listener on the original label click runs before the browser forwards a click to the radio. Click-only activation is supported, but actual screen reader and mobile interaction still needs manual testing. Browser and assistive technology testing is needed before publishing. Framework-controlled inputs must update their model from events to avoid restoring their previous value. This changes standard radio behavior; explain it to users, or consider an explicit “None” option where appropriate.

### Programmatic changes

Direct assignments such as `radio.checked = true` emit no events. After such assignments, call `cleanup.refresh()` before the next click-only activation. Refresh reads the state of the radios without changing their selection or emitting events. It has no effect after cleanup.

Markup observation and form-reset synchronization are asynchronous. If code inserts, resets, or changes radios and immediately calls `.click()` in the same JavaScript task, call `cleanup.refresh()` between those operations. A mouse release or Space release reads the actual state automatically. Event tracking includes ordinary radios and group members outside a scoped setup root, because selecting those radios can uncheck an opted-in radio.

## Develop

Requires Node.js 20 or newer and Python 3 for the demo server.

```sh
npm install
npx playwright install chromium firefox webkit
npm test
npm run demo
```

Open http://localhost:8080/demo/. Tests combine jsdom unit coverage with Playwright tests in Chromium, Firefox and WebKit. Browser tests exercise real mouse and keyboard activation, both opt-in attributes, nested and external labels, group selection, event order/counts, dynamic radios, descriptions and cleanup. Run `npm run test:unit` or `npm run test:browser` separately. Click-state regression tests require target and bubbling listeners to observe deselection immediately for direct input clicks and both label forms. No cases are marked as expected failures.

## Prepare a release

1. Choose a license and add its LICENSE file and package metadata.
2. Confirm npm name availability, author and repository metadata.
3. Test the demo with mouse, keyboard, touch and assistive technology in supported browsers.
4. Run `npm test` and `npm pack --dry-run` to inspect the package.
5. Set the release version and publish when ready.

`npm run build` compiles `src/index.ts` to JavaScript and generates type declarations in `dist/`. The npm package ships `dist/`; consumers need no build step or runtime dependencies. Tests and the demo build automatically, and `npm pack` rebuilds before packaging. This repository does not publish automatically.
