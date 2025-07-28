// Copyright 2019-2025 ETH Zurich and the DaCe authors. All rights reserved.

import $ from 'jquery';
import {
    AccessNode,
    Edge,
    ExitNode,
    MapEntry,
    SDFGElement,
    SDFGNode,
    State,
    Tasklet,
} from '../renderer/sdfg/sdfg_elements';
import { sdfgPropertyToString } from '../utils/sdfg/display';
import {
    AccessMode,
    DataContainer,
    SymbolicDataAccess,
} from './elements/data_container';
import { DataDimension } from './elements/dimensions';
import { MapNode } from './elements/map_node';
import { Graph } from './graph/graph';
import { MemoryLocationOverlay } from '../overlays/memory_location_overlay';
import { ComputationNode } from './elements/computation_node';
import { MemoryMovementEdge } from './elements/memory_movement_edge';
import { MemoryNode } from './elements/memory_node';
import { Element } from './elements/element';
import { LViewRenderer } from './lview_renderer';
import { evaluate } from 'mathjs';
import type { DagreGraph } from '../renderer/sdfg/sdfg_renderer';
import { DataSubset, JsonSDFG, JsonSDFGCodeBlock } from '../types';
import { Node } from './elements/node';

export class LViewGraphParseError extends Error {}

function parseSymbolic(
    symbol: string | number, symbolMap: Map<string, number>
): number {
    let result;
    if (typeof symbol === 'number')
        result = symbol;
    else
        result = evaluate(symbol.replaceAll('**', '^'), symbolMap) as number;
    return result;
}

function parseMap(
    elem: MapEntry, graph: Graph, state: State, sdfg: DagreGraph,
    symbolMap: Map<string, number>, renderer?: LViewRenderer
): MapNode | undefined {
    const attrs = elem.attributes();
    if (!attrs || !state.graph)
        return undefined;

    const rRanges = (attrs.range as DataSubset).ranges ?? [];
    const rParams = attrs.params as string[];
    const ranges = [];
    for (let i = 0; i < rParams.length; i++) {
        const rng = rRanges[i];

        const start = parseSymbolic(rng.start, symbolMap);
        const end = parseSymbolic(rng.end, symbolMap);
        const step = parseSymbolic(rng.step, symbolMap);

        ranges.push({
            itvar: rParams[i],
            start: start,
            end: end,
            step: step,
        });
    }

    const innerGraph = new Graph(renderer);
    const mapScopeDict = state.jsonData?.scope_dict?.[elem.id];
    if (mapScopeDict) {
        const scopeEdges = new Set<dagre.Edge>();
        for (const id of mapScopeDict) {
            const node = state.graph.node(id.toString());
            if (!node)
                continue;
            const childElem = parseElement(
                graph, node, state, sdfg, symbolMap, renderer
            );
            if (childElem) {
                innerGraph.addChild(childElem);

                const iedges = state.graph.inEdges(id.toString()) ?? [];
                for (const iedge of iedges)
                    scopeEdges.add(iedge);
                const oedges = state.graph.outEdges(id.toString()) ?? [];
                for (const oedge of oedges)
                    scopeEdges.add(oedge);
            }
        }

        for (const edge of scopeEdges) {
            const elem = parseEdge(
                graph, edge, state, sdfg, symbolMap, renderer
            );
            if (elem)
                innerGraph.addChild(elem);
        }
    }

    innerGraph.contractGraph();

    const node = new MapNode(
        elem.id.toString(), graph, ranges, innerGraph, undefined,
        undefined, renderer
    );
    attrs.lviewNode = node;
    return node;
}

function findAccessNodeForContainer(
    name: string, state: State
): AccessNode | undefined {
    if (!state.graph)
        return undefined;
    for (const nid of state.graph.nodes()) {
        const node = state.graph.node(nid);
        if (node instanceof AccessNode && node.attributes()?.data === name)
            return node;
    }
    return undefined;
}

function getOrCreateContainer(
    name: string, graph: Graph, state: State,
    symbolMap: Map<string, number>, elem?: AccessNode
): DataContainer | undefined {
    if (name) {
        const sdfgContainer = state.sdfg.attributes?._arrays[name];
        let container = graph.dataContainers.get(name);
        if (!container) {
            const dimensions = [];
            for (const s of sdfgContainer?.attributes?.shape ?? []) {
                const val = parseSymbolic(s, symbolMap);
                dimensions.push(new DataDimension(s.toString(), val));
            }
            elem ??= findAccessNodeForContainer(name, state);
            const storageType = elem ?
                MemoryLocationOverlay.getStorageType(elem) :
                undefined;
            const strides: DataDimension[] = [];
            const sdfgStrides = sdfgContainer?.attributes?.strides;
            if (sdfgStrides) {
                for (const currStride of sdfgStrides) {
                    const strideDim = new DataDimension(
                        currStride,
                        parseSymbolic(currStride, symbolMap)
                    );
                    strides.push(strideDim);
                }
            } else {
                strides.push(new DataDimension('1', 1));
            }
            container = new DataContainer(
                name,
                dimensions,
                8, // TODO
                (sdfgContainer?.attributes?.start_offset ?? 0) as number,
                (sdfgContainer?.attributes?.alignment ?? 0) as number,
                storageType?.type,
                strides
            );
            graph.dataContainers.set(name, container);
        } else if (container.storage === undefined) {
            elem ??= findAccessNodeForContainer(name, state);
            const storageType = elem ?
                MemoryLocationOverlay.getStorageType(elem) :
                undefined;
            container.storage = storageType?.type;
        }
        return container;
    }
    return undefined;
}

