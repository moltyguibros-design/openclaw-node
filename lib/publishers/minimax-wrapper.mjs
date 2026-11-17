/**
 * minimax-wrapper.mjs — MiniMax SDK wrapper for OpenClaw extraction triggering
 * and ambient memory injection.
 *
 * MiniMax uses an OpenAI-compatible API, so this wrapper follows the same
 * pattern as openai-wrapper.mjs: wraps `client.chat.completions.create`.
 *
 * Usage:
 *   import { createNatsPublisher } from '../publishers/publish-helper.mjs';
 *   import { wrapMiniMax } from '../publishers/minimax-wrapper.mjs';
 *
 *   const publisher = createNatsPublisher();
 *   const client = wrapMiniMax(minimaxClient, publisher);
 *   // Basic: extraction events only
 *
 *   const client = wrapMiniMax(minimaxClient, publisher, { injector });
 *   // With injection: memory context prepended to system message
 */

import { wrapChatCompletions } from './openai-wrapper.mjs';

/**
 * Wrap a MiniMax client (OpenAI-compatible) to publish extraction events
 * and optionally inject ambient memory before each chat completion.
 *
 * @param {object} client - MiniMax client instance with OpenAI-compatible interface
 * @param {{ publish: (triggeredBy?: string) => Promise<void> }} publisher - from createNatsPublisher
 * @param {{ injector?: { retrieve: (prompt: string, opts?: object) => Promise<object> } }} [opts] - optional memory injector
 * @returns {object} The same client with wrapped chat.completions.create
 */
export function wrapMiniMax(client, publisher, opts = {}) {
  return wrapChatCompletions(client, publisher, opts, 'wrapMiniMax', 'minimax-wrapper');
}
