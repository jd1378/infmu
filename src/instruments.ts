// Composition root of the instruments page: the latest composer's instruments, played through the render workers.

import { engine, LATEST_VERSION } from './engines/index.ts';
import { startInstruments } from './ui/instruments/page.ts';

// the build renames the worker bundle to a hashed file and rewrites this path to match
const WORKER_URL = new URL('./worker.js', import.meta.url);
const WORKERS = Math.max(1, Math.min(2, (navigator.hardwareConcurrency || 2) - 1));

startInstruments(engine(LATEST_VERSION), WORKER_URL, WORKERS);
