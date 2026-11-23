import { test, expect, type Page } from '@playwright/test';

type RecordedEvent = { type: string; checked: boolean; trusted: boolean };
declare global {
  interface Window {
    cleanup: { (): void; refresh(): void };
    events: RecordedEvent[];
  }
}

/**
 * Waits for pending notifications or the Space fallback before assertions, including assertions that no change occurs.
 * The callback executes in the browser so it shares the timer queue with the library.
 */
async function settle(page: Page) {
  // Wait for the library's queued task, including cases with no expected change.
  await page.evaluate(/* Waits in the browser rather than the test process. */ () => new Promise(/* Resolves after queued deselection can finish. */ resolve => setTimeout(resolve, 30)));
}

/** Reads the events that page listeners observed, including the selected state at each event. */
async function trace(page: Page) {
  return page.evaluate(/* Copies the browser event log into the test process. */ () => window.events);
}

/** Starts a fresh event log so assertions describe only the next user interaction. */
async function clearTrace(page: Page) {
  await page.evaluate(/* Clears the log without removing the page listeners. */ () => { window.events = []; });
}

/**
 * Checks that one selection change emits input followed by change, each with the final selected state.
 * Extra events can cause a page to save data twice, so the event count matters too.
 */
async function expectTransition(page: Page, checked: boolean) {
  await settle(page);
  const events = (await trace(page)).filter(/* Excludes click because this assertion covers notifications of a selection change. */ event => event.type !== 'click');
  expect(events.map(/* Compares event order and state without depending on whether the browser created the event. */ ({ type, checked }) => ({ type, checked }))).toEqual([
    { type: 'input', checked }, { type: 'change', checked },
  ]);
}

// Each test gets a fresh document and library setup so earlier selections cannot affect its result.
test.beforeEach(async ({ page }) => {
  // A real origin lets the browser resolve the package's internal module imports.
  await page.goto('/');
  await page.setContent(`
    <p id="hint">Original help</p>
    <fieldset data-describe-deselectable-radio="Activate again to clear">
      <legend>Choice</legend>
      <label id="wrapped"><input id="one" type="radio" name="choice" data-deselectable aria-describedby="hint"><span>One</span></label>
      <input id="two" type="radio" name="choice" deselectable><label id="external" for="two"><span>Two</span></label>
      <label><input id="normal" type="radio" name="choice">Normal</label>
      <label><input id="disabled" type="radio" name="disabled" data-deselectable disabled checked>Disabled</label>
    </fieldset>
  `);
  await page.evaluate(async () => {
    // Imports the built package into the browser, where real input activation takes place.
    const { enableDeselectableRadio } = await import(new URL('/dist/index.js', location.href).href);
    window.cleanup = enableDeselectableRadio();
    window.events = [];
    for (const type of ['click', 'input', 'change']) {
      document.addEventListener(type, event => {
        // Records radio events after they reach the document, as a page listener normally sees them.
        if (event.target instanceof HTMLInputElement) {
          window.events.push({ type, checked: event.target.checked, trusted: event.isTrusted });
        }
      });
    }
  });
});

for (const [target, input] of [
  ['#one', '#one'],
  ['#wrapped span', '#one'],
  ['#two', '#two'],
  ['#external span', '#two'],
]) {
  // Each input and label form must select once, then clear once, without duplicate notifications.
  test(`selects and deselects through ${target} with one input/change pair`, async ({ page }) => {
    await page.locator(target).click();
    await expect(page.locator(input)).toBeChecked();
    await expectTransition(page, true);
    await clearTrace(page);
    await page.locator(target).click();
    await expect(page.locator(input)).not.toBeChecked();
    await expectTransition(page, false);
  });
}

