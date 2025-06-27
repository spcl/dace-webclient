// Copyright 2019-2025 ETH Zurich and the DaCe authors. All rights reserved.

import {
    ConditionalBlock,
    Connector,
    ControlFlowBlock,
    ControlFlowRegion,
    InterstateEdge,
    SDFGElement,
    SDFGElementType,
    State,
} from '../../renderer/sdfg/sdfg_elements';
import { DagreGraph } from '../../renderer/sdfg/sdfg_renderer';
import {
    JsonSDFG,
    JsonSDFGBlock,
    JsonSDFGConditionalBlock,
    JsonSDFGControlFlowRegion,
    JsonSDFGEdge,
    JsonSDFGElement,
    JsonSDFGNode,
    JsonSDFGState,
    SDFGElementGroup,
    SDFGElementInfo,
} from '../../types';

/**
 * Receives a callback that accepts (node, parent graph) and returns a value.
 * This function is invoked recursively per scope (including scope nodes),
 * unless the return value is false, upon which the sub-scope will not be
 * visited. The function also accepts an optional post-subscope callback (same
 * signature as `func`).
 **/
export function traverseSDFGScopes(
    sdfg: DagreGraph, func: (gNode: SDFGElement, g: DagreGraph) => boolean,
    postSubscopeFunc?: (gNode: SDFGElement, g: DagreGraph) => void
): void {
    function scopesRecursive(
        graph: DagreGraph, nodes: (number | string)[],
        processedNodes?: Set<string>
    ): void {
        processedNodes ??= new Set();

        for (const nodeid of nodes) {
            const node = graph.node(nodeid.toString());
            if (!node)
                continue;

            if (processedNodes.has(node.id.toString()))
                continue;

            // Invoke function.
            const result = func(node, graph);

            // Skip in case of e.g., collapsed nodes.
            if (result) {
                // Traverse scopes recursively (if scope_dict provided).
                if (node.type.endsWith('Entry') &&
                node.parentStateId !== undefined) {
                    const state = (
                        node.parentElem as State | undefined
                    )?.jsonData;
                    if (state?.scope_dict?.[node.id] !== undefined) {
                        scopesRecursive(
                            graph, state.scope_dict[node.id.toString()] ?? [],
                            processedNodes
                        );
                    }
                }

                // Traverse states or nested SDFGs
                if (node.graph) {
                    const state = (node as State).jsonData;
                    if (state?.scope_dict?.[-1] !== undefined) {
                        scopesRecursive(node.graph, state.scope_dict[-1] ?? []);
                    } else {
                        // No scope_dict, traverse all nodes as a flat hierarchy
                        scopesRecursive(node.graph, node.graph.nodes());
                    }
                }
            }

            if (postSubscopeFunc)
                postSubscopeFunc(node, graph);

            processedNodes.add(node.id.toString());
        }
    }

    scopesRecursive(sdfg, sdfg.nodes());
}

interface JsonSDFGElementInfo extends SDFGElementInfo {
    graph: JsonSDFGControlFlowRegion,
    obj?: JsonSDFGElement,
}

export interface DagreGraphElementInfo extends SDFGElementInfo {
    graph: DagreGraph,
    obj?: SDFGElement,
}

type DagreGraphElemFunction = (
    elementGroup: SDFGElementGroup,
    elementInfo: DagreGraphElementInfo,
    element: SDFGElement,
) => unknown;

type JsonSDFGElemFunction = (
    elementGroup: SDFGElementGroup,
    elementInfo: JsonSDFGElementInfo,
    element: JsonSDFGElement,
) => unknown;

/**
 * Perform a function on all SDFG elements in a JSON SDFG.
 * The function is called with the element group, element info, and the
 * element itself. The element info contains the SDFG and the graph
 * (state or control flow region) in which the element is located.
 * @param func The function to call on each element.
 * @param sdfg The SDFG to traverse.
 * @param cfg  The control flow graph to traverse. If not provided, the entire
 *             SDFG will be traversed.
 */
