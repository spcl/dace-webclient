// Copyright 2019-2024 ETH Zurich and the DaCe authors. All rights reserved.

import {
    CFGListType,
    DagreGraph,
    JsonSDFGBlock,
    JsonSDFGControlFlowRegion,
    JsonSDFGEdge,
    JsonSDFGNode,
    JsonSDFGState,
} from '../../index';
import {
    ControlFlowRegion,
    Edge,
    SDFGElement,
    SDFGElementType,
    SDFGNode,
    State,
} from '../../renderer/renderer_elements';

export function findExitForEntry(
    nodes: JsonSDFGNode[], entryNode: JsonSDFGNode
): JsonSDFGNode | null {
    for (const n of nodes) {
        if (n.type.endsWith('Exit') && n.scope_entry &&
            parseInt(n.scope_entry) === entryNode.id)
            return n;
    }
    console.warn('Did not find corresponding exit');
    return null;
}

/**
 * Return the string UUID for an SDFG graph element.
 *
 * UUIDs have the form of "G/S/N/E", where:
 * G = Graph list id
 * S = State ID (-1 for (nested) SDFGs)
 * N = SDFGNode ID (-1 for States, SDFGs, and Edges)
 * E = Edge ID (-1 for States, SDFGs, and Nodes)
 *
 * @param {*} element   Element to generate the UUID for.
 *
 * @returns             String containing the UUID
 */
export function getGraphElementUUID(element: SDFGElement | null): string {
    const undefined_val = -1;
    const cfgId = (
        element instanceof ControlFlowRegion ?
            element.data.block.cfg_list_id :
            element?.cfg?.cfg_list_id
    ) ?? undefined_val;
    if (element instanceof State) {
        return (
            cfgId + '/' +
            element.id + '/' +
            undefined_val + '/' +
            undefined_val
        );
    } else if (element instanceof SDFGNode) {
        return (
            cfgId + '/' +
            element.parent_id + '/' +
            element.id + '/' +
            undefined_val
        );
    } else if (element instanceof Edge) {
        let parent_id = undefined_val;
        if (element.parent_id !== null && element.parent_id !== undefined)
            parent_id = element.parent_id;
        return (
            cfgId + '/' +
            parent_id + '/' +
            undefined_val + '/' +
            element.id
        );
    }
    return (
        cfgId + '/' +
        undefined_val + '/' +
        undefined_val + '/' +
        undefined_val
    );
}


export function check_and_redirect_edge(
    edge: JsonSDFGEdge, drawn_nodes: Set<string>, sdfg_state: JsonSDFGState
): JsonSDFGEdge | null {
    // If destination is not drawn, no need to draw the edge
    if (!drawn_nodes.has(edge.dst))
        return null;
    // If both source and destination are in the graph, draw edge as-is
    if (drawn_nodes.has(edge.src))
        return edge;

    // If immediate scope parent node is in the graph, redirect
    const scope_src = sdfg_state.nodes[parseInt(edge.src)].scope_entry;
    if (!scope_src || !drawn_nodes.has(scope_src))
        return null;

    // Clone edge for redirection, change source to parent
    const new_edge = Object.assign({}, edge);
    new_edge.src = scope_src;

    return new_edge;
}

export function findGraphElementByUUID(
    cfgList: CFGListType, cfgTree: { [key: number]: number },  uuid: string
): SDFGElement | null {
    const uuidParts = uuid.split('/');

    const cfgId = uuidParts[0];
    const stateId = uuidParts[1];
    const nodeId = uuidParts[2];
    const edgeId = uuidParts[3];

    if (!(cfgId in cfgList))
        return null;

    const graph = cfgList[cfgId].graph;
    if (graph === null)
        return null;

    let state = null;
    if (stateId !== '-1')
        state = graph.node(stateId);

    let element = null;
    if (nodeId !== '-1' && state !== null && state.data.graph !== null)
        element = state.data.graph.node(nodeId); // SDFG Dataflow graph node
    else if (edgeId !== '-1' && state !== null && state.data.graph !== null)
        element = state.data.graph.edge(edgeId); // Memlet
    else if (edgeId !== '-1' && state === null)
        element = graph.edge(edgeId as any); // Interstate edge

    if (element)
        return element;
    if (state)
        return state;

    const parentCfgId = cfgTree[Number(cfgId)];
    if (parentCfgId === undefined || parentCfgId === null)
        return null;
    const parentCfg = cfgList[parentCfgId].graph;
    if (!parentCfg)
        return null;
    return parentCfg.node(cfgList[cfgId].jsonObj.id.toString()) ?? null;
}

/**
 * Initializes positioning information on the given element.
 *
 * @param {SDFGElement} elem    The element to be initialized
 * @returns                     Initially created positioning information
 */
export function initialize_positioning_info(elem: any): any {
    let position;
    if (elem instanceof Edge || elem.type === 'MultiConnectorEdge') {
        let points = undefined;
        if (elem.points)
            points = Array(elem.points.length);

        position = {
            points: points ? points : [],
            scope_dx: 0,
            scope_dy: 0,
        };

        for (let i = 0; elem.points && i < elem.points.length; i++)
            position.points[i] = { dx: 0, dy: 0 };
    } else {
        position = { dx: 0, dy: 0, scope_dx: 0, scope_dy: 0 };
    }

    setPositioningInfo(elem, position);

    return position;
}

/**
 * Sets the positioning information on a given element. Replaces old
 * positioning information.
 *
 * @param {SDFGElement} elem    The element that receives new positioning info
 * @param {*} position          The positioning information
 */