// Keyboard activation must work even in browsers that omit click on an already selected radio.
test('Space selects and deselects exactly once', async ({ page, browserName }) => {
  await page.locator('#one').focus();
  await page.keyboard.press('Space');
  await expect(page.locator('#one')).toBeChecked();
  await expectTransition(page, true);
  await clearTrace(page);
  await page.keyboard.press('Space');
  await expect(page.locator('#one')).not.toBeChecked();
  await expectTransition(page, false);
  // Already-selected native radios do not emit click for Space in every engine.
  expect((await trace(page)).filter(/* Counts native keyboard clicks separately from input and change. */ e => e.type === 'click')).toHaveLength(browserName === 'firefox' ? 1 : 0);
});

// Arrow keys must keep their native role: move selection to another radio in the group.
test('arrow navigation preserves native radio-group selection', async ({ page }) => {
  await page.locator('#one').click();
  await clearTrace(page);
  // Safari does not necessarily focus a radio when it is clicked.
  await page.locator('#one').focus();
  await page.keyboard.press('ArrowRight');
  await settle(page);
  await expect(page.locator('#two')).toBeChecked();
  await expect(page.locator('#one')).not.toBeChecked();
  await expectTransition(page, true);
});

// Radios with the same name must still allow only one selected choice.
test('switching choices keeps radio groups mutually exclusive', async ({ page }) => {
  await page.locator('#one').click();
  await clearTrace(page);
  await page.locator('#two').click();
  await expect(page.locator('#one')).not.toBeChecked();
  await expect(page.locator('#two')).toBeChecked();
  await expectTransition(page, true);
});

// Radios without an opt-in attribute and disabled radios must retain their browser behavior.
test('ordinary and disabled radios retain native behavior', async ({ page }) => {
  await page.locator('#normal').click();
  await clearTrace(page);
  await page.locator('#normal').click();
  const box = await page.locator('#disabled').boundingBox();
  await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await settle(page);
  await expect(page.locator('#normal')).toBeChecked();
  await expect(page.locator('#disabled')).toBeChecked();
  expect((await trace(page)).filter(/* Keeps only notifications that the selected state changed. */ e => e.type !== 'click')).toEqual([]);
});

for (const button of ['right', 'middle'] as const) {
  // Context-menu and middle-button actions must not clear the current selection.
  test(`${button} click does not deselect or emit change events`, async ({ page }) => {
    await page.locator('#one').click();
    await clearTrace(page);
    await page.locator('#one').click({ button });
    await settle(page);
    await expect(page.locator('#one')).toBeChecked();
    expect(await trace(page)).toEqual([]);
  });
}

// The library must support radios that the page inserts after setup, without another setup call.
test('dynamic radios opt in without another setup call', async ({ page }) => {
  await page.evaluate(() => {
    // Adds a radio after setup to exercise the listeners on the root.
    document.body.insertAdjacentHTML('beforeend', '<label><input id="dynamic" type="radio" data-deselectable>Dynamic</label>');
  });
  await page.locator('#dynamic').click();
  await expect(page.locator('#dynamic')).toBeChecked();
  await clearTrace(page);
  await page.locator('#dynamic').click();
  await expect(page.locator('#dynamic')).not.toBeChecked();
  await expectTransition(page, false);
  await expect(page.locator('#dynamic')).not.toHaveAttribute('aria-describedby');
});

// Cleanup must preserve page-owned descriptions, including descriptions added after library setup.
test('descriptions survive deselection and cleanup preserves page-owned IDs', async ({ page }) => {
  const ids = (await page.locator('#one').getAttribute('aria-describedby'))!.split(/\s+/);
  expect(ids).toContain('hint');
  expect(ids).toHaveLength(2);
  await page.locator('#one').click();
  await page.locator('#one').click();
  await expect(page.locator('#one')).not.toBeChecked();
  await expect(page.locator('#one')).toHaveAttribute('aria-describedby', ids.join(' '));
  await page.evaluate(() => {
    // Simulates a page that adds its own description before the library stops.
    document.body.insertAdjacentHTML('beforeend', '<p id="later">Later help</p>');
    document.querySelector('#one')!.setAttribute('aria-describedby', document.querySelector('#one')!.getAttribute('aria-describedby') + ' later');
    window.cleanup();
    window.cleanup();
  });
  await expect(page.locator('#one')).toHaveAttribute('aria-describedby', 'hint later');
  await expect(page.locator(`[id="${ids[1]}"]`)).toHaveCount(0);
});