function parseAccessNode(
    element: AccessNode, graph: Graph, state: State,
    symbolMap: Map<string, number>, renderer?: LViewRenderer
): MemoryNode | undefined {
    const attributes = element.attributes();
    if (attributes) {
        const container = getOrCreateContainer(
            attributes.data as string, graph, state, symbolMap, element
        );
        if (container) {
            const node = new MemoryNode(
                element.id.toString(), graph, container, AccessMode.ReadWrite,
                undefined, undefined, renderer
            );
            attributes.lviewNode = node;
            return node;
        }
    }
    return undefined;
}

function getMemletAccess(
    edge: Edge, mode: AccessMode, graph: Graph, state: State,
    symbolMap: Map<string, number>
): SymbolicDataAccess | undefined {
    const attributes = edge.attributes();
    if (!attributes)
        return undefined;

    const dataContainer = getOrCreateContainer(
        attributes.data as string, graph, state, symbolMap
    );
    const subset = (attributes.other_subset ?? attributes.subset) as DataSubset;
    const ranges = subset.ranges;
    const volume = parseSymbolic(
        (attributes.num_accesses ?? 0) as number, symbolMap
    );
    if (dataContainer && ranges) {
        if (volume === 1) {
            const accessIdx = [];
            for (const rng of ranges)
                accessIdx.push(rng.start);
            return {
                dataContainer: dataContainer,
                accessMode: mode,
                index: accessIdx,
            };
        } else {
            throw new LViewGraphParseError(
                'This subgraph cannot be statically analyzed for data ' +
                'access patterns due to data dependent executions.'
            );
        }
    }
    return undefined;
}

function parseTasklet(
    graph: Graph, el: Tasklet, state: State, sdfg: DagreGraph,
    symbolMap: Map<string, number>, renderer?: LViewRenderer
): ComputationNode | undefined {
    const attributes = el.attributes();
    if (!attributes)
        return undefined;

    const label = (
        attributes.code as JsonSDFGCodeBlock | undefined
    )?.string_data ?? '';
    const farLabel = (attributes.label ?? '') as string;

    const accessOrder: SymbolicDataAccess[] = [];
    for (const iedgeId of state.graph?.inEdges(el.id.toString()) ?? []) {
        const iedge = state.graph?.edge(iedgeId);
        if (iedge) {
            const accesses = getMemletAccess(
                iedge, AccessMode.ReadOnly, graph, state, symbolMap
            );
            if (accesses)
                accessOrder.push(accesses);
        }
    }
    for (const oedgeId of state.graph?.outEdges(el.id.toString()) ?? []) {
        const oedge = state.graph?.edge(oedgeId);
        if (oedge) {
            const accesses = getMemletAccess(
                oedge, AccessMode.Write, graph, state, symbolMap
            );
            if (accesses)
                accessOrder.push(accesses);
        }
    }

    const node = new ComputationNode(
        el.id.toString(), graph, label, accessOrder, farLabel, undefined,
        renderer
    );
    attributes.lviewNode = node;
    return node;
}

function parseEdge(
    graph: Graph, el: dagre.Edge, state: State,
    sdfg: DagreGraph, symbolMap: Map<string, number>,
    renderer?: LViewRenderer
): Element | undefined {
    if (!state.graph)
        return undefined;

    let src = state.graph.node(el.v) as SDFGNode;
    if (src instanceof ExitNode)
        src = state.graph.node(src.jsonData?.scope_entry ?? '') as SDFGNode;
    const dst = state.graph.node(el.w);
    const edge = state.graph.edge(el);
    if  (!dst || !edge)
        return undefined;
    const srcAttrs = src.attributes();
    const dstAttrs = dst.attributes();

    if (srcAttrs?.lviewNode && dstAttrs?.lviewNode) {
        const eAttrs = edge.attributes();
        if (eAttrs?.data) {
            const text = (eAttrs.data as string) + sdfgPropertyToString(
                edge.attributes()?.subset
            );
            const elem = new MemoryMovementEdge(
                text, graph, edge.points,
                srcAttrs.lviewNode as Node,
                dstAttrs.lviewNode as Node,
                renderer
            );
            eAttrs.lviewNode = elem;
            return elem;
        }
    }

    return undefined;
}

