// Copyright 2019-2024 ETH Zurich and the DaCe authors. All rights reserved.

import { SDFGElementType } from '../../renderer/renderer_elements';
import {
    JsonSDFG,
    JsonSDFGBlock,
    JsonSDFGConditionalBlock,
    JsonSDFGControlFlowRegion,
    JsonSDFGEdge,
    JsonSDFGNode,
    JsonSDFGState,
} from '../../types';


/**
 * Returns a partial memlet tree from a given edge.
 * It descends into nested SDFGs.
 * @param visitedEdges is used to speed up the computation of the memlet trees
 **/
export function memletTreeNested(
    sdfg: JsonSDFG,
    state: JsonSDFGState,
    edge: JsonSDFGEdge,
    visitedEdges: JsonSDFGEdge[] = []
): any[] {
    if (visitedEdges.includes(edge) ||
        edge.attributes.data.attributes.shortcut)
        return [];

    visitedEdges.push(edge);

    let result: any[] = [];

    function src(e: JsonSDFGEdge): JsonSDFGNode {
        return state.nodes[parseInt(e.src)];
    }

    function dst(e: JsonSDFGEdge): JsonSDFGNode {
        return state.nodes[parseInt(e.dst)];
    }

    function isview(node: JsonSDFGNode) {
        if (node.type === SDFGElementType.AccessNode) {
            const nodedesc = sdfg.attributes._arrays[node.attributes.data];
            return (nodedesc && nodedesc.type === 'View');
        }
        return false;
    }

    // Determine propagation direction.
    let propagateForward = false;
    let propagateBackward = false;
    if ((edge.src_connector && src(edge).type.endsWith('Entry')) ||
        (edge.dst_connector && dst(edge).type.endsWith('Entry') &&
            edge.dst_connector.startsWith('IN_')) ||
        dst(edge).type === SDFGElementType.NestedSDFG ||
        isview(dst(edge)))
        propagateForward = true;
    if ((edge.src_connector && src(edge).type.endsWith('Exit')) ||
        (edge.dst_connector && dst(edge).type.endsWith('Exit')) ||
        src(edge).type === SDFGElementType.NestedSDFG ||
        isview(src(edge)))
        propagateBackward = true;

    result.push(edge);

    // If no scope is involved we return only the edge as a degenerate tree.
    if (!propagateForward && !propagateBackward)
        return result;

    // Descend recursively.
    const addedChildren = new Set<JsonSDFGEdge>();

    function checkNested(
        cfg: JsonSDFGControlFlowRegion, nsdfg: JsonSDFG, name: string | null,
        direction: 'in' | 'out'
    ): void {
        cfg.nodes.forEach((block: JsonSDFGBlock) => {
            if (block.type === SDFGElementType.SDFGState) {
                const nstate: JsonSDFGState = block as JsonSDFGState;
                nstate.edges.forEach((e: any) => {
                    const node = nstate.nodes[
                        direction === 'in' ? e.src : e.dst
                    ];
                    if (node.type === SDFGElementType.AccessNode &&
                        node.attributes.data === name) {
                        result = result.concat(
                            memletTreeNested(
                                nsdfg, nstate, e, visitedEdges
                            )
                        );
                    }
                });
            } else if (block.type.endsWith('Region')) {
                checkNested(
                    block as JsonSDFGControlFlowRegion, nsdfg, name, direction
                );
            } else if (block.type === SDFGElementType.ConditionalBlock) {
                const condBlock = block as JsonSDFGConditionalBlock;
                for (const [_, branch] of condBlock.branches)
                    checkNested(branch, nsdfg, name, direction);
            }
        });
    }

    function addChildren(edge: JsonSDFGEdge) {
        if (addedChildren.has(edge))
            return;
        addedChildren.add(edge);

        const children: JsonSDFGEdge[] = [];

        if (propagateForward) {
            const next_node = dst(edge);

            // Descend into nested SDFG.
            if (next_node.type === SDFGElementType.NestedSDFG) {
                const name = edge.dst_connector;
                const nsdfg = next_node.attributes.sdfg;
                if (nsdfg)
                    checkNested(nsdfg, nsdfg, name, 'in');
            }

            if (isview(next_node)) {
                state.edges.forEach((e: JsonSDFGEdge) => {
                    if (parseInt(e.src) === next_node.id) {
                        children.push(e);
                        if (!e.attributes.data.attributes.shortcut)
                            result.push(e);
                    }
                });
            } else {
                if (!next_node.type.endsWith('Entry') ||
                    !edge.dst_connector?.startsWith('IN_'))
                    return;
                if (next_node.attributes.is_collapsed)
                    return;
                const conn = edge.dst_connector.substring(3);
                state.edges.forEach((e: JsonSDFGEdge) => {
                    if (parseInt(e.src) === next_node.id &&
                        e.src_connector === 'OUT_' + conn) {
                        children.push(e);
                        if (!e.attributes.data.attributes.shortcut)
                            result.push(e);
                    }
                });
            }
        }

        if (propagateBackward) {
            const nextNode = src(edge);

            // Descend into nested SDFG.
            if (nextNode.type === SDFGElementType.NestedSDFG) {
                const name = edge.src_connector;
                const nsdfg = nextNode.attributes.sdfg;
                if (nsdfg)
                    checkNested(nsdfg, nsdfg, name, 'out');
            }

            if (isview(nextNode)) {
                state.edges.forEach((e: JsonSDFGEdge) => {
                    if (parseInt(e.dst) === nextNode.id) {
                        children.push(e);
                        result.push(e);
                    }
                });
            } else {
                if (!(nextNode.type.endsWith('Exit')) || !edge.src_connector)
                    return;

                const conn = edge.src_connector.substring(4);
                state.edges.forEach((e: JsonSDFGEdge) => {
                    if (parseInt(e.dst) === nextNode.id &&
                        e.dst_connector === 'IN_' + conn) {
                        children.push(e);
                        result.push(e);
                    }
                });
            }
        }

        for (const child of children)
            addChildren(child);
    }

    // Descend starting from the current edge.
    addChildren(edge);

    return result;
}

