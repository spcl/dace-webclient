import dagre from 'dagre';
import { Viewport } from 'pixi-viewport';
import { Application } from 'pixi.js';
import { DagreSDFG, JsonSDFG, SDFGViewer } from '..';
import { Graph } from './graph/graph';
import { ScopedNode } from './graph/graph_element';
import { NestedSDFGNode } from './graph/nested_sdfg_node';
import { SDFG } from './graph/sdfg';
import { State } from './graph/state';

export class Renderer {

    protected readonly app: Application;
    protected readonly viewport: Viewport;
    protected graph: SDFG = new SDFG();

    public constructor(
        protected readonly sdfvInstance: SDFGViewer,
        protected readonly container: JQuery<HTMLElement>,
    ) {
        this.app = new Application({
            resizeTo: container[0],
            backgroundAlpha: 0.0,
            antialias: true,
        });

        container.append(this.app.view);

        this.viewport = new Viewport({
            interaction: this.app.renderer.plugins.interaction,
        });

        this.app.stage.addChild(this.viewport);

        this.viewport.drag().pinch().wheel().decelerate({
            friction: 0.3,
        });

        this.relayout();

        // TODO: Worry about resizing the container.
    }

    public set sdfg(nSdfg: JsonSDFG) {
        this.graph = SDFG.fromJSON(nSdfg);

        this.viewport.removeChildren();
        this.viewport.addChild(this.graph);

        // XXX: Why do we need to draw this twice for it to render correctly?..
        this.relayout();
        this.graph.draw();
        //this.relayout();
        //this.graph.draw();

        console.log(this.graph);
    }

    public get sdfg(): JsonSDFG {
        return this.graph.toJSON();
    }
    
    private layoutGraph(graph: Graph): void {
        const g: DagreSDFG = new dagre.graphlib.Graph();

        g.setGraph({});
        g.setDefaultEdgeLabel(() => {
            return {};
        });

        graph.nodes.forEach(node => {
            // Recurse down for each subgraph.
            if (node instanceof State)
                this.layoutGraph(node.stateGraph);
            else if (node instanceof ScopedNode)
                this.layoutGraph(node.scopedGraph);
            else if (node instanceof NestedSDFGNode)
                this.layoutGraph(node.nestedGraph);

            g.setNode(node.id.toString(), node);
        });

        graph.edges.forEach(edge => {
            g.setEdge(edge.srcId, edge.dstId, edge);
        });

        dagre.layout(g);
    }

    public relayout(): void {
        this.layoutGraph(this.graph);
    }

}
