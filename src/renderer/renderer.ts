import { Viewport } from 'pixi-viewport';
import { Application } from 'pixi.js';
import { JsonSDFG, SDFGViewer } from '..';
import { GraphLayouter } from '../layout/graph_layouter';
import { SDFG } from './graph/sdfg';

declare const renderLib: {
    layouter: {
        DagreLayouter: any,
        MagneticSpringLayouter: any,
        SugiyamaLayouter: any,
    },
    renderer: {
        PixiRenderer: any,
        SvgRenderer: any,
    },
    renderGraph: {
        GenericContainerNode: any,
        GenericNode: any,
        GenericEdge: any,
        RenderGraph: any,
    },
};

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

        // TODO: Worry about resizing the container.
    }

    public set sdfg(nSdfg: JsonSDFG) {
        this.graph = SDFG.fromJSON(nSdfg);

        this.viewport.removeChildren();
        this.viewport.addChild(this.graph);

        GraphLayouter.getInstance().layoutGraph(this.graph).then(() => {
            this.graph.draw();
        });
    }

    public get sdfg(): JsonSDFG {
        return this.graph.toJSON();
    }
    
    /*
    public static layoutGraph(graph: Graph): void {
        const g: DagreSDFG = new dagre.graphlib.Graph();

        g.setGraph({
        });
        g.setDefaultEdgeLabel(() => {
            return {};
        });

        console.log('layoutGraph', graph);
        
        graph.nodes.forEach(node => {
            // Recurse down for each subgraph.
            //if (node instanceof State)
            //    Renderer.layoutGraph(node.stateGraph);
            //else if (node instanceof ScopedNode)
            //    Renderer.layoutGraph(node.scopedGraph);
            //else if (node instanceof NestedSDFGNode)
            //    Renderer.layoutGraph(node.nestedGraph);

            g.setNode(node.id.toString(), node);
        });

        graph.edges.forEach(edge => {
            g.setEdge(edge.srcId, edge.dstId, edge);
        });

        dagre.layout(g);
    }
    */

}
