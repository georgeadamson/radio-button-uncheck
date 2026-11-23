import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { enableDeselectableRadio } from "../dist/index.js";

/**
 * Creates an isolated document for tests that inspect the library without a browser.
 * The fixture covers both opt-in attributes, label forms, and a page-owned description.
 * These tests dispatch events manually. Playwright tests cover native browser activation.
 */
function setup() {
  const dom = new JSDOM(`<body><p id="hint">Existing hint</p>
    <fieldset data-describe-deselectable-radio="Click again to deselect">
    <span>
    <label><input id="one" data-deselectable type="radio" name="x" aria-describedby="hint"><b>One</b></label>
    <input id="two" deselectable type="radio" name="x"><label for="two"><b>Two</b></label>
    <input id="disabled" data-deselectable type="radio" disabled checked name="y">
    </span><input id="three" type="radio" name="x"></fieldset>`);
  const { document } = dom.window;
  const cleanup = enableDeselectableRadio(document);
  // Finds a fixture radio so each test can inspect its selected state.
  const get = (id) => document.getElementById(id);
  // Simulates mouse release before click, when the library reads the prior selected state.
  const up = (target, options = {}) =>
    target.dispatchEvent(
      new dom.window.MouseEvent("mouseup", {
        bubbles: true,
        button: 0,
        ...options,
      }),
    );
  // Gives pending notifications or the Space fallback time to finish before assertions.
  const settle = () =>
    new Promise(/* Resolves after the library has a chance to process its timer. */ (resolve) => dom.window.setTimeout(resolve, 10));
  return { dom, document, cleanup, get, up, settle };
}

// Server-rendered applications must be able to import the package without a document.
test("import is safe without a browser global", () => {
  assert.equal(typeof enableDeselectableRadio, "function");
});
// The browser selects first. A later click clears selection before notifications reach page listeners.
test("click sees deselection and input/change follow exactly once", async () => {
  const s = setup();
  const input = s.get("one");
  s.up(input);
  input.click();
  await s.settle();
  assert.equal(input.checked, true);
  const seen = [];
  for (const type of ["input", "change"])
    s.document.addEventListener(type, /* Records state as page listeners receive each event. */ (e) =>
      seen.push([type, e.target.checked]),
    );
  s.up(input);
  input.click();
  assert.equal(input.checked, false);
  await s.settle();
  assert.equal(input.checked, false);
  assert.deepEqual(seen, [
    ["input", false],
    ["change", false],
  ]);
  s.cleanup();
  s.dom.window.close();
});
// Clicks on label text must find the associated radio, even with a separate for attribute.
test("nested labels and external labels resolve their associated radio", async () => {
  const s = setup();
  for (const id of ["one", "two"]) {
    const input = s.get(id);
    input.checked = true;
    const label = [...input.labels][0];
    s.up(label.querySelector("b"));
    label.click();
    await s.settle();
    assert.equal(input.checked, false);
  }
  s.cleanup();
  s.dom.window.close();
});
// The extra behavior applies only to enabled radios and supported activation events.
test("normal radios, disabled inputs, right click and other keys are ignored", async () => {
  const s = setup();
  s.get("three").checked = true;
  s.up(s.get("three"));
  s.up(s.get("disabled"));
  s.get("one").checked = true;
  s.up(s.get("one"), { button: 2 });
  s.get("one").dispatchEvent(
    new s.dom.window.KeyboardEvent("keyup", { bubbles: true, code: "Enter" }),
  );
  await s.settle();
  assert.equal(s.get("one").checked, true);
  assert.equal(s.get("disabled").checked, true);
  s.cleanup();
  s.dom.window.close();
});
// Cleanup must cancel a queued deselection and preserve descriptions supplied by the page.
test("Space clears selection and cleanup cancels pending work", async () => {
  const s = setup();
  const input = s.get("one");
  input.checked = true;
  input.dispatchEvent(
    new s.dom.window.KeyboardEvent("keyup", { bubbles: true, code: "Space" }),
  );
  await s.settle();
  assert.equal(input.checked, false);
  input.checked = true;
  s.up(input);
  s.cleanup();
  s.cleanup();
  await s.settle();
  assert.equal(input.checked, true);
  assert.equal(input.getAttribute("aria-describedby"), "hint");
  assert.equal(s.document.querySelector('[id^="radio-uncheck-"]'), null);
  s.dom.window.close();
});
// Root listeners must cover new radios without attaching another listener to each input.
test("delegation supports dynamically inserted opt-in radios", async () => {
  const s = setup();
  const input = s.document.createElement("input");
  input.type = "radio";
  input.setAttribute("data-deselectable", "");
  s.document.body.append(input);
  input.checked = true;
  s.up(input);
  input.click();
  await s.settle();
  assert.equal(input.checked, false);
  assert.equal(input.hasAttribute("aria-describedby"), false);
  s.cleanup();
  s.dom.window.close();
});