/**
 * Calls memletTreeNested for every nested SDFG and its edges and returns a
 * list with all memlet trees. As edges are visited only in one direction (from
 * outer SDFGs to inner SDFGs) a memlet can be split into several arrays.
 */
export function memletTreeRecursive(
    cfg: JsonSDFGControlFlowRegion, sdfg: JsonSDFG
): any[] {
    let trees: any[] = [];
    const visitedEdges: JsonSDFGEdge[] = [];

    cfg.nodes?.forEach((block: JsonSDFGBlock) => {
        if (block.type === SDFGElementType.SDFGState) {
            const state: JsonSDFGState = block as JsonSDFGState;
            state.edges.forEach((e: JsonSDFGEdge) => {
                const tree = memletTreeNested(sdfg, state, e, visitedEdges);
                if (tree.length > 1)
                    trees.push(tree);
            });

            state.nodes.forEach((n: JsonSDFGNode) => {
                if (n.type === SDFGElementType.NestedSDFG &&
                    n.attributes.sdfg) {
                    const t = memletTreeRecursive(n.attributes.sdfg, sdfg);
                    trees = trees.concat(t);
                }
            });
        } else if (block.type.endsWith('Region')) {
            trees = trees.concat(memletTreeRecursive(
                block as JsonSDFGControlFlowRegion, sdfg
            ));
        } else if (block.type === SDFGElementType.ConditionalBlock) {
            const condBlock = block as JsonSDFGConditionalBlock;
            for (const [_, branch] of condBlock.branches)
                trees = trees.concat(memletTreeRecursive(branch, sdfg));
        }
    });

    return trees;
}

/**
 * Returns all memlet trees as sets for the given graph.
 *
 * @param {JsonSDFG} sdfg The top level SDFG.
 */
export function memletTreeComplete(sdfg: JsonSDFG): any[] {
    const allMemletTrees: any[] = [];
    const memletTrees = memletTreeRecursive(sdfg, sdfg);

    // combine trees as memlet_tree_recursive does not necessarily return the
    // complete trees (they might be split into several trees)
    memletTrees.forEach(tree => {
        let commonEdge = false;
        for (const mt of allMemletTrees) {
            for (const edge of tree) {
                if (mt.has(edge)) {
                    tree.forEach((e: JsonSDFGEdge) => mt.add(e));
                    commonEdge = true;
                    break;
                }
            }
            if (commonEdge)
                break;
        }
        if (!commonEdge)
            allMemletTrees.push(new Set(tree));
    });

    return allMemletTrees;
}