function parseElement(
    graph: Graph, el: SDFGElement, state: State, sdfg: DagreGraph,
    symbolMap: Map<string, number>, renderer?: LViewRenderer
): Element | undefined {
    if (el instanceof SDFGNode) {
        if (el instanceof AccessNode)
            return parseAccessNode(el, graph, state, symbolMap, renderer);
        else if (el instanceof MapEntry)
            return parseMap(el, graph, state, sdfg, symbolMap, renderer);
        else if (el instanceof Tasklet)
            return parseTasklet(graph, el, state, sdfg, symbolMap, renderer);
    }
    return undefined;
}

function parseState(
    state: State, sdfg: DagreGraph, symbolMap: Map<string, number>,
    renderer?: LViewRenderer
): Graph {
    const graph = new Graph(renderer);

    const scopeDict = state.jsonData?.scope_dict;
    const lastScope = scopeDict?.[-1];
    if (lastScope) {
        const rootScope = [];
        for (const id of lastScope)
            rootScope.push(state.graph?.node(id.toString()) as SDFGNode);

        const rootScopeEdges = new Set<dagre.Edge>();
        for (const el of rootScope) {
            const elem = parseElement(
                graph, el, state, sdfg, symbolMap, renderer
            );
            if (elem)
                graph.addChild(elem);

            const iedges = state.graph?.inEdges(el.id.toString());
            for (const iedge of iedges ?? [])
                rootScopeEdges.add(iedge);
            if (el instanceof MapEntry && !el.attributes()?.is_collapsed) {
                if (el.jsonData?.scope_exit) {
                    const exitNode = state.graph?.node(
                        el.jsonData.scope_exit
                    ) as SDFGNode;
                    const oedges = state.graph?.outEdges(
                        exitNode.id.toString()
                    );
                    for (const oedge of oedges ?? [])
                        rootScopeEdges.add(oedge);
                }
            } else {
                const oedges = state.graph?.outEdges(el.id.toString());
                for (const oedge of oedges ?? [])
                    rootScopeEdges.add(oedge);
            }
        }

        for (const edge of rootScopeEdges) {
            const elem = parseEdge(
                graph, edge, state, sdfg, symbolMap, renderer
            );
            if (elem)
                graph.addChild(elem);
        }
    }

    return graph;
}

async function promptDefineSymbol(symbol: string): Promise<number> {
    return new Promise((resolve) => {
        const dialogueBackground = $('<div>', {
            class: 'sdfv_modal_background',
        });

        const dialogue = $('<div>', {
            class: 'sdfv_modal',
        }).appendTo(dialogueBackground);

        const headerBar = $('<div>', {
            class: 'sdfv_modal_title_bar',
        }).appendTo(dialogue);
        $('<span>', {
            class: 'sdfv_modal_title',
            text: 'Define symbol ' + symbol,
        }).appendTo(headerBar);
        $('<div>', {
            class: 'modal_close',
            html: '<i class="material-symbols-outlined">close</i>',
            click: () => {
                dialogueBackground.remove();
                throw new LViewGraphParseError(
                    'Symbol ' + symbol + ' left undefined'
                );
            },
        }).appendTo(headerBar);

        const contentBox = $('<div>', {
            class: 'sdfv_modal_content_box',
        }).appendTo(dialogue);
        const content = $('<div>', {
            class: 'sdfv_modal_content',
        }).appendTo(contentBox);
        const input = $('<input>', {
            type: 'text',
            class: 'sdfv_modal_input_text',
        }).appendTo(content);
        input.on('keypress', (e) => {
            if (e.key === 'Enter') {
                const val = input.val();
                if (val && typeof val === 'string') {
                    const intval = parseInt(val);
                    if (intval) {
                        dialogueBackground.remove();
                        resolve(intval);
                    }
                }
            }
        });

        dialogueBackground.appendTo(document.body);
        dialogueBackground.show();
        input.trigger('focus');
    });
}

async function resolveSymbols(
    sdfg: JsonSDFG
): Promise<Map<string, number>> {
    const symbolMap = new Map<string, number>();
    const symbols = sdfg.attributes?.symbols ?? {};
    const constants = sdfg.attributes?.constants_prop ?? {};

    for (const symbol in symbols) {
        if (constants[symbol][1]) {
            symbolMap.set(symbol, +constants[symbol][1]);
        } else {
            const symbolValue = await promptDefineSymbol(symbol);
            symbolMap.set(symbol, symbolValue);
        }
    }

    return symbolMap;
}

export async function parseGraph(
    sdfg: DagreGraph, renderer?: LViewRenderer
): Promise<Graph | null> {
    const state = sdfg.node('0') as State;
    const symbolMap = await resolveSymbols(state.sdfg);
    return parseState(state, sdfg, symbolMap, renderer);
}
