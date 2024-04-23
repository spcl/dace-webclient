// Copyright 2019-2024 ETH Zurich and the DaCe authors. All rights reserved.

import $ from 'jquery';
import { DagreGraph, JsonSDFG } from '..';
import {
    AccessNode,
    Edge,
    ExitNode,
    MapEntry,
    SDFGElement,
    SDFGNode,
    State,
    Tasklet,
} from '../renderer/renderer_elements';
import { sdfg_property_to_string } from '../utils/sdfg/display';
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

export class LViewGraphParseError extends Error {}

export class LViewParser {

    private static parseSymbolic(
        symbol: string | number, symbolMap: Map<string, number>
    ): number {
        let result;
        if (typeof symbol === 'number')
            result = symbol;
        else
            result = evaluate(symbol.replaceAll('**', '^'), symbolMap);
        return result;
    }

    private static parseMap(
        elem: MapEntry, graph: Graph, state: State, sdfg: DagreGraph,
        symbolMap: Map<string, number>, renderer?: LViewRenderer
    ): MapNode {
        const rRanges = elem.data.node.attributes.range.ranges;
        const rParams = elem.data.node.attributes.params;
        const ranges = [];
        for (let i = 0; i < rParams.length; i++) {
            const rng = rRanges[i];

            const start = this.parseSymbolic(rng.start, symbolMap);
            const end = this.parseSymbolic(rng.end, symbolMap);
            const step = this.parseSymbolic(rng.step, symbolMap);

            ranges.push({
                itvar: rParams[i],
                start: start,
                end: end,
                step: step,
            });
        }

        const innerGraph = new Graph(renderer);
        const mapScopeDict = state.data.state.scope_dict[elem.id];
        if (mapScopeDict) {
            const scopeEdges = new Set<{
                v: string,
                w: string,
                name: string,
            }>();
            for (const id of mapScopeDict) {
                const childElem = this.parseElement(
                    graph, state.data.graph.node(id), state, sdfg, symbolMap,
                    renderer
                );
                if (childElem) {
                    innerGraph.addChild(childElem);

                    const iedges = state.data.graph.inEdges(id);
                    for (const iedge of iedges)
                        scopeEdges.add(iedge);
                    const oedges = state.data.graph.outEdges(id);
                    for (const oedge of oedges)
                        scopeEdges.add(oedge);
                }
            }

            for (const edge of scopeEdges) {
                const elem = this.parseEdge(
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
        elem.data.node.attributes.lview_node = node;
        return node;
    }

    private static findAccessNodeForContainer(
        name: string, state: State
    ): AccessNode | undefined {
        for (const nid of state.data.graph.nodes()) {
            const node = state.data.graph.node(nid);
            if (node instanceof AccessNode && node.attributes().data === name)
                return node;
        }
        return undefined;
    }

    private static getOrCreateContainer(
        name: string, graph: Graph, state: State,
        symbolMap: Map<string, number>, elem?: AccessNode
    ): DataContainer | null {
        if (name) {
            const sdfgContainer = state.sdfg.attributes._arrays[name];
            let container = graph.dataContainers.get(name);
            if (!container) {
                const dimensions = [];
                for (const s of sdfgContainer.attributes.shape ?? []) {
                    const val = this.parseSymbolic(s, symbolMap);
                    dimensions.push(new DataDimension(s.toString(), val));
                }
                if (!elem)
                    elem = this.findAccessNodeForContainer(name, state);
                const storageType = elem ?
                    MemoryLocationOverlay.getStorageType(elem) :
                    undefined;
                const strides: DataDimension[] = [];
                const sdfgStrides = sdfgContainer.attributes.strides;
                if (sdfgStrides) {
                    for (let i = 0; i < sdfgStrides.length; i++) {
                        const currStride = sdfgStrides[i];
                        const strideDim = new DataDimension(
                            currStride,
                            this.parseSymbolic(currStride, symbolMap)
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
                    sdfgContainer.attributes.start_offset ?? 0,
                    sdfgContainer.attributes.alignment ?? 0,
                    storageType?.type,
                    strides
                );
                graph.dataContainers.set(name, container);
            } else if (container.storage === undefined) {
                if (!elem)
                    elem = this.findAccessNodeForContainer(name, state);
                const storageType = elem ?
                    MemoryLocationOverlay.getStorageType(elem) :
                    undefined;
                container.storage = storageType?.type;
            }
            return container;
        }
        return null;
    }

    private static parseAccessNode(
        element: AccessNode, graph: Graph, state: State,
        symbolMap: Map<string, number>, renderer?: LViewRenderer
    ): MemoryNode | null {
        const container = this.getOrCreateContainer(
            element.attributes().data, graph, state, symbolMap, element
        );
        if (container) {
            const node = new MemoryNode(
                element.id.toString(), graph, container, AccessMode.ReadWrite,
                undefined, undefined, renderer
            );
            element.data.node.attributes.lview_node = node;
            return node;
        }
        return null;
    }

    private static getMemletAccess(
        edge: Edge, mode: AccessMode, graph: Graph, state: State,
        symbolMap: Map<string, number>
    ): SymbolicDataAccess | null {
        const attributes = edge.attributes();
        const dataContainer = this.getOrCreateContainer(
            attributes.data, graph, state, symbolMap
        );
        const ranges = attributes.other_subset ?
            attributes.other_subset.ranges : attributes.subset?.ranges;
        const volume = this.parseSymbolic(
            attributes.num_accesses ?? 0, symbolMap
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
        return null;
    }

    private static parseTasklet(
        graph: Graph, el: Tasklet, state: State, sdfg: DagreGraph,
        symbolMap: Map<string, number>, renderer?: LViewRenderer
    ): ComputationNode {
        const label = el.attributes().code?.string_data;
        const farLabel = el.attributes().label;

        const accessOrder: SymbolicDataAccess[] = [];
        for (const iedgeId of state.data.graph.inEdges(el.id.toString())) {
            const iedge: Edge = state.data.graph.edge(iedgeId);
            if (iedge) {
                const accesses = this.getMemletAccess(
                    iedge, AccessMode.ReadOnly, graph, state, symbolMap
                );
                if (accesses)
                    accessOrder.push(accesses);
            }
        }
        for (const oedgeId of state.data.graph.outEdges(el.id.toString())) {
            const oedge = state.data.graph.edge(oedgeId);
            if (oedge) {
                const accesses = this.getMemletAccess(
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
        el.data.node.attributes.lview_node = node;
        return node;
    }

    private static parseEdge(
        graph: Graph, el: { name: string, v: string, w: string }, state: State,
        sdfg: DagreGraph, symbolMap: Map<string, number>,
        renderer?: LViewRenderer
    ): Element | null {
        let src: SDFGNode = state.data.graph.node(el.v);
        if (src instanceof ExitNode)
            src = state.data.graph.node(src.data.node.scope_entry);
        const dst: SDFGNode = state.data.graph.node(el.w);
        const edge: Edge = state.data.graph.edge(el);

        if (src?.attributes().lview_node && dst?.attributes().lview_node &&
            edge) {
            const text = edge.attributes().data + sdfg_property_to_string(
                edge.attributes().subset
            );
            const elem = new MemoryMovementEdge(
                text, graph, edge.points,
                src.attributes().lview_node,
                dst.attributes().lview_node,
                renderer
            );
            edge.data.attributes.lview_edge = elem;
            return elem;
        }

        return null;
    }

    private static parseElement(
        graph: Graph, el: SDFGElement, state: State, sdfg: DagreGraph,
        symbolMap: Map<string, number>, renderer?: LViewRenderer
    ): Element | null {
        if (el instanceof SDFGNode) {
            if (el instanceof AccessNode) {
                return this.parseAccessNode(
                    el, graph, state, symbolMap, renderer
                );
            } else if (el instanceof MapEntry) {
                return this.parseMap(
                    el, graph, state, sdfg, symbolMap, renderer
                );
            } else if (el instanceof Tasklet) {
                return this.parseTasklet(
                    graph, el, state, sdfg, symbolMap, renderer
                );
            }
        }
        return null;
    }

    private static parseState(
        state: State, sdfg: DagreGraph, symbolMap: Map<string, number>,
        renderer?: LViewRenderer
    ): Graph {
        const graph = new Graph(renderer);

        const scopeDict = state.data.state.scope_dict;
        if (scopeDict) {
            const rootScope = [];
            for (const id of scopeDict[-1])
                rootScope.push(state.data.graph.node(id.toString()));

            const rootScopeEdges: Set<{
                name: string,
                v: string,
                w: string,
            }> = new Set();
            for (const el of rootScope) {
                const elem = this.parseElement(
                    graph, el, state, sdfg, symbolMap, renderer
                );
                if (elem)
                    graph.addChild(elem);

                const iedges = state.data.graph.inEdges(el.id.toString());
                for (const iedge of iedges)
                    rootScopeEdges.add(iedge);
                if (el instanceof MapEntry && !el.attributes().is_collapsed) {
                    const exitNode = state.data.graph.node(
                        el.data.node.scope_exit
                    );
                    const oedges = state.data.graph.outEdges(
                        exitNode.id.toString()
                    );
                    for (const oedge of oedges)
                        rootScopeEdges.add(oedge);
                } else {
                    const oedges = state.data.graph.outEdges(el.id.toString());
                    for (const oedge of oedges)
                        rootScopeEdges.add(oedge);
                }
            }

            for (const edge of rootScopeEdges) {
                const elem = this.parseEdge(
                    graph, edge, state, sdfg, symbolMap, renderer
                );
                if (elem)
                    graph.addChild(elem);
            }
        }

        return graph;
    }

    private static async promptDefineSymbol(symbol: string): Promise<number> {
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
                html: '<i class="material-icons">close</i>',
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

    private static async resolveSymbols(
        sdfg: JsonSDFG
    ): Promise<Map<string, number>> {
        const symbolMap = new Map<string, number>();
        const symbols = sdfg.attributes.symbols ?? [];
        const constants = sdfg.attributes.constants_prop ?? [];

        if (symbols) {
            for (const symbol in symbols) {
                if (constants && constants[symbol] && constants[symbol][1]) {
                    symbolMap.set(symbol, constants[symbol][1]);
                } else {
                    const symbolValue = await this.promptDefineSymbol(symbol);
                    symbolMap.set(symbol, symbolValue);
                }
            }
        }

        return symbolMap;
    }

    public static async parseGraph(
        sdfg: DagreGraph, renderer?: LViewRenderer
    ): Promise<Graph | null> {
        const state = sdfg.node('0');
        if (state) {
            const symbolMap = await this.resolveSymbols(state.sdfg);
            return this.parseState(state, sdfg, symbolMap, renderer);
        }
        return null;
    }

}
