import { SDFGData } from '../../../../utils/sdfg/types';
import { CompleteLayout, LayoutElement } from '../layout';
import { RenderLayouter } from './layouter';

export class DummyLayouter implements RenderLayouter {
    layout(sdfg: SDFGData): CompleteLayout {
        const els: LayoutElement[] = [];
        let nextEl = 0;

        for (const state of sdfg.nodes) {
            const scopeBegin = nextEl;
            nextEl += 0.25;
            for (const n of (state as any).nodes) {
                els.push({
                    type: 'node',
                    zIndex: 1,
                    caption: n.label,
                    x: 500 * Math.random() + 20,
                    y: nextEl++ * 50,
                    width: 400,
                    height: 40,
                    shape: n.type.includes('Entry') ? 'upperHexagon'
                        : n.type.includes('Exit') ? 'lowerHexagon'
                            : n.type === 'AccessNode' ? 'ellipse' : 'octagon',
                    stroke: 'normal',
                });
            }
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            for (const edge of (state as any).edges) {
                const points = [[Math.random() * 1000, Math.random() * (nextEl - scopeBegin) * 50 + scopeBegin * 50], [Math.random() * 1000, Math.random() * (nextEl - scopeBegin) * 50 + scopeBegin * 50]];
                for (let i = 0; i < Math.random() * 2; i++) {
                    points.push([Math.random() * 1000, Math.random() * (nextEl - scopeBegin) * 50 + scopeBegin * 50]);
                }
                els.push({
                    type: 'edge',
                    zIndex: 2,
                    points: points as any,
                    lineStyle: Math.random() < 0.5 ? 'solid' : 'dotted',
                    interstateColor: Math.random() < 0.5,
                });
            }
            els.push({
                type: 'state',
                zIndex: 0,
                x: 0,
                width: 1000,
                y: scopeBegin * 50,
                height: (nextEl++ - scopeBegin) * 50,
                caption: state.label,
                isCollapsed: false,
            });
        }

        return {
            elements: els
        };
    }
}
