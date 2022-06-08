import { Viewport } from 'pixi-viewport';
import { Application } from 'pixi.js';
import { DagreSDFG } from '..';
import { AccessNode, MapEntry, SDFGElement, State } from '../renderer/renderer_elements';
import { SDFV } from '../sdfv';
import { AccessMode, DataContainer } from './elements/data_container';
import { DataDimension } from './elements/dimensions';
import { Element } from './elements/element';
import { MapNode } from './elements/map_node';
import { MemoryNode } from './elements/memory_node';
import { Graph } from './graph/graph';

export class LViewRenderer {

    private pixiApp: Application | null = null;
    private viewport: Viewport | null = null;

    public constructor(
        protected sdfvInstance: SDFV,
        protected state: State,
        protected container: HTMLElement,
    ) {
        this.initPixi();
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

    private parseAccessNode(element: any, graph: Graph): MemoryNode {
        const containerName = element.attributes.data;
        const sdfgContainer =
            this.state.sdfg.attributes._arrays[containerName];

        console.log(sdfgContainer);
        
        let container = graph.dataContainers.get(containerName);
        if (!container) {
            const dimensions = [];
            for (const s of sdfgContainer.attributes.shape)
                dimensions.push(new DataDimension(
                    s.toString(), 10 // TODO
                ));
            container = new DataContainer(
                containerName,
                dimensions,
                false, // TODO
                8, // TODO
                sdfgContainer.attributes.start_offset,
                sdfgContainer.attributes.alignment,
                sdfgContainer.attributes.strides
            );
            console.log(container);
        }
        const accessNode = new MemoryNode(graph, container);
        console.log(accessNode);

        graph.addChild(accessNode);
        graph.registerMemoryNode(container, accessNode, AccessMode.ReadWrite);

        return accessNode;
    }

    public parseStateLegacy(): void {
        console.log(this.state);
        const scopeDict = this.state.data.state.scope_dict;
        if (scopeDict) {
            const rootScope = this.state.data.state.nodes.filter(
                (el: any) => {
                    return scopeDict[-1].includes(el.id);
                }
            );

            const graph = new Graph();

            for (const el of rootScope) {
                switch (el.type) {
                    case 'AccessNode':
                        this.parseAccessNode(el, graph);
                        break;
                    case 'MapEntry':
                        // TODO:
                        break;
                    default:
                        break;
                }
                console.log(el);
            }

            this.viewport?.addChild(graph);
            graph.draw();
        }
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

        return new MapNode(graph, ranges, innerGraph);
    }

    private static parseAcccessNode(
        element: AccessNode, graph: Graph, state: State
    ): MemoryNode {
        const containerName = element.attributes().data;
        const sdfgContainer =
            state.sdfg.attributes._arrays[containerName];
        
        let container = graph.dataContainers.get(containerName);
        if (!container) {
            const dimensions = [];
            for (const s of sdfgContainer.attributes.shape) {
                const val = +s;
                dimensions.push(new DataDimension(
                    s.toString(), isNaN(val) ? 0 : val
                ));
            }
            container = new DataContainer(
                containerName,
                dimensions,
                false, // TODO
                8, // TODO
                sdfgContainer.attributes.start_offset,
                sdfgContainer.attributes.alignment,
                sdfgContainer.attributes.strides
            );
            console.log(container);
        }
        const accessNode = new MemoryNode(graph, container);

        graph.addChild(accessNode);
        graph.registerMemoryNode(container, accessNode, AccessMode.ReadWrite);

        return accessNode;
    }

    private static parseElement(
        graph: Graph, el: SDFGElement, state: State, sdfg: DagreSDFG
    ): Element | null {
        if (el instanceof AccessNode)
            return this.parseAcccessNode(el, graph, state);
        else if (el instanceof MapEntry)
            return this.parseMap(el, graph, state, sdfg);
        return null;
    }

    private static parseState(state: State, sdfg: DagreSDFG): Graph {
        const graph = new Graph();

        const scopeDict = state.data.state.scope_dict;
        if (scopeDict) {
            const rootScope = [];
            for (const id of scopeDict[-1])
                rootScope.push(state.data.graph.node(id.toString()));

            for (const el of rootScope)
                this.parseElement(graph, el, state, sdfg);
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
