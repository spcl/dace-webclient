// Copyright 2019-2020 ETH Zurich and the DaCe authors. All rights reserved.

class CanvasManager {
    // Manages translation and scaling of canvas rendering

    static counter() {
        return _canvas_manager_counter++;
    }
    constructor(ctx, renderer, canvas) {
        this.ctx = ctx;
        this.ctx.lod = true;
        this.canvas = canvas;
        this.anim_id = null;
        this.prev_time = null;
        this.drawables = [];
        this.renderer = renderer;
        this.indices = [];

        // Animation-related fields
        this.animating = false;
        this.animate_target = null;

        this.request_scale = false;
        this.scalef = 1.0;

        this._destroying = false;

        this.scale_origin = { x: 0, y: 0 };

        this.contention = 0;

        this._svg = document.createElementNS("http://www.w3.org/2000/svg", 'svg');

        this.user_transform = this._svg.createSVGMatrix();

        this.addCtxTransformTracking();
    }

    stopAnimation() {
        this.animating = false;
    }

    svgPoint(x, y) {
        let pt = this._svg.createSVGPoint();
        pt.x = x; pt.y = y;
        return pt;
    }

    applyUserTransform() {
        let ut = this.user_transform;
        this.ctx.setTransform(ut.a, ut.b, ut.c, ut.d, ut.e, ut.f);
    }

    get translation() {
        return { x: this.user_transform.e, y: this.user_transform.f };
    }

    addCtxTransformTracking() {
        /* This function is a hack to provide the non-standardized functionality
        of getting the current transform from a RenderingContext.
        When (if) this is standardized, the standard should be used instead.
        This is made for "easy" transforms and does not support saving/restoring
        */

        let svg = document.createElementNS("http://www.w3.org/2000/svg", 'svg');
        this.ctx._custom_transform_matrix = svg.createSVGMatrix();
        // Save/Restore is not supported.

        let checker = () => {
            console.assert(!isNaN(this.ctx._custom_transform_matrix.f));
        };
        let _ctx = this.ctx;
        let scale_func = _ctx.scale;
        _ctx.scale = function (sx, sy) {
            _ctx._custom_transform_matrix = _ctx._custom_transform_matrix.scaleNonUniform(sx, sy);
            checker();
            return scale_func.call(_ctx, sx, sy);
        };
        let translate_func = _ctx.translate;
        _ctx.translate = function (sx, sy) {
            _ctx._custom_transform_matrix = _ctx._custom_transform_matrix.translate(sx, sy);
            checker();
            return translate_func.call(_ctx, sx, sy);
        };
        let rotate_func = _ctx.rotate;
        _ctx.rotate = function (r) {
            _ctx._custom_transform_matrix = _ctx._custom_transform_matrix.rotate(r * 180.0 / Math.PI);
            checker();
            return rotate_func.call(_ctx, r);
        };
        let transform_func = _ctx.scale;
        _ctx.transform = function (a, b, c, d, e, f) {
            let m2 = svg.createSVGMatrix();
            m2.a = a; m2.b = b; m2.c = c; m2.d = d; m2.e = e; m2.f = f;
            _ctx._custom_transform_matrix = _ctx._custom_transform_matrix.multiply(m2);
            checker();
            return transform_func.call(_ctx, a, b, c, d, e, f);
        };

        let setTransform_func = _ctx.setTransform;
        _ctx.setTransform = function (a, b, c, d, e, f) {
            _ctx._custom_transform_matrix.a = a;
            _ctx._custom_transform_matrix.b = b;
            _ctx._custom_transform_matrix.c = c;
            _ctx._custom_transform_matrix.d = d;
            _ctx._custom_transform_matrix.e = e;
            _ctx._custom_transform_matrix.f = f;
            checker();
            return setTransform_func.call(_ctx, a, b, c, d, e, f);
        };

        _ctx.custom_inverseTransformMultiply = function (x, y) {
            let pt = svg.createSVGPoint();
            pt.x = x; pt.y = y;
            checker();
            return pt.matrixTransform(_ctx._custom_transform_matrix.inverse());
        }
    }

    destroy() {
        this._destroying = true;
        this.clearDrawables();
    }

    addDrawable(obj) {
        this.drawables.push(obj);
        this.indices.push({ "c": CanvasManager.counter(), "d": obj });
    }

    removeDrawable(drawable) {
        this.drawables = this.drawables.filter(x => x != drawable);
    }

    clearDrawables() {
        for (let x of this.drawables) {
            x.destroy();
        }
        this.drawables = [];
        this.indices = [];
    }

    isBlank() {
        const ctx = this.canvas.getContext('2d');
        let topleft = ctx.getImageData(0,0,1,1).data;
        if (topleft[0] != 0 || topleft[1] != 0 || topleft[2] != 0 || topleft[3] != 255)
            return false;

        const pixelBuffer = new Uint32Array(
            ctx.getImageData(0, 0, this.canvas.width, this.canvas.height).data.buffer
        );

        return !pixelBuffer.some(color => color !== 0xff000000);
    }

    scale(diff, x = 0, y = 0) {
        this.stopAnimation();
        if (this.request_scale || this.contention > 0) {
            return;
        }
        this.contention++;
        this.request_scale = true;
        if(this.isBlank()) {
            this.renderer.bgcolor = 'black';
            this.renderer.zoom_to_view();
            diff = 0.01;
        }

        this.scale_origin.x = x;
        this.scale_origin.y = y;

        let sv = diff;
        let pt = this.svgPoint(this.scale_origin.x, this.scale_origin.y).matrixTransform(this.user_transform.inverse());
        this.user_transform = this.user_transform.translate(pt.x, pt.y);
        this.user_transform = this.user_transform.scale(sv, sv, 1, 0, 0, 0);
        this.scalef *= sv;
        this.user_transform = this.user_transform.translate(-pt.x, -pt.y);

        this.contention--;
    }

    // Sets the view to the square around the input rectangle
    set_view(rect) {
        this.stopAnimation();
        this.user_transform = this._svg.createSVGMatrix();
        let canvas_w = this.canvas.width;
        let canvas_h = this.canvas.height;
        if (canvas_w == 0 || canvas_h == 0)
            return;

        let scale = 1, tx = 0, ty = 0;
        if (rect.width > rect.height) {
            scale = canvas_w / rect.width;
            tx = -rect.x;
            ty = -rect.y - (rect.height / 2) + (canvas_h / scale / 2);

            // Now other dimension does not fit, scale it as well
            if (rect.height * scale > canvas_h) {
                scale = canvas_h / rect.height;
                tx = -rect.x - (rect.width / 2) + (canvas_w / scale / 2);
                ty = -rect.y;
            }
        } else {
            scale = canvas_h / rect.height;
            tx = -rect.x - (rect.width / 2) + (canvas_w / scale / 2);
            ty = -rect.y;

            // Now other dimension does not fit, scale it as well
            if (rect.width * scale > canvas_w) {
                scale = canvas_w / rect.width;
                tx = -rect.x;
                ty = -rect.y - (rect.height / 2) + (canvas_h / scale / 2);
            }
        }

        // Uniform scaling
        this.user_transform = this.user_transform.scale(scale, scale, 1, 0, 0, 0);
        this.user_transform = this.user_transform.translate(tx, ty);
        this.scale_origin = { x: 0, y: 0 };
        this.scalef = 1.0;
    }

    translate(x, y) {
        this.stopAnimation();
        this.user_transform = this.user_transform.translate(x / this.user_transform.a, y / this.user_transform.d);
    }

