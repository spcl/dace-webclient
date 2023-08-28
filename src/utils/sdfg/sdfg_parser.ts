// Copyright 2019-2023 ETH Zurich and the DaCe authors. All rights reserved.

import {
    JsonSDFG,
    JsonSDFGBlock,
    JsonSDFGNode,
    SDFGElementType,
} from '../../index';

export class SDFGParser {

    public constructor(private readonly sdfg: JsonSDFG) {
    }

    public getStates(): SDFGStateParser[] {
        return this.sdfg.nodes.map((x: JsonSDFGBlock) => new SDFGStateParser(x));
    }

    public static lookupSymbols(
        sdfg: JsonSDFG, stateId: number, elem: any,
        symbolsToResolve: string[], depth: number = 0
    ): any[] {
        // Resolve used symbols by following connectors in reverse order.
        const state = sdfg.nodes[stateId];

        let syms: any[] = [];

        if (elem.constructor == Object) {
            // Memlet.
            const memlets = state.edges.filter((x: any) => {
                return x.dst == elem.dst && x.src == elem.src;
            });

            // Recurse into parent (since this a multigraph, all edges need to
            // be looked at).
            for (const m of memlets) {
                // Find symbols used (may be Indices or Range).
                const mdata = m.attributes.data.attributes.subset;
                // Check for indices
                if (mdata.type == 'subsets.Indices') {
                    // These are constants or variables.
                    // Reverse to have smallest unit first.
                    const tmp = mdata.indices.map((x: any) => x).reverse();
                    for (const x of tmp) {
                        // Add the used variables as null and hope that they
                        // will be resolved.
                        depth += 1;
                        syms.push({ var: x, val: null, depth: depth });
                    }
                } else if (mdata.type == 'subsets.Range') {
                    // These are ranges.
                    // These ranges are not of interest, as they specify what is
                    // copied and don't define new variables.
                }

                // Find parent nodes.
                const tmp = SDFGParser.lookupSymbols(
                    sdfg, stateId, m.src, symbolsToResolve, depth + 1
                );
                syms = [...syms, ...tmp];
            }
        } else {
            // Node.
            const node = state.nodes[elem];

            // Maps (and Consumes) define ranges, extract symbols from there.
            try {
                // The iterator ranges.
                const rngs = node.attributes.range.ranges.map((x: any) => x);
                // The iterators.
                const params = node.attributes.params.map((x: any) => x);

                console.assert(
                    rngs.length == params.length,
                    'Ranges and params should have the same count of elements'
                );

                // Reverse from big -> little to little -> big (or outer ->
                // inner to inner -> outer).
                rngs.reverse();
                params.reverse();

                for (let i = 0; i < rngs.length; ++i) {
                    // Check first if the variable is already defined, and if
                    // yes, if the value is the same.
                    const fltrd = syms.filter(x => x.var == params[i]);
                    if (fltrd.length == 0) {
                        depth += 1;
                        syms.push({
                            var: params[i],
                            val: rngs[i],
                            depth: depth
                        });
                    } else {
                        if (JSON.stringify(fltrd[0].val) !=
                            JSON.stringify(rngs[i]))
                            console.warn(
                                'Colliding definitions for var ' + params[i],
                                fltrd[0].val, rngs[i]
                            );
                    }
                }
            } catch (e) {
                // Not a node defining ranges (every node except maps /
                // consumes).
            }
            // Find all incoming edges.
            const inc_edges = state.edges.filter((x: any) => x.dst == elem);
            for (const e of inc_edges) {
                const tmp = SDFGParser.lookupSymbols(
                    sdfg, stateId, e, symbolsToResolve, depth + 1
                );
                syms = [...syms, ...tmp];
            }
        }

        return syms;
    }
}

export class SDFGStateParser {

    public constructor(private readonly block: JsonSDFGBlock) {
    }

    public getNodes(): any {
        return this.block.nodes.map((x) => {
            switch (x.type) {
                case SDFGElementType.SDFGState:
                case SDFGElementType.BasicBlock:
                case SDFGElementType.LoopScopeBlock:
                    return new SDFGStateParser(x as JsonSDFGBlock);
                default:
                    return new SDFGNodeParser(x as JsonSDFGNode);
            }
        });
    }
}

export class SDFGNodeParser {

    public constructor(private readonly node: JsonSDFGNode) {
    }

    public isNodeType(nodeType: string): boolean {
        return this.node.attributes.type === nodeType;
    }

}

export class SDFGPropUtil {

    public static getMetaFor(obj: any, attr_name: string): any {
        return obj.attributes['_meta_' + attr_name];
    }

    public static getAttributeNames(obj: any): string[] {
        const keys = Object.keys(obj.attributes);
        const list = keys.filter(x => keys.includes('_meta_' + x));
        return list;
    }

}
