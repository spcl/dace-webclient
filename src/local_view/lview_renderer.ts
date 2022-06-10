import { Viewport } from 'pixi-viewport';
import { Application } from 'pixi.js';
import { DagreSDFG } from '..';
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
import { SDFV } from '../sdfv';
import { ComputationNode } from './elements/computation_node';
import {
    AccessMode,
    DataContainer,
    SymbolicDataAccess,
} from './elements/data_container';
import { DataDimension } from './elements/dimensions';
import { Element } from './elements/element';
import { MapNode } from './elements/map_node';
import { MemoryMovementEdge } from './elements/memory_movement_edge';
import { MemoryNode } from './elements/memory_node';
import { Graph } from './graph/graph';

export class LViewGraphParseError extends Error {}

export class LViewRenderer {

    private pixiApp: Application | null = null;
    private viewport: Viewport | null = null;

    public constructor(
        protected sdfvInstance: SDFV,
        protected graph: Graph,
        protected container: HTMLElement,
    ) {
        this.initPixi();

        this.viewport?.addChild(this.graph);
        this.graph.draw();
    }

    private initPixi(): void {
        const containerRect = this.container.getBoundingClientRect();
        this.pixiApp = new Application({
            width: containerRect.width - 10,
            height: containerRect.height - 10,
            backgroundAlpha: 0.0,
            antialias: true,
        });

        this.container.appendChild(this.pixiApp.view);

        this.viewport = new Viewport({
            screenWidth: containerRect.width,
            screenHeight: containerRect.height,
            interaction: this.pixiApp.renderer.plugins.interaction,
        });

        this.pixiApp.stage.addChild(this.viewport);

        this.viewport
            .drag()
            .pinch()
            .wheel()
            .decelerate({
                friction: 0.3,
            });
    }

    public destroy(): void {
        if (this.pixiApp)
            this.container.removeChild(this.pixiApp.view);
    }

    private static parseMap(
        elem: MapEntry, graph: Graph, state: State, sdfg: DagreSDFG
    ): MapNode {
        const rRanges = elem.data.node.attributes.range.ranges;
        const rParams = elem.data.node.attributes.params;
        const ranges = [];
        for (let i = 0; i < rParams.length; i++) {
            const rng = rRanges[i];
            const start = +rng.start;
            const end = +rng.end;
            const step = +rng.step;
            
            ranges.push({
                itvar: rParams[i],
                start: isNaN(start) ? rng.start : start,
                end: isNaN(end) ? rng.end : end,
                step: isNaN(step) ? rng.step : step,
            });
        }
        
        const innerGraph = new Graph();
        const mapScopeDict = state.data.state.scope_dict[elem.id];
        if (mapScopeDict) {
            for (const id of mapScopeDict) {
                const childElem = this.parseElement(
                    graph, state.data.graph.node(id), state, sdfg
                );
                if (childElem)
                    innerGraph.addChild(childElem);
            }
        }

        const node = new MapNode(elem.id.toString(), graph, ranges, innerGraph);
        elem.data.node.attributes.lview_node = node;
        return node;
    }

    private static getOrCreateContainer(
        name: string, graph: Graph, state: State
    ): DataContainer | null {
        if (name) {
            const sdfgContainer = state.sdfg.attributes._arrays[name];
            let container = graph.dataContainers.get(name);
            if (!container) {
                const dimensions = [];
                for (const s of sdfgContainer.attributes.shape) {
                    const val = +s;
                    dimensions.push(new DataDimension(
                        s.toString(), isNaN(val) ? 0 : val
                    ));
                }
                container = new DataContainer(
                    name,
                    dimensions,
                    false, // TODO
                    8, // TODO
                    sdfgContainer.attributes.start_offset,
                    sdfgContainer.attributes.alignment,
                    sdfgContainer.attributes.strides
                );
                graph.dataContainers.set(name, container);
            }
            return container;
        }
        return null;
    }

    private static parseAcccessNode(
        element: AccessNode, graph: Graph, state: State
    ): MemoryNode | null {
        const container = this.getOrCreateContainer(
            element.attributes().data, graph, state
        );
        if (container) {
            const node = new MemoryNode(
                element.id.toString(), graph, container, AccessMode.ReadWrite
            );
            element.data.node.attributes.lview_node = node;
            return node;
        }
        return null;
    }

