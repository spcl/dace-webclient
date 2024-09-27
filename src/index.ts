// Copyright 2019-2024 ETH Zurich and the DaCe authors. All rights reserved.

import { SDFGElement } from './renderer/renderer_elements';

export * from './overlays/generic_sdfg_overlay';
export * from './overlays/memory_volume_overlay';
export * from './overlays/runtime_micro_seconds_overlay';
export * from './overlays/memory_location_overlay';
export * from './overlays/operational_intensity_overlay';
export * from './overlays/simulated_operational_intensity_overlay';
export * from './overlays/static_flops_overlay';
export * from './overlays/depth_overlay';
export * from './overlays/avg_parallelism_overlay';
export * from './overlays/logical_group_overlay';
export * from './renderer/canvas_manager';
export * from './renderer/renderer_elements';
export * from './renderer/renderer';
export * from './utils/sdfg/display';
export * from './utils/sdfg/json_serializer';
export * from './utils/sdfg/sdfg_utils';
export * from './utils/sdfg/traversal';
export * from './utils/sdfv_settings';
export * from './utils/bounding_box';
export * from './utils/lerp_matrix';
export * from './utils/sanitization';
export * from './utils/utils';
export * from './overlay_manager';
export * from './sdfv';
export * from './sdfv_ui';

export type SymbolMap = {
    [symbol: string]: number | undefined,
};

export type DagreGraph = dagre.graphlib.Graph<SDFGElement>;

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