    /**
     * Move/translate an element in the graph by a change in x and y.
     * @param {*} el                Element to move
     * @param {*} old_mousepos      Old mouse position in canvas coordinates
     * @param {*} new_mousepos      New mouse position in canvas coordinates
     * @param {*} entire_graph      Reference to the entire graph
     * @param {*} sdfg_list         List of SDFGs and nested SDFGs
     * @param {*} state_parent_list List of parent elements to SDFG states
     */
    translate_element(el, old_mousepos, new_mousepos, entire_graph, sdfg_list,
        state_parent_list, drag_start) {
        this.stopAnimation();

        // Edges connected to the moving element
        let out_edges = [];
        let in_edges = [];

        // Find the parent graph in the list of available SDFGs
        let parent_graph = sdfg_list[el.sdfg.sdfg_list_id];
        let parent_element = null;

        if (entire_graph !== parent_graph && (el.data.state || el.data.type == 'InterstateEdge')) {
            // If the parent graph and the entire SDFG shown are not the same,
            // we're currently in a nested SDFG. If we're also moving a state,
            // this means that its parent element is found in the list of
            // parents to states (state_parent_list)
            parent_element = state_parent_list[el.sdfg.sdfg_list_id];
        } else if (el.parent_id !== null && parent_graph) {
            // If the parent_id isn't null and there is a parent graph, we can
            // look up the parent node via the element's parent_id
            parent_element = parent_graph.node(el.parent_id);
            // If our parent element is a state, we want the state's graph
            if (parent_element.data.state)
                parent_graph = parent_element.data.graph;
        }

        if (parent_graph && !(el instanceof Edge)) {
            // Find all the edges connected to the moving node
            parent_graph.outEdges(el.id).forEach(edge_id => {
                out_edges.push(parent_graph.edge(edge_id));
            });
            parent_graph.inEdges(el.id).forEach(edge_id => {
                in_edges.push(parent_graph.edge(edge_id));
            });
        }

        // Compute theoretical initial displacement/movement
        let dx = new_mousepos.x - old_mousepos.x;
        let dy = new_mousepos.y - old_mousepos.y;

        // If edge, find closest point to drag start position
        let pt = -1;
        if (el instanceof Edge) {
            // Find closest point to old mouse position
            if (drag_start.edge_point === undefined) {
                let dist = null;
                el.points.forEach((p, i) => {
                    // Only allow dragging if the memlet has more than two points
                    if (i == 0 || i == el.points.length - 1)
                        return;
                    let ddx = p.x - drag_start.cx;
                    let ddy = p.y - drag_start.cy;
                    let curdist = ddx*ddx + ddy*ddy;
                    if (dist === null || curdist < dist) {
                        dist = curdist;
                        pt = i;
                    }
                });
                drag_start.edge_point = pt;
            } else
                pt = drag_start.edge_point;
        }

        if (parent_element) {
            // Calculate the box to bind the element to. This is given by
            // the parent element, i.e. the element where out to-be-moved
            // element is contained within
            const parent_left_border =
                (parent_element.x - (parent_element.width / 2));
            const parent_right_border =
                parent_left_border + parent_element.width;
            const parent_top_border =
                (parent_element.y - (parent_element.height / 2));
            const parent_bottom_border =
                parent_top_border + parent_element.height;

            let el_h_margin = el.height / 2;
            let el_w_margin = el.width / 2;
            if (el instanceof Edge) {
                el_h_margin = el_w_margin = 0;
            }
            const min_x = parent_left_border + el_w_margin;
            const min_y = parent_top_border + el_h_margin;
            const max_x = parent_right_border - el_w_margin;
            const max_y = parent_bottom_border - el_h_margin;

            // Make sure we don't move our element outside its parent's
            // bounding box. If either the element or the mouse pointer are
            // outside the parent, we clamp movement in that direction
            if (el instanceof Edge) {
                if (pt > 0) {
                    let target_x = el.points[pt].x + dx;
                    let target_y = el.points[pt].y + dy;
                    if (target_x <= min_x ||
                        new_mousepos.x <= parent_left_border) {
                        dx = min_x - el.points[pt].x;
                    } else if (target_x >= max_x ||
                        new_mousepos.x >= parent_right_border) {
                        dx = max_x - el.points[pt].x;
                    }
                    if (target_y <= min_y ||
                        new_mousepos.y <= parent_top_border) {
                        dy = min_y - el.points[pt].y;
                    } else if (target_y >= max_y ||
                        new_mousepos.y >= parent_bottom_border) {
                        dy = max_y - el.points[pt].y;
                    }
                }
            } else {
                let target_x = el.x + dx;
                let target_y = el.y + dy;
                if (target_x <= min_x ||
                    new_mousepos.x <= parent_left_border) {
                    dx = min_x - el.x;
                } else if (target_x >= max_x ||
                    new_mousepos.x >= parent_right_border) {
                    dx = max_x - el.x;
                }
                if (target_y <= min_y ||
                    new_mousepos.y <= parent_top_border) {
                    dy = min_y - el.y;
                } else if (target_y >= max_y ||
                    new_mousepos.y >= parent_bottom_border) {
                    dy = max_y - el.y;
                }
            }
        }

        if (el instanceof Edge) {
            if (pt > 0) {
                // Move point
                el.points[pt].x += dx;
                el.points[pt].y += dy;
                
                // Move edge bounding box
                updateEdgeBoundingBox(el);
            }
            // The rest of the method doesn't apply to Edges
            return;
        }

        // Move a node together with its connectors if it has any
        function move_node_and_connectors(node) {
            node.x += dx;
            node.y += dy;
            if (node.data.node && node.data.node.type === 'NestedSDFG')
                translate_recursive(node.data.graph);
            if (node.in_connectors)
                node.in_connectors.forEach(c => {
                    c.x += dx;
                    c.y += dy;
                });
            if (node.out_connectors)
                node.out_connectors.forEach(c => {
                    c.x += dx;
                    c.y += dy;
                });
        }

        // Allow recursive translation of nested SDFGs
        function translate_recursive(ng) {
            ng.nodes().forEach(state_id => {
                const state = ng.node(state_id);
                state.x += dx;
                state.y += dy;
                const g = state.data.graph;
                if (g) {
                    g.nodes().forEach(node_id => {
                        const node = g.node(node_id);
                        move_node_and_connectors(node);
                    });

                    g.edges().forEach(edge_id => {
                        const edge = g.edge(edge_id);
                        edge.x += dx;
                        edge.y += dy;
                        edge.points.forEach(point => {
                            point.x += dx;
                            point.y += dy;
                        });
                        updateEdgeBoundingBox(edge);
                    });
                }
            });
            ng.edges().forEach(edge_id => {
                const edge = ng.edge(edge_id);
                edge.x += dx;
                edge.y += dy;
                edge.points.forEach(point => {
                    point.x += dx;
                    point.y += dy;
                });
                updateEdgeBoundingBox(edge);
            });
        }

        // Move the node
        move_node_and_connectors(el);

        if (el.data.state && !el.data.state.attributes.is_collapsed) {
            // We're moving a state, move all its contained elements
            const graph = el.data.graph;
            graph.nodes().forEach(node_id => {
                const node = graph.node(node_id);
                move_node_and_connectors(node);
            });

            // Drag all the edges along
            graph.edges().forEach(edge_id => {
                const edge = graph.edge(edge_id);
                edge.x += dx;
                edge.y += dy;
                edge.points.forEach(point => {
                    point.x += dx;
                    point.y += dy;
                });
                updateEdgeBoundingBox(edge);
            });
        }

        // Move the connected edges along with the element
        out_edges.forEach(edge => {
            const n = edge.points.length - 1;
            let moved = false;
            if (edge.src_connector !== null) {
                for (let i = 0; i < el.out_connectors.length; i++) {
                    if (el.out_connectors[i].data.name === edge.src_connector) {
                        edge.points[0] = dagre.util.intersectRect(el.out_connectors[i], edge.points[1]);
                        moved = true;
                        break;
                    }
                }
            }
            if (!moved) {
                edge.points[0].x += dx;
                edge.points[0].y += dy;
            }
            updateEdgeBoundingBox(edge);
        });
        in_edges.forEach(edge => {
            const n = edge.points.length - 1;
            let moved = false;
            if (edge.dst_connector !== null) {
                for (let i = 0; i < el.in_connectors.length; i++) {
                    if (el.in_connectors[i].data.name === edge.dst_connector) {
                        edge.points[n] = dagre.util.intersectRect(el.in_connectors[i], edge.points[n-1]);
                        moved = true;
                        break;
                    }
                }
            }
            if (!moved) {
                edge.points[n].x += dx;
                edge.points[n].y += dy;
            }
            updateEdgeBoundingBox(edge);
        });
    }

    mapPixelToCoordsX(xpos) {
        return this.svgPoint(xpos, 0).matrixTransform(this.user_transform.inverse()).x;
    }

    mapPixelToCoordsY(ypos) {
        return this.svgPoint(0, ypos).matrixTransform(this.user_transform.inverse()).y;
    }

    noJitter(x) {
        x = parseFloat(x.toFixed(3));
        x = Math.round(x * 100) / 100;
        return x;
    }

    points_per_pixel() {
        // Since we are using uniform scaling, (bottom-top)/height and
        // (right-left)/width should be equivalent
        let left = this.mapPixelToCoordsX(0);
        let right = this.mapPixelToCoordsX(this.canvas.width);
        return (right - left) / this.canvas.width;
    }

    draw(now = null) {
        if (this._destroying)
            return;

        let dt = now - this.prev_time;
        if (!now || !this.prev_time)
            dt = null;
        if (now)
            this.prev_time = now;

        if (this.contention > 0) return;
        this.contention += 1;
        let ctx = this.ctx;

        // Clear with default transform
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
        ctx.fillStyle = this.renderer.bgcolor;
        ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
        ctx.restore();

        if (this.request_scale && this.contention == 1) {
            // Reset the translation
            this.applyUserTransform();
            this.request_scale = false;
        }
        else
            this.applyUserTransform();

        this.renderer.draw(dt);
        this.contention -= 1;

        if (this.animating) {
            if (!this.animate_target)
                this.animating = false;
            this.draw_async();
        }
    }

    draw_async() {
        this.anim_id = window.requestAnimationFrame((now) => this.draw(now));
    }
}

function getQuadraticAngle(t, sx, sy, cp1x, cp1y, ex, ey) {
    let dx = 2 * (1 - t) * (cp1x - sx) + 2 * t * (ex - cp1x);
    let dy = 2 * (1 - t) * (cp1y - sy) + 2 * t * (ey - cp1y);
    return -Math.atan2(dx, dy) + 0.5 * Math.PI;
}

function calculateBoundingBox(g) {
    // iterate over all objects, calculate the size of the bounding box
    let bb = {};
    bb.width = 0;
    bb.height = 0;

    g.nodes().forEach(function (v) {
        let x = g.node(v).x + g.node(v).width / 2.0;
        let y = g.node(v).y + g.node(v).height / 2.0;
        if (x > bb.width) bb.width = x;
        if (y > bb.height) bb.height = y;
    });

    return bb;
}

function boundingBox(elements) {
    let bb = { x1: null, y1: null, x2: null, y2: null };

    elements.forEach(function (v) {
        let topleft = v.topleft();
        if (bb.x1 === null || topleft.x < bb.x1) bb.x1 = topleft.x;
        if (bb.y1 === null || topleft.y < bb.y1) bb.y1 = topleft.y;

        let x2 = v.x + v.width / 2.0;
        let y2 = v.y + v.height / 2.0;

        if (bb.x2 === null || x2 > bb.x2) bb.x2 = x2;
        if (bb.y2 === null || y2 > bb.y2) bb.y2 = y2;
    });

    return { x: bb.x1, y: bb.y1, width: bb.x2 - bb.x1, height: bb.y2 - bb.y1 };
}

