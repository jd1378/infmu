// One arranger per style: given a section's role (intro, verse, drop...), decide which parts play and how.
// Choices that should stay the same for a whole movement (hook, drum pattern, instruments) come from the
// movement's stream `ctx.mrng`; per-section detail comes from `ctx.rng`.

import type { StyleId } from '../types.ts';
import type { Ctx } from './context.ts';
import { colours } from './colors.ts';
import { opening, transition } from './parts.ts';
import { garden, haze, nocturne } from './styles/acoustic.ts';
import { cathedral, drift, ember } from './styles/atmospheric.ts';
import { acid, pulse, rise } from './styles/electronic.ts';

const ARRANGERS: Record<StyleId, (ctx: Ctx) => void> = {
  rise,
  pulse,
  acid,
  haze,
  garden,
  nocturne,
  drift,
  cathedral,
  ember,
};

export function arrange(ctx: Ctx): void {
  opening(ctx);
  ARRANGERS[ctx.mv.style](ctx);
  colours(ctx);
  transition(ctx);
}
