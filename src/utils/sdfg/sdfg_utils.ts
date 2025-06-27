// Copyright 2019-2025 ETH Zurich and the DaCe authors. All rights reserved.

import {
    ControlFlowRegion,
    Edge,
    SDFGElement,
    SDFGElementType,
    SDFGNode,
    State,
} from '../../renderer/sdfg/sdfg_elements';
import type {
    CFGListType,
} from '../../renderer/sdfg/sdfg_renderer';
import {
    JsonSDFGBlock,
    JsonSDFGConditionalBlock,
    JsonSDFGControlFlowRegion,
    JsonSDFGEdge,
    JsonSDFGNode,
    JsonSDFGState,
    Point2D,
} from '../../types';


/**
 * Given a scope entry node, finds and returns the corresponding exit node.
 * @param nodes     State nodes in which the scope node is contained.
 * @param entryNode Scope entry node.
 * @returns         Exit node corresponding to `entryNode`.
 */
export function findExitForEntry(
    nodes: JsonSDFGNode[], entryNode: JsonSDFGNode
): JsonSDFGNode | undefined {
    for (const n of nodes) {
        if (n.type.endsWith('Exit') && n.scope_entry &&
            parseInt(n.scope_entry) === entryNode.id)
            return n;
    }
    console.warn('Did not find corresponding exit');
    return undefined;
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
export function getGraphElementUUID(element?: SDFGElement): string {
    const undefinedVal = '-1';
    let cfgId = undefinedVal;
    if (element instanceof ControlFlowRegion)
        cfgId = element.jsonData?.cfg_list_id.toString() ?? undefinedVal;
    else
        cfgId = element?.cfg?.cfg_list_id.toString() ?? undefinedVal;
    if (element instanceof State) {
        return (
            cfgId + '/' +
            element.id.toString() + '/' +
            undefinedVal + '/' +
            undefinedVal
        );
    } else if (element instanceof SDFGNode) {
        return (
            cfgId + '/' +
            (element.parentStateId?.toString() ?? undefinedVal) + '/' +
            element.id.toString() + '/' +
            undefinedVal
        );
    } else if (element instanceof Edge) {
        let parentId = undefinedVal;
        if (element.parentStateId !== undefined)
            parentId = element.parentStateId.toString();
        return (
            cfgId + '/' +
            parentId + '/' +
            undefinedVal + '/' +
            element.id.toString()
        );
    }
    return cfgId + '/' + undefinedVal + '/' + undefinedVal + '/' + undefinedVal;
}


export function checkAndRedirectEdge<T extends JsonSDFGEdge>(
    edge: T, drawnNodes: Set<string>, sdfgState: JsonSDFGState
): T | undefined {
    // If destination is not drawn, no need to draw the edge
    if (!drawnNodes.has(edge.dst))
        return undefined;
    // If both source and destination are in the graph, draw edge as-is
    if (drawnNodes.has(edge.src))
        return edge;

    // If immediate scope parent node is in the graph, redirect
    const scopeSrc = sdfgState.nodes[parseInt(edge.src)].scope_entry;
    if (!scopeSrc || !drawnNodes.has(scopeSrc))
        return undefined;

    // Clone edge for redirection, change source to parent
    const newEdge = Object.assign({}, edge);
    newEdge.src = scopeSrc;

    return newEdge;
}

export function findGraphElementByUUID(
    cfgList: CFGListType, uuid: string
): SDFGElement | undefined {
    const uuidParts = uuid.split('/');

    const cfgId = uuidParts[0];
    const stateId = uuidParts[1];
    const nodeId = uuidParts[2];
    const edgeId = uuidParts[3];

    if (!(cfgId in cfgList))
        return undefined;

    const cfgListItem = cfgList[cfgId];
    const graph = cfgListItem.graph;
    if (graph) {
        let state = null;
        if (stateId !== '-1')
            state = graph.node(stateId);

        let element = null;
        if (nodeId !== '-1' && state?.graph) {
            // Dataflow graph node.
            element = state.graph.node(nodeId);
        } else if (edgeId !== '-1' && state?.graph) {
            // Memlet.
            element = state.graph.edge(edgeId);
        } else if (edgeId !== '-1' && state === null) {
            element = graph.edge(edgeId);
        }

        if (element)
            return element;
        if (state)
            return state;
    }

    return cfgListItem.nsdfgNode;
}

interface IElemPosition {
    points: Point2D[];
    dx?: number;
    dy?: number;
    scopeDx?: number;
    scopeDy?: number;
}

/**
 * Initializes positioning information on the given element.
 *
 * @param elem The element to be initialized
 * @returns    Initially created positioning information
 */
export function initializePositioningInfo(elem: SDFGElement): IElemPosition {
    const position: IElemPosition = {
        points: [],
        dx: 0,
        dy: 0,
        scopeDx: 0,
        scopeDy: 0,
    };
    if (elem instanceof Edge) {
        for (const _ignored of elem.points)
            position.points.push({ x: 0, y: 0 });
    }

    setPositioningInfo(elem, position);

    return position;
}

/**
 * Sets the positioning information on a given element. Replaces old
 * positioning information.
 *
 * @param elem     The element that receives new positioning info
 * @param position The positioning information
 */
export function setPositioningInfo(
    elem: SDFGElement, position: IElemPosition
): void {
    const attr = elem.attributes();
    if (attr)
        attr.position = position;
}

/**
 * Finds the positioning information of the given element
 *
 * @param elem The element that contains the information
 * @returns    Position information, undefined if not present
 */
export function getPositioningInfo(
    elem: SDFGElement
): IElemPosition | undefined {
    return elem.attributes()?.position as IElemPosition | undefined;
}

/**
 * Deletes the positioning information of the given element
 *
 * @param elem The element that contains the information
 */
export function deletePositioningInfo(elem: SDFGElement): void {
    delete elem.attributes()?.position;
}

/**
 * Find the root CFG or SDFG for a given CFG tree.
 * @param cfgs      List of all control flow graph ids.
 * @param cfgTree   Control flow graph tree.
 * @param cfgList   Control flow graph list.
 * @param sdfgsOnly Whether or not to only look for SDFGs.
 * @returns         The root CFG or SDFG ID or null if not found.
 */
export function findRootCFG(
    cfgs: Iterable<number>, cfgTree: Record<number, number>,
    cfgList: CFGListType,
    sdfgsOnly: boolean = false
): number | null {
    const makeCFGPath = (cfg: number, path: number[]) => {
        path.push(cfg);
        if (cfg in cfgTree)
            makeCFGPath(cfgTree[cfg], path);
    };

    let commonCFGs: number[] | null = null;
    for (const sid of cfgs) {
        const path: number[] = [];
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
        for (const cfgId of commonCFGs) {
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
    deleteOthers = false
): void {
    const block = cfg.nodes[stateId];
    if (block.type !== SDFGElementType.SDFGState.toString()) {
        console.warn(
            'Trying to delete an SDFG node, but parent element',
            block, 'is not of type SDFGState'
        );
        return;
    }

    const state: JsonSDFGState = block as JsonSDFGState;
    nodeIds.sort((a, b) => (a - b));
    const mapping: Record<string, string> = { '-1': '-1' };
    state.nodes.forEach((n: JsonSDFGNode) => mapping[n.id] = '-1');
    let predicate: (ind: number) => boolean;
    if (deleteOthers)
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
    state.edges.forEach(e => {
        e.src = mapping[e.src];
        e.dst = mapping[e.dst];
    });

    // Remap scope dictionaries.
    state.nodes.forEach(n => {
        if (n.scope_entry !== undefined)
            n.scope_entry = mapping[n.scope_entry];
        if (n.scope_exit !== undefined)
            n.scope_exit = mapping[n.scope_exit];
    });
    const newScopeDict: Record<string, number[]> = {};
    for (const sdkey of Object.keys(state.scope_dict ?? {})) {
        const oldScope = state.scope_dict?.[sdkey] ?? [];
        const newScope = oldScope.filter(
            v => mapping[v.toString()] !== '-1'
        ).map(v => parseInt(mapping[v.toString()]));
        if ((sdkey === '-1') || (sdkey in mapping && mapping[sdkey] !== '-1'))
            newScopeDict[mapping[sdkey]] = newScope;
    }
    state.scope_dict = newScopeDict;
}

export function deleteCFGBlocks(
    cfg: JsonSDFGControlFlowRegion, blockIds: number[],
    deleteOthers: boolean = false
): void {
    blockIds.sort((a, b) => (a - b));
    let predicate: (ind: number) => boolean;
    if (deleteOthers)
        predicate = (ind: number) => blockIds.includes(ind);
    else
        predicate = (ind: number) => !blockIds.includes(ind);

    cfg.nodes = cfg.nodes.filter((_v, ind: number) => predicate(ind));
    cfg.edges = cfg.edges.filter((e: JsonSDFGEdge) => (
        predicate(parseInt(e.src)) && predicate(parseInt(e.dst))
    ));

    // Remap node and edge indices.
    const mapping: Record<string, string> = {};
    cfg.nodes.forEach((n: JsonSDFGBlock, index: number) => {
        mapping[n.id] = index.toString();
        n.id = index;
    });
    cfg.edges.forEach((e: JsonSDFGEdge) => {
        e.src = mapping[e.src];
        e.dst = mapping[e.dst];
    });
    if (mapping[cfg.start_block] === '-1')
        cfg.start_block = 0;
    else
        cfg.start_block = parseInt(mapping[cfg.start_block]);
}

/**
 * Recursively set the collapsed state of SDFG elements.
 * @param cfg           Control flow graph in which to set the collapsed state.
 * @param collapseState Collapsed state to set.
 */
export function setCollapseStateRecursive(
    cfg: JsonSDFGBlock, collapseState: boolean
): void {
    if (Object.hasOwn(cfg, 'branches')) {
        for (const branch of (cfg as JsonSDFGConditionalBlock).branches) {
            if (branch[1].attributes)
                branch[1].attributes.is_collapsed = collapseState;
            setCollapseStateRecursive(branch[1], collapseState);
        }
    } else if (cfg.type === 'SDFGState') {
        for (const node of (cfg as JsonSDFGState).nodes) {
            if (node.type === 'NestedSDFG') {
                if (node.attributes)
                    node.attributes.is_collapsed = collapseState;
                if (node.attributes?.sdfg) {
                    setCollapseStateRecursive(
                        node.attributes.sdfg, collapseState
                    );
                }
            } else if (node.type.endsWith('Entry')) {
                if (node.attributes)
                    node.attributes.is_collapsed = collapseState;
            }
        }
    } else if (Object.hasOwn(cfg, 'nodes')) {
        for (const node of (cfg as JsonSDFGControlFlowRegion).nodes) {
            if (node.attributes)
                node.attributes.is_collapsed = collapseState;
            setCollapseStateRecursive(node, collapseState);
        }
    }
}
