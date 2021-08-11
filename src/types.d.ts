// Copyright 2019-2021 ETH Zurich and the DaCe authors. All rights reserved.

import { SDFGRenderer } from './renderer/renderer';
import { SDFGElement } from './renderer/renderer_elements';

export type SymbolMap = {
    [symbol: string]: number | undefined,
};

export type DagreSDFG = dagre.graphlib.Graph<SDFGElement>;

export type InvalidSDFGError = {
    message: string | undefined,
    sdfg_id: number | undefined,
    state_id: number | undefined,
    node_id: number | undefined,
    edge_id: number | undefined,
    isedge_id: number | undefined,
};

export type JsonSDFG = {
    type: string,
    start_state: number,
    sdfg_list_id: number,
    attributes: any,
    edges: any[],
    nodes: any[],
    error: InvalidSDFGError | undefined,
};

export type ModeButtons = {
    [name: string]: HTMLElement | null,
    add_btns: HTMLElement[],
};

export type SDFVTooltipFunc = (container: HTMLElement) => void;

export type Point2D = {
    x: number,
    y: number,
};

export type SimpleRect = {
    x: number,
    y: number,
    w: number,
    h: number,
};