function calculateEdgeBoundingBox(edge) {
    // iterate over all points, calculate the size of the bounding box
    let bb = {};
    bb.x1 = edge.points[0].x;
    bb.y1 = edge.points[0].y;
    bb.x2 = edge.points[0].x;
    bb.y2 = edge.points[0].y;

    edge.points.forEach(function (p) {
        bb.x1 = p.x < bb.x1 ? p.x : bb.x1;
        bb.y1 = p.y < bb.y1 ? p.y : bb.y1;
        bb.x2 = p.x > bb.x2 ? p.x : bb.x2;
        bb.y2 = p.y > bb.y2 ? p.y : bb.y2;
    });

    bb = {
        'x': bb.x1, 'y': bb.y1, 'width': (bb.x2 - bb.x1),
        'height': (bb.y2 - bb.y1)
    };
    if (bb.width <= 5) {
        bb.width = 10;
        bb.x -= 5;
    }
    if (bb.height <= 5) {
        bb.height = 10;
        bb.y -= 5;
    }
    return bb;
}

function updateEdgeBoundingBox(edge) {
    let bb = calculateEdgeBoundingBox(edge);
    edge.x = bb.x + bb.width/2;
    edge.y = bb.y + bb.height/2;
    edge.width = bb.width;
    edge.height = bb.height;
}

function calculateNodeSize(sdfg_state, node, ctx) {
    let labelsize = ctx.measureText(node.label).width;
    let inconnsize = 2 * LINEHEIGHT * Object.keys(node.attributes.layout.in_connectors).length - LINEHEIGHT;
    let outconnsize = 2 * LINEHEIGHT * Object.keys(node.attributes.layout.out_connectors).length - LINEHEIGHT;
    let maxwidth = Math.max(labelsize, inconnsize, outconnsize);
    let maxheight = 2 * LINEHEIGHT;
    maxheight += 4 * LINEHEIGHT;

    let size = { width: maxwidth, height: maxheight }

    // add something to the size based on the shape of the node
    if (node.type === "AccessNode") {
        size.height -= 4 * LINEHEIGHT;
        size.width += size.height;
    }
    else if (node.type.endsWith("Entry")) {
        size.width += 2.0 * size.height;
        size.height /= 1.75;
    }
    else if (node.type.endsWith("Exit")) {
        size.width += 2.0 * size.height;
        size.height /= 1.75;
    }
    else if (node.type === "Tasklet") {
        size.width += 2.0 * (size.height / 3.0);
        size.height /= 1.75;
    }
    else if (node.type === "EmptyTasklet") {
        size.width = 0.0;
        size.height = 0.0;
    }
    else if (node.type === "LibraryNode") {
        size.width += 2.0 * (size.height / 3.0);
        size.height /= 1.75;
    }
    else if (node.type === "Reduce") {
        size.height -= 4 * LINEHEIGHT;
        size.width *= 2;
        size.height = size.width / 3.0;
    }
    else {
    }

    return size;
}

// Layout SDFG elements (states, nodes, scopes, nested SDFGs)
function relayout_sdfg(ctx, sdfg, sdfg_list, state_parent_list) {
    let STATE_MARGIN = 4 * LINEHEIGHT;

    // Layout the SDFG as a dagre graph
    let g = new dagre.graphlib.Graph();
    g.setGraph({});
    g.setDefaultEdgeLabel(function (u, v) { return {}; });

    // layout each state to get its size
    sdfg.nodes.forEach((state) => {
        let stateinfo = {};

        stateinfo.label = state.id;
        let state_g = null;
        if (state.attributes.is_collapsed) {
            stateinfo.width = ctx.measureText(stateinfo.label).width;
            stateinfo.height = LINEHEIGHT;
        }
        else {
            state_g = relayout_state(ctx, state, sdfg, sdfg_list,
                state_parent_list);
            stateinfo = calculateBoundingBox(state_g);
        }
        stateinfo.width += 2 * STATE_MARGIN;
        stateinfo.height += 2 * STATE_MARGIN;
        g.setNode(state.id, new State({
            state: state,
            layout: stateinfo,
            graph: state_g
        }, state.id, sdfg));
    });

    sdfg.edges.forEach((edge, id) => {
        g.setEdge(edge.src, edge.dst, new Edge(edge.attributes.data, id, sdfg));
    });

    dagre.layout(g);

    // Annotate the sdfg with its layout info
    sdfg.nodes.forEach(function (state) {
        let gnode = g.node(state.id);
        state.attributes.layout = {};
        state.attributes.layout.x = gnode.x;
        state.attributes.layout.y = gnode.y;
        state.attributes.layout.width = gnode.width;
        state.attributes.layout.height = gnode.height;
    });

    sdfg.edges.forEach(function (edge) {
        let gedge = g.edge(edge.src, edge.dst);
        let bb = calculateEdgeBoundingBox(gedge);
        // Convert from top-left to center
        bb.x += bb.width / 2.0;
        bb.y += bb.height / 2.0;

        gedge.x = bb.x;
        gedge.y = bb.y;
        gedge.width = bb.width;
        gedge.height = bb.height;
        edge.attributes.layout = {};
        edge.attributes.layout.width = bb.width;
        edge.attributes.layout.height = bb.height;
        edge.attributes.layout.x = bb.x;
        edge.attributes.layout.y = bb.y;
        edge.attributes.layout.points = gedge.points;
    });

    // Offset node and edge locations to be in state margins
    sdfg.nodes.forEach((s, sid) => {
        if (s.attributes.is_collapsed)
            return;

        let state = g.node(sid);
        let topleft = state.topleft();
        offset_state(s, state, {
            x: topleft.x + STATE_MARGIN,
            y: topleft.y + STATE_MARGIN
        });
    });

    let bb = calculateBoundingBox(g);
    g.width = bb.width;
    g.height = bb.height;

    // Add SDFG to global store
    sdfg_list[sdfg.sdfg_list_id] = g;

    return g;
}