    private static getMemletAccess(
        edge: Edge, mode: AccessMode, graph: Graph, state: State
    ): SymbolicDataAccess | null {
        const attributes = edge.attributes();
        const dataContainer = this.getOrCreateContainer(
            attributes.data, graph, state
        );
        const ranges = attributes.other_subset ?
            attributes.other_subset.ranges : attributes.subset.ranges;
        const volume = +attributes.num_accesses;
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
                // TODO: How should we handle this? We can't necessarily
                // derive the exact access order for this type of
                // access if there is no exact subset. Typically this
                // will be a range and we could only give an upper
                // bound.
                throw new LViewGraphParseError(
                    'This subgraph cannot be statically analyzed for data ' +
                    'access patterns due to data dependent executions.'
                );
            }
        }
        return null;
    }

    private static parseTasklet(
        graph: Graph, el: Tasklet, state: State, sdfg: DagreSDFG
    ): ComputationNode {
        const label = el.attributes().code?.string_data;
        const farLabel = el.attributes().label;

        const accessOrder: SymbolicDataAccess[] = [];
        for (const iedgeId of state.data.graph.inEdges(el.id.toString())) {
            const iedge: Edge = state.data.graph.edge(iedgeId);
            if (iedge) {
                const accesses = this.getMemletAccess(
                    iedge, AccessMode.ReadOnly, graph, state
                );
                if (accesses)
                    accessOrder.push(accesses);
            }
        }
        for (const oedgeId of state.data.graph.outEdges(el.id.toString())) {
            const oedge = state.data.graph.edge(oedgeId);
            if (oedge) {
                const accesses =
                    this.getMemletAccess(oedge, AccessMode.Write, graph, state);
                if (accesses)
                    accessOrder.push(accesses);
            }
        }

        return new ComputationNode(
            el.id.toString(), graph, label, accessOrder, farLabel
        );
    }

    private static parseEdge(
        graph: Graph, el: { name: string, v: string, w: string }, state: State,
        sdfg: DagreSDFG
    ): Element | null {
        let src: SDFGNode = state.data.graph.node(el.v);
        if (src instanceof ExitNode)
            src = state.data.graph.node(src.data.node.scope_entry);
        const dst: SDFGNode = state.data.graph.node(el.w);
        const edge: Edge = state.data.graph.edge(el);

        if (src?.attributes().lview_node && dst?.attributes().lview_node &&
            edge) {
            let text = edge.attributes().data;
            let sep = '[';
            for (const rng of edge.attributes().subset.ranges) {
                text += sep +
                    (rng.start != rng.end ?
                        rng.start + ':' + rng.end : rng.start) +
                    (rng.step != '1' ? ':' + rng.step : '');
                sep = ',';
            }
            text += ']';
            const elem = new MemoryMovementEdge(
                text, graph, edge.points,
                src.attributes().lview_node,
                dst.attributes().lview_node
            );
            edge.data.attributes.lview_edge = elem;
            return elem;
        }
        
        return null;
    }

    private static parseElement(
        graph: Graph, el: SDFGElement, state: State, sdfg: DagreSDFG
    ): Element | null {
        if (el instanceof SDFGNode) {
            if (el instanceof AccessNode)
                return this.parseAcccessNode(el, graph, state);
            else if (el instanceof MapEntry)
                return this.parseMap(el, graph, state, sdfg);
            else if (el instanceof Tasklet)
                return this.parseTasklet(graph, el, state, sdfg);
        }
        return null;
    }

    private static parseState(state: State, sdfg: DagreSDFG): Graph {
        const graph = new Graph();

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
                const elem = this.parseElement(graph, el, state, sdfg);
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
                const elem = this.parseEdge(graph, edge, state, sdfg);
                if (elem)
                    graph.addChild(elem);
            }
        }

        return graph;
    }

    public static parseGraph(sdfg: DagreSDFG): Graph | null {
        const state = sdfg.node('0');
        if (state)
            return this.parseState(state, sdfg);
        return null;
    }

}