export function doForAllJsonSDFGElements(
    func: JsonSDFGElemFunction, sdfg: JsonSDFG, cfg?: JsonSDFG
): void {
    // Traverse nested SDFGs recursively
    function doRecursive(rCFG: JsonSDFGControlFlowRegion, rSDFG: JsonSDFG) {
        rCFG.nodes.forEach((block: JsonSDFGBlock, blockId: number) => {
            if (block.type === SDFGElementType.SDFGState.toString()) {
                func(
                    'states', {
                        sdfg: rSDFG,
                        graph: rCFG,
                        id: blockId,
                        cfgId: rCFG.cfg_list_id,
                        stateId: -1,
                    }, block
                );

                const state: JsonSDFGState = block as JsonSDFGState;
                state.nodes.forEach((node: JsonSDFGNode, nId: number) => {
                    // Nodes
                    func(
                        'nodes',
                        {
                            sdfg: rSDFG,
                            graph: rCFG,
                            id: nId,
                            cfgId: rCFG.cfg_list_id,
                            stateId: blockId,
                        },
                        node
                    );

                    // If nested SDFG, traverse recursively
                    if (node.type === SDFGElementType.NestedSDFG.toString() &&
                        node.attributes?.sdfg) {
                        doRecursive(
                            node.attributes.sdfg, node.attributes.sdfg
                        );
                    }
                });

                // Edges
                state.edges.forEach(
                    (edge: JsonSDFGEdge, edgeId: number) => {
                        func(
                            'edges',
                            {
                                sdfg: rSDFG,
                                graph: rCFG,
                                id: edgeId,
                                cfgId: rCFG.cfg_list_id,
                                stateId: blockId,
                            },
                            edge
                        );
                    }
                );
            } else if (
                'start_block' in block && 'cfg_list_id' in block &&
                'nodes' in block && 'edges' in block
            ) {
                // Control flow region.
                func('controlFlowRegions', {
                    sdfg: rSDFG,
                    graph: rCFG,
                    id: blockId,
                    cfgId: rCFG.cfg_list_id,
                    stateId: -1,
                }, block);
                doRecursive(block as JsonSDFGControlFlowRegion, rSDFG);
            } else if ('branches' in block) {
                func('controlFlowBlocks', {
                    sdfg: rSDFG,
                    graph: rCFG,
                    id: blockId,
                    cfgId: rCFG.cfg_list_id,
                    stateId: block.id,
                }, block);
                const conditRegion = block as JsonSDFGConditionalBlock;
                for (const el of conditRegion.branches) {
                    // Control flow region.
                    func('controlFlowRegions', {
                        sdfg: rSDFG,
                        graph: rCFG,
                        id: blockId,
                        cfgId: rCFG.cfg_list_id,
                        stateId: -1,
                    }, el[1]);
                    doRecursive(el[1], rSDFG);
                }
            }
        });

        // Selected inter-state edges
        rCFG.edges.forEach((isedge: JsonSDFGEdge, isEdgeId: number) => {
            func('isedges', {
                sdfg: rSDFG,
                graph: rCFG,
                id: isEdgeId,
                cfgId: rCFG.cfg_list_id,
                stateId: -1,
            }, isedge);
        });
    }

    cfg ??= sdfg;
    doRecursive(cfg, sdfg);
}

/**
 * Perform a function on all SDFG elements in a DagreGraph.
 * The function is called with the element group, element info, and the
 * element itself. The element info contains the SDFG and the graph
 * (state or control flow region) in which the element is located.
 * @param func  The function to call on each element.
 * @param graph The graph to traverse.
 * @param sdfg  The SDFG to traverse.
 * @param cfg   The control flow graph to traverse. If not provided, the entire
 *              SDFG will be traversed.
 */
