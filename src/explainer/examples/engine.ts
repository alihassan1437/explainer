// A four-stroke engine written the way an agent writes a component: only data. No code runs; the piston, valves, cams, spark, flame and gas
// all come from formulas of the crank angle. Copy and change it: it shows every feature of the drawing block in one working example.

import type { DrawingScene, Shape } from '../drawing/types';

const VALVE = (side: 'in' | 'ex'): Shape[] => {
  const x = side === 'in' ? -0.5 : 0.5;
  const part = side === 'in' ? 'intakeValve' : 'exhaustValve';
  const lift = side === 'in' ? 'liftIn' : 'liftEx', cam = side === 'in' ? 'camIn' : 'camEx';
  const stemTop = `camY-camR-${lift}`;
  return [
    // the spring squeezes as the valve opens
    { type: 'curve', id: `${side}Spring`, part, n: 14, x: `${x}+if(wrap(j,2)>=1,0.12,-0.12)`, y: `mix(headY+0.45,${stemTop}-0.1,u)`, fill: 'none', alpha: 0.7 },
    { type: 'rect', id: `${side}Stem`, part, x0: x - 0.03, y0: `headY-${lift}`, x1: x + 0.03, y1: stemTop },
    { type: 'poly', id: `${side}Disc`, part, points: [[x - 0.33, `headY-${lift}`], [x + 0.33, `headY-${lift}`], [x + 0.27, `headY-${lift}-0.08`], [x - 0.27, `headY-${lift}-0.08`]], emph: `if(${lift}>0.02,0.35,0)` },
    { type: 'rect', id: `${side}Cap`, part, x0: x - 0.1, y0: stemTop, x1: x + 0.1, y1: `${stemTop}+0.07` },
    // the cam: a circle with one lobe that points down at the middle of the stroke and lifts the valve
    { type: 'curve', id: `${side}Cam`, part: 'camshaft', n: 72, close: true, x: `${x}+(camR+lobe*exp(-pow(wrappi(u*tau-${cam})/lw,2)))*sin(u*tau)`, y: `camY-(camR+lobe*exp(-pow(wrappi(u*tau-${cam})/lw,2)))*cos(u*tau)`, emph: `if(${lift}>0.06,0.4,0)` },
    { type: 'circle', part: 'camshaft', x, y: 'camY', r: 0.05 },
  ];
};