export function setPositioningInfo(
    elem: any, position: any
): void {
    let attr = elem?.attributes() ?? elem?.attributes?.data?.attributes;
    if (!attr)
        attr = elem?.attributes;
    if (attr)
        attr.position = position;
}

/**
 * Finds the positioning information of the given element
 *
 * @param {SDFGElement} elem    The element that contains the information
 * @returns                     Position information, undefined if not present
 */
export function getPositioningInfo(elem: any): any {
    let attr = elem?.attributes() ?? elem?.attributes?.data?.attributes;
    if (!attr)
        attr = elem?.attributes;
    return attr?.position;
}

/**
 * Deletes the positioning information of the given element
 *
 * @param {SDFGElement} elem    The element that contains the information
 */
export function deletePositioningInfo(elem: any): void {
    let attr = elem?.attributes() ?? elem?.attributes?.data?.attributes;
    if (!attr)
        attr = elem?.attributes;
    if (attr)
        delete attr.position;
}


export function findRootCFG(
    cfgs: Iterable<number>, cfgTree: { [key: number]: number },
    cfgList: CFGListType,
    sdfgsOnly: boolean = false
): number | null {
    const makeCFGPath = (cfg: number, path: Array<number>) => {
        path.push(cfg);
        if (cfg in cfgTree)
            makeCFGPath(cfgTree[cfg], path);
    };

    let commonCFGs: Array<number> | null = null;
    for (const sid of cfgs) {
        const path: Array<number> = [];
        makeCFGPath(sid, path);

        if (commonCFGs === null) {
            commonCFGs = path;
        } else {
            commonCFGs = [...commonCFGs].filter(
                (x: number) => path.includes(x)
            );
        }
    }

    // Return the first one (greatest common denominator).
    // If only looking for SDFGs, only return the first one that is of type
    // SDFG.
    if (commonCFGs && commonCFGs.length > 0) {
        for (let i = 0; i < commonCFGs.length; i++) {
            const cfgId = commonCFGs[i];
            const cfg = cfgList[cfgId].jsonObj;
            if (sdfgsOnly) {
                if (cfg.type === 'SDFG')
                    return cfgId;
            } else {
                return cfgId;
            }
        }
    }

    // No root SDFG found.
    return null;
}

// In-place delete of SDFG state nodes.
export function deleteSDFGNodes(
    cfg: JsonSDFGControlFlowRegion, stateId: number, nodeIds: number[],
    delete_others = false
): void {
    const block = cfg.nodes[stateId];
    if (block.type !== SDFGElementType.SDFGState) {
        console.warn(
            'Trying to delete an SDFG node, but parent element',
            block, 'is not of type SDFGState'
        );
        return;
    }

    const state: JsonSDFGState = block as JsonSDFGState;
    nodeIds.sort((a, b) => (a - b));
    const mapping: { [key: string]: string } = { '-1': '-1' };
    state.nodes.forEach((n: JsonSDFGNode) => mapping[n.id] = '-1');
    let predicate: CallableFunction;
    if (delete_others)
        predicate = (ind: number) => nodeIds.includes(ind);
    else
        predicate = (ind: number) => !nodeIds.includes(ind);

    state.nodes = state.nodes.filter((_v, ind: number) => predicate(ind));
    state.edges = state.edges.filter((e: JsonSDFGEdge) => (
        predicate(parseInt(e.src)) && predicate(parseInt(e.dst))
    ));

    // Remap node and edge indices.
    state.nodes.forEach((n: JsonSDFGNode, index: number) => {
        mapping[n.id] = index.toString();
        n.id = index;
    });
    state.edges.forEach((e: JsonSDFGEdge) => {
        e.src = mapping[e.src];
        e.dst = mapping[e.dst];
    });

    // Remap scope dictionaries.
    state.nodes.forEach((n: JsonSDFGNode) => {
        if (n.scope_entry !== null)
            n.scope_entry = mapping[n.scope_entry];
        if (n.scope_exit !== null)
            n.scope_exit = mapping[n.scope_exit];
    });
    const new_scope_dict: any = {};
    for (const sdkey of Object.keys(state.scope_dict)) {
        const old_scope = state.scope_dict[sdkey];
        const new_scope = old_scope.filter((v: any) => mapping[v] !== '-1').map(
            (v: any) => mapping[v]
        );
        if ((sdkey === '-1') || (sdkey in mapping && mapping[sdkey] !== '-1'))
            new_scope_dict[mapping[sdkey]] = new_scope;
    }
    state.scope_dict = new_scope_dict;
}

export function deleteCFGBlocks(
    cfg: JsonSDFGControlFlowRegion, blockIds: number[],
    deleteOthers: boolean = false
): void {
    blockIds.sort((a, b) => (a - b));
    let predicate: CallableFunction;
    if (deleteOthers)
        predicate = (ind: number) => blockIds.includes(ind);
    else
        predicate = (ind: number) => !blockIds.includes(ind);

    cfg.nodes = cfg.nodes.filter((_v, ind: number) => predicate(ind));
    cfg.edges = cfg.edges.filter((e: JsonSDFGEdge) => (
        predicate(parseInt(e.src)) && predicate(parseInt(e.dst))
    ));

    // Remap node and edge indices.
    const mapping: { [key: string]: string } = {};
    cfg.nodes.forEach((n: JsonSDFGBlock, index: number) => {
        mapping[n.id] = index.toString();
        n.id = index;
    });
    cfg.edges.forEach((e: JsonSDFGEdge) => {
        e.src = mapping[e.src];
        e.dst = mapping[e.dst];
    });
    if (mapping[cfg.start_block] === '-1' ||
        mapping[cfg.start_block] === undefined)
        cfg.start_block = 0;
    else
        cfg.start_block = parseInt(mapping[cfg.start_block]);
}
