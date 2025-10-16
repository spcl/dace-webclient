// Copyright 2019-2025 ETH Zurich and the DaCe authors. All rights reserved.

import { SDFGElementType } from '../../renderer/sdfg/sdfg_elements';
import {
    JsonSDFG,
    JsonSDFGConditionalBlock,
    JsonSDFGControlFlowRegion,
    JsonSDFGEdge,
    JsonSDFGMultiConnectorEdge,
    JsonSDFGNode,
    JsonSDFGSerializedAtom,
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
    edge: JsonSDFGMultiConnectorEdge,
    visitedEdges: JsonSDFGEdge[] = [],
    ignoreCollapsed: boolean = false
): JsonSDFGMultiConnectorEdge[] {
    if (visitedEdges.includes(edge) ||
        edge.attributes?.data?.attributes?.shortcut)
        return [];

    visitedEdges.push(edge);

    let result: JsonSDFGEdge[] = [];

    function src(e: JsonSDFGEdge): JsonSDFGNode {
        return state.nodes[parseInt(e.src)];
    }

    function dst(e: JsonSDFGEdge): JsonSDFGNode {
        return state.nodes[parseInt(e.dst)];
    }

    function isview(node: JsonSDFGNode) {
        if (node.type === SDFGElementType.AccessNode.toString()) {
            const nodedesc = sdfg.attributes?._arrays[
                node.attributes?.data ?? ''
            ] as JsonSDFGSerializedAtom | undefined;
            return nodedesc?.type === 'View';
        }
        return false;
    }

    // Determine propagation direction.
    let propagateForward = false;
    let propagateBackward = false;
    if ((edge.src_connector && src(edge).type.endsWith('Entry')) ||
        (edge.dst_connector && dst(edge).type.endsWith('Entry') &&
            edge.dst_connector.startsWith('IN_')) ||
        dst(edge).type === SDFGElementType.NestedSDFG.toString() ||
        isview(dst(edge)))
        propagateForward = true;
    if ((edge.src_connector && src(edge).type.endsWith('Exit')) ||
        (edge.dst_connector && dst(edge).type.endsWith('Exit')) ||
        src(edge).type === SDFGElementType.NestedSDFG.toString() ||
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
        for (const block of cfg.nodes) {
            if (block.type === SDFGElementType.SDFGState.toString()) {
                const nstate: JsonSDFGState = block as JsonSDFGState;
                for (const e of nstate.edges) {
                    const node = nstate.nodes[
                        direction === 'in' ? parseInt(e.src) : parseInt(e.dst)
                    ];
                    if (node.type === SDFGElementType.AccessNode.toString() &&
                        node.attributes?.data === name) {
                        result = result.concat(memletTreeNested(
                            nsdfg, nstate, e, visitedEdges, ignoreCollapsed
                        ));
                    }
                }
            } else if (block.type.endsWith('Region')) {
                checkNested(
                    block as JsonSDFGControlFlowRegion, nsdfg, name, direction
                );
            } else if (
                block.type === SDFGElementType.ConditionalBlock.toString()
            ) {
                const condBlock = block as JsonSDFGConditionalBlock;
                for (const [_, branch] of condBlock.branches)
                    checkNested(branch, nsdfg, name, direction);
            }
        }
    }

    function addChildren(edge: JsonSDFGEdge) {
        if (addedChildren.has(edge))
            return;
        addedChildren.add(edge);

        const children: JsonSDFGEdge[] = [];

        if (propagateForward) {
            const nextNode = dst(edge);

            // Descend into nested SDFG.
            if (nextNode.type === SDFGElementType.NestedSDFG.toString()) {
                const name = edge.dst_connector ?? '';
                const nsdfg = nextNode.attributes?.sdfg;
                if (nsdfg && (
                    nextNode.attributes?.is_collapsed !== true ||
                    ignoreCollapsed
                ))
                    checkNested(nsdfg, nsdfg, name, 'in');
            }

            if (isview(nextNode)) {
                for (const e of state.edges) {
                    if (parseInt(e.src) === nextNode.id) {
                        children.push(e);
                        if (!e.attributes?.data?.attributes?.shortcut)
                            result.push(e);
                    }
                }
            } else {
                if (!nextNode.type.endsWith('Entry') ||
                    !edge.dst_connector?.startsWith('IN_'))
                    return;
                if (nextNode.attributes?.is_collapsed === false &&
                    !ignoreCollapsed
                )
                    return;
                const conn = edge.dst_connector.substring(3);
                for (const e of state.edges) {
                    if (parseInt(e.src) === nextNode.id &&
                        e.src_connector === 'OUT_' + conn) {
                        children.push(e);
                        if (!e.attributes?.data?.attributes?.shortcut)
                            result.push(e);
                    }
                }
            }
        }

        if (propagateBackward) {
            const nextNode = src(edge);

            // Descend into nested SDFG.
            if (nextNode.type === SDFGElementType.NestedSDFG.toString()) {
                const name = edge.src_connector ?? '';
                const nsdfg = nextNode.attributes?.sdfg;
                if (nsdfg && (
                    ignoreCollapsed ||
                    nextNode.attributes?.is_collapsed !== true
                ))
                    checkNested(nsdfg, nsdfg, name, 'out');
            }

            if (isview(nextNode)) {
                for (const e of state.edges) {
                    if (parseInt(e.dst) === nextNode.id) {
                        children.push(e);
                        result.push(e);
                    }
                }
            } else {
                if (!(nextNode.type.endsWith('Exit')) ||
                    !edge.src_connector?.startsWith('OUT_'))
                    return;
                if (nextNode.attributes?.is_collapsed === false &&
                    !ignoreCollapsed
                )
                    return;

                const conn = edge.src_connector.substring(4);
                for (const e of state.edges) {
                    if (parseInt(e.dst) === nextNode.id &&
                        e.dst_connector === 'IN_' + conn) {
                        children.push(e);
                        result.push(e);
                    }
                }
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
    cfg: JsonSDFGControlFlowRegion, sdfg: JsonSDFG,
    ignoreCollapsed: boolean = false
): JsonSDFGMultiConnectorEdge[][] {
    let trees: JsonSDFGMultiConnectorEdge[][] = [];
    const visitedEdges: JsonSDFGMultiConnectorEdge[] = [];

    for (const block of cfg.nodes) {
        if (block.type === SDFGElementType.SDFGState.toString()) {
            const state: JsonSDFGState = block as JsonSDFGState;
            for (const e of state.edges) {
                const tree = memletTreeNested(
                    sdfg, state, e, visitedEdges, ignoreCollapsed
                );
                if (tree.length > 1)
                    trees.push(tree);
            }

            for (const n of state.nodes) {
                if (n.type === SDFGElementType.NestedSDFG.toString() &&
                    (n.attributes?.is_collapsed !== true || ignoreCollapsed) &&
                    n.attributes?.sdfg) {
                    const t = memletTreeRecursive(
                        n.attributes.sdfg, sdfg, ignoreCollapsed
                    );
                    trees = trees.concat(t);
                }
            }
        } else if (block.type.endsWith('Region')) {
            trees = trees.concat(memletTreeRecursive(
                block as JsonSDFGControlFlowRegion, sdfg, ignoreCollapsed
            ));
        } else if (block.type === SDFGElementType.ConditionalBlock.toString()) {
            const condBlock = block as JsonSDFGConditionalBlock;
            for (const [_, branch] of condBlock.branches) {
                trees = trees.concat(memletTreeRecursive(
                    branch, sdfg, ignoreCollapsed
                ));
            }
        }
    }

    return trees;
}

/**
 * Returns all memlet trees as sets for the given graph.
 * @param sdfg The top level SDFG.
 */
export function memletTreeComplete(
    sdfg: JsonSDFG, ignoreCollapsed: boolean = false
): Set<JsonSDFGMultiConnectorEdge>[] {
    const allMemletTrees: Set<JsonSDFGMultiConnectorEdge>[] = [];
    const memletTrees = memletTreeRecursive(sdfg, sdfg, ignoreCollapsed);

    // Combine trees as memlet_tree_recursive does not necessarily return the
    // complete trees (they might be split into several trees).
    for (const tree of memletTrees) {
        let commonEdge = false;
        for (const mt of allMemletTrees) {
            for (const edge of tree) {
                if (mt.has(edge)) {
                    for (const e of tree)
                        mt.add(e);
                    commonEdge = true;
                    break;
                }
            }
            if (commonEdge)
                break;
        }
        if (!commonEdge)
            allMemletTrees.push(new Set(tree));
    }

    return allMemletTrees;
}