// After cleanup, another click on a selected radio must use native behavior and leave it selected.
test('cleanup disables deselection', async ({ page }) => {
  await page.locator('#one').click();
  await page.evaluate(/* Stops the library while the selected radio stays on the page. */ () => window.cleanup());
  await clearTrace(page);
  await page.locator('#one').click();
  await settle(page);
  await expect(page.locator('#one')).toBeChecked();
  expect((await trace(page)).filter(/* Keeps only notifications that the selected state changed. */ e => e.type !== 'click')).toEqual([]);
});

for (const activation of ['direct click', 'wrapped label', 'external label'] as const) {
  // Both input and document click listeners must observe the cleared state during the same event.
  test(`${activation} handlers observe deselection immediately`, async ({ page }) => {
    const input = activation === 'external label' ? '#two' : '#one';
    const target = activation === 'wrapped label' ? '#wrapped span'
      : activation === 'external label' ? '#external span' : input;
    // Uses the same input or label for selection and the later attempt to clear it.
    const activate = () => page.locator(target).click();
    await page.locator(input).focus();
    await activate();
    await expect(page.locator(input)).toBeChecked();
    await page.locator(input).evaluate(element => {
      // Attaches a listener directly to the radio to compare target and document observations.
      element.addEventListener('click', () => {
        // Records the state before the click reaches the document listener.
        window.events.push({ type: 'target-click', checked: (element as HTMLInputElement).checked, trusted: true });
      });
    });
    await clearTrace(page);
    await activate();
    const events = (await trace(page)).filter(/* Keeps both observations of the same click. */ event => ['click', 'target-click'].includes(event.type));
    expect(events.map(/* Checks that both listeners actually received the click. */ e => e.type)).toEqual(['target-click', 'click']);
    expect(events.map(/* Compares the selected state seen by the target and document listeners. */ e => e.checked)).toEqual([false, false]);
  });
}

for (const target of ['#one', '#wrapped span', '#external span']) {
  // A page can cancel activation on the input or its label without triggering deselection notifications.
  test(`canceling click on ${target} preserves selection`, async ({ page }) => {
    const input = target === '#external span' ? '#two' : '#one';
    await page.locator(target).click();
    await page.locator(target).evaluate(element => {
      // Cancels one click after the library capture listener, as a page handler can do.
      element.addEventListener('click', event => event.preventDefault(), { once: true });
    });
    await clearTrace(page);
    await page.locator(target).click();
    await settle(page);
    await expect(page.locator(input)).toBeChecked();
    expect((await trace(page)).filter(/* Keeps only selection notifications. */ e => e.type !== 'click')).toEqual([]);
    await page.locator(target).click();
    await expect(page.locator(input)).not.toBeChecked();
  });
}

// An abandoned release must not itself clear selection. A later click-only activation can clear it.
test('mouse release alone does not clear selection, but a later click-only activation does', async ({ page }) => {
  await page.locator('#one').click();
  await clearTrace(page);
  await page.locator('#one').dispatchEvent('mouseup', { button: 0 });
  await settle(page);
  await expect(page.locator('#one')).toBeChecked();
  expect(await trace(page)).toEqual([]);
  await page.locator('#one').evaluate(element => {
    // Calls native click without a preceding mouse release or Space release.
    (element as HTMLInputElement).click();
  });
  await settle(page);
  await expect(page.locator('#one')).not.toBeChecked();
});

/** Activates an input or label without mouse or keyboard events, as a click-only caller can do. */
async function clickOnly(page: Page, selector: string): Promise<void> {
  await page.locator(selector).evaluate(element => {
    // Native click includes radio pre-activation, unlike dispatchEvent on a plain Event.
    (element as HTMLElement).click();
  });
}

