#!/usr/bin/env node
import { initializeMcSessionToken } from '../lib/mc-session-token.mjs';

initializeMcSessionToken();
process.stdout.write('Mission Control session token initialized\n');
