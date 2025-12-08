// Copyright 2019-2025 ETH Zurich and the DaCe authors. All rights reserved.

export type SymbolMap = Record<string, number | undefined>;

export enum OverlayType {
    NODE,
    EDGE,
    BOTH,
    LENSE,
};

export interface InvalidSDFGError {
    message?: string;
    sdfg_id?: number;
    state_id?: number;
    node_id?: number;
    edge_id?: number;
    isedge_id?: number;
};

export interface JsonSDFGDataDesc extends Record<string, unknown> {
    type?: string;
    attributes?: Record<string, unknown> & {
        dtype?: string;
        name?: string;
        shape?: string[];
        strides?: string[];
        offset?: string;
        total_size?: number;
        storage?: string;
        transient?: boolean;
        members?: [string, JsonSDFGDataDesc][];
    };
}

export interface JsonSDFGSerializedAtom extends Record<string, unknown> {
    type?: string;
}

export interface SDFGRange extends JsonSDFGSerializedAtom {
    start: string;
    end: string;
    step: string;
    tile: string;
}

export interface DataSubset extends JsonSDFGSerializedAtom {
    type: string;
    ranges?: SDFGRange[];
    indices?: SDFGRange[];
    subset_list?: DataSubset[];
}

export interface JsonSDFGMemletAttributes {
    data?: string;
    subset?: DataSubset;
    other_subset?: DataSubset;
    is_data_src?: boolean;
    wcr?: string;
    volume?: string;
    num_accesses?: number;
    dynamic?: boolean;
    shortcut?: unknown;
}

export interface JsonSDFGElement extends JsonSDFGSerializedAtom {
    id?: number | string;
    attributes?: Record<string, unknown>;
    type: string,
}

interface JsonSDFGEdgeData {
    type?: string;
    attributes?: Record<string, unknown>;
}

export interface JsonSDFGEdge extends JsonSDFGElement {
    attributes?: {
        data?: JsonSDFGEdgeData & Record<string, unknown>,
    } & Record<string, unknown>;
    dst: string;
    dst_connector?: string;
    src: string;
    src_connector?: string;
    height: number;
    width: number;
    x?: number;
    y?: number;
}

export interface JsonSDFGMultiConnectorEdge extends JsonSDFGEdge {
    attributes?: {
        data?: JsonSDFGEdgeData & {
            edge?: unknown,
            volume?: number,
            attributes?: JsonSDFGMemletAttributes,
        } & Record<string, unknown>,
    };
}

export interface JsonSDFGNodeAttributes extends Record<string, unknown> {
    is_collapsed?: boolean,
    data?: string;
    sdfg?: JsonSDFG;
    ext_sdfg_path?: string;
    layout?: Record<string, unknown>;
}

export interface JsonSDFGNode extends JsonSDFGElement {
    attributes?: JsonSDFGNodeAttributes;
    id: number;
    label: string;
    scope_entry?: string;
    scope_exit?: string;
}

export interface JsonSDFGBlock extends JsonSDFGElement {
    attributes?: Record<string, unknown> & {
        is_collapsed?: boolean,
    };
    edges?: JsonSDFGEdge[],
    nodes?: (JsonSDFGBlock | JsonSDFGNode)[],
    id: number,
    label: string,
}

export interface JsonSDFGCodeBlock {
    string_data?: string | null;
    language?: string;
};

export interface JsonSDFGSymExpr {
    approx?: string;
    main?: string;
}

export interface JsonSDFGTypeclass extends JsonSDFGSerializedAtom {
    arguments?: unknown[];
    dtype?: string | JsonSDFGTypeclass;
    returntype?: string | JsonSDFGTypeclass;
    elements?: string;
    name?: string;
}

export interface JsonSDFGConditionalBlock extends JsonSDFGBlock {
    branches: ([JsonSDFGCodeBlock | null, JsonSDFGControlFlowRegion])[];
}

export interface JsonSDFGControlFlowRegion extends JsonSDFGBlock {
    nodes: JsonSDFGBlock[],
    edges: JsonSDFGEdge[],
    start_block: number,
    cfg_list_id: number,
}

export interface JsonSDFGState extends JsonSDFGBlock {
    scope_dict?: Record<string, number[] | undefined>,
    nodes: JsonSDFGNode[],
    edges: JsonSDFGMultiConnectorEdge[],
}

export interface JsonSDFGAttributes extends Record<string, unknown> {
    name?: string;
    _arrays: Record<string, JsonSDFGDataDesc>,
    constants_prop?: Record<string, [JsonSDFGDataDesc, (number | string)]>,
    symbols: Record<string, JsonSDFGSymExpr>,
}

export interface JsonSDFG extends JsonSDFGControlFlowRegion {
    attributes?: JsonSDFGAttributes;
    dace_version?: string;
    error: InvalidSDFGError | undefined;
}

export interface JsonSDFGLogicalGroup extends JsonSDFGSerializedAtom {
    name?: string;
    color?: string;
}

export interface ModeButtons {
    pan?: JQuery<HTMLButtonElement>;
    move?: JQuery<HTMLButtonElement>;
    select?: JQuery<HTMLButtonElement>;
    addBtns: JQuery<HTMLButtonElement>[];
};

export type SDFVTooltipFunc = (container: HTMLElement) => void;

export interface Point2D {
    x: number;
    y: number;
}

export interface Size2D {
    w: number;
    h: number;
}

export type SimpleRect = Point2D & Size2D;

export type SDFGElementGroup = (
    'states' | 'nodes' | 'edges' | 'interstateEdges' | 'connectors' |
    'controlFlowRegions' | 'controlFlowBlocks'
);

export interface SDFGElementInfo {
    sdfg: JsonSDFG,
    id: number,
    cfgId: number,
    stateId: number,
    connector?: number,
    conntype?: string,
}
