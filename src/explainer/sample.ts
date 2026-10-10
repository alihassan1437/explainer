import type { Project } from './types';
import { ENGINE_DRAWING } from './examples/engine';
import { WATER_CYCLE_DRAWING } from './examples/water-cycle';

/** "How an engine works", with the engine written entirely as data in the drawing format an agent uses. */
export const SAMPLE_ENGINE_DRAWING: Project = {
  aspect: '16:9',
  theme: 'blueprint',
  scenes: [
    { block: 'title', text: 'How a car engine works', subtitle: 'This engine is written as data, not built into the app', lengthMs: 3600 },
    ENGINE_DRAWING,
    { block: 'title', text: 'Four strokes, one cycle', subtitle: 'Then it starts again', lengthMs: 3000 },
  ],
};

/** A different topic made from the same blocks. */
export const SAMPLE_WATER_CYCLE: Project = {
  aspect: '16:9',
  theme: 'blueprint',
  scenes: [
    { block: 'title', text: 'How the water cycle works', subtitle: 'Drawn from data, with no new app code', lengthMs: 3400 },
    WATER_CYCLE_DRAWING,
  ],
};

export const SAMPLES: { id: string; label: string; project: Project }[] = [
  { id: 'engine-data', label: 'Engine, written as data', project: SAMPLE_ENGINE_DRAWING },
  { id: 'water', label: 'Water cycle, written as data', project: SAMPLE_WATER_CYCLE },
];
