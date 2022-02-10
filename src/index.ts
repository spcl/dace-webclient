import { GraphElement } from './renderer/graph/graph_element';

export * from './main';
export * from './overlays/generic_sdfg_overlay';
export * from './overlays/memory_volume_overlay';
export * from './overlays/runtime_micro_seconds_overlay';
export * from './overlays/static_flops_overlay';
export * from './overlay_manager';
export * from './renderer/canvas_manager';
export * from './renderer/renderer_elements';
export * from './renderer/sdfg_renderer';
export * from './utils/bounding_box';
export * from './utils/context_menu';
export * from './utils/lerp_matrix';
export * from './utils/sanitization';
export * from './utils/sdfg/display';
export * from './utils/sdfg/json_serializer';
export * from './utils/sdfg/sdfg_parser';
export * from './utils/sdfg/sdfg_utils';
export * from './utils/sdfg/traversal';
export * from './utils/utils';

export type SymbolMap = {
    [symbol: string]: number | string | undefined,
};

export type DagreSDFG = dagre.graphlib.Graph<GraphElement>;

export type InvalidSDFGError = {
    message?: string,
    sdfg_id?: number,
    state_id?: number,
    node_id?: number,
    edge_id?: number,
    isedge_id?: number,
};

export type JsonSDFG = {
    type: string,
    start_state: number,
    sdfg_list_id: number,
    attributes: any,
    edges: any[],
    nodes: any[],
    error?: InvalidSDFGError,
    dace_version?: string,
};

export type JsonSDFGEdge = {
    attributes: any,
    dst: string,
    dst_connector: string | null,
    src: string,
    src_connector: string | null,
    type: string,
    height: number,
    width: number,
    x?: number,
    y?: number,
};

export type JsonSDFGNode = {
    attributes: any,
    id: number,
    label: string,
    scope_entry: string | null,
    scope_exit: string | null,
    type: string,
};

export type JsonSDFGState = {
    attributes: any,
    collapsed: boolean,
    edges: JsonSDFGEdge[],
    id: number,
    label: string,
    nodes: JsonSDFGNode[],
    scope_dict: any,
    type: string,
};

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

export type SimpleRect = {
    x: number,
    y: number,
    w: number,
    h: number,
};
