import { RenderGraph } from '../../../layouting/layoutLib';
import { SDFGData } from '../../../utils/sdfg/types';
import { SDFGElement } from '../../renderer_elements';

export type CompleteLayout = Readonly<{
    /**
     * List of all layout elements.
     */
    elements: readonly LayoutElement[],
    /**
     * Reference to an optional SDFG graph.
     */
    graph?: RenderGraph | undefined,
}>;

export type LayoutElement = StateLayoutElement | NodeLayoutElement | EdgeLayoutElement | ConnectorLayoutElement;



type BaseLayoutElement = {
    type: string,
    zIndex: number,
    tooltip?: {
        html: string,
        style: 'normal' | 'interstate' | 'connector',
    } | undefined,
    sdfgData?: any | undefined,
    renderData?: SDFGElement | undefined,
    highlightingGroup?: unknown,
};

type BoxedLayoutElement = BaseLayoutElement & {
    /**
     * x coordinate of the left side
     */
    x: number,
    /**
     * y coordinate of the top side
     */
    y: number,
    width: number,
    height: number,
};

export type StateLayoutElement = BoxedLayoutElement & {
    type: 'state',
    caption: string,
    isCollapsed: boolean,
};

export type NodeLayoutElement = BoxedLayoutElement & {
    type: 'node',
    caption: string,
    farCaption?: string | undefined,
    stroke: 'normal' | 'bold' | 'double',
    shape: 'ellipse' | 'octagon' | 'upperHexagon' | 'lowerHexagon' | 'hexagon' | 'triangle' | 'rectangle',
    backgroundTemperature?: number | undefined,
}

export type ConnectorLayoutElement = BaseLayoutElement & {
    type: 'connector',
    /**
     * x coordinate of the center
     */
    x: number,
    /**
     * y coordinate of the center
     */
    y: number,
    radius: number,
    scopedColor: boolean,
}

type EdgePoint = [number, number];

export type EdgeLayoutElement = BaseLayoutElement & {
    type: 'edge',
    /**
     * First element is the start, last element is the destination. There can be more optional control points
     * inbetween, which will be used to draw a piecewise interpolated quadratic or cubic Bezier
     */
    points: [EdgePoint, EdgePoint, ...EdgePoint[]],
    lineStyle: 'solid' | 'dotted',
    interstateColor: boolean,
    shadeTemperature?: number | undefined,
}

export type SDFGLayouter = {
    (sdfg: SDFGData): CompleteLayout
};