function relayout_state(ctx, sdfg_state, sdfg, sdfg_list, state_parent_list) {
    // layout the state as a dagre graph
    let g = new dagre.graphlib.Graph({ multigraph: true });

    // Set layout options and a simpler algorithm for large graphs
    let layout_options = {ranksep: 30};
    if (sdfg_state.nodes.length >= 1000)
        layout_options.ranker = 'longest-path';
        
    g.setGraph(layout_options);


    // Set an object for the graph label
    g.setDefaultEdgeLabel(function (u, v) { return {}; });

    // Add nodes to the graph. The first argument is the node id. The
    // second is metadata about the node (label, width, height),
    // which will be updated by dagre.layout (will add x,y).

    // Process nodes hierarchically
    let toplevel_nodes = sdfg_state.scope_dict[-1];
    if (toplevel_nodes === undefined)
        toplevel_nodes = Object.keys(sdfg_state.nodes);
    let drawn_nodes = new Set();

    function layout_node(node) {
        let nested_g = null;
        node.attributes.layout = {};

        // Set connectors prior to computing node size
        node.attributes.layout.in_connectors = node.attributes.in_connectors;
        if ('is_collapsed' in node.attributes && node.attributes.is_collapsed && node.type !== "NestedSDFG")
            node.attributes.layout.out_connectors = find_exit_for_entry(sdfg_state.nodes, node).attributes.out_connectors;
        else
            node.attributes.layout.out_connectors = node.attributes.out_connectors;

        let nodesize = calculateNodeSize(sdfg_state, node, ctx);
        node.attributes.layout.width = nodesize.width;
        node.attributes.layout.height = nodesize.height;
        node.attributes.layout.label = node.label;

        // Recursively lay out nested SDFGs
        if (node.type === "NestedSDFG") {
            nested_g = relayout_sdfg(ctx, node.attributes.sdfg, sdfg_list, state_parent_list);
            let sdfginfo = calculateBoundingBox(nested_g);
            node.attributes.layout.width = sdfginfo.width + 2 * LINEHEIGHT;
            node.attributes.layout.height = sdfginfo.height + 2 * LINEHEIGHT;
        }

        // Dynamically create node type
        let obj = new SDFGElements[node.type]({ node: node, graph: nested_g }, node.id, sdfg, sdfg_state.id);

        // If it's a nested SDFG, we need to record the node as all of its
        // state's parent node
        if (node.type === 'NestedSDFG')
            state_parent_list[node.attributes.sdfg.sdfg_list_id] = obj;

        // Add input connectors
        let i = 0;
        let conns;
        if (Array.isArray(node.attributes.layout.in_connectors))
            conns = node.attributes.layout.in_connectors;
        else
            conns = Object.keys(node.attributes.layout.in_connectors);
        for (let cname of conns) {
            let conn = new Connector({ name: cname }, i, sdfg, node.id);
            obj.in_connectors.push(conn);
            i += 1;
        }

        // Add output connectors -- if collapsed, uses exit node connectors
        i = 0;
        if (Array.isArray(node.attributes.layout.out_connectors))
            conns = node.attributes.layout.out_connectors;
        else
            conns = Object.keys(node.attributes.layout.out_connectors);
        for (let cname of conns) {
            let conn = new Connector({ name: cname }, i, sdfg, node.id);
            obj.out_connectors.push(conn);
            i += 1;
        }

        g.setNode(node.id, obj);
        drawn_nodes.add(node.id.toString());

        // Recursively draw nodes
        if (node.id in sdfg_state.scope_dict) {
            if (node.attributes.is_collapsed)
                return;
            sdfg_state.scope_dict[node.id].forEach(function (nodeid) {
                let node = sdfg_state.nodes[nodeid];
                layout_node(node);
            });
        }
    }


    toplevel_nodes.forEach(function (nodeid) {
        let node = sdfg_state.nodes[nodeid];
        layout_node(node);
    });

    sdfg_state.edges.forEach((edge, id) => {
        edge = check_and_redirect_edge(edge, drawn_nodes, sdfg_state);
        if (!edge) return;
        let e = new Edge(edge.attributes.data, id, sdfg, sdfg_state.id);
        e.src_connector = edge.src_connector;
        e.dst_connector = edge.dst_connector;
        g.setEdge(edge.src, edge.dst, e, id);
    });

    dagre.layout(g);


    // Layout connectors and nested SDFGs
    sdfg_state.nodes.forEach(function (node, id) {
        let gnode = g.node(id);
        if (!gnode) return;
        let topleft = gnode.topleft();

        // Offset nested SDFG
        if (node.type === "NestedSDFG") {

            offset_sdfg(node.attributes.sdfg, gnode.data.graph, {
                x: topleft.x + LINEHEIGHT,
                y: topleft.y + LINEHEIGHT
            });
        }
        // Connector management 
        let SPACING = LINEHEIGHT;
        let iconn_length = (LINEHEIGHT + SPACING) * Object.keys(node.attributes.layout.in_connectors).length - SPACING;
        let oconn_length = (LINEHEIGHT + SPACING) * Object.keys(node.attributes.layout.out_connectors).length - SPACING;
        let iconn_x = gnode.x - iconn_length / 2.0 + LINEHEIGHT / 2.0;
        let oconn_x = gnode.x - oconn_length / 2.0 + LINEHEIGHT / 2.0;

        for (let c of gnode.in_connectors) {
            c.width = LINEHEIGHT;
            c.height = LINEHEIGHT;
            c.x = iconn_x;
            iconn_x += LINEHEIGHT + SPACING;
            c.y = topleft.y;
        }
        for (let c of gnode.out_connectors) {
            c.width = LINEHEIGHT;
            c.height = LINEHEIGHT;
            c.x = oconn_x;
            oconn_x += LINEHEIGHT + SPACING;
            c.y = topleft.y + gnode.height;
        }
    });

    sdfg_state.edges.forEach(function (edge, id) {
        edge = check_and_redirect_edge(edge, drawn_nodes, sdfg_state);
        if (!edge) return;
        let gedge = g.edge(edge.src, edge.dst, id);

        // Reposition first and last points according to connectors
        let src_conn = null, dst_conn = null;
        if (edge.src_connector) {
            let src_node = g.node(edge.src);
            let cindex = -1;
            for (let i = 0; i < src_node.out_connectors.length; i++) {
                if (src_node.out_connectors[i].data.name == edge.src_connector) {
                    cindex = i;
                    break;
                }
            }
            if (cindex >= 0) {
                gedge.points[0].x = src_node.out_connectors[cindex].x;
                gedge.points[0].y = src_node.out_connectors[cindex].y;
                src_conn = src_node.out_connectors[cindex];
            }
        }
        if (edge.dst_connector) {
            let dst_node = g.node(edge.dst);
            let cindex = -1;
            for (let i = 0; i < dst_node.in_connectors.length; i++) {
                if (dst_node.in_connectors[i].data.name == edge.dst_connector) {
                    cindex = i;
                    break;
                }
            }
            if (cindex >= 0) {
                gedge.points[gedge.points.length - 1].x = dst_node.in_connectors[cindex].x;
                gedge.points[gedge.points.length - 1].y = dst_node.in_connectors[cindex].y;
                dst_conn = dst_node.in_connectors[cindex];
            }
        }

        let n = gedge.points.length - 1;
        if (src_conn !== null)
            gedge.points[0] = dagre.util.intersectRect(src_conn, gedge.points[n]);
        if (dst_conn !== null)
            gedge.points[n] = dagre.util.intersectRect(dst_conn, gedge.points[0]);

        if (gedge.points.length == 3 && gedge.points[0].x == gedge.points[n].x)
            gedge.points = [gedge.points[0], gedge.points[n]];

        let bb = calculateEdgeBoundingBox(gedge);
        // Convert from top-left to center
        bb.x += bb.width / 2.0;
        bb.y += bb.height / 2.0;

        edge.width = bb.width;
        edge.height = bb.height;
        edge.x = bb.x;
        edge.y = bb.y;
        gedge.width = bb.width;
        gedge.height = bb.height;
        gedge.x = bb.x;
        gedge.y = bb.y;
    });


    return g;
}

class SDFGRenderer {
    constructor(sdfg, container, on_mouse_event = null, user_transform = null,
                debug_draw = false, background = null) {
        // DIODE/SDFV-related fields
        this.sdfg = sdfg;
        this.sdfg_list = {};
        this.state_parent_list = {}; // List of all state's parent elements

        // Rendering-related fields
        this.container = container;
        this.ctx = null;
        this.canvas = null;
        this.last_visible_elements = null;
        this.last_hovered_elements = null;
        this.last_clicked_elements = null;
        this.last_dragged_element = null;
        this.tooltip = null;
        this.tooltip_container = null;

        // Toolbar-related fields
        this.menu = null;
        this.toolbar = null;
        this.movemode_btn = null;
        this.selectmode_btn = null;
        

        // View options
        this.inclusive_ranges = false;

        // Mouse-related fields
        this.mouse_mode = 'pan'; // Mouse mode - pan, move, select
        this.box_select_rect = null;
        this.mousepos = null; // Last position of the mouse pointer (in canvas coordinates)
        this.realmousepos = null; // Last position of the mouse pointer (in pixel coordinates)
        this.dragging = false;
        this.drag_start = null; // Null if the mouse/touch is not activated
        this.drag_second_start = null; // Null if two touch points are not activated
        this.external_mouse_handler = on_mouse_event;

        // Selection related fields
        this.selected_elements = [];

        // Overlay fields
        this.overlay_manager = new OverlayManager(this);

        // Draw debug aids.
        this.debug_draw = debug_draw;

        this.init_elements(user_transform, background);
    }

    destroy() {
        try {
            if (this.menu)
                this.menu.destroy();
            this.canvas_manager.destroy();
            this.container.removeChild(this.canvas);
            this.container.removeChild(this.toolbar);
            this.container.removeChild(this.tooltip_container);
        } catch (ex) {
            // Do nothing
        }
    }

    view_settings() {
        return { inclusive_ranges: this.inclusive_ranges };
    }

    // Updates buttons based on cursor mode
    update_toggle_buttons() {
        // First clear out of all modes, then jump in to the correct mode.
        this.selectmode_btn.innerHTML =
            '<i class="material-icons">border_style</i>';
        this.selectmode_btn.title = 'Enter box select mode';
        this.movemode_btn.innerHTML =
            '<i class="material-icons">open_with</i>';
        this.movemode_btn.title = 'Enter object moving mode';
        this.canvas.style.cursor = 'default';
        this.interaction_info_box.style.display = 'none';
        this.interaction_info_text.innerHTML = '';

        switch (this.mouse_mode) {
            case 'move':
                this.interaction_info_box.style.display = 'block';
                this.movemode_btn.innerHTML =
                    '<i class="material-icons">done</i>';
                this.movemode_btn.title = 'Exit object moving mode';
                this.interaction_info_text.innerHTML = 'Middle Mouse: Pan view';
                break;
            case 'select':
                this.interaction_info_box.style.display = 'block';
                this.selectmode_btn.innerHTML =
                    '<i class="material-icons">done</i>';
                this.selectmode_btn.title = 'Exit box select mode';
                this.canvas.style.cursor = 'crosshair';
                this.interaction_info_text.innerHTML =
                    'Shift: Add to selection<br>' +
                    'Ctrl: Remove from selection<br>' +
                    'Middle Mouse: Pan view';
                break;
            case 'pan':
            default:
                break;
        }
    }

