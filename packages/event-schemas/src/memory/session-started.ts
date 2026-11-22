import { z } from 'zod';
import { EventEnvelopeSchema } from '../envelope.js';

// PRODUCER STATUS: lib/memory-budget.mjs publishes memory.session_started /
// memory.session_ended for daemon sessions (session_type 'daemon').

export const SessionStartedSchema = EventEnvelopeSchema.extend({
  event_type: z.literal('memory.session_started'),
  data: z.object({
    session_id: z.string(),
    start_time: z.string().datetime(),
    session_type: z.enum(['interactive', 'daemon', 'headless']).default('interactive'),
  }),
});

export type SessionStartedEvent = z.infer<typeof SessionStartedSchema>;
