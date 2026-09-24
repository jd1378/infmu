// Composition root: the browser player plugged into the interface.

import { WebPlayer } from './audio/player.ts';
import { startApp } from './ui/app.ts';

// the build renames the worker bundle to a hashed file and rewrites this path to match
const WORKER_URL = new URL('./worker.js', import.meta.url);
const WORKERS = Math.max(1, Math.min(2, (navigator.hardwareConcurrency || 2) - 1));

startApp((song) => new WebPlayer(song, WORKER_URL, WORKERS));