    // Initializes the DOM
    init_elements(user_transform, background) {

        this.canvas = document.createElement('canvas');
        if (background)
            this.canvas.style.backgroundColor = background;
        else
            this.canvas.style.backgroundColor = 'inherit';
        this.container.append(this.canvas);

        if (this.debug_draw) {
            this.dbg_info_box = document.createElement('div');
            this.dbg_info_box.style.position = 'absolute';
            this.dbg_info_box.style.bottom = '.5rem';
            this.dbg_info_box.style.right = '.5rem';
            this.dbg_info_box.style.backgroundColor = 'black';
            this.dbg_info_box.style.padding = '.3rem';
            this.dbg_mouse_coords = document.createElement('span');
            this.dbg_mouse_coords.style.color = 'white';
            this.dbg_mouse_coords.style.fontSize = '1rem';
            this.dbg_mouse_coords.innerText = 'x: N/A / y: N/A';
            this.dbg_info_box.appendChild(this.dbg_mouse_coords);
            this.container.appendChild(this.dbg_info_box);
        }

        // Add an info box for interaction hints to the bottom left of the
        // canvas.
        this.interaction_info_box = document.createElement('div');
        this.interaction_info_box.style.position = 'absolute';
        this.interaction_info_box.style.bottom = '.5rem',
        this.interaction_info_box.style.left = '.5rem',
        this.interaction_info_box.style.backgroundColor = 'rgba(0, 0, 0, 0.5)';
        this.interaction_info_box.style.borderRadius = '5px';
        this.interaction_info_box.style.padding = '.3rem';
        this.interaction_info_box.style.display = 'none';
        this.interaction_info_text = document.createElement('span');
        this.interaction_info_text.style.color = '#eeeeee';
        this.interaction_info_text.innerHTML = '';
        this.interaction_info_box.appendChild(this.interaction_info_text);
        this.container.appendChild(this.interaction_info_box);

        // Add buttons
        this.toolbar = document.createElement('div');
        this.toolbar.style = 'position:absolute; top:10px; left: 10px;';
        let d;

        // Menu bar
        try {
            ContextMenu;
            d = document.createElement('button');
            d.className = 'button';
            d.innerHTML = '<i class="material-icons">menu</i>';
            d.style = 'padding-bottom: 0px; user-select: none';
            let that = this;
            d.onclick = function () {
                if (that.menu && that.menu.visible()) {
                    that.menu.destroy();
                    return;
                }
                let rect = this.getBoundingClientRect();
                let cmenu = new ContextMenu();
                cmenu.addOption("Save view as PNG", x => that.save_as_png());
                if (that.has_pdf()) {
                    cmenu.addOption("Save view as PDF", x => that.save_as_pdf());
                    cmenu.addOption("Save all as PDF", x => that.save_as_pdf(true));
                }
                cmenu.addCheckableOption("Inclusive ranges", that.inclusive_ranges, (x, checked) => { that.inclusive_ranges = checked; });
                cmenu.addOption(
                    'Overlays',
                    () => {
                        if (that.overlays_menu && that.overlays_menu.visible()) {
                            that.overlays_menu.destroy();
                            return;
                        }
                        let rect = cmenu._cmenu_elem.getBoundingClientRect();
                        let overlays_cmenu = new ContextMenu();
                        overlays_cmenu.addCheckableOption(
                            'Memory volume analysis',
                            that.overlay_manager.memory_volume_overlay_active,
                            (x, checked) => {
                                if (checked)
                                    that.overlay_manager.register_overlay(
                                        GenericSdfgOverlay.OVERLAY_TYPE.MEMORY_VOLUME
                                    );
                                else
                                    that.overlay_manager.deregister_overlay(
                                        GenericSdfgOverlay.OVERLAY_TYPE.MEMORY_VOLUME
                                    );
                                that.draw_async();
                            }
                        );
                        that.overlays_menu = overlays_cmenu;
                        that.overlays_menu.show(rect.left, rect.top);
                    }
                );
                that.menu = cmenu;
                that.menu.show(rect.left, rect.bottom);
            };
            d.title = 'Menu';
            this.toolbar.appendChild(d);
        } catch (ex) { }

        let in_vscode = false;
        try {
            vscode;
            if (vscode)
                in_vscode = true;
        } catch (ex) { }

        // Zoom to fit
        d = document.createElement('button');
        d.className = 'button';
        d.innerHTML = '<i class="material-icons">filter_center_focus</i>';
        d.style = 'padding-bottom: 0px; user-select: none';
        d.onclick = () => this.zoom_to_view();
        d.title = 'Zoom to fit SDFG';
        this.toolbar.appendChild(d);

        // Collapse all
        d = document.createElement('button');
        d.className = 'button';
        d.innerHTML = '<i class="material-icons">unfold_less</i>';
        d.style = 'padding-bottom: 0px; user-select: none';
        d.onclick = () => this.collapse_all();
        d.title = 'Collapse all elements';
        this.toolbar.appendChild(d);

        // Expand all
        d = document.createElement('button');
        d.className = 'button';
        d.innerHTML = '<i class="material-icons">unfold_more</i>';
        d.style = 'padding-bottom: 0px; user-select: none';
        d.onclick = () => this.expand_all();
        d.title = 'Expand all elements';
        this.toolbar.appendChild(d);

        // Enter object moving mode
        let move_mode_btn = document.createElement('button');
        this.movemode_btn = move_mode_btn;
        move_mode_btn.className = 'button';
        move_mode_btn.innerHTML = '<i class="material-icons">open_with</i>';
        move_mode_btn.style = 'padding-bottom: 0px; user-select: none';
        move_mode_btn.onclick = () => {
            if (this.mouse_mode === 'move')
                this.mouse_mode = 'pan';
            else
                this.mouse_mode = 'move';
            this.update_toggle_buttons();
        };
        move_mode_btn.title = 'Enter object moving mode';
        this.toolbar.appendChild(move_mode_btn);

        // Enter box selection mode
        let box_select_btn = document.createElement('button');
        this.selectmode_btn = box_select_btn;
        box_select_btn.className = 'button';
        box_select_btn.innerHTML =
            '<i class="material-icons">border_style</i>';
        box_select_btn.style = 'padding-bottom: 0px; user-select: none';
        box_select_btn.onclick = () => {
            if (this.mouse_mode === 'select')
                this.mouse_mode = 'pan';
            else
                this.mouse_mode = 'select';
            this.update_toggle_buttons();
        };
        box_select_btn.title = 'Enter box select mode';
        this.toolbar.appendChild(box_select_btn);

        // Exit previewing mode
        if (in_vscode) {
            let exit_preview_btn = document.createElement('button');
            exit_preview_btn.id = 'exit-preview-button';
            exit_preview_btn.className = 'button hidden';
            exit_preview_btn.innerHTML = '<i class="material-icons">close</i>';
            exit_preview_btn.style = 'padding-bottom: 0px; user-select: none';
            exit_preview_btn.onclick = () => {
                exit_preview_btn.className = 'button hidden';
                if (vscode)
                    vscode.postMessage({
                        type: 'getCurrentSdfg',
                    });
            };
            exit_preview_btn.title = 'Exit preview';
            this.toolbar.appendChild(exit_preview_btn);
        }

        this.container.append(this.toolbar);
        // End of buttons

        // Tooltip HTML container
        this.tooltip_container = document.createElement('div');
        this.tooltip_container.innerHTML = '';
        this.tooltip_container.className = 'sdfvtooltip';
        this.tooltip_container.onmouseover = () => this.tooltip_container.style.display = "none";
        this.container.appendChild(this.tooltip_container);

        // HTML container for error popovers with invalid SDFGs
        this.error_popover_container = document.createElement('div');
        this.error_popover_container.innerHTML = '';
        this.error_popover_container.className = 'invalid_popup';
        this.error_popover_text = document.createElement('div');
        let error_popover_dismiss = document.createElement('button');
        let that = this;
        error_popover_dismiss.onclick = () => {
            that.sdfg.error = undefined;
            that.error_popover_text.innerText = '';
            that.error_popover_container.style.display = 'none';
        };
        error_popover_dismiss.style.float = 'right';
        error_popover_dismiss.style.cursor = 'pointer';
        error_popover_dismiss.style.color = 'white';
        error_popover_dismiss.innerHTML = '<i class="material-icons">close</i>';
        this.error_popover_container.appendChild(error_popover_dismiss);
        this.error_popover_container.appendChild(this.error_popover_text);
        this.container.appendChild(this.error_popover_container);

        this.ctx = this.canvas.getContext("2d");

        // Translation/scaling management
        this.canvas_manager = new CanvasManager(this.ctx, this, this.canvas);
        if (user_transform !== null)
            this.canvas_manager.user_transform = user_transform;

        // Resize event for container
        let observer = new MutationObserver((mutations) => { this.onresize(); this.draw_async(); });
        observer.observe(this.container, { attributes: true });

        // Set inherited properties
        if (background)
            this.bgcolor = background;
        else
            this.bgcolor = window.getComputedStyle(this.canvas).backgroundColor;

        // Create the initial SDFG layout
        this.relayout();

        // Set mouse event handlers
        this.set_mouse_handlers();

        // Set initial zoom, if not already set
        if (user_transform === null)
            this.zoom_to_view();

        // Queue first render
        this.draw_async();
    }

    draw_async() {
        this.canvas_manager.draw_async();
    }

    set_sdfg(new_sdfg) {
        this.sdfg = new_sdfg;
        this.relayout();
        this.draw_async();
    }

    // Set mouse events (e.g., click, drag, zoom)
    set_mouse_handlers() {
        let canvas = this.canvas;
        let br = () => canvas.getBoundingClientRect();

        let comp_x = event => this.canvas_manager.mapPixelToCoordsX(event.clientX - br().left);
        let comp_y = event => this.canvas_manager.mapPixelToCoordsY(event.clientY - br().top);

        // Mouse handler event types
        for (let evtype of ['mousedown', 'mousemove', 'mouseup', 'touchstart', 'touchmove', 'touchend',
            'wheel', 'click', 'dblclick', 'contextmenu']) {
            canvas.addEventListener(evtype, x => {
                let cancelled = this.on_mouse_event(x, comp_x, comp_y, evtype);
                if (cancelled)
                    return;
                x.stopPropagation();
                x.preventDefault();
            });
        }
    }

    onresize() {
        // Set canvas size
        this.canvas.style.width = '99%';
        this.canvas.style.height = '99%';
        this.canvas.width = this.canvas.offsetWidth;
        this.canvas.height = this.canvas.offsetHeight;
    }

    // Re-layout graph and nested graphs
    relayout() {
        this.sdfg_list = {};
        this.graph = relayout_sdfg(this.ctx, this.sdfg, this.sdfg_list,
            this.state_parent_list);
        this.onresize();

        return this.graph;
    }

    // Change translation and scale such that the chosen elements
    // (or entire graph if null) is in view
    zoom_to_view(elements = null) {
        if (!elements || elements.length == 0)
            elements = this.graph.nodes().map(x => this.graph.node(x));

        let bb = boundingBox(elements);
        this.canvas_manager.set_view(bb);

        this.draw_async();
    }

    collapse_all() {
        this.for_all_sdfg_elements((otype, odict, obj) => {
            if ('is_collapsed' in obj.attributes && !obj.type.endsWith('Exit'))
                obj.attributes.is_collapsed = true;
        });
        this.relayout();
        this.draw_async();
    }

