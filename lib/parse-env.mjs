/**
 * parse-env.mjs — parseNum: numeric env parsing with a fallback.
 *
 * @module lib/parse-env
 */

/**
 * Parse a numeric env var with a fallback.
 *
 * @param {string | undefined | null} value
 * @param {number} defaultValue
 * @returns {number}
 */
export function parseNum(value, defaultValue) {
  if (value === undefined || value === null || value === '') return defaultValue;
  const n = Number(value);
  return Number.isFinite(n) ? n : defaultValue;
}
