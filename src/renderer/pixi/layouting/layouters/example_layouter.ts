import { SDFGData } from '../../../../utils/sdfg/types';
import { RendererSettings } from '../../pixi_renderer';
import { CompleteLayout } from '../layout';
import { RenderLayouter } from './layouter';

export class ExampleLayouter implements RenderLayouter {
    layout(sdfg: SDFGData, settings: RendererSettings): CompleteLayout {
        return {
            elements: [
                {
                    type: 'node',
                    zIndex: 1,
                    x: 0,
                    y: 0,
                    width: 200,
                    height: 40,
                    caption: 'heyo',
                    shape: 'octagon',
                    stroke: 'normal',
                    backgroundTemperature: settings.runtimeMap ? 0.2 : undefined,
                },
                {
                    type: 'node',
                    zIndex: 1,
                    x: 0,
                    y: 50,
                    width: 200,
                    height: 40,
                    caption: 'hexaheyo',
                    shape: 'upperHexagon',
                    stroke: 'double',
                    backgroundTemperature: settings.runtimeMap ? 0 : undefined,
                },
                {
                    type: 'node',
                    zIndex: 1,
                    x: 0,
                    y: 100,
                    width: 200,
                    height: 40,
                    caption: 'hexalower',
                    shape: 'lowerHexagon',
                    stroke: 'normal',
                },
                {
                    type: 'node',
                    zIndex: 1,
                    x: 0,
                    y: 150,
                    width: 200,
                    height: 40,
                    caption: 'ellipse (thick)',
                    shape: 'ellipse',
                    stroke: 'bold',
                    backgroundTemperature: settings.runtimeMap ? 1.0 : undefined,
                },
                {
                    type: 'state',
                    zIndex: 0,
                    x: -25,
                    y: -50,
                    width: 525,
                    height: 550,
                    caption: 'scopebig',
                    isCollapsed: false,
                },
                {
                    type: 'edge',
                    zIndex: 1.2,
                    points: [[0, 225], [200, 225]],
                    lineStyle: 'solid',
                    interstateColor: false,
                },
                {
                    type: 'edge',
                    zIndex: 1.2,
                    points: [[0, 275], [100, 225], [200, 275]],
                    lineStyle: 'solid',
                    interstateColor: true,
                    shadeTemperature: settings.memoryVolumeOverlay ? 0.45 : undefined,
                    tooltip: {
                        html: 'Interstate',
                        style: 'interstate',
                    },
                },
                {
                    type: 'edge',
                    zIndex: 1.2,
                    points: [[0, 325], [67, 275], [133, 375], [200, 325]],
                    lineStyle: 'dotted',
                    interstateColor: false,
                    shadeTemperature: settings.memoryVolumeOverlay ? 0.9 : undefined,
                    tooltip: {
                        html: 'This is an edge!',
                        style: 'normal',
                    },
                },
                {
                    type: 'connector',
                    zIndex: 1.1,
                    x: 0,
                    y: 225,
                    radius: 5,
                    scopedColor: false,
                    tooltip: {
                        html: 'Connector!',
                        style: 'connector',
                    },
                },
                {
                    type: 'connector',
                    zIndex: 1.1,
                    x: 200,
                    y: 225,
                    radius: 5,
                    scopedColor: false,
                },
                {
                    type: 'connector',
                    zIndex: 1.1,
                    x: 0,
                    y: 275,
                    radius: 5,
                    scopedColor: true,
                },
                {
                    type: 'connector',
                    zIndex: 1.1,
                    x: 200,
                    y: 275,
                    radius: 5,
                    scopedColor: true,
                },
                {
                    type: 'connector',
                    zIndex: 1.1,
                    x: 0,
                    y: 325,
                    radius: 5,
                    scopedColor: true,
                },
                {
                    type: 'connector',
                    zIndex: 1.1,
                    x: 200,
                    y: 325,
                    radius: 5,
                    scopedColor: false,
                },
            ],
        };
    }

}
