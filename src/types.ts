// Copyright 2019-2024 ETH Zurich and the DaCe authors. All rights reserved.

export type SymbolMap = {
    [symbol: string]: number | undefined,
};

export enum OverlayType {
    NODE,
    EDGE,
    BOTH,
    LENSE,
};

export type InvalidSDFGError = {
    message: string | undefined,
    sdfg_id: number | undefined,
    state_id: number | undefined,
    node_id: number | undefined,
    edge_id: number | undefined,
    isedge_id: number | undefined,
};

export interface JsonSDFGElement {
    attributes?: any,
    type: string,
}

export interface JsonSDFGEdge extends JsonSDFGElement {
    dst: string,
    dst_connector: string | null,
    src: string,
    src_connector: string | null,
    height: number,
    width: number,
    x?: number,
    y?: number,
}

export interface JsonSDFGNode extends JsonSDFGElement {
    id: number,
    label: string,
    scope_entry: string | null,
    scope_exit: string | null,
}

export interface JsonSDFGBlock extends JsonSDFGElement {
    collapsed?: boolean,
    edges?: JsonSDFGEdge[],
    nodes?: (JsonSDFGBlock | JsonSDFGNode)[],
    id: number,
    label: string,
}

type CodeBlock = {
    string_data: string,
    language: string,
};

export interface JsonSDFGConditionalBlock extends JsonSDFGBlock {
    branches: ([CodeBlock | null, JsonSDFGControlFlowRegion])[];
}

export interface JsonSDFGControlFlowRegion extends JsonSDFGBlock {
    nodes: JsonSDFGBlock[],
    edges: JsonSDFGEdge[],
    start_block: number,
    cfg_list_id: number,
}

export interface JsonSDFGState extends JsonSDFGBlock {
    scope_dict: any,
    nodes: JsonSDFGNode[],
    edges: JsonSDFGEdge[],
}

export interface JsonSDFG extends JsonSDFGControlFlowRegion {
    error: InvalidSDFGError | undefined,
}

export type ModeButtons = {
    pan: HTMLElement | null,
    move: HTMLElement | null,
    select: HTMLElement | null,
    add_btns: HTMLElement[],
};

export type SDFVTooltipFunc = (container: HTMLElement) => void;

export type Point2D = {
    x: number,
    y: number,
};

export type Size2D = {
    w: number,
    h: number,
};

export type SimpleRect = Point2D & Size2D;

export interface DataSubset {
    type: string;
    ranges: {
        start: string;
        end: string;
        step: string;
        tile: string;
    }[];
}
