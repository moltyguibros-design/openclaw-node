'use strict';

/**
 * A capture that keeps the first `headMax` and the last `tailMax` characters of a stream.
 * Consumers need both ends: artifacts and thinking-block detection read the head, verdicts
 * and reflections the tail. Once anything in between is dropped, `truncated` is true and
 * text() marks the cut, so a parser can fail closed instead of reading a spliced output.
 */
function createOutputWindow(headMax, tailMax) {
  let head = '';
  let tail = '';
  let dropped = 0;
  return {
    push(chunk) {
      let s = String(chunk);
      if (head.length < headMax) {
        const take = headMax - head.length;
        head += s.slice(0, take);
        s = s.slice(take);
      }
      if (!s) return;
      tail += s;
      if (tail.length > tailMax) {
        dropped += tail.length - tailMax;
        tail = tail.slice(-tailMax);
      }
    },
    get truncated() { return dropped > 0; },
    text() {
      return dropped > 0 ? `${head}\n…(output truncated: ${dropped} characters dropped)…\n${tail}` : head + tail;
    },
  };
}

module.exports = { createOutputWindow };
