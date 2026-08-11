/**
 * Cooperative yielding for the long synchronous loops of the data load.
 *
 * Reading and merging the DBF files is pure CPU work: `fs.readSync` per
 * record, no I/O the runtime could interleave. Even though the functions
 * are declared `async`, they never await anything, so the event loop is
 * blocked from the first record to the last. Measured on the reference
 * data set that is one contiguous 6.8 second block, and around a minute
 * inside a container. During that time the server accepts connections but
 * answers nothing, not even the HTML of the loading screen, which is why
 * a fresh start used to look like a broken app.
 *
 * A yielder hands control back to the event loop whenever the current
 * slice is used up, so pending HTTP requests get served in between.
 *
 * @module cooperative
 */

'use strict';

/** How long a loop may run before it should give the loop a turn. */
const DEFAULT_SLICE_MS = 20;

/**
 * Create a yield function.
 *
 * The returned function is cheap to call: it only looks at the clock and
 * returns immediately while the slice lasts, so callers can invoke it
 * inside hot loops (ideally every few hundred iterations) without paying
 * for a promise per record.
 *
 * @param {number} [sliceMs] Maximum time between two yields.
 * @returns {() => Promise<void>}
 */
function createYielder(sliceMs = DEFAULT_SLICE_MS) {
  let last = Date.now();
  return async function tick() {
    if (Date.now() - last < sliceMs) return;
    // setImmediate runs after pending I/O callbacks, so requests that
    // arrived meanwhile are handled before the loop continues.
    await new Promise(resolve => setImmediate(resolve));
    last = Date.now();
  };
}

/** Bitmask for "check the clock every 512 iterations" in hot loops. */
const TICK_MASK = 511;

module.exports = { createYielder, TICK_MASK, DEFAULT_SLICE_MS };