for (const [target, input] of [['#one', '#one'], ['#wrapped', '#one'], ['#external', '#two']]) {
  // The second click must clear selection without requiring mouseup or keyup.
  test(`click-only activation selects and clears through ${target}`, async ({ page }) => {
    await clickOnly(page, target);
    await expect(page.locator(input)).toBeChecked();
    await expectTransition(page, true);
    await clearTrace(page);
    await clickOnly(page, target);
    await expect(page.locator(input)).not.toBeChecked();
    expect((await trace(page)).find(/* Reads the state exposed to the page's click handler. */ e => e.type === 'click')?.checked).toBe(false);
    await expectTransition(page, false);
  });
}

// Checked markup must work before any selection event occurs.
test('initially selected radios support click-only deselection', async ({ page }) => {
  await page.evaluate(async () => {
    // Recreates setup after initial markup, as a consumer does on page load.
    window.cleanup();
    (document.querySelector('#one') as HTMLInputElement).checked = true;
    const { enableDeselectableRadio } = await import(new URL('/dist/index.js', location.href).href);
    window.cleanup = enableDeselectableRadio();
  });
  await clickOnly(page, '#one');
  await expect(page.locator('#one')).not.toBeChecked();
  await expectTransition(page, false);
});

// Group changes emit events on the newly selected radio, not on its unchecked sibling.
test('tracking follows opted-in and ordinary group members', async ({ page }) => {
  for (const other of ['#two', '#normal']) {
    await clickOnly(page, '#one');
    await expect(page.locator('#one')).toBeChecked();
    await clickOnly(page, other);
    await expect(page.locator('#one')).not.toBeChecked();
    await clickOnly(page, '#one');
    await expect(page.locator('#one')).toBeChecked();
    await clickOnly(page, '#one');
    await expect(page.locator('#one')).not.toBeChecked();
  }
});

// Form reset changes checked properties without emitting input or change.
test('tracking follows form reset and default selections', async ({ page }) => {
  await page.evaluate(() => {
    // The form owns the fixture radios after this move.
    const form = document.createElement('form');
    document.body.append(form);
    form.append(document.querySelector('fieldset')!);
    (document.querySelector('#one') as HTMLInputElement).defaultChecked = true;
  });
  await settle(page);
  await clickOnly(page, '#one');
  await expect(page.locator('#one')).not.toBeChecked();
  await page.evaluate(() => {
    // Resets through the native form API, without synthetic change events.
    document.querySelector('form')!.reset();
  });
  await settle(page);
  await clearTrace(page);
  await clickOnly(page, '#one');
  await expect(page.locator('#one')).not.toBeChecked();
  await expectTransition(page, false);
});

// Explicit refresh covers direct property writes and immediate synthetic activation of new radios.
test('refresh captures silent changes and synchronous insertion', async ({ page }) => {
  await page.evaluate(() => {
    // Direct checked assignments do not emit DOM events.
    const input = document.querySelector('#one') as HTMLInputElement;
    input.checked = true;
    window.cleanup.refresh();
    input.click();
  });
  await expect(page.locator('#one')).not.toBeChecked();
  await expectTransition(page, false);
  await clearTrace(page);
  await page.evaluate(() => {
    // Refresh captures a new radio before the MutationObserver callback can run.
    const input = document.createElement('input');
    input.type = 'radio';
    input.id = 'new-checked';
    input.setAttribute('deselectable', '');
    input.checked = true;
    document.body.append(input);
    window.cleanup.refresh();
    input.click();
  });
  await expect(page.locator('#new-checked')).not.toBeChecked();
  await expectTransition(page, false);
});