    expand_all() {
        this.for_all_sdfg_elements((otype, odict, obj) => {
            if ('is_collapsed' in obj.attributes && !obj.type.endsWith('Exit'))
                obj.attributes.is_collapsed = false;
        });
        this.relayout();
        this.draw_async();
    }

    // Save functions
    save(filename, contents) {
        var link = document.createElement('a');
        link.setAttribute('download', filename);
        link.href = contents;
        document.body.appendChild(link);

        // wait for the link to be added to the document
        window.requestAnimationFrame(function () {
            var event = new MouseEvent('click');
            link.dispatchEvent(event);
            document.body.removeChild(link);
        });
    }

    save_as_png() {
        this.save('sdfg.png', this.canvas.toDataURL('image/png'));
    }

    has_pdf() {
        try {
            blobStream;
            canvas2pdf.PdfContext;
            return true;
        } catch (e) {
            return false;
        }
    }

    save_as_pdf(save_all = false) {
        let stream = blobStream();

        // Compute document size
        let curx = this.canvas_manager.mapPixelToCoordsX(0);
        let cury = this.canvas_manager.mapPixelToCoordsY(0);
        let size;
        if (save_all) {
            // Get size of entire graph
            let elements = this.graph.nodes().map(x => this.graph.node(x));
            let bb = boundingBox(elements);
            size = [bb.width, bb.height];
        } else {
            // Get size of current view
            let endx = this.canvas_manager.mapPixelToCoordsX(this.canvas.width);
            let endy = this.canvas_manager.mapPixelToCoordsY(this.canvas.height);
            let curw = endx - curx, curh = endy - cury;
            size = [curw, curh];
        }
        //

        let ctx = new canvas2pdf.PdfContext(stream, {
            size: size
        });
        let oldctx = this.ctx;
        this.ctx = ctx;
        this.ctx.lod = !save_all;
        this.ctx.pdf = true;
        // Center on saved region
        if (!save_all)
            this.ctx.translate(-curx, -cury);

        this.draw_async();

        ctx.stream.on('finish', () => {
            this.save('sdfg.pdf', ctx.stream.toBlobURL('application/pdf'));
            this.ctx = oldctx;
            this.draw_async();
        });
    }

    // Draw a debug grid on the canvas to indicate coordinates.
    debug_draw_grid(curx, cury, endx, endy, grid_width = 100) {
        var lim_x_min = Math.floor(curx / grid_width) * grid_width;
        var lim_x_max = Math.ceil(endx / grid_width) * grid_width;
        var lim_y_min = Math.floor(cury / grid_width) * grid_width;
        var lim_y_max = Math.ceil(endy / grid_width) * grid_width;
        for (var i = lim_x_min; i <= lim_x_max; i += grid_width) {
            this.ctx.moveTo(i, lim_y_min);
            this.ctx.lineTo(i, lim_y_max);
        }
        for (var i = lim_y_min; i <= lim_y_max; i += grid_width) {
            this.ctx.moveTo(lim_x_min, i);
            this.ctx.lineTo(lim_x_max, i);
        }
        this.ctx.strokeStyle = 'yellow';
        this.ctx.stroke();

        // Draw the zero-point.
        this.ctx.beginPath();
        this.ctx.arc(0, 0, 10, 0, 2 * Math.PI, false);
        this.ctx.fillStyle = 'red';
        this.ctx.fill();
        this.ctx.strokeStyle = 'red';
        this.ctx.stroke();
    }

    // Render SDFG
    draw(dt) {
        let ctx = this.ctx;
        let g = this.graph;
        let curx = this.canvas_manager.mapPixelToCoordsX(0);
        let cury = this.canvas_manager.mapPixelToCoordsY(0);
        let endx = this.canvas_manager.mapPixelToCoordsX(this.canvas.width);
        let endy = this.canvas_manager.mapPixelToCoordsY(this.canvas.height);
        let curw = endx - curx, curh = endy - cury;

        this.visible_rect = { x: curx, y: cury, w: curw, h: curh };

        this.on_pre_draw();

        draw_sdfg(this, ctx, g, this.mousepos, this.debug_draw);

        if (this.box_select_rect) {
            this.ctx.beginPath();
            let old_line_width = this.ctx.lineWidth;
            this.ctx.lineWidth = this.canvas_manager.points_per_pixel();
            this.ctx.strokeStyle = 'grey';
            this.ctx.rect(this.box_select_rect.x_start, this.box_select_rect.y_start,
                this.box_select_rect.x_end - this.box_select_rect.x_start,
                this.box_select_rect.y_end - this.box_select_rect.y_start);
            this.ctx.stroke();
            this.ctx.lineWidth = old_line_width;
        }

        if (this.debug_draw) {
            this.debug_draw_grid(curx, cury, endx, endy, 100);
            if (this.mousepos) {
                this.dbg_mouse_coords.innerText = 'x: ' + Math.floor(this.mousepos.x) +
                    ' / y: ' + Math.floor(this.mousepos.y);
            } else {
                this.dbg_mouse_coords.innerText = 'x: N/A / y: N/A';
            }
        }

        this.on_post_draw();
    }

    on_pre_draw() { }

    on_post_draw() {
        this.overlay_manager.draw();

        try {
            this.ctx.end();
        } catch (ex) { }

        if (this.tooltip) {
            let br = this.canvas.getBoundingClientRect();
            let pos = {
                x: this.realmousepos.x - br.x,
                y: this.realmousepos.y - br.y
            };

            // Clear style and contents
            this.tooltip_container.style = '';
            this.tooltip_container.innerHTML = '';
            this.tooltip_container.style.display = 'block';

            // Invoke custom container         
            this.tooltip(this.tooltip_container);

            // Make visible near mouse pointer
            this.tooltip_container.style.top = pos.y + 'px';
            this.tooltip_container.style.left = (pos.x + 20) + 'px';
        } else {
            this.tooltip_container.style.display = 'none';
        }

        if (this.sdfg.error) {
            let error = this.sdfg.error;

            let type = '';
            let state_id = -1;
            let el_id = -1;
            if (error.isedge_id !== undefined) {
                type = 'isedge';
                el_id = error.isedge_id;
            } else if (error.state_id !== undefined) {
                state_id = error.state_id;
                if (error.node_id !== undefined) {
                    type = 'node';
                    el_id = error.node_id;
                } else if (error.edge_id !== undefined) {
                    type = 'edge';
                    el_id = error.edge_id;
                } else {
                    type = 'state';
                }
            } else {
                return;
            }
            let offending_element = find_graph_element(
                this.graph, type, error.sdfg_id, state_id, el_id
            );
            if (offending_element) {
                this.zoom_to_view([offending_element]);
                this.error_popover_container.style.display = 'block';
                this.error_popover_container.style.bottom = '5%';
                this.error_popover_container.style.left = '5%';
                this.error_popover_text.innerText = error.message;
            }
        } else {
            this.error_popover_container.style.display = 'none';
        }
    }

    visible_elements() {
        let curx = this.canvas_manager.mapPixelToCoordsX(0);
        let cury = this.canvas_manager.mapPixelToCoordsY(0);
        let endx = this.canvas_manager.mapPixelToCoordsX(this.canvas.width);
        let endy = this.canvas_manager.mapPixelToCoordsY(this.canvas.height);
        let curw = endx - curx;
        let curh = endy - cury;
        let elements = [];
        this.do_for_intersected_elements(curx, cury, curw, curh, (type, e, obj) => {
            let state_id = e.state ? Number(e.state) : -1;
            let el_type = 'other';
            if (type === 'nodes')
                el_type = 'node';
            else if (type === 'states')
                el_type = 'state';
            else if (type === 'edges')
                el_type = 'edge';
            else if (type === 'isedges')
                el_type = 'isedge';
            else if (type === 'connectors')
                el_type = 'connector';
            elements.push({
                type: el_type,
                sdfg_id: Number(e.sdfg_id),
                state_id: state_id,
                id: Number(e.id),
            });
        });
        return elements;
    }

    // Returns a dictionary of SDFG elements in a given rectangle. Used for
    // selection, rendering, localized transformations, etc.
    // The output is a dictionary of lists of dictionaries. The top-level keys are:
    // states, nodes, connectors, edges, isedges (interstate edges). For example:
    // {'states': [{sdfg: sdfg_name, state: 1}, ...], nodes: [sdfg: sdfg_name, state: 1, node: 5],
    //              edges: [], isedges: [], connectors: []}
    elements_in_rect(x, y, w, h) {
        let elements = {
            states: [], nodes: [], connectors: [],
            edges: [], isedges: []
        };
        this.do_for_intersected_elements(x, y, w, h, (type, e, obj) => {
            e.obj = obj;
            elements[type].push(e);
        });
        return elements;
    }

