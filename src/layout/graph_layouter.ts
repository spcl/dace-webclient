import { Graph } from '../renderer/graph/graph';

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

export class GraphLayouter {

    private static readonly INSTANCE: GraphLayouter = new GraphLayouter();

    private readonly layouter;

    private constructor() {
        this.layouter = new renderLib.layouter.SugiyamaLayouter({
            spaceBetweenComponents: 10,
        });
    }

    public static getInstance(): GraphLayouter {
        return this.INSTANCE;
    }

    public async layoutGraph(graph: Graph): Promise<void> {
        await this.layouter.layout(graph);
    }

}