// Observation handles radios inserted between user interactions without requiring a refresh call.
test('tracking observes new preselected radios', async ({ page }) => {
  await page.evaluate(() => {
    // Inserts a selected radio as markup rather than through a checked property assignment.
    document.body.insertAdjacentHTML('beforeend', '<label><input id="new-default" type="radio" data-deselectable checked>New</label>');
  });
  await settle(page);
  await clickOnly(page, '#new-default');
  await expect(page.locator('#new-default')).not.toBeChecked();
  await expectTransition(page, false);
});

// A canceled deselection must restore both the radio and its saved state.
test('canceled click-only deselection preserves the tracked selection', async ({ page }) => {
  await clickOnly(page, '#one');
  await page.locator('#one').evaluate(element => {
    // Cancels one activation after capture, as an application can do.
    element.addEventListener('click', event => event.preventDefault(), { once: true });
  });
  await clearTrace(page);
  await clickOnly(page, '#one');
  await settle(page);
  await expect(page.locator('#one')).toBeChecked();
  expect((await trace(page)).filter(/* Keeps selection notifications only. */ e => e.type !== 'click')).toEqual([]);
  await clickOnly(page, '#one');
  await expect(page.locator('#one')).not.toBeChecked();
  await expectTransition(page, false);
});

// Setup cleanup must disable click-only handling and make refresh harmless.
test('cleanup stops state observation and click-only deselection', async ({ page }) => {
  await clickOnly(page, '#one');
  await page.evaluate(() => {
    // Repeated cleanup and refresh must not reinstall listeners or observers.
    window.cleanup();
    window.cleanup();
    window.cleanup.refresh();
  });
  await clearTrace(page);
  await clickOnly(page, '#one');
  await settle(page);
  await expect(page.locator('#one')).toBeChecked();
  expect((await trace(page)).filter(/* Keeps selection notifications only. */ e => e.type !== 'click')).toEqual([]);
});

// Canceling an initial selection must not leave a cached selected state behind.
test('canceled first click-only selection leaves the next activation usable', async ({ page }) => {
  await page.locator('#one').evaluate(element => {
    // Cancels native activation, which then emits no input or change event.
    element.addEventListener('click', event => event.preventDefault(), { once: true });
  });
  await clickOnly(page, '#one');
  await settle(page);
  await expect(page.locator('#one')).not.toBeChecked();
  await clearTrace(page);
  await clickOnly(page, '#one');
  await expect(page.locator('#one')).toBeChecked();
  await expectTransition(page, true);
});

// A scoped setup must track group changes from ordinary radios outside its root.
test('tracking follows group members outside the setup root', async ({ page }) => {
  await page.evaluate(async () => {
    // Only the wrapped label belongs to this setup, but all fixture radios share a group.
    window.cleanup();
    const { enableDeselectableRadio } = await import(new URL('/dist/index.js', location.href).href);
    window.cleanup = enableDeselectableRadio(document.querySelector('#wrapped'));
  });
  await clickOnly(page, '#one');
  await clickOnly(page, '#normal');
  await expect(page.locator('#one')).not.toBeChecked();
  await clearTrace(page);
  await clickOnly(page, '#one');
  await expect(page.locator('#one')).toBeChecked();
  await expectTransition(page, true);
  await clickOnly(page, '#one');
  await expect(page.locator('#one')).not.toBeChecked();
});

// Equal radio names in different forms identify separate groups.
test('tracking keeps same-name radios in different forms independent', async ({ page }) => {
  await page.evaluate(() => {
    // Moves the two opted-in radios into separate forms without changing their shared name.
    for (const id of ['one', 'two']) {
      const form = document.createElement('form');
      document.body.append(form);
      form.append(document.getElementById(id)!);
    }
    window.cleanup.refresh();
  });
  await clickOnly(page, '#one');
  await clickOnly(page, '#two');
  await expect(page.locator('#one')).toBeChecked();
  await expect(page.locator('#two')).toBeChecked();
  await clearTrace(page);
  await clickOnly(page, '#one');
  await expect(page.locator('#one')).not.toBeChecked();
  await expect(page.locator('#two')).toBeChecked();
  await expectTransition(page, false);
});
