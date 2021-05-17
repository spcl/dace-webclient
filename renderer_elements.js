// Copyright 2019-2021 ETH Zurich and the DaCe authors. All rights reserved.

class SDFGElement {
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

    draw(renderer, ctx, mousepos) {}

    shade(renderer, ctx, color, alpha='0.6') {}

    debug_draw(renderer, ctx) {
        if (renderer.debug_draw) {
            // Print the center and bounding box in debug mode.
            ctx.beginPath();
            ctx.arc(this.x, this.y, 1, 0, 2 * Math.PI, false);
            ctx.fillStyle = 'red';
            ctx.fill();
            ctx.strokeStyle = 'red';
            ctx.stroke();
            ctx.strokeRect(this.x - (this.width / 2.0), this.y - (this.height / 2.0),
                this.width, this.height);
        }
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

    // Produces HTML for a hover-tooltip
    tooltip(container) {
        container.className = 'sdfvtooltip';
    }

    topleft() {
        return { x: this.x, y: this.y };
    }

    strokeStyle(renderer=undefined) {
        if (this.selected) {
            if (this.hovered)
                return this.getCssProperty(renderer, '--color-selected-hovered');
            else if (this.highlighted)
                return this.getCssProperty(renderer, '--color-selected-highlighted');
            else
                return this.getCssProperty(renderer, '--color-selected');
        } else {
            if (this.hovered)
                return this.getCssProperty(renderer, '--color-hovered');
            else if (this.highlighted)
                return this.getCssProperty(renderer, '--color-highlighted');
        }
        return this.getCssProperty(renderer, '--color-default');
    }

    // General bounding-box intersection function. Returns true iff point or rectangle intersect element.
    intersect(x, y, w = 0, h = 0) {
        if (w == 0 || h == 0) {  // Point-element intersection
            return (x >= this.x) &&
                (x <= this.x + this.width) &&
                (y >= this.y) &&
                (y <= this.y + this.height);
        } else {                 // Box-element intersection
            return (x <= this.x + this.width) &&
                (x + w >= this.x) &&
                (y <= this.y + this.height) &&
                (y + h >= this.y);
        }
    }

    contained_in(x, y, w = 0, h = 0) {
        if (w === 0 || h === 0)
            return false;

        var box_start_x = x;
        var box_end_x = x + w;
        var box_start_y = y;
        var box_end_y = y + h;

        var el_start_x = this.x;
        var el_end_x = this.x + this.width;
        var el_start_y = this.y;
        var el_end_y = this.y + this.height ;

        return box_start_x <= el_start_x &&
            box_end_x >= el_end_x &&
            box_start_y <= el_start_y &&
            box_end_y >= el_end_y;
    }

    getCssProperty(renderer, propertyName) {
        return window.getComputedStyle(renderer.canvas).getPropertyValue(propertyName).trim();
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
class SDFG extends SDFGElement {
    constructor(sdfg) {
        super(sdfg, -1, sdfg);
    }

    set_layout() {
    }

    label() {
        return this.data.attributes.name;
    }
}

class State extends SDFGElement {
    childPadding = 4 * LINEHEIGHT;

    draw(renderer, ctx, mousepos) {
        let topleft = this.topleft();
        let visible_rect = renderer.visible_rect;
        let clamped = {x: Math.max(topleft.x, visible_rect.x),
                       y: Math.max(topleft.y, visible_rect.y),
                       x2: Math.min(topleft.x + this.width,
                                    visible_rect.x + visible_rect.w),
                       y2: Math.min(topleft.y + this.height,
                                    visible_rect.y + visible_rect.h)};
        clamped.w = clamped.x2 - clamped.x;
        clamped.h = clamped.y2 - clamped.y;
        if (!ctx.lod)
            clamped = {x: topleft.x, y: topleft.y,
                       w: this.width, h: this.height};

        ctx.fillStyle = this.getCssProperty(renderer, '--state-background-color');
        ctx.fillRect(clamped.x, clamped.y, clamped.w, clamped.h);
        ctx.fillStyle = this.getCssProperty(renderer, '--state-foreground-color');

        if (visible_rect.x <= topleft.x && visible_rect.y <= topleft.y + LINEHEIGHT)
            ctx.fillText(this.label(), topleft.x, topleft.y + LINEHEIGHT);

        // If this state is selected or hovered
        if ((this.selected || this.highlighted || this.hovered) &&
            (clamped.x === topleft.x ||
                clamped.y === topleft.y ||
                clamped.x2 === topleft.x + this.width ||
                clamped.y2 === topleft.y + this.height)) {
            ctx.strokeStyle = this.strokeStyle(renderer);
            ctx.strokeRect(clamped.x, clamped.y, clamped.w, clamped.h);
        }

        // If collapsed, draw a "+" sign in the middle
        if (this.data.state.attributes.is_collapsed) {
            ctx.beginPath();
            ctx.moveTo(this.x, this.y - LINEHEIGHT);
            ctx.lineTo(this.x, this.y + LINEHEIGHT);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(this.x - LINEHEIGHT, this.y);
            ctx.lineTo(this.x + LINEHEIGHT, this.y);
            ctx.stroke();
        }

        ctx.strokeStyle = "black";
    }

    simple_draw(renderer, ctx, mousepos) {
        // Fast drawing function for small states
        let topleft = this.topleft();

        ctx.fillStyle = this.getCssProperty(renderer, '--state-background-color');
        ctx.fillRect(topleft.x, topleft.y, this.width, this.height);
        ctx.fillStyle = this.getCssProperty(renderer, '--state-text-color');

        if (mousepos && this.intersect(mousepos.x, mousepos.y))
            renderer.tooltip = (c) => this.tooltip(c);
        // Draw state name in center without contents (does not look good)
        /*
        let FONTSIZE = Math.min(renderer.canvas_manager.points_per_pixel() * 16, 100);
        let label = this.label();

        let oldfont = ctx.font;
        ctx.font = FONTSIZE + "px Arial";

        let textmetrics = ctx.measureText(label);
        ctx.fillText(label, this.x - textmetrics.width / 2.0, this.y - this.height / 6.0 + FONTSIZE / 2.0);

        ctx.font = oldfont;
        */
    }

    shade(renderer, ctx, color, alpha='0.6') {
        // Save the current style properties.
        let orig_fill_style = ctx.fillStyle;
        let orig_alpha = ctx.globalAlpha;

        ctx.globalAlpha = alpha;
        ctx.fillStyle = color;

        let topleft = this.topleft();
        ctx.fillRect(topleft.x, topleft.y, this.width, this.height);

        // Restore the previous style properties.
        ctx.fillStyle = orig_fill_style;
        ctx.globalAlpha = orig_alpha;
    }

    tooltip(container) {
        container.innerHTML = 'State: ' + this.label();
    }

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

class Node extends SDFGElement {
    draw(renderer, ctx, mousepos, fgstyle='--node-foreground-color', bgstyle='--node-background-color') {
        let topleft = this.topleft();
        ctx.fillStyle = this.getCssProperty(renderer, bgstyle);
        ctx.fillRect(topleft.x, topleft.y, this.width, this.height);
        ctx.strokeStyle = this.strokeStyle(renderer);
        ctx.strokeRect(topleft.x, topleft.y, this.width, this.height);
        ctx.fillStyle = this.getCssProperty(renderer, fgstyle);
        let textw = ctx.measureText(this.label()).width;
        ctx.fillText(this.label(), this.x - textw / 2, this.y + LINEHEIGHT / 4);
    }

    simple_draw(renderer, ctx, mousepos) {
        // Fast drawing function for small nodes
        let topleft = this.topleft();
        ctx.fillStyle = this.getCssProperty(renderer, '--node-background-color');
        ctx.fillRect(topleft.x, topleft.y, this.width, this.height);
        ctx.fillStyle = this.getCssProperty(renderer, '--node-foreground-color');
    }

    shade(renderer, ctx, color, alpha='0.6') {
        // Save the current style properties.
        let orig_fill_style = ctx.fillStyle;
        let orig_alpha = ctx.globalAlpha;

        ctx.globalAlpha = alpha;
        ctx.fillStyle = color;

        let topleft = this.topleft();
        ctx.fillRect(topleft.x, topleft.y, this.width, this.height);

        // Restore the previous style properties.
        ctx.fillStyle = orig_fill_style;
        ctx.globalAlpha = orig_alpha;
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

class Edge extends SDFGElement {

    create_arrow_line(ctx) {
        ctx.beginPath();
        ctx.moveTo(this.points[0].x, this.points[0].y);
        if (this.points.length === 2) {
            // Straight line can be drawn
            ctx.lineTo(this.points[1].x, this.points[1].y);
        } else {
            let i;
            for (i = 1; i < this.points.length - 2; i++) {
                let xm = (this.points[i].x + this.points[i + 1].x) / 2.0;
                let ym = (this.points[i].y + this.points[i + 1].y) / 2.0;
                ctx.quadraticCurveTo(this.points[i].x, this.points[i].y, xm, ym);
            }
            ctx.quadraticCurveTo(this.points[i].x, this.points[i].y,
                this.points[i + 1].x, this.points[i + 1].y);
        }
    }

    draw(renderer, ctx, mousepos) {
        let edge = this;

        this.create_arrow_line(ctx);

        let style = this.strokeStyle(renderer);
        if (this.hovered)
            renderer.tooltip = (c) => this.tooltip(c, renderer);
        if (this.parent_id == null && style === this.getCssProperty(renderer, '--color-default')) {  // Interstate edge
            style = this.getCssProperty(renderer, '--interstate-edge-color');
        }
        ctx.fillStyle = ctx.strokeStyle = style;

        // CR edges have dashed lines
        if (this.parent_id != null && this.data.attributes.wcr != null)
            ctx.setLineDash([2, 2]);
        else
            ctx.setLineDash([1, 0]);

        ctx.stroke();

        ctx.setLineDash([1, 0]);

        if (edge.points.length < 2)
            return;


        // Show anchor points for moving
        if (this.selected && renderer.mouse_mode === 'move') {
            let i;
            for (i = 1; i < this.points.length - 1; i++)                
                ctx.strokeRect(this.points[i].x - 5, this.points[i].y - 5, 8, 8);
        }
          
        drawArrow(ctx, edge.points[edge.points.length - 2], edge.points[edge.points.length - 1], 3);
    }

    shade(renderer, ctx, color, alpha='0.6') {
        this.create_arrow_line(ctx);

        // Save current style properties.
        let orig_stroke_style = ctx.strokeStyle;
        let orig_fill_style = ctx.fillStyle;
        let orig_line_cap = ctx.lineCap;
        let orig_line_width = ctx.lineWidth;
        let orig_alpha = ctx.globalAlpha;

        ctx.globalAlpha = alpha;
        ctx.lineWidth = orig_line_width + 1;
        ctx.fillStyle = color;
        ctx.strokeStyle = color;
        ctx.lineCap = 'round';

        ctx.stroke();

        if (this.points.length < 2)
            return;
        drawArrow(ctx, this.points[this.points.length - 2],
            this.points[this.points.length - 1], 3, 0, 2);

        // Restore previous stroke style, width, and opacity.
        ctx.strokeStyle = orig_stroke_style;
        ctx.fillStyle = orig_fill_style;
        ctx.lineCap = orig_line_cap;
        ctx.lineWidth = orig_line_width;
        ctx.globalAlpha = orig_alpha;
    }

    tooltip(container, renderer) {
        super.tooltip(container);
        let dsettings = renderer.view_settings();
        let attr = this.attributes();
        // Memlet
        if (attr.subset !== undefined) {
            if (attr.subset === null) {  // Empty memlet
                container.style.display = 'none';
                return;
            }
            let contents = attr.data;
            contents += sdfg_property_to_string(attr.subset, dsettings);

            if (attr.other_subset)
                contents += ' -> ' + sdfg_property_to_string(attr.other_subset, dsettings);

            if (attr.wcr)
                contents += '<br /><b>CR: ' + sdfg_property_to_string(attr.wcr, dsettings) + '</b>';

            let num_accesses = null;
            if (attr.volume)
                num_accesses = sdfg_property_to_string(attr.volume, dsettings);
            else
                num_accesses = sdfg_property_to_string(attr.num_accesses, dsettings);

            if (attr.dynamic) {
                if (num_accesses == 0 || num_accesses == -1)
                    num_accesses = "<b>Dynamic (unbounded)</b>";
                else
                    num_accesses = "<b>Dynamic</b> (up to " + num_accesses + ")";
            } else if (num_accesses == -1) {
                num_accesses = "<b>Dynamic (unbounded)</b>";
            }

            contents += '<br /><font style="font-size: 14px">Volume: ' + num_accesses + '</font>';
            container.innerHTML = contents;
        } else {  // Interstate edge
            container.classList.add('sdfvtooltip--interstate-edge');
            container.innerText = this.label();
            if (!this.label())
                container.style.display = 'none';
        }
    }

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
                let dist = ptLineDistance({ x: x, y: y }, this.points[i], this.points[i + 1]);
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

class Connector extends SDFGElement {
    constructor(elem, elem_id, sdfg, parent_id = null) {
        super(elem, elem_id, sdfg, parent_id);
        this.name = elem.name;
        this.width = LINEHEIGHT;
        this.height = LINEHEIGHT;
    }

    draw(renderer, ctx, mousepos) {
        let scope_connector = (this.data.name.startsWith("IN_") || this.data.name.startsWith("OUT_"));
        let topleft = this.topleft();
        ctx.beginPath();
        drawEllipse(ctx, topleft.x, topleft.y, this.width, this.height);
        ctx.closePath();
        ctx.strokeStyle = this.strokeStyle(renderer);
        let fillColor;
        if (scope_connector) {
            let cname = this.data.name;
            if (cname.startsWith("IN_"))
                cname = cname.substring(3);
            else
                cname = cname.substring(4);

            ctx.lineWidth = 0.4;
            ctx.stroke();
            ctx.lineWidth = 1.0;
            fillColor = this.getCssProperty(renderer, '--connector-scoped-color');
        } else {
            ctx.stroke();
            fillColor = this.getCssProperty(renderer, '--connector-unscoped-color');
        }
        if (ctx.pdf) // PDFs do not support transparent fill colors
            fillColor = fillColor.substr(0, 7);
        ctx.fillStyle = fillColor;

        if (ctx.pdf) { // PDFs do not support stroke and fill on the same object
            ctx.beginPath();
            drawEllipse(ctx, topleft.x, topleft.y, this.width, this.height);
            ctx.closePath();
        }
        ctx.fill();
        if (this.strokeStyle(renderer) !== this.getCssProperty(renderer, '--color-default'))
            renderer.tooltip = (c) => this.tooltip(c);
    }

    attributes() {
        return {};
    }

    set_layout() { }

    label() { return this.data.name; }

    tooltip(container) {
        super.tooltip(container);
        container.classList.add('sdfvtooltip--connector');
        container.innerText = this.label();
    }
}

class AccessNode extends Node {
    draw(renderer, ctx, mousepos) {
        let topleft = this.topleft();
        ctx.beginPath();
        drawEllipse(ctx, topleft.x, topleft.y, this.width, this.height);
        ctx.closePath();
        ctx.strokeStyle = this.strokeStyle(renderer);

        let nodedesc = this.sdfg.attributes._arrays[this.data.node.attributes.data];
        // Streams have dashed edges
        if (nodedesc && nodedesc.type === "Stream") {
            ctx.setLineDash([5, 3]);
        } else {
            ctx.setLineDash([1, 0]);
        }

        // Non-transient (external) data is thicker
        if (nodedesc && nodedesc.attributes.transient === false) {
            ctx.lineWidth = 3.0;
        } else {
            ctx.lineWidth = 1.0;
        }
        ctx.stroke();
        ctx.lineWidth = 1.0;
        ctx.setLineDash([1, 0]);

        // Views are colored like connectors
        if (nodedesc && nodedesc.type === "View") {
            ctx.fillStyle = this.getCssProperty(renderer, '--connector-unscoped-color');
        } else {
            ctx.fillStyle = this.getCssProperty(renderer, '--node-background-color');
        }

        if (ctx.pdf) { // PDFs do not support stroke and fill on the same object
            ctx.beginPath();
            drawEllipse(ctx, topleft.x, topleft.y, this.width, this.height);
            ctx.closePath();
        }
        ctx.fill();
        ctx.fillStyle = this.getCssProperty(renderer, '--node-foreground-color');
        var textmetrics = ctx.measureText(this.label());
        ctx.fillText(this.label(), this.x + this.width / 2 - textmetrics.width / 2.0, this.y + this.height / 2 + LINEHEIGHT / 4.0);
    }

    shade(renderer, ctx, color, alpha='0.6') {
        // Save the current style properties.
        let orig_fill_style = ctx.fillStyle;
        let orig_alpha = ctx.globalAlpha;

        ctx.globalAlpha = alpha;
        ctx.fillStyle = color;

        let topleft = this.topleft();
        ctx.beginPath();
        drawEllipse(ctx, topleft.x, topleft.y, this.width, this.height);
        ctx.closePath();
        ctx.fill();

        // Restore the previous style properties.
        ctx.fillStyle = orig_fill_style;
        ctx.globalAlpha = orig_alpha;
    }

}

class ScopeNode extends Node {
    connectorPadding = 40;

    draw(renderer, ctx, mousepos) {
        let draw_shape;
        if (this.data.node.attributes.is_collapsed) {
            draw_shape = () => drawHexagon(ctx, this.x, this.y, this.width, this.height);
        } else {
            draw_shape = () => drawTrapezoid(ctx, this.topleft(), this, this.scopeend());
        }
        ctx.strokeStyle = this.strokeStyle(renderer);

        // Consume scopes have dashed edges
        if (this.data.node.type.startsWith("Consume"))
            ctx.setLineDash([5, 3]);
        else
            ctx.setLineDash([1, 0]);

        draw_shape();
        ctx.stroke();
        ctx.setLineDash([1, 0]);
        ctx.fillStyle = this.getCssProperty(renderer, '--node-background-color');
        if (ctx.pdf) // PDFs do not support stroke and fill on the same object
            draw_shape();
        ctx.fill();
        ctx.fillStyle = this.getCssProperty(renderer, '--node-foreground-color');

        let far_label = this.far_label();
        drawAdaptiveText(ctx, renderer, far_label,
            this.close_label(renderer), this.x + this.width / 2, this.y + this.height / 2,
            this.width, this.height,
            SCOPE_LOD);
    }

    shade(renderer, ctx, color, alpha='0.6') {
        // Save the current style properties.
        let orig_fill_style = ctx.fillStyle;
        let orig_alpha = ctx.globalAlpha;

        ctx.globalAlpha = alpha;
        ctx.fillStyle = color;

        if (this.data.node.attributes.is_collapsed)
            drawHexagon(ctx, this.x, this.y, this.width, this.height);
        else
            drawTrapezoid(ctx, this.topleft(), this, this.scopeend());
        ctx.fill();

        // Restore the previous style properties.
        ctx.fillStyle = orig_fill_style;
        ctx.globalAlpha = orig_alpha;
    }

    far_label() {
        let result = this.attributes().label;
        if (this.scopeend()) {  // Get label from scope entry
            let entry = this.sdfg.nodes[this.parent_id].nodes[this.data.node.scope_entry];
            if (entry !== undefined)
                result = entry.attributes.label;
            else {
                result = this.data.node.label;
                let ind = result.indexOf('[');
                if (ind > 0)
                    result = result.substring(0, ind);
            }
        }
        return result;
    }

    close_label(renderer) {
        if (!renderer.inclusive_ranges)
            return this.label();

        let result = this.far_label();
        let attrs = this.attributes();
        if (this.scopeend()) {
            let entry = this.sdfg.nodes[this.parent_id].nodes[this.data.node.scope_entry];
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
                result += sdfg_range_elem_to_string(attrs.range.ranges[i], renderer.view_settings()) + ', ';
            }
            result = result.substring(0, result.length - 2); // Remove trailing comma
        }
        return result + ']';
    }
}

class EntryNode extends ScopeNode {
    scopeend() { return false; }
}

class ExitNode extends ScopeNode {
    scopeend() { return true; }
}

class MapEntry extends EntryNode { stroketype(ctx) { ctx.setLineDash([1, 0]); } }
class MapExit extends ExitNode { stroketype(ctx) { ctx.setLineDash([1, 0]); } }
class ConsumeEntry extends EntryNode { stroketype(ctx) { ctx.setLineDash([5, 3]); } }
class ConsumeExit extends ExitNode { stroketype(ctx) { ctx.setLineDash([5, 3]); } }
class PipelineEntry extends EntryNode { stroketype(ctx) { ctx.setLineDash([10, 3]); } }
class PipelineExit extends ExitNode { stroketype(ctx) { ctx.setLineDash([10, 3]); } }

class Tasklet extends Node {
    draw(renderer, ctx, mousepos) {
        let topleft = this.topleft();
        drawOctagon(ctx, topleft, this.width, this.height);
        ctx.strokeStyle = this.strokeStyle(renderer);
        ctx.stroke();
        ctx.fillStyle = this.getCssProperty(renderer, '--node-background-color');
        if (ctx.pdf) // PDFs do not support stroke and fill on the same object
            drawOctagon(ctx, topleft, this.width, this.height);
        ctx.fill();
        ctx.fillStyle = this.getCssProperty(renderer, '--node-foreground-color');

        let ppp = renderer.canvas_manager.points_per_pixel();
        if (!ctx.lod || ppp < TASKLET_LOD) {
            // If we are close to the tasklet, show its contents
            let code = this.attributes().code.string_data;
            let lines = code.split('\n');
            let maxline = 0, maxline_len = 0;
            for (let i = 0; i < lines.length; i++) {
                if (lines[i].length > maxline_len) {
                    maxline = i;
                    maxline_len = lines[i].length;
                }
            }
            let oldfont = ctx.font;
            ctx.font = "10px courier new";
            let textmetrics = ctx.measureText(lines[maxline]);

            // Fit font size to 80% height and width of tasklet
            let height = lines.length * LINEHEIGHT * 1.05;
            let width = textmetrics.width;
            let TASKLET_WRATIO = 0.9, TASKLET_HRATIO = 0.5;
            let hr = height / (this.height * TASKLET_HRATIO);
            let wr = width / (this.width * TASKLET_WRATIO);
            let FONTSIZE = Math.min(10 / hr, 10 / wr);
            let text_yoffset = FONTSIZE / 4;

            ctx.font = FONTSIZE + "px courier new";
            // Set the start offset such that the middle row of the text is in this.y
            let y = this.y + text_yoffset - ((lines.length - 1) / 2) * FONTSIZE * 1.05;
            for (let i = 0; i < lines.length; i++)
                ctx.fillText(lines[i], this.x + (1 - TASKLET_WRATIO) * this.width / 2,
                    y + this.height / 2 + i * FONTSIZE * 1.05);

            ctx.font = oldfont;
            return;
        }

        let textmetrics = ctx.measureText(this.label());
        ctx.fillText(this.label(), this.x + this.width / 2 - textmetrics.width / 2, this.y + this.height / 2 + LINEHEIGHT / 2);
    }

    shade(renderer, ctx, color, alpha='0.6') {
        // Save the current style properties.
        let orig_fill_style = ctx.fillStyle;
        let orig_alpha = ctx.globalAlpha;

        ctx.globalAlpha = alpha;
        ctx.fillStyle = color;

        drawOctagon(ctx, this.topleft(), this.width, this.height);
        ctx.fill();

        // Restore the previous style properties.
        ctx.fillStyle = orig_fill_style;
        ctx.globalAlpha = orig_alpha;
    }

}

class Reduce extends Node {
    draw(renderer, ctx, mousepos) {
        let topleft = this.topleft();
        let draw_shape = () => {
            ctx.beginPath();
            ctx.moveTo(topleft.x, topleft.y);
            ctx.lineTo(topleft.x + this.width / 2, topleft.y + this.height);
            ctx.lineTo(topleft.x + this.width, topleft.y);
            ctx.lineTo(topleft.x, topleft.y);
            ctx.closePath();
        };
        ctx.strokeStyle = this.strokeStyle(renderer);
        draw_shape();
        ctx.stroke();
        ctx.fillStyle = this.getCssProperty(renderer, '--node-background-color');
        if (ctx.pdf) // PDFs do not support stroke and fill on the same object
            draw_shape();
        ctx.fill();
        ctx.fillStyle = this.getCssProperty(renderer, '--node-foreground-color');

        let far_label = this.label().substring(4, this.label().indexOf(','));
        drawAdaptiveText(ctx, renderer, far_label,
            this.label(), this.x + this.width / 2, this.y + this.height * 0.3,
            this.width, this.height,
            SCOPE_LOD);
    }

    shade(renderer, ctx, color, alpha='0.6') {
        // Save the current style properties.
        let orig_fill_style = ctx.fillStyle;
        let orig_alpha = ctx.globalAlpha;

        ctx.globalAlpha = alpha;
        ctx.fillStyle = color;

        let topleft = this.topleft();
        ctx.beginPath();
        ctx.moveTo(topleft.x, topleft.y);
        ctx.lineTo(topleft.x + this.width / 2, topleft.y + this.height);
        ctx.lineTo(topleft.x + this.width, topleft.y);
        ctx.lineTo(topleft.x, topleft.y);
        ctx.closePath();
        ctx.fill();

        // Restore the previous style properties.
        ctx.fillStyle = orig_fill_style;
        ctx.globalAlpha = orig_alpha;
    }

}

class NestedSDFG extends Node {
    childPadding = LINEHEIGHT;

    draw(renderer, ctx, mousepos) {
        if (this.data.node.attributes.is_collapsed) {
            let topleft = this.topleft();
            drawOctagon(ctx, topleft, this.width, this.height);
            ctx.strokeStyle = this.strokeStyle(renderer);
            ctx.stroke();
            drawOctagon(ctx, { x: topleft.x + 2.5, y: topleft.y + 2.5 }, this.width - 5, this.height - 5);
            ctx.strokeStyle = this.strokeStyle(renderer);
            ctx.stroke();
            ctx.fillStyle = this.getCssProperty(renderer, '--node-background-color');
            if (ctx.pdf) // PDFs do not support stroke and fill on the same object
                drawOctagon(ctx, { x: topleft.x + 2.5, y: topleft.y + 2.5 }, this.width - 5, this.height - 5);
            ctx.fill();
            ctx.fillStyle = this.getCssProperty(renderer, '--node-foreground-color');
            let label = this.data.node.attributes.label;
            let textmetrics = ctx.measureText(label);
            ctx.fillText(label, this.x + this.width / 2 - textmetrics.width / 2.0, this.y + this.height / 2 + LINEHEIGHT / 4.0);
            return;
        }

        // Draw square around nested SDFG
        super.draw(renderer, ctx, mousepos, '--nested-sdfg-foreground-color', 
                   '--nested-sdfg-background-color');

        // Draw nested graph
        draw_sdfg(renderer, ctx, this.data.graph, mousepos);
    }

    shade(renderer, ctx, color, alpha='0.6') {
        if (this.data.node.attributes.is_collapsed) {
            // Save the current style properties.
            let orig_fill_style = ctx.fillStyle;
            let orig_alpha = ctx.globalAlpha;

            ctx.globalAlpha = alpha;
            ctx.fillStyle = color;

            drawOctagon(ctx, this.topleft(), this.width, this.height);
            ctx.fill();

            // Restore the previous style properties.
            ctx.fillStyle = orig_fill_style;
            ctx.globalAlpha = orig_alpha;
        } else {
            super.shade(renderer, ctx, color, alpha);
        }
    }

    set_layout() {
        if (this.data.node.attributes.is_collapsed) {
            let labelsize = this.data.node.attributes.label.length * LINEHEIGHT * 0.8;
            let inconnsize = 2 * LINEHEIGHT * Object.keys(this.data.node.attributes.in_connectors).length - LINEHEIGHT;
            let outconnsize = 2 * LINEHEIGHT * Object.keys(this.data.node.attributes.out_connectors).length - LINEHEIGHT;
            let maxwidth = Math.max(labelsize, inconnsize, outconnsize);
            let maxheight = 2 * LINEHEIGHT;
            maxheight += 4 * LINEHEIGHT;

            let size = { width: maxwidth, height: maxheight };
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

class LibraryNode extends Node {
    _path(ctx) {
        let hexseg = this.height / 6.0;
        let topleft = this.topleft();
        ctx.beginPath();
        ctx.moveTo(topleft.x, topleft.y);
        ctx.lineTo(topleft.x + this.width - hexseg, topleft.y);
        ctx.lineTo(topleft.x + this.width, topleft.y + hexseg);
        ctx.lineTo(topleft.x + this.width, topleft.y + this.height);
        ctx.lineTo(topleft.x, topleft.y + this.height);
        ctx.closePath();
    }

    _path2(ctx) {
        let hexseg = this.height / 6.0;
        let topleft = this.topleft();
        ctx.beginPath();
        ctx.moveTo(topleft.x + this.width - hexseg, topleft.y);
        ctx.lineTo(topleft.x + this.width - hexseg, topleft.y + hexseg);
        ctx.lineTo(topleft.x + this.width, topleft.y + hexseg);
    }

    draw(renderer, ctx, mousepos) {
        ctx.fillStyle = this.getCssProperty(renderer, '--node-background-color');
        this._path(ctx);
        ctx.fill();
        ctx.strokeStyle = this.strokeStyle(renderer);
        this._path(ctx);
        ctx.stroke();
        this._path2(ctx);
        ctx.stroke();
        ctx.fillStyle = this.getCssProperty(renderer, '--node-foreground-color');
        let textw = ctx.measureText(this.label()).width;
        ctx.fillText(this.label(), this.x + this.width / 2 - textw / 2, this.y + this.height / 2 + LINEHEIGHT / 4);
    }

    shade(renderer, ctx, color, alpha='0.6') {
        // Save the current style properties.
        let orig_fill_style = ctx.fillStyle;
        let orig_alpha = ctx.globalAlpha;

        ctx.globalAlpha = alpha;
        ctx.fillStyle = color;

        this._path(ctx);
        ctx.fill();

        // Restore the previous style properties.
        ctx.fillStyle = orig_fill_style;
        ctx.globalAlpha = orig_alpha;
    }

}

//////////////////////////////////////////////////////

// Draw an entire SDFG
function draw_sdfg(renderer, ctx, sdfg_dagre, mousepos) {
    let ppp = renderer.canvas_manager.points_per_pixel();

    // Render state machine
    let g = sdfg_dagre;
    if (!ctx.lod || ppp < EDGE_LOD)
        g.edges().forEach(edge => {
            edge.draw(renderer, ctx, mousepos);
            edge.debug_draw(renderer, ctx);
        });


    visible_rect = renderer.visible_rect;

    // Render each visible state's contents
    g.nodes().forEach(node => {

        if (ctx.lod && (ppp >= STATE_LOD || node.width / ppp < STATE_LOD)) {
            node.simple_draw(renderer, ctx, mousepos);
            node.debug_draw(renderer, ctx);
            return;
        }
        // Skip invisible states
        if (ctx.lod && !node.intersect(visible_rect.x, visible_rect.y, visible_rect.w, visible_rect.h))
            return;

        node.draw(renderer, ctx, mousepos);
        node.debug_draw(renderer, ctx);

        let ng = node.data.graph;

        if (!node.data.state.attributes.is_collapsed && ng) {
            ng.nodes().forEach(n => {

                if (ctx.lod && !n.intersect(visible_rect.x, visible_rect.y, visible_rect.w, visible_rect.h))
                    return;
                if (ctx.lod && ppp >= NODE_LOD) {
                    n.simple_draw(renderer, ctx, mousepos);
                    n.debug_draw(renderer, ctx);
                    return;
                }

                n.draw(renderer, ctx, mousepos);
                n.debug_draw(renderer, ctx);
                n.inConnectors.forEach(c => {
                    c.draw(renderer, ctx, mousepos);
                    c.debug_draw(renderer, ctx);
                });
                n.outConnectors.forEach(c => {
                    c.draw(renderer, ctx, mousepos);
                    c.debug_draw(renderer, ctx);
                });
            });
            if (ctx.lod && ppp >= EDGE_LOD)
                return;
            ng.edges().forEach(edge => {
                if (ctx.lod && !edge.intersect(visible_rect.x, visible_rect.y, visible_rect.w, visible_rect.h))
                    return;
                edge.draw(renderer, ctx, mousepos);
                edge.debug_draw(renderer, ctx);
            });
        }
    });
}

// Translate an SDFG by a given offset
function offset_sdfg(sdfg, sdfg_graph, offset) {
    sdfg.nodes.forEach((state, id) => {
        let g = sdfg_graph.node(id);
        g.x += offset.x;
        g.y += offset.y;
        if (!state.attributes.is_collapsed)
            offset_state(state, g, offset);
    });
    sdfg.edges.forEach((e, eid) => {
        let edge = sdfg_graph.edge(e.src, e.dst);
        edge.x += offset.x;
        edge.y += offset.y;
        edge.points.forEach((p) => {
            p.x += offset.x;
            p.y += offset.y;
        });
    });
}

// Translate nodes, edges, and connectors in a given SDFG state by an offset
function offset_state(state, state_graph, offset) {
    let drawn_nodes = new Set();

    state.nodes.forEach((n, nid) => {
        let node = state_graph.data.graph.node(nid);
        if (!node) return;
        drawn_nodes.add(nid.toString());

        node.x += offset.x;
        node.y += offset.y;
        node.in_connectors.forEach(c => {
            c.x += offset.x;
            c.y += offset.y;
        });
        node.out_connectors.forEach(c => {
            c.x += offset.x;
            c.y += offset.y;
        });

        if (node.data.node.type === 'NestedSDFG')
            offset_sdfg(node.data.node.attributes.sdfg, node.data.graph, offset);
    });
    state.edges.forEach((e, eid) => {
        e = check_and_redirect_edge(e, drawn_nodes, state);
        if (!e) return;
        let edge = state_graph.data.graph.edge(e.src, e.dst, eid);
        if (!edge) return;
        edge.x += offset.x;
        edge.y += offset.y;
        edge.points.forEach((p) => {
            p.x += offset.x;
            p.y += offset.y;
        });
    });
}


///////////////////////////////////////////////////////

function drawAdaptiveText(ctx, renderer, far_text, close_text,
                          x, y, w, h, ppp_thres, max_font_size = 50,
                          font_multiplier = 16) {
    let ppp = renderer.canvas_manager.points_per_pixel();
    let label = close_text;
    let FONTSIZE = Math.min(ppp * font_multiplier, max_font_size);
    let yoffset = LINEHEIGHT / 2.0;
    let oldfont = ctx.font;
    if (ctx.lod && ppp >= ppp_thres) { // Far text
        ctx.font = FONTSIZE + "px sans-serif";
        label = far_text;
        yoffset = FONTSIZE / 2.0 - h / 6.0;
    }

    let textmetrics = ctx.measureText(label);
    let tw = textmetrics.width;
    if (ctx.lod && ppp >= ppp_thres && tw > w) {
        FONTSIZE = FONTSIZE / (tw / w);
        ctx.font = FONTSIZE + "px sans-serif";
        yoffset = FONTSIZE / 2.0 - h / 6.0;
        tw = w;
    }

    ctx.fillText(label, x - tw / 2.0, y + yoffset);

    if (ctx.lod && ppp >= ppp_thres)
        ctx.font = oldfont;
}

function drawHexagon(ctx, x, y, w, h, offset) {
    const centerY = y + h / 2;
    let hexseg = h / 3.0;
    ctx.beginPath();
    ctx.moveTo(x, centerY);
    ctx.lineTo(x + hexseg, y);
    ctx.lineTo(x + w - hexseg, y);
    ctx.lineTo(x + w, centerY);
    ctx.lineTo(x + w - hexseg, y + h);
    ctx.lineTo(x + hexseg, y + h);
    ctx.lineTo(x, centerY);
    ctx.closePath();
}

function drawOctagon(ctx, topleft, width, height) {
    let octseg = height / 3.0;
    ctx.beginPath();
    ctx.moveTo(topleft.x, topleft.y + octseg);
    ctx.lineTo(topleft.x + octseg, topleft.y);
    ctx.lineTo(topleft.x + width - octseg, topleft.y);
    ctx.lineTo(topleft.x + width, topleft.y + octseg);
    ctx.lineTo(topleft.x + width, topleft.y + 2 * octseg);
    ctx.lineTo(topleft.x + width - octseg, topleft.y + height);
    ctx.lineTo(topleft.x + octseg, topleft.y + height);
    ctx.lineTo(topleft.x, topleft.y + 2 * octseg);
    ctx.lineTo(topleft.x, topleft.y + 1 * octseg);
    ctx.closePath();
}

// Adapted from https://stackoverflow.com/a/2173084/6489142
function drawEllipse(ctx, x, y, w, h) {
    var kappa = .5522848,
        ox = (w / 2) * kappa, // control point offset horizontal
        oy = (h / 2) * kappa, // control point offset vertical
        xe = x + w,           // x-end
        ye = y + h,           // y-end
        xm = x + w / 2,       // x-middle
        ym = y + h / 2;       // y-middle

    ctx.moveTo(x, ym);
    ctx.bezierCurveTo(x, ym - oy, xm - ox, y, xm, y);
    ctx.bezierCurveTo(xm + ox, y, xe, ym - oy, xe, ym);
    ctx.bezierCurveTo(xe, ym + oy, xm + ox, ye, xm, ye);
    ctx.bezierCurveTo(xm - ox, ye, x, ym + oy, x, ym);
}

function drawArrow(ctx, p1, p2, size, offset=0, padding=0) {
    ctx.save();
    // Rotate the context to point along the path
    let dx = p2.x - p1.x;
    let dy = p2.y - p1.y;
    ctx.translate(p2.x, p2.y);
    ctx.rotate(Math.atan2(dy, dx));

    // arrowhead
    ctx.beginPath();
    ctx.moveTo(0 + padding + offset, 0);
    ctx.lineTo(((-2 * size) - padding) - offset, -(size + padding));
    ctx.lineTo(((-2 * size) - padding) - offset, (size + padding));
    ctx.closePath();
    ctx.fill();
    ctx.restore();
}

function drawTrapezoid(ctx, topleft, node, inverted = false) {
    ctx.beginPath();
    if (inverted) {
        ctx.moveTo(topleft.x, topleft.y);
        ctx.lineTo(topleft.x + node.width, topleft.y);
        ctx.lineTo(topleft.x + node.width - node.height, topleft.y + node.height);
        ctx.lineTo(topleft.x + node.height, topleft.y + node.height);
        ctx.lineTo(topleft.x, topleft.y);
    } else {
        ctx.moveTo(topleft.x, topleft.y + node.height);
        ctx.lineTo(topleft.x + node.width, topleft.y + node.height);
        ctx.lineTo(topleft.x + node.width - node.height, topleft.y);
        ctx.lineTo(topleft.x + node.height, topleft.y);
        ctx.lineTo(topleft.x, topleft.y + node.height);
    }
    ctx.closePath();
}

// Returns the distance from point p to line defined by two points (line1, line2)
function ptLineDistance(p, line1, line2) {
    let dx = (line2.x - line1.x);
    let dy = (line2.y - line1.y);
    let res = dy * p.x - dx * p.y + line2.x * line1.y - line2.y * line1.x;

    return Math.abs(res) / Math.sqrt(dy * dy + dx * dx);
}

/**
 * Get the color on a green-red temperature scale based on a fractional value.
 * @param {Number} val Value between 0 and 1, 0 = green, .5 = yellow, 1 = red
 * @returns            HSL color string
 */
function getTempColor(val){
    if (val < 0)
        val = 0;
    if (val > 1)
        val = 1;
    let hue = ((1 - val) * 120).toString(10);
    return 'hsl(' + hue + ',100%,50%)';
}

var SDFGElements = {
    SDFGElement: SDFGElement, SDFG: SDFG, State: State, Node: Node, Edge: Edge, Connector: Connector, AccessNode: AccessNode,
    ScopeNode: ScopeNode, EntryNode: EntryNode, ExitNode: ExitNode, MapEntry: MapEntry, MapExit: MapExit,
    ConsumeEntry: ConsumeEntry, ConsumeExit: ConsumeExit, Tasklet: Tasklet, Reduce: Reduce,
    PipelineEntry: PipelineEntry, PipelineExit: PipelineExit, NestedSDFG: NestedSDFG, LibraryNode: LibraryNode
};

// Save as globals
Object.keys(SDFGElements).forEach(function (elem) {
    window[elem] = SDFGElements[elem];
});