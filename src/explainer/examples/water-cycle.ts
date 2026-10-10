// A second worked example, on a different topic, to show the same building blocks cover it without any new app code: the water cycle.
// Parts for the sun, sea, land, vapour, cloud, rain and the return flow; formulas for the four stages; a panel that explains each.

import type { DrawingScene } from '../drawing/types';

export const WATER_CYCLE_DRAWING: DrawingScene = {
  block: 'drawing',
  title: 'The water cycle',
  lengthMs: 32000,
  stage: { w: 8.4, h: 6.2, cx: 0, cy: 0 },
  params: { period: 16 },
  vars: {
    c: 'wrap(t,period)/period',                          // where we are in one trip round: 0 to 1
    st: 'floor(c*4)', sp: 'wrap(c*4,1)',                  // which of the four stages, and how far through it
    beat: '0.5+0.5*sin(t*1.6)',
    ev: '1-smooth(0.26,0.34,c)',                         // evaporation is strongest at the start
    cd: 'smooth(0.18,0.5,c)*(1-smooth(0.78,0.95,c))',    // the cloud builds, then empties
    ri: 'smooth(0.5,0.56,c)*(1-smooth(0.76,0.82,c))',     // the rain
    back: 'smooth(0.74,0.8,c)',                          // water running back to the sea
  },
  parts: {
    sun: { color: 'hot', label: { text: 'Sun', at: [-4.0, 2.75], to: [-3.1, 2.3], align: 'left' } },
    cloud: { color: { byTheme: { blueprint: '#cfe3f7', flat: '#7d8bb5' } }, label: { text: 'Cloud', at: [3.15, 2.55], to: [2.3, 1.95], align: 'left' } },
    rain: { color: 'accent', label: { text: 'Rain', at: [3.3, 0.35], to: [2.4, 0.2], align: 'left' } },
    sea: { color: 'accent2', label: { text: 'Sea', at: [-3.9, -2.55], to: [-3.2, -2.0], align: 'left' } },
    land: { color: { byTheme: { blueprint: '#4ade80', flat: '#06b38a' } }, label: { text: 'Land', at: [3.3, -1.35], to: [2.6, -1.2], align: 'left' } },
    vapor: { color: 'ink' },
    flow: { color: 'good' },
  },
  cues: [
    { at: 1200, do: 'highlight', part: 'sun' },
    { at: 4800, do: 'highlight', part: 'cloud' },
    { at: 9000, do: 'highlight', part: 'rain' },
    { at: 13200, do: 'highlight', part: 'sea' },
  ],
  shapes: [
    // land: a hill on the right
    { type: 'curve', id: 'land', part: 'land', n: 40, close: true, x: 'mix(0.4,4.2,u)', y: '-2.2+if(u<0.9,1.1*sin(u*pi*1.02)+0.15*sin(u*13),0.0)' },
    // the sea, with a surface that moves
    { type: 'rect', id: 'sea', part: 'sea', x0: -4.2, y0: -3.1, x1: 0.5, y1: -1.75, alpha: 0.85 },
    { type: 'curve', id: 'waves', part: 'sea', n: 60, fill: 'none', x: 'mix(-4.2,0.5,u)', y: '-1.75+0.07*sin(u*26+t*2.2)', emph: 'if(st==3,0.8,0)' },
    // the sun and its rays
    { type: 'circle', id: 'sun', part: 'sun', x: -3, y: 2.2, r: '0.5+0.04*beat', emph: 'if(st==0,0.9,0)' },
    { type: 'line', id: 'ray', part: 'sun', repeat: 12, let: { a: 'i/12*tau+t*0.25' }, x1: '-3+0.68*cos(a)', y1: '2.2+0.68*sin(a)', x2: '-3+(0.9+0.12*beat)*cos(a)', y2: '2.2+(0.9+0.12*beat)*sin(a)' },
    // vapour rising from the sea toward the cloud
    {
      type: 'circle', id: 'vapor', part: 'vapor', repeat: 16, stroke: 'none',
      let: { f: 'wrap(t*0.35+rand(i+40),1)', k: 'rand(i)' },
      x: 'mix(-3.4+k*2.6,1.0+k*1.0,f)+0.12*sin(t*2+i)', y: 'mix(-1.7,1.6,f)', r: 0.055, fill: 'vapor', alpha: 'ev*sin(f*pi)*0.9',
    },
    // the cloud: five soft puffs that grow while the vapour cools
    { type: 'circle', id: 'puff', part: 'cloud', repeat: 5, let: { k: 'rand(i+7)' }, x: '1.1+i*0.38', y: '1.95+0.14*sin(i*1.7)', r: '(0.28+0.16*k)*(0.35+0.65*cd)', alpha: '0.35+0.65*cd', emph: 'if(st==1,0.7,0)' },
    // rain falling from the cloud while it empties
    {
      type: 'line', id: 'drop', part: 'rain', repeat: 26, when: 'ri>0.02',
      let: { f: 'wrap(t*1.4+rand(i+90),1)', k: 'rand(i+3)' },
      x1: '1.0+k*1.9', y1: '1.5-f*3.1', x2: '1.0+k*1.9', y2: '1.5-f*3.1-0.26', alpha: 'ri*(1-f*0.35)', width: 0.9,
    },
    // water running back to the sea, with an arrowhead
    { type: 'curve', id: 'return', part: 'flow', when: 'back>0.02', n: 30, fill: 'none', alpha: 'back', width: 1.2, x: 'mix(2.2,0.0,u)', y: 'mix(-0.9,-1.78,u)+0.25*sin(u*pi)' },
    { type: 'poly', id: 'returnHead', part: 'flow', when: 'back>0.02', points: [[0.0, -1.78], [0.25, -1.55], [0.28, -1.82]], alpha: 'back' },
  ],
  panel: {
    title: 'Water cycle', counter: 'floor(t/period)+1',
    items: [
      { title: 'Evaporation', text: 'The sun warms the sea. Water turns to vapour and rises into the air.', active: 'st==0', progress: 'sp', color: 'hot' },
      { title: 'Condensation', text: 'High up it is cold. The vapour turns back into tiny drops that form clouds.', active: 'st==1', progress: 'sp', color: 'accent2' },
      { title: 'Precipitation', text: 'The drops join together until they are heavy, and fall as rain.', active: 'st==2', progress: 'sp', color: 'accent' },
      { title: 'Collection', text: 'The water runs over the land and back into the sea. Then it begins again.', active: 'st==3', progress: 'sp', color: 'good' },
    ],
  },
};
