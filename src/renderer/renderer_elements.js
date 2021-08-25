// Copyright 2019-2021 ETH Zurich and the DaCe authors. All rights reserved.

import { sdfg_range_elem_to_string, sdfg_property_to_string } from '../utils/sdfg/display';
import { check_and_redirect_edge } from "../utils/sdfg/sdfg_utils";
import { LINEHEIGHT } from '../utils/constants';
import { calculateEdgeBoundingBox } from "../utils/bounding_box"

export class SDFGElement {
    connectorPadding = 10;

    // Parent ID is the state ID, if relevant
    constructor(elem, elem_id, sdfg, parent_id = null) {
        this.data = elem;
        this.id = elem_id;
        this.parent_id = parent_id;
        this.sdfg = sdfg;
        this.inConnectors = [];
        this.outConnectors = [];

        // Indicate special drawing conditions based on interactions.
        this.selected = false;
        this.highlighted = false;
        this.hovered = false;

        this.childGraph = elem.graph || null;
        if (this.childGraph !== null) {
            this.childGraph.parentNode = this;
        }

        this.scopeEntry = null;
        this.scopeExit = null;
        if (elem.node) {
            this.scopeEntry = elem.node.scope_entry ? parseInt(elem.node.scope_entry) : null;
            this.scopeExit = elem.node.scope_exit ? parseInt(elem.node.scope_exit) : null;
        }

        this.set_layout();
    }

    set_layout() {
        // dagre does not work well with properties, only fields
        this.width = this.data.layout.width;
        this.height = this.data.layout.height;
    }

    attributes() {
        return this.data.attributes;
    }

    type() {
        return this.data.type;
    }

    label() {
        return this.data.label;
    }

    long_label() {
        return this.label();
    }

    topleft() {
        return { x: this.x - this.width / 2, y: this.y - this.height / 2 };
    }

    // General bounding-box intersection function. Returns true iff point or rectangle intersect element.
    intersect(x, y, w = 0, h = 0) {
        if (w == 0 || h == 0) {  // Point-element intersection
            return (x >= this.x - this.width / 2.0) &&
                (x <= this.x + this.width / 2.0) &&
                (y >= this.y - this.height / 2.0) &&
                (y <= this.y + this.height / 2.0);
        } else {                 // Box-element intersection
            return (x <= this.x + this.width / 2.0) &&
                (x + w >= this.x - this.width / 2.0) &&
                (y <= this.y + this.height / 2.0) &&
                (y + h >= this.y - this.height / 2.0);
        }
    }

    contained_in(x, y, w = 0, h = 0) {
        if (w === 0 || h === 0)
            return false;

        const box_start_x = x;
        const box_end_x = x + w;
        const box_start_y = y;
        const box_end_y = y + h;

        var el_start_x = this.x;
        var el_end_x = this.x + this.width;
        var el_start_y = this.y;
        var el_end_y = this.y + this.height ;

        return box_start_x <= el_start_x &&
            box_end_x >= el_end_x &&
            box_start_y <= el_start_y &&
            box_end_y >= el_end_y;
    }

    size() {
        return {
            width: this.width,
            height: this.height,
        };
    }

    setPosition(position) {
        const prevX = this.x || 0;
        const prevY = this.y || 0;
        const offsetX = position.x - prevX;
        const offsetY = position.y - prevY;
        this.x = position.x;
        this.y = position.y;
        if (this.childGraph !== null) {
            this.childGraph.offsetChildren(offsetX, offsetY);
        }
    }

    setSize(size) {
        this.width = size.width;
        this.height = size.height;
    }

    boundingBox() {
        return {
            x: this.x,
            y: this.y,
            width: this.width,
            height: this.height,
        }
    }

    offset(x, y) {
        this.x += x;
        this.y += y;
        if (this.childGraph !== null) {
            this.childGraph.offsetChildren(x, y);
        }
    }
}

// SDFG as an element (to support properties)
export class SDFG extends SDFGElement {
    childPadding = 4 * LINEHEIGHT;

    constructor(sdfg) {
        super(sdfg, -1, sdfg);
    }

    set_layout() {
    }

    label() {
        return this.data.attributes.name;
    }
}

export class State extends SDFGElement {
    attributes() {
        return this.data.state.attributes;
    }

    label() {
        return this.data.state.label;
    }

    type() {
        return this.data.state.type;
    }
}

export class SDFGNode extends SDFGElement {
    /**
     * What stroke style to use for this node.
     * 
     * @returns {'normal' | 'bold' | 'double'}
     */
    getStrokeStyle() {
        return 'normal';
    }

    label() {
        return this.data.node.label;
    }

    attributes() {
        return this.data.node.attributes;
    }

    type() {
        return this.data.node.type;
    }

    set_layout() {
        this.width = this.data.node.attributes.layout.width;
        this.height = this.data.node.attributes.layout.height;
    }
}

export class Edge extends SDFGElement {
    set_layout() {
        // NOTE: Setting this.width/height will disrupt dagre in self-edges
    }

    label() {
        // Memlet
        if (this.data.attributes.subset !== undefined)
            return "";
        return super.label();
    }

    labelSize() {

    }

    intersect(x, y, w = 0, h = 0) {
        // First, check bounding box
        if (!super.intersect(x, y, w, h))
            return false;

        // Then (if point), check distance from line
        if (w == 0 || h == 0) {
            for (let i = 0; i < this.points.length - 1; i++) {
                const dist = ptLineDistance({ x: x, y: y }, this.points[i], this.points[i + 1]);
                if (dist <= 5.0)
                    return true;
            }
            return false;
        }
        return true;
    }

    boundingBox() {
        return calculateEdgeBoundingBox(this);
    }

    updateBoundingBox() {
        let bb = calculateEdgeBoundingBox(this);
        this.x = bb.x;
        this.y = bb.y;
        this.width = bb.width;
        this.height = bb.height;
    }

    offset(x, y) {
        this.points.forEach(point => {
            point.x += x;
            point.y += y;
        });
        this.updateBoundingBox();
    }
}

export class Connector extends SDFGElement {
    constructor(elem, elem_id, sdfg, parent_id = null) {
        super(elem, elem_id, sdfg, parent_id);
        this.name = elem.name;
        this.width = LINEHEIGHT;
        this.height = LINEHEIGHT;
    }
    attributes() {
        return {};
    }

    set_layout() { }

    label() { return this.data.name; }
}

export class AccessNode extends SDFGNode {
    getStrokeStyle() {
        const nodedesc = this.sdfg.attributes._arrays[this.data.node.attributes.data];
        return nodedesc && nodedesc.attributes.transient === false ? 'bold' : 'normal';
    }

}

export class ScopeNode extends SDFGNode {
    childPadding = LINEHEIGHT;

    far_label(settings) {
        const closeLabel = this.close_label(settings);
        return closeLabel.substring(closeLabel.indexOf('['));
    }

    close_label(settings) {
        if (!settings.inclusiveRanges)
            return this.label();

        let attrs = this.attributes();
        let result = attrs.label;
        if (this.scopeend()) {
            const entry = this.sdfg.nodes[this.parent_id].nodes[this.data.node.scope_entry];
            if (entry !== undefined)
                attrs = entry.attributes;
            else
                return this.label();
        }
        result += ' [';

        if (this instanceof ConsumeEntry || this instanceof ConsumeExit) {
            result += attrs.pe_index + '=' + '0..' + (attrs.num_pes - 1).toString();
        } else {
            for (let i = 0; i < attrs.params.length; ++i) {
                result += attrs.params[i] + '=';
                result += sdfg_range_elem_to_string(attrs.range.ranges[i], settings) + ', ';
            }
            result = result.substring(0, result.length - 2); // Remove trailing comma
        }
        return result + ']';
    }
}

export class EntryNode extends ScopeNode {
    scopeend() { return false; }
}

export class ExitNode extends ScopeNode {
    scopeend() { return true; }
}

export class MapEntry extends EntryNode {}
export class MapExit extends ExitNode {}
export class ConsumeEntry extends EntryNode {}
export class ConsumeExit extends ExitNode {}
export class PipelineEntry extends EntryNode {}
export class PipelineExit extends ExitNode {}

export class Tasklet extends SDFGNode {}

export class Reduce extends SDFGNode {}