    do_for_intersected_elements(x, y, w, h, func) {
        // Traverse nested SDFGs recursively
        function traverse_recursive(g, sdfg_name, sdfg_id) {
            g.nodes().forEach(state_id => {
                let state = g.node(state_id);
                if (!state) return;

                if (state.intersect(x, y, w, h)) {
                    // States
                    func('states', { sdfg: sdfg_name, sdfg_id: sdfg_id, id: state_id }, state);

                    if (state.data.state.attributes.is_collapsed)
                        return;

                    let ng = state.data.graph;
                    if (!ng)
                        return;
                    ng.nodes().forEach(node_id => {
                        let node = ng.node(node_id);
                        if (node.intersect(x, y, w, h)) {
                            // Selected nodes
                            func('nodes', { sdfg: sdfg_name, sdfg_id: sdfg_id, state: state_id, id: node_id }, node);

                            // If nested SDFG, traverse recursively
                            if (node.data.node.type === "NestedSDFG")
                                traverse_recursive(node.data.graph,
                                    node.data.node.attributes.sdfg.attributes.name,
                                    node.data.node.attributes.sdfg.sdfg_list_id);
                        }
                        // Connectors
                        node.in_connectors.forEach((c, i) => {
                            if (c.intersect(x, y, w, h))
                                func('connectors', {
                                    sdfg: sdfg_name, sdfg_id: sdfg_id, state: state_id, node: node_id,
                                    connector: i, conntype: "in"
                                }, c);
                        });
                        node.out_connectors.forEach((c, i) => {
                            if (c.intersect(x, y, w, h))
                                func('connectors', {
                                    sdfg: sdfg_name, sdfg_id: sdfg_id, state: state_id, node: node_id,
                                    connector: i, conntype: "out"
                                }, c);
                        });
                    });

                    // Selected edges
                    ng.edges().forEach(edge_id => {
                        let edge = ng.edge(edge_id);
                        if (edge.intersect(x, y, w, h)) {
                            func('edges', { sdfg: sdfg_name, sdfg_id: sdfg_id, state: state_id, id: edge.id }, edge);
                        }
                    });
                }
            });

            // Selected inter-state edges
            g.edges().forEach(isedge_id => {
                let isedge = g.edge(isedge_id);
                if (isedge.intersect(x, y, w, h)) {
                    func('isedges', { sdfg: sdfg_name, sdfg_id: sdfg_id, id: isedge.id }, isedge);
                }
            });
        }

        // Start with top-level SDFG
        traverse_recursive(this.graph, this.sdfg.attributes.name,
            this.sdfg.sdfg_list_id);
    }

    for_all_sdfg_elements(func) {
        // Traverse nested SDFGs recursively
        function traverse_recursive(sdfg) {
            sdfg.nodes.forEach((state, state_id) => {
                // States
                func('states', { sdfg: sdfg, id: state_id }, state);

                state.nodes.forEach((node, node_id) => {
                    // Nodes
                    func('nodes', { sdfg: sdfg, state: state_id, id: node_id }, node);

                    // If nested SDFG, traverse recursively
                    if (node.type === "NestedSDFG")
                        traverse_recursive(node.attributes.sdfg);
                });

                // Edges
                state.edges.forEach((edge, edge_id) => {
                    func('edges', { sdfg: sdfg, state: state_id, id: edge_id }, edge);
                });
            });

            // Selected inter-state edges
            sdfg.edges.forEach((isedge, isedge_id) => {
                func('isedges', { sdfg: sdfg, id: isedge_id }, isedge);
            });
        }

        // Start with top-level SDFG
        traverse_recursive(this.sdfg);
    }

    for_all_elements(x, y, w, h, func) {
        // Traverse nested SDFGs recursively
        function traverse_recursive(g, sdfg_name) {
            g.nodes().forEach(state_id => {
                let state = g.node(state_id);
                if (!state) return;

                // States
                func('states', { sdfg: sdfg_name, id: state_id, graph: g }, state, state.intersect(x, y, w, h));

                if (state.data.state.attributes.is_collapsed)
                    return;

                let ng = state.data.graph;
                if (!ng)
                    return;
                ng.nodes().forEach(node_id => {
                    let node = ng.node(node_id);
                    // Selected nodes
                    func('nodes', { sdfg: sdfg_name, state: state_id, id: node_id, graph: ng }, node, node.intersect(x, y, w, h));

                    // If nested SDFG, traverse recursively
                    if (node.data.node.type === "NestedSDFG")
                        traverse_recursive(node.data.graph, node.data.node.attributes.sdfg.attributes.name);

                    // Connectors
                    node.in_connectors.forEach((c, i) => {
                        func('connectors', {
                            sdfg: sdfg_name, state: state_id, node: node_id,
                            connector: i, conntype: "in", graph: ng
                        }, c, c.intersect(x, y, w, h));
                    });
                    node.out_connectors.forEach((c, i) => {
                        func('connectors', {
                            sdfg: sdfg_name, state: state_id, node: node_id,
                            connector: i, conntype: "out", graph: ng
                        }, c, c.intersect(x, y, w, h));
                    });
                });

                // Selected edges
                ng.edges().forEach(edge_id => {
                    let edge = ng.edge(edge_id);
                    func('edges', { sdfg: sdfg_name, state: state_id, id: edge.id, graph: ng }, edge, edge.intersect(x, y, w, h));
                });
            });

            // Selected inter-state edges
            g.edges().forEach(isedge_id => {
                let isedge = g.edge(isedge_id);
                func('isedges', { sdfg: sdfg_name, id: isedge.id, graph: g }, isedge, isedge.intersect(x, y, w, h));
            });
        }

        // Start with top-level SDFG
        traverse_recursive(this.graph, this.sdfg.attributes.name);
    }

    find_elements_under_cursor(mouse_pos_x, mouse_pos_y) {
        // Find all elements under the cursor.
        const elements = this.elements_in_rect(mouse_pos_x, mouse_pos_y, 0, 0);
        const clicked_states = elements.states;
        const clicked_nodes = elements.nodes;
        const clicked_edges = elements.edges;
        const clicked_interstate_edges = elements.isedges;
        const clicked_connectors = elements.connectors;
        const total_elements =
            clicked_states.length + clicked_nodes.length +
            clicked_edges.length + clicked_interstate_edges.length +
            clicked_connectors.length;
        let foreground_elem = null, foreground_surface = -1;

        // Find the top-most element under the mouse cursor (i.e. the one with
        // the smallest dimensions).
        const categories = [
            clicked_states,
            clicked_interstate_edges,
            clicked_nodes,
            clicked_edges
        ];
        for (const category of categories) {
            for (let i = 0; i < category.length; i++) {
                const s = category[i].obj.width * category[i].obj.height;
                if (foreground_surface < 0 || s < foreground_surface) {
                    foreground_surface = s;
                    foreground_elem = category[i].obj;
                }
            }
        }

        return {
            total_elements,
            elements,
            foreground_elem,
        };
    }

    on_mouse_event(event, comp_x_func, comp_y_func, evtype = "other") {
        let dirty = false; // Whether to redraw at the end
        // Whether the set of visible or selected elements changed
        let element_focus_changed = false;

        if (evtype === "mousedown" || evtype === "touchstart") {
            this.drag_start = event;
        } else if (evtype === "mouseup") {
            this.drag_start = null;
            this.last_dragged_element = null;
        } else if (evtype === "touchend") {
            if (event.touches.length == 0)
                this.drag_start = null;
            else
                this.drag_start = event;
        } else if (evtype === "mousemove") {
            // Calculate the change in mouse position in canvas coordinates
            let old_mousepos = this.mousepos;
            this.mousepos = { x: comp_x_func(event), y: comp_y_func(event) };
            this.realmousepos = { x: event.clientX, y: event.clientY };

            // Only accept the primary mouse button as dragging source
            if (this.drag_start && event.buttons & 1) {
                this.dragging = true;

                if (this.mouse_mode === 'move') {
                    if (this.last_dragged_element) {
                        this.canvas.style.cursor = 'grabbing';
                        this.drag_start.cx = comp_x_func(this.drag_start);
                        this.drag_start.cy = comp_y_func(this.drag_start);
                        this.canvas_manager.translate_element(
                            this.last_dragged_element,
                            old_mousepos, this.mousepos,
                            this.graph, this.sdfg_list, this.state_parent_list,
                            this.drag_start
                        );
                        dirty = true;
                        this.draw_async();
                        return false;
                    } else {
                        const mouse_elements = this.find_elements_under_cursor(
                            this.mousepos.x, this.mousepos.y
                        );
                        if (mouse_elements.foreground_elem) {
                            this.last_dragged_element =
                                mouse_elements.foreground_elem;
                            this.canvas.style.cursor = 'grabbing';
                            return false;
                        }
                        return true;
                    }
                } else if (this.mouse_mode === 'select') {
                    this.box_select_rect = {
                        x_start: comp_x_func(this.drag_start),
                        y_start: comp_y_func(this.drag_start),
                        x_end: this.mousepos.x,
                        y_end: this.mousepos.y,
                    };

                    // Mark for redraw and resort
                    dirty = true;
                    element_focus_changed = true;
                } else {
                    this.canvas_manager.translate(event.movementX,
                        event.movementY);

                    // Mark for redraw and resort
                    dirty = true;
                    element_focus_changed = true;
                }
            } else if (this.drag_start && event.buttons & 4) {
                // Pan the view with the middle mouse button
                this.dragging = true;
                this.canvas_manager.translate(event.movementX, event.movementY);
                dirty = true;
                element_focus_changed = true;
            } else {
                this.drag_start = null;
                this.last_dragged_element = null;
                if (event.buttons & 1 || event.buttons & 4)
                    return true; // Don't stop propagation
            }
        } else if (evtype === "touchmove") {
            if (this.drag_start.touches.length != event.touches.length) {
                // Different number of touches, ignore and reset drag_start
                this.drag_start = event;
            } else if (event.touches.length == 1) { // Move/drag
                this.canvas_manager.translate(event.touches[0].clientX - this.drag_start.touches[0].clientX,
                    event.touches[0].clientY - this.drag_start.touches[0].clientY);
                this.drag_start = event;

                // Mark for redraw
                dirty = true;
                this.draw_async();
                return false;
            } else if (event.touches.length == 2) {
                // Find relative distance between two touches before and after.
                // Then, center and zoom to their midpoint.
                let touch1 = this.drag_start.touches[0];
                let touch2 = this.drag_start.touches[1];
                let x1 = touch1.clientX, x2 = touch2.clientX;
                let y1 = touch1.clientY, y2 = touch2.clientY;
                let oldCenter = [(x1 + x2) / 2.0, (y1 + y2) / 2.0];
                let initialDistance = Math.sqrt((x1 - x2) ** 2 + (y1 - y2) ** 2);
                x1 = event.touches[0].clientX; x2 = event.touches[1].clientX;
                y1 = event.touches[0].clientY; y2 = event.touches[1].clientY;
                let currentDistance = Math.sqrt((x1 - x2) ** 2 + (y1 - y2) ** 2);
                let newCenter = [(x1 + x2) / 2.0, (y1 + y2) / 2.0];

                // First, translate according to movement of center point
                this.canvas_manager.translate(newCenter[0] - oldCenter[0],
                    newCenter[1] - oldCenter[1]);
                // Then scale
                this.canvas_manager.scale(currentDistance / initialDistance,
                    newCenter[0], newCenter[1]);

                this.drag_start = event;

                // Mark for redraw
                dirty = true;
                this.draw_async();
                return false;
            }
        } else if (evtype === "wheel") {
            // Get physical x,y coordinates (rather than canvas coordinates)
            let br = this.canvas.getBoundingClientRect();
            let x = event.clientX - br.x;
            let y = event.clientY - br.y;
            this.canvas_manager.scale(event.deltaY > 0 ? 0.9 : 1.1, x, y);
            dirty = true;
            element_focus_changed = true;
        }
        // End of mouse-move/touch-based events


        if (!this.mousepos)
            return true;

        // Find elements under cursor
        const elements_under_cursor = this.find_elements_under_cursor(
            this.mousepos.x, this.mousepos.y
        );
        let elements = elements_under_cursor.elements;
        let total_elements = elements_under_cursor.total_elements;
        let foreground_elem = elements_under_cursor.foreground_elem;

        // Change mouse cursor accordingly
        if (this.mouse_mode === 'select') {
            this.canvas.style.cursor = 'crosshair';
        } else if (total_elements > 0) {
            if (this.mouse_mode === 'move' && this.drag_start) {
                this.canvas.style.cursor = 'grabbing';
            } else if (this.mouse_mode === 'move') {
                this.canvas.style.cursor = 'grab';
            } else {
                // Hovering over an element while not in any specific mode.
                if ((foreground_elem.data.state &&
                     foreground_elem.data.state.attributes.is_collapsed) ||
                    (foreground_elem.data.node &&
                     foreground_elem.data.node.attributes.is_collapsed)) {
                    // This is a collapsed node or state, show with the cursor
                    // shape that this can be expanded.
                    this.canvas.style.cursor = 'alias';
                } else {
                    this.canvas.style.cursor = 'pointer';
                }
            }
        } else {
            this.canvas.style.cursor = 'auto';
        }

        this.tooltip = null;
        this.last_hovered_elements = elements;

        // De-highlight all elements.
        this.for_all_elements(this.mousepos.x, this.mousepos.y, 0, 0, (type, e, obj, intersected) => {
            obj.hovered = false;
            obj.highlighted = false;
        });
        // Mark hovered and highlighted elements.
        this.for_all_elements(this.mousepos.x, this.mousepos.y, 0, 0, (type, e, obj, intersected) => {
            if (intersected && obj instanceof Edge && obj.parent_id != null) {
                let tree = memlet_tree(e.graph, obj);
                tree.forEach(te => {
                    if (te != obj) {
                        te.highlighted = true;
                    }
                });
            }

            if (intersected)
                obj.hovered = true;
        });

        if (evtype === "mousemove") {
            // TODO: Draw only if elements have changed
            dirty = true;
        }

        if (evtype === "dblclick") {
            let sdfg = (foreground_elem ? foreground_elem.sdfg : null);
            let sdfg_elem = null;
            if (foreground_elem instanceof State)
                sdfg_elem = foreground_elem.data.state;
            else if (foreground_elem instanceof Node) {
                sdfg_elem = foreground_elem.data.node;

                // If a scope exit node, use entry instead
                if (sdfg_elem.type.endsWith("Exit"))
                    sdfg_elem = sdfg.nodes[foreground_elem.parent_id].nodes[sdfg_elem.scope_entry];
            } else
                sdfg_elem = null;

            // Toggle collapsed state
            if (sdfg_elem && 'is_collapsed' in sdfg_elem.attributes) {
                sdfg_elem.attributes.is_collapsed = !sdfg_elem.attributes.is_collapsed;

                // Re-layout SDFG
                this.relayout();
                dirty = true;
                element_focus_changed = true;
            }
        }

        let ends_drag = false;
        if (evtype === 'click') {
            if (this.dragging) {
                // This click ends a drag.
                this.dragging = false;
                ends_drag = true;

                if (this.box_select_rect) {
                    let elements_in_selection = [];
                    let start_x = Math.min(this.box_select_rect.x_start,
                        this.box_select_rect.x_end);
                    let end_x = Math.max(this.box_select_rect.x_start,
                        this.box_select_rect.x_end);
                    let start_y = Math.min(this.box_select_rect.y_start,
                        this.box_select_rect.y_end);
                    let end_y = Math.max(this.box_select_rect.y_start,
                        this.box_select_rect.y_end);
                    let w = end_x - start_x;
                    let h = end_y - start_y;
                    this.do_for_intersected_elements(start_x, start_y, w, h,
                        (type, e, obj) => {
                            if (obj.contained_in(start_x, start_y, w, h))
                                elements_in_selection.push(obj);
                        });
                    if (event.shiftKey) {
                        elements_in_selection.forEach((el) => {
                            if (!this.selected_elements.includes(el))
                                this.selected_elements.push(el);
                        });
                    } else if (event.ctrlKey) {
                        elements_in_selection.forEach((el) => {
                            if (this.selected_elements.includes(el)) {
                                this.selected_elements =
                                    this.selected_elements.filter((val) => {
                                        val.selected = false;
                                        return val !== el;
                                    });
                            }
                        });
                    } else {
                        this.selected_elements.forEach((el) => {
                            el.selected = false;
                        });
                        this.selected_elements = elements_in_selection;
                    }
                    this.box_select_rect = null;
                    dirty = true;
                    element_focus_changed = true;
                }
            } else {
                if (foreground_elem) {
                    if (event.ctrlKey) {
                        // Ctrl + click on an object, add it, or remove it from
                        // the selection if it was previously in it.
                        if (this.selected_elements.includes(foreground_elem)) {
                            foreground_elem.selected = false;
                            this.selected_elements =
                                this.selected_elements.filter((el) => {
                                    return el !== foreground_elem;
                                });
                        } else {
                            this.selected_elements.push(foreground_elem);
                        }
                    } else if (event.shiftKey) {
                        // TODO: Implement shift-clicks for path selection.
                    } else {
                        // Clicked an element, select it and nothing else.
                        this.selected_elements.forEach((el) => {
                            el.selected = false;
                        });
                        this.selected_elements = [foreground_elem];
                    }
                } else {
                    // Clicked nothing, clear the selection.
                    this.selected_elements.forEach((el) => {
                        el.selected = false;
                    });
                    this.selected_elements = [];
                }
                dirty = true;
                element_focus_changed = true;
            }
        }
        this.selected_elements.forEach((el) => {
            el.selected = true;
        });

        let mouse_x = comp_x_func(event);
        let mouse_y = comp_y_func(event);
        if (this.external_mouse_handler)
            dirty |= this.external_mouse_handler(evtype, event, { x: mouse_x, y: mouse_y }, elements,
                this, this.selected_elements, ends_drag);

        dirty |= this.overlay_manager.on_mouse_event(
            evtype,
            event,
            { x: mouse_x, y: mouse_y },
            elements,
            foreground_elem,
            ends_drag
        );

        if (dirty) {
            this.draw_async();
        }

        if (element_focus_changed) {
            // If a listener in VSCode is present, update it about the new
            // viewport and tell it to re-sort the shown transformations.
            try {
                if (vscode) {
                    function clean_selected(selected_elements) {
                        let elems = [];
                        selected_elements.forEach((el) => {
                            let parent_id =
                                el.parent_id === null ? -1 : el.parent_id;
                            let type = 'other';
                            if (el.data.node)
                                type = 'node';
                            else if (el.data.state)
                                type = 'state';
                            else if (el.data.type === 'InterstateEdge')
                                type = 'isedge';
                            else if (el.data.type === 'Memlet')
                                type = 'edge';
                            elems.push({
                                type: type,
                                sdfg_id: el.sdfg.sdfg_list_id,
                                state_id: parent_id,
                                id: el.id,
                            });
                        });
                        return elems;
                    }

                    vscode.postMessage({
                        type: 'sortTransformations',
                        visibleElements: JSON.stringify(this.visible_elements()),
                        selectedElements: JSON.stringify(
                            clean_selected(this.selected_elements)
                        ),
                    });
                }
            } catch (ex) {
                // Do nothing
            }
        }

        return false;
    }
}

/**
 * Create a DOM element with an optional given ID and class list.
 *
 * If a parent is provided, the element is automatically added as a child.
 *
 * @param {*} type      Element tag (div, span, etc.)
 * @param {*} id        Optional element id
 * @param {*} classList Optional array of class names
 * @param {*} parent    Optional parent element
 *
 * @returns             The created DOM element
 */
function createElement(type, id='', classList=[], parent=undefined) {
    let element = document.createElement(type);
    if (id !== '')
        element.id = id;
    if (classList !== [])
        classList.forEach(class_name => {
            if (!element.classList.contains(class_name))
                element.classList.add(class_name);
        });
    if (parent)
        parent.appendChild(element);
    return element;
}

window.SDFGRenderer = SDFGRenderer;
