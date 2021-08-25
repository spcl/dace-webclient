export type SDFGData = {
    type: 'SDFG',
    nodes: SDFGNode[],
    // eslint-disable-next-line camelcase
    sdfg_list_id: number,
    [K: number]: any
};

export type SDFGNode = SDFGBaseNode<string>;

type SDFGBaseNode<T extends string> = {
    type: T,
    label: string,
    attributes: SDFGAttributes,
    nodes?: SDFGNode[] | undefined,
    edges?: any[] | undefined,
    id: number,
};

export type SDFGAttributes = {
    label: string,
    // eslint-disable-next-line camelcase
    is_collapsed?: boolean | undefined,
    sdfg: SDFGData,
    layout?: {
        x: number,
        y: number,
        width: number,
        height: number,
    }
}

export type SDFGStateNode = SDFGBaseNode<'SDFGStateNode'> & {
    attributes: any,
    nodes: SDFGNode[],
    edges: any[],
};