export function doForAllDagreGraphElements(
    func: DagreGraphElemFunction, graph: DagreGraph, sdfg: JsonSDFG,
    cfg?: JsonSDFGControlFlowRegion
): void {
    // Traverse nested SDFGs recursively
    function doRecursive(
        rGraph: DagreGraph | null, rCFG: JsonSDFGControlFlowRegion,
        rSDFG: JsonSDFG
    ) {
        rGraph?.nodes().forEach(blockIdString => {
            const block = rGraph.node(blockIdString);
            if (!(block instanceof ControlFlowBlock))
                return;
            const blockId = Number(blockIdString);

            if (block instanceof State) {
                // States
                func(
                    'states',
                    {
                        sdfg: rSDFG,
                        graph: rGraph,
                        id: blockId,
                        cfgId: rCFG.cfg_list_id,
                        stateId: -1,
                    },
                    block
                );

                const state = block.jsonData;
                if (state?.attributes?.is_collapsed)
                    return;

                const ng = block.graph;
                if (!ng)
                    return;
                ng.nodes().forEach(nodeIdString => {
                    const node = ng.node(nodeIdString);
                    if (!node)
                        return;
                    const nodeId = Number(nodeIdString);
                    // Selected nodes.
                    func(
                        'nodes',
                        {
                            sdfg: rSDFG,
                            graph: ng,
                            id: nodeId,
                            cfgId: rCFG.cfg_list_id,
                            stateId: blockId,
                        },
                        node
                    );

                    // If nested SDFG, traverse recursively
                    const nData = node.data as {
                        graph: DagreGraph,
                        node: JsonSDFGNode,
                    };
                    if (nData.node.type ===
                        SDFGElementType.NestedSDFG.toString() &&
                        nData.node.attributes?.sdfg) {
                        doRecursive(
                            nData.graph,
                            nData.node.attributes.sdfg,
                            nData.node.attributes.sdfg
                        );
                    }

                    // Connectors
                    node.inConnectors.forEach(
                        (c: Connector, i: number) => {
                            func(
                                'connectors', {
                                    sdfg: rSDFG,
                                    graph: ng,
                                    id: nodeId,
                                    cfgId: rCFG.cfg_list_id,
                                    stateId: blockId,
                                    connector: i,
                                    conntype: 'in',
                                }, c
                            );
                        }
                    );
                    node.outConnectors.forEach(
                        (c: Connector, i: number) => {
                            func(
                                'connectors', {
                                    sdfg: rSDFG,
                                    graph: ng,
                                    id: nodeId,
                                    cfgId: rCFG.cfg_list_id,
                                    stateId: blockId,
                                    connector: i,
                                    conntype: 'out',
                                }, c
                            );
                        }
                    );
                });

                // Selected edges
                ng.edges().forEach(edgeId => {
                    const edge = ng.edge(edgeId);
                    if (edge) {
                        func(
                            'edges',
                            {
                                sdfg: rSDFG,
                                graph: ng,
                                id: edge.id,
                                cfgId: rCFG.cfg_list_id,
                                stateId: blockId,
                            },
                            edge
                        );
                    }
                });
            } else if (block instanceof ControlFlowRegion) {
                // Control Flow Regions.
                func(
                    'controlFlowRegions',
                    {
                        sdfg: rSDFG,
                        graph: rGraph,
                        id: blockId,
                        cfgId: rCFG.cfg_list_id,
                        stateId: -1,
                    },
                    block
                );
                const ng = block.graph;
                if (ng && block.jsonData)
                    doRecursive(ng, block.jsonData, rSDFG);
            } else if (block instanceof ConditionalBlock) {
                func(
                    'controlFlowBlocks',
                    {
                        sdfg: rSDFG,
                        graph: rGraph,
                        id: blockId,
                        cfgId: rCFG.cfg_list_id,
                        stateId: -1,
                    },
                    block
                );
                for (const [_, branch] of block.branches) {
                    func(
                        'controlFlowRegions',
                        {
                            sdfg: rSDFG,
                            graph: rGraph,
                            id: blockId,
                            cfgId: rCFG.cfg_list_id,
                            stateId: -1,
                        },
                        branch
                    );
                    const ng = branch.graph;
                    if (ng && branch.jsonData)
                        doRecursive(ng, branch.jsonData, rSDFG);
                }
            } else {
                // Other (unknown) control flow blocks.
                func(
                    'controlFlowBlocks',
                    {
                        sdfg: rSDFG,
                        graph: rGraph,
                        id: blockId,
                        cfgId: rCFG.cfg_list_id,
                        stateId: -1,
                    },
                    block
                );
            }
        });

        // Selected inter-state edges
        rGraph?.edges().forEach(isEdgeId => {
            const isEdge = rGraph.edge(isEdgeId) as InterstateEdge;
            func(
                'isedges',
                {
                    sdfg: rSDFG,
                    graph: rGraph,
                    id: isEdge.id,
                    cfgId: rCFG.cfg_list_id,
                    stateId: -1,
                },
                isEdge
            );
        });
    }

    cfg ??= sdfg;
    doRecursive(graph, cfg, sdfg);
}

