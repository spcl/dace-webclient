// Copyright 2019-2025 ETH Zurich and the DaCe authors. All rights reserved.

import { JsonSDFGControlFlowRegion, JsonSDFGEdge } from '../../types';


/**
 * Convet an SDFG edge to its dotgraph string representation.
 * @param cfg  Control flow graph the edge is contained in.
 * @param edge Edge to convert.
 * @returns    Dotgraph string representation of `edge`.
 */
function cfgEdgeToDotGraphEdge(
    cfg: JsonSDFGControlFlowRegion, edge: JsonSDFGEdge
): string {
    const srcName = cfg.nodes[Number(edge.src)].label;
    const dstName = cfg.nodes[Number(edge.dst)].label;
    return srcName + ' -> ' + dstName;
}

/**
 * Convert a control flow region to a dotrgraph string.
 * @param cfg Control flow region to convert.
 * @returns   Dotrgraph string representation of `cfg`.
 */
export function cfgToDotGraph(cfg: JsonSDFGControlFlowRegion): string {
    let graphString = '';

    let progString = 'program';
    if (cfg.attributes && Object.hasOwn(cfg.attributes, 'name'))
        progString = (cfg.attributes as { name: string }).name;
    graphString += 'digraph "' + progString + '" {\n';

    for (const edge of cfg.edges)
        graphString += '  ' + cfgEdgeToDotGraphEdge(cfg, edge) + '\n';

    graphString += '}\n';

    return graphString;
}
