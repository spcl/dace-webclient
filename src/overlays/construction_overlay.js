import { NestedSDFG } from '../renderer/renderer_elements';
import { GenericSdfgOverlay } from './generic_sdfg_overlay';


export class ConstructionOverlay extends GenericSdfgOverlay {

    constructor(overlay_manager, renderer) {
        super(
            overlay_manager,
            renderer,
            GenericSdfgOverlay.OVERLAY_TYPE.CONSTRUCTION
        );
    }

    shade_node(node, ctx) {
        node.shade(this.renderer, ctx, '#f80000', 0.1);
    }

    recursively_shade_sdfg(graph, ctx, visible_rect) {
        // We shade a highlight for items being added. We only shade what is
        // visible.
        graph.nodes().forEach(v => {
            let state = graph.node(v);

            // If the node's invisible, we skip it.
            if (ctx.lod && !state.intersect(visible_rect.x, visible_rect.y,
                visible_rect.w, visible_rect.h))
                return;

            // Shade the state
            if (state.data.state.attributes.in_construction)
                this.shade_node(state, ctx);

            if (!state.data.state.attributes.is_collapsed) {
                let state_graph = state.data.graph;
                if (state_graph) {
                    state_graph.nodes().forEach(v => {
                        let node = state_graph.node(v);

                        // Skip the node if it's not visible.
                        if (ctx.lod && !node.intersect(visible_rect.x,
                            visible_rect.y, visible_rect.w, visible_rect.h))
                            return;

                        // Shade the node
                        if (node.data.node.attributes.in_construction)
                            this.shade_node(node, ctx);

                        // Descend recursively
                        if (node instanceof NestedSDFG && !node.data.node.attributes.is_collapsed) {
                            this.recursively_shade_sdfg(node.data.graph, ctx, visible_rect);
                        }
                    });
                }
            }
        });
    }

    draw() {
        this.recursively_shade_sdfg(
            this.renderer.graph,
            this.renderer.ctx,
            this.renderer.visible_rect
        );
    }

}