export function doForIntersectedDagreGraphElements(
    func: DagreGraphElemFunction, x: number, y: number, w: number | undefined,
    h: number | undefined,
    graph: DagreGraph, sdfg: JsonSDFG, cfg?: JsonSDFGControlFlowRegion
): void {
    // Traverse nested SDFGs recursively.
    function doRecursive(
        rGraph: DagreGraph, rCFG: JsonSDFGControlFlowRegion, rSDFG: JsonSDFG
    ): void {
        rGraph.nodes().forEach(blockIdString => {
            const block = rGraph.node(blockIdString);
            if (!(block instanceof ControlFlowBlock))
                return;

            const blockId = Number(blockIdString);
            if (block.intersect(x, y, w, h)) {
                const elemInfo = {
                    sdfg: rSDFG,
                    graph: rGraph,
                    id: blockId,
                    cfgId: rCFG.cfg_list_id,
                    stateId: -1,
                };
                let elemGroup: SDFGElementGroup;
                if (block instanceof State)
                    elemGroup = 'states';
                else if (block instanceof ControlFlowRegion)
                    elemGroup = 'controlFlowRegions';
                else
                    elemGroup = 'controlFlowBlocks';
                func(elemGroup, elemInfo, block);

                if (block.attributes()?.is_collapsed)
                    return;

                const ng = block.graph;
                if (!ng)
                    return;

                if (block instanceof State) {
                    ng.nodes().forEach(nodeIdString => {
                        const node = ng.node(nodeIdString);
                        if (!node)
                            return;
                        const nodeId = Number(nodeIdString);
                        if (node.intersect(x, y, w, h)) {
                            // Selected nodes
                            func(
                                'nodes',
                                {
                                    sdfg: rSDFG,
                                    graph: ng,
                                    id: nodeId,
                                    cfgId: rCFG.cfg_list_id,
                                    stateId: blockId,
                                },
                                node
                            );

                            // If nested SDFG, traverse recursively
                            const nData = node.data as {
                                graph: DagreGraph,
                                node: JsonSDFGNode,
                            };
                            if (nData.node.type ===
                                SDFGElementType.NestedSDFG.toString() &&
                                node.attributes()?.sdfg) {
                                const nsdfg =
                                    node.attributes()?.sdfg as JsonSDFG;
                                doRecursive(nData.graph, nsdfg, nsdfg);
                            }
                        }
                        // Connectors
                        node.inConnectors.forEach(
                            (c: Connector, i: number) => {
                                if (c.intersect(x, y, w, h)) {
                                    func(
                                        'connectors',
                                        {
                                            sdfg: rSDFG,
                                            graph: ng,
                                            id: nodeId,
                                            cfgId: rCFG.cfg_list_id,
                                            stateId: blockId,
                                            connector: i,
                                            conntype: 'in',
                                        },
                                        c
                                    );
                                }
                            }
                        );
                        node.outConnectors.forEach(
                            (c: Connector, i: number) => {
                                if (c.intersect(x, y, w, h)) {
                                    func(
                                        'connectors',
                                        {
                                            sdfg: rSDFG,
                                            graph: ng,
                                            id: nodeId,
                                            cfgId: rCFG.cfg_list_id,
                                            stateId: blockId,
                                            connector: i,
                                            conntype: 'out',
                                        },
                                        c
                                    );
                                }
                            }
                        );
                    });

                    // Selected edges
                    ng.edges().forEach(edgeId => {
                        const edge = ng.edge(edgeId);
                        if (edge?.intersect(x, y, w, h)) {
                            func(
                                'edges',
                                {
                                    sdfg: rSDFG,
                                    graph: rGraph,
                                    id: edge.id,
                                    cfgId: rCFG.cfg_list_id,
                                    stateId: blockId,
                                },
                                edge
                            );
                        }
                    });
                } else if (block instanceof ControlFlowRegion) {
                    if (block.jsonData)
                        doRecursive(block.graph, block.jsonData, rSDFG);
                }
            }
        });

        // Selected inter-state edges
        rGraph.edges().forEach(isEdgeId => {
            const isedge = rGraph.edge(isEdgeId) as InterstateEdge;
            if (isedge.intersect(x, y, w, h)) {
                func(
                    'isedges',
                    {
                        sdfg: rSDFG,
                        graph: rGraph,
                        id: isedge.id,
                        cfgId: rCFG.cfg_list_id,
                        stateId: -1,
                    },
                    isedge
                );
            }
        });
    }

    cfg ??= sdfg;
    doRecursive(graph, cfg, sdfg);
}