export const ENGINE_DRAWING: DrawingScene = {
  block: 'drawing',
  title: 'The four-stroke cycle',
  lengthMs: 34000,
  // The drawing's own units: 8.4 wide, 6.2 tall, with the point (-0.1, 1.7) at the middle of the stage. y points up; the crankshaft is at (0, 0).
  stage: { w: 8.4, h: 6.2, cx: -0.1, cy: 1.7 },
  params: { R: 0.55, L: 1.9, headY: 2.85, ductY: 3.05, camY: 4.1, camR: 0.28, lobe: 0.18, lw: 0.366 },
  // Values worked out every frame, in order. The crank angle is the only thing that moves; everything else follows from it.
  // One full four-stroke cycle per scene, so the strokes track the narration: intake, compression, power, exhaust in quarters.
  vars: {
    crank: 't*720/len',                       // total crank angle
    phi: 'wrap(crank,720)',                     // position in the four-stroke cycle: 0 to 720
    cyc: 'floor(crank/720)',                    // which cycle this is
    th: 'rad(wrap(phi,360))',                 // crank angle from the top
    pinY: 'R*cos(th)+sqrt(L*L-pow(R*sin(th),2))',   // the piston pin: the crank-slider formula
    yt: 'pinY+0.2', yb: 'pinY-0.3',           // top and bottom of the piston
    cpx: 'R*sin(th)', cpy: 'R*cos(th)',       // the crank pin
    stroke: 'floor(phi/180)', sp: 'wrap(phi,180)/180',
    camIn: 'rad((phi-90)/2)', camEx: 'rad((phi-630)/2)',   // the camshaft turns once for two turns of the crank
    liftIn: 'lobe*exp(-pow(wrappi(camIn)/lw,2))', liftEx: 'lobe*exp(-pow(wrappi(camEx)/lw,2))',
    spark: 'smooth(350,358,phi)*(1-smooth(366,374,phi))',
    flame: 'if(phi>=360&&phi<540,exp(-(phi-360)/55)*smooth(360,366,phi),0)',
    burn: 'if(phi<360,0,clamp(1-(phi-360)/260,0,1))',
    heat: 'if(phi<360,0.5+0.9*smooth(180,360,phi),if(phi<540,2,1.1))',
    hh: 'headY-yt',                           // how tall the chamber is
    pg: 'flame*0.9',                          // the piston glows while it is pushed down
    ig: 'step(360,phi)',
    sb: '(cyc*1000+floor(phi/2))*16',         // a different spark shape every two degrees
    rx: '0-cpx', ry: 'pinY-cpy', rl: 'sqrt(rx*rx+ry*ry)', nx: '0-ry/rl*0.07', ny: 'rx/rl*0.07',   // the connecting rod's width, across its length
  },
  // Named parts: each has one colour (the theme sets it, the user can change it) and optionally a label that follows the part.
  parts: {
    intakeValve: { color: { byTheme: { blueprint: 'good', flat: 'good' } }, label: { text: 'Intake valve', at: [-2.35, 'headY+1.05'], to: [-0.5, 'headY+0.62'], align: 'right' } },
    camshaft: { color: { byTheme: { blueprint: '#8fb3dd', flat: '#8d93b8' } }, label: { text: 'Camshaft', at: [-2.35, 'camY+0.1'], to: [-0.78, 'camY'], align: 'right' } },
    connectingRod: { color: 'ink', label: { text: 'Connecting rod', at: [-2.35, 1.5], to: ['cpx/2', '(cpy+pinY)/2'], align: 'right' } },
    crankshaft: { color: { byTheme: { blueprint: 'ink', flat: '#3a3f66' } }, label: { text: 'Crankshaft', at: [-2.35, -0.45], to: [-0.5, -0.5], align: 'right' } },
    exhaustValve: { color: { byTheme: { blueprint: '#fb7185', flat: '#e63946' } }, label: { text: 'Exhaust valve', at: [2.4, 'headY+1.05'], to: [0.5, 'headY+0.62'], align: 'left' } },
    sparkPlug: { color: { byTheme: { blueprint: '#fde047', flat: '#f4b400' } }, label: { text: 'Spark plug', at: [2.4, 'headY+1.7'], to: [0.1, 'headY+0.7'], align: 'left' } },
    cylinder: { color: 'dim', label: { text: 'Cylinder', at: [2.4, 'headY-0.55'], to: [0.97, 'headY-0.55'], align: 'left' } },
    piston: { color: 'accent', label: { text: 'Piston', at: [2.4, 1.55], to: [0.9, 'pinY'], align: 'left' } },
    head: { color: { byTheme: { blueprint: 'dim', flat: '#4a4e72' } } },
    spark: { color: { byTheme: { blueprint: '#fff6b0', flat: '#ffe066' } } },
    mixture: { color: 'accent2' },
    flame: { color: 'hot' },
    exhaust: { color: { byTheme: { blueprint: '#9aa8bd', flat: '#7b7f9e' } } },
  },
  cues: [
    { at: { frac: 0.02 }, do: 'highlight', part: 'intakeValve' },
    { at: { frac: 0.26 }, do: 'highlight', part: 'piston' },
    { at: { frac: 0.48 }, do: 'highlight', part: 'sparkPlug' },
    { at: { frac: 0.52 }, do: 'highlight', part: 'piston', ms: 3200 },
    { at: { frac: 0.74 }, do: 'highlight', part: 'exhaustValve' },
  ],
  shapes: [
    // The crankcase and cylinder walls, and the dark inside of the chamber.
    { type: 'poly', id: 'walls', part: 'cylinder', close: false, fill: 'body', points: [[-0.97, 'headY'], [-0.97, 0.75], [-1.4, 0.45], [-1.4, -0.85], [-1.4, -1.3], [1.4, -1.3], [1.4, -0.85], [1.4, 0.45], [0.97, 0.75], [0.97, 'headY']] },
    { type: 'rect', id: 'chamber', x0: -0.95, y0: 0.76, x1: 0.95, y1: 'headY', stroke: 'none', fill: { byTheme: { blueprint: 'bgBottom', flat: { mix: ['bgBottom', 'bgTop'], by: 0.55 } } }, alpha: 'if(flat,1,0.9)' },
    // The head, with a port for each valve and the pipes that lead to them.
    { type: 'rect', id: 'head', part: 'head', x0: -1.25, y0: 'headY', x1: 1.25, y1: 'headY+0.4' },
    { type: 'rect', id: 'port', repeat: 2, let: { s: 'i*2-1' }, x0: 'min(s*0.8,s*0.2)', y0: 'headY-0.001', x1: 'max(s*0.8,s*0.2)', y1: 'headY+0.4', stroke: 'none', fill: { byTheme: { blueprint: 'bgBottom', flat: { mix: ['head', '#000000'], by: 0.55 } } }, alpha: 'if(flat,1,0.97)' },
    { type: 'rect', id: 'duct', part: 'head', repeat: 2, let: { s: 'i*2-1' }, x0: 'if(s<0,-1.95,0.8)', y0: 'ductY-0.12', x1: 'if(s<0,-0.8,1.95)', y1: 'ductY+0.12', fill: { byTheme: { blueprint: 'bgBottom', flat: { mix: ['head', '#000000'], by: 0.55 } } }, alpha: 'if(flat,1,0.97)' },
    { type: 'rect', id: 'portCover', repeat: 2, let: { s: 'i*2-1' }, x0: 'min(s*0.8,s*0.2)+0.01', y0: 'headY', x1: 'max(s*0.8,s*0.2)-0.01', y1: 'headY+0.4', stroke: 'none', fill: { byTheme: { blueprint: 'bgBottom', flat: { mix: ['head', '#000000'], by: 0.55 } } }, alpha: 'if(flat,1,0.97)' },
    // The burning gas: a soft glow over the chamber.
    { type: 'radial', id: 'flame', when: 'flame>0.01', rect: [-0.95, 'yt', 0.95, 'headY'], color: 'flame', alpha: 'flame' },
    // Thirty-eight bits of gas. Each one comes in through the open intake valve, is squeezed, burns, and leaves through the exhaust valve.
    {
      type: 'circle', id: 'gas', repeat: 38, stroke: 'none',
      let: {
        b: 'cyc*1000+i*8', gu: '(rand(b)*2-1)*0.84', gv: '0.06+rand(b+1)*0.88',
        en: '40+i/38*90+rand(b+2)*4', ex: '585+i/38*90+rand(b+3)*4',
        w1: '3+rand(b+4)*5', w2: '3+rand(b+5)*5', p1: 'rand(b+6)*6.28', p2: 'rand(b+7)*6.28',
        jx: 'sin(t*w1+p1)*0.045*heat', jy: 'sin(t*w2+p2)*0.04*heat',
        hx: 'clamp(gu+jx,-0.86,0.86)', hy: 'yt+clamp(gv+jy/max(hh,0.2),0.04,0.96)*hh',
        k1: 'ease((phi-en)/38)', k3: 'ease((phi-ex)/42)',
        ix: 'if(k1<0.45,mix(-1.85,-0.5,k1/0.45),if(k1<0.65,-0.5,mix(-0.5,hx,(k1-0.65)/0.35)))',
        iy: 'if(k1<0.45,ductY,if(k1<0.65,mix(ductY,headY-0.05,(k1-0.45)/0.2),mix(headY-0.05,hy,(k1-0.65)/0.35)))',
        ox: 'if(k3<0.3,mix(hx,0.5,k3/0.3),if(k3<0.45,0.5,mix(0.5,1.9,(k3-0.45)/0.55)))',
        oy: 'if(k3<0.3,mix(hy,headY-0.05,k3/0.3),if(k3<0.45,mix(headY-0.05,ductY,(k3-0.3)/0.15),ductY))',
        ph: 'if(phi<en,0,if(phi<en+38,1,if(phi<ex,2,if(phi<ex+42,3,4))))',
        pb: 'if(ph==2,burn,0)',
      },
      x: 'if(ph==1,ix,if(ph==3,ox,hx))', y: 'if(ph==1,iy,if(ph==3,oy,hy))', r: 0.04,
      alpha: '0.95*if(ph==0,0,if(ph==1,smooth(0,0.2,k1),if(ph==2,1,if(ph==3,1-smooth(0.75,1,k3),0))))',
      fill: { mix: ['mixture', { mix: ['exhaust', 'flame'], by: 'pb*0.95' }], by: 'ig' },
    },
    // The piston, which glows while it is pushed down, with its rings and its hot crown.
    { type: 'rect', id: 'piston', part: 'piston', x0: -0.9, y0: 'yb', x1: 0.9, y1: 'yt', emph: 'pg' },
    { type: 'line', part: 'piston', x1: -0.9, y1: 'yt-0.09', x2: 0.9, y2: 'yt-0.09' },
    { type: 'line', part: 'piston', x1: -0.9, y1: 'yt-0.17', x2: 0.9, y2: 'yt-0.17' },
    { type: 'rect', id: 'crown', when: 'pg>0.05', x0: -0.9, y0: 'yt-0.07', x1: 0.9, y1: 'yt', fill: 'flame', stroke: 'none', alpha: '0.55*pg' },
    // The connecting rod and its two ends.
    { type: 'poly', id: 'rod', part: 'connectingRod', points: [['cpx+nx*1.7', 'cpy+ny*1.7'], ['nx', 'pinY+ny'], ['0-nx', 'pinY-ny'], ['cpx-nx*1.7', 'cpy-ny*1.7']] },
    { type: 'circle', id: 'bigEnd', part: 'connectingRod', x: 'cpx', y: 'cpy', r: 0.15 },
    { type: 'circle', id: 'wristPin', part: 'piston', x: 0, y: 'pinY', r: 0.075, emph: 'pg' },
    // The flywheel, the crank and its counterweight.
    { type: 'circle', id: 'flywheel', part: 'crankshaft', x: 0, y: 0, r: 0.95 },
    { type: 'circle', id: 'flywheelFace', x: 0, y: 0, r: 0.93, stroke: 'none', fill: { byTheme: { blueprint: 'bgBottom', flat: { mix: ['crankshaft', 'bgTop'], by: 0.82 } } }, alpha: 'if(flat,1,0.96)' },
    { type: 'circle', id: 'crankPath', part: 'crankshaft', x: 0, y: 0, r: 0.55, fill: 'none', dash: [1.5, 2.5], alpha: 0.35 },
    { type: 'poly', id: 'web', part: 'crankshaft', points: [['0.09*cos(th)', '-0.09*sin(th)'], ['cpx+0.07*cos(th)', 'cpy-0.07*sin(th)'], ['cpx-0.07*cos(th)', 'cpy+0.07*sin(th)'], ['-0.09*cos(th)', '0.09*sin(th)']] },
    { type: 'circle', id: 'counterweight', part: 'crankshaft', x: '-cpx*0.85', y: '-cpy*0.85', r: 0.27 },
    { type: 'circle', id: 'journal', part: 'crankshaft', x: 0, y: 0, r: 0.17 },
    { type: 'circle', id: 'crankPin', part: 'crankshaft', x: 'cpx', y: 'cpy', r: 0.09 },
    // The two valves and the two cams that open them.
    ...VALVE('in'), ...VALVE('ex'),
    { type: 'line', id: 'camshaft', part: 'camshaft', x1: -0.5, y1: 'camY', x2: 0.5, y2: 'camY', dash: [1.2, 2], alpha: 0.8 },
    // The spark plug, and the spark that jumps its gap at the top of the compression stroke.
    { type: 'rect', id: 'plug', part: 'sparkPlug', x0: -0.1, y0: 'headY+0.02', x1: 0.1, y1: 'headY+0.85' },
    { type: 'rect', id: 'plugNut', part: 'sparkPlug', x0: -0.15, y0: 'headY+0.4', x1: 0.15, y1: 'headY+0.55' },
    { type: 'poly', id: 'electrode', part: 'sparkPlug', close: false, fill: 'none', points: [[0, 'headY'], [0, 'headY-0.14'], [0.13, 'headY-0.2']] },
    {
      type: 'curve', id: 'spark', part: 'spark', when: 'spark>0.05', n: 5, fill: 'none', alpha: 'spark', width: 1.3, emph: 'spark*0.7',
      x: 'if(j==0,0.13,if(j==5,-0.13,0.13-j*0.06+(rand(sb+j*2)-0.5)*0.1))',
      y: 'if(j==0||j==5,headY-0.2,headY-0.2-j*0.012+(rand(sb+j*2+1)-0.5)*0.06)',
    },
  ],
  // The four strokes, with the current one lit and explained.
  panel: {
    title: 'Four-stroke cycle', counter: 'cyc+1',
    items: [
      { title: 'Intake', text: 'The piston moves down and the intake valve opens. Fuel and air are drawn into the cylinder.', active: 'stroke==0', progress: 'sp', color: 'good' },
      { title: 'Compression', text: 'Both valves are closed. The piston rises and squeezes the mixture into a small space.', active: 'stroke==1', progress: 'sp', color: 'accent2' },
      { title: 'Power', text: 'The spark ignites the mixture. The burning gas expands and pushes the piston down.', active: 'stroke==2', progress: 'sp', color: 'hot' },
      { title: 'Exhaust', text: 'The exhaust valve opens. The piston rises and pushes the burnt gas out.', active: 'stroke==3', progress: 'sp', color: '#fb7185' },
    ],
  },
};