export class NestedSDFG extends SDFGNode {
    childPadding = LINEHEIGHT;

    getStrokeStyle() {
        return this.data.node.attributes.is_collapsed ? 'double' : 'normal';
    }

    set_layout() {
        if (this.data.node.attributes.is_collapsed) {
            const labelsize = this.data.node.attributes.label.length * LINEHEIGHT * 0.8;
            const inconnsize = 2 * LINEHEIGHT * Object.keys(this.data.node.attributes.in_connectors).length - LINEHEIGHT;
            const outconnsize = 2 * LINEHEIGHT * Object.keys(this.data.node.attributes.out_connectors).length - LINEHEIGHT;
            const maxwidth = Math.max(labelsize, inconnsize, outconnsize);
            let maxheight = 2 * LINEHEIGHT;
            maxheight += 4 * LINEHEIGHT;

            const size = { width: maxwidth, height: maxheight };
            size.width += 2.0 * (size.height / 3.0);
            size.height /= 1.75;

            this.width = size.width;
            this.height = size.height;
        } else {
            this.width = this.data.node.attributes.layout.width;
            this.height = this.data.node.attributes.layout.height;
        }
    }


    label() { return ""; }
}

export class LibraryNode extends SDFGNode {}

// Translate an SDFG by a given offset
export function offset_sdfg(sdfg, sdfg_graph, offset) {
    sdfg.nodes.forEach((state, id) => {
        const g = sdfg_graph.node(id);
        g.x += offset.x;
        g.y += offset.y;
        if (!state.attributes.is_collapsed)
            offset_state(state, g, offset);
    });
    sdfg.edges.forEach((e, eid) => {
        const edge = sdfg_graph.edge(e.src, e.dst);
        edge.x += offset.x;
        edge.y += offset.y;
        edge.points.forEach((p) => {
            p.x += offset.x;
            p.y += offset.y;
        });
    });
}

// Translate nodes, edges, and connectors in a given SDFG state by an offset
export function offset_state(state, state_graph, offset) {
    const drawn_nodes = new Set();

    state.nodes.forEach((n, nid) => {
        const node = state_graph.data.graph.node(nid);
        if (!node) return;
        drawn_nodes.add(nid.toString());

        node.x += offset.x;
        node.y += offset.y;
        node.inConnectors.forEach(c => {
            c.x += offset.x;
            c.y += offset.y;
        });
        node.outConnectors.forEach(c => {
            c.x += offset.x;
            c.y += offset.y;
        });

        if (node.data.node.type === 'NestedSDFG')
            offset_sdfg(node.data.node.attributes.sdfg, node.data.graph, offset);
    });
    state.edges.forEach((e, eid) => {
        e = check_and_redirect_edge(e, drawn_nodes, state);
        if (!e) return;
        const edge = state_graph.data.graph.edge(e.src, e.dst, eid);
        if (!edge) return;
        edge.x += offset.x;
        edge.y += offset.y;
        edge.points.forEach((p) => {
            p.x += offset.x;
            p.y += offset.y;
        });
    });
}

// Returns the distance from point p to line defined by two points (line1, line2)
export function ptLineDistance(p, line1, line2) {
    const dx = (line2.x - line1.x);
    const dy = (line2.y - line1.y);
    const res = dy * p.x - dx * p.y + line2.x * line1.y - line2.y * line1.x;

    return Math.abs(res) / Math.sqrt(dy * dy + dx * dx);
}

/**
 * Get the color on a green-red temperature scale based on a fractional value.
 * @param {Number} val Value between 0 and 1, 0 = green, .5 = yellow, 1 = red
 * @returns            HSL color string
 */
export function getTempColor(val) {
    if (val < 0)
        val = 0;
    if (val > 1)
        val = 1;
    const hue = ((1 - val) * 120).toString(10);
    return 'hsl(' + hue + ',100%,50%)';
}

export const SDFGElements = {
    SDFGElement, SDFG, State, SDFGNode, Edge, Connector, AccessNode, ScopeNode, EntryNode, ExitNode, MapEntry, MapExit,
    ConsumeEntry, ConsumeExit, Tasklet, Reduce, PipelineEntry, PipelineExit, NestedSDFG, LibraryNode
};
