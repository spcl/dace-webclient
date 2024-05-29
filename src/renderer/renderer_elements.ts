// Copyright 2019-2024 ETH Zurich and the DaCe authors. All rights reserved.

import {
    DagreGraph,
    JsonSDFG,
    JsonSDFGBlock,
    JsonSDFGControlFlowRegion,
    JsonSDFGEdge,
    JsonSDFGNode,
    JsonSDFGState,
    Point2D,
    SimpleRect,
} from '../index';
import { SDFV } from '../sdfv';
import { editor } from 'monaco-editor';
import {
    sdfg_consume_elem_to_string,
    sdfg_property_to_string,
    sdfg_range_elem_to_string,
} from '../utils/sdfg/display';
import { check_and_redirect_edge } from '../utils/sdfg/sdfg_utils';
import { SDFVSettings } from '../utils/sdfv_settings';
import { SDFGRenderer } from './renderer';

export enum SDFGElementType {
    Edge = 'Edge',
    MultiConnectorEdge = 'MultiConnectorEdge',
    SDFGState = 'SDFGState',
    ContinueState = 'ContinueState',
    BreakState = 'BreakState',
    AccessNode = 'AccessNode',
    Tasklet = 'Tasklet',
    LibraryNode = 'LibraryNode',
    NestedSDFG = 'NestedSDFG',
    ExternalNestedSDFG = 'ExternalNestedSDFG',
    MapEntry = 'MapEntry',
    MapExit = 'MapExit',
    ConsumeEntry = 'ConsumeEntry',
    ConsumeExit = 'ConsumeExit',
    PipelineEntry = 'PipelineEntry',
    PipelineExit = 'PipelineExit',
    Reduce = 'Reduce',
    BasicBlock = 'BasicBlock',
    ControlFlowBlock = 'ControlFlowBlock',
    ControlFlowRegion = 'ControlFlowRegion',
    LoopRegion = 'LoopRegion',
}

function draw_summary_symbol(
    ctx: CanvasRenderingContext2D,
    min_connector_x: number, max_connector_x: number,
    horizontal_line_level: number, draw_arrows_above_line: boolean
): void {
    // Draw left arrow
    const middle_of_line = (min_connector_x + max_connector_x) / 2;
    const left_arrow_x = middle_of_line - 10;
    const righ_arrow_x = middle_of_line + 10;
    let arrow_start_y = horizontal_line_level + 2;
    let arrow_end_y = horizontal_line_level + 8;
    if (draw_arrows_above_line) {
        arrow_start_y = horizontal_line_level - 10;
        arrow_end_y = horizontal_line_level - 4;
    }
    const dot_height = (arrow_start_y + arrow_end_y) / 2;

    // Arrow line left
    ctx.beginPath();
    ctx.moveTo(left_arrow_x, arrow_start_y);
    ctx.lineTo(left_arrow_x, arrow_end_y);
    // Arrow line right
    ctx.moveTo(righ_arrow_x, arrow_start_y);
    ctx.lineTo(righ_arrow_x, arrow_end_y);
    // 3 dots
    ctx.moveTo(middle_of_line - 5, dot_height);
    ctx.lineTo(middle_of_line - 4, dot_height);
    ctx.moveTo(middle_of_line - 0.5, dot_height);
    ctx.lineTo(middle_of_line + 0.5, dot_height);
    ctx.moveTo(middle_of_line + 4, dot_height);
    ctx.lineTo(middle_of_line + 5, dot_height);
    ctx.closePath();
    ctx.stroke();

    // Arrow heads
    ctx.beginPath();
    ctx.moveTo(left_arrow_x, arrow_end_y + 2);
    ctx.lineTo(left_arrow_x - 2, arrow_end_y);
    ctx.lineTo(left_arrow_x + 2, arrow_end_y);
    ctx.lineTo(left_arrow_x, arrow_end_y + 2);
    ctx.closePath();
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(righ_arrow_x, arrow_end_y + 2);
    ctx.lineTo(righ_arrow_x - 2, arrow_end_y);
    ctx.lineTo(righ_arrow_x + 2, arrow_end_y);
    ctx.lineTo(righ_arrow_x, arrow_end_y + 2);
    ctx.closePath();
    ctx.fill();
}

export class SDFGElement {

    public get COLLAPSIBLE(): boolean {
        return false;
    }

    public in_connectors: Connector[] = [];
    public out_connectors: Connector[] = [];

    // Indicate special drawing conditions based on interactions.
    public selected: boolean = false;
    public highlighted: boolean = false;
    public hovered: boolean = false;

    // Used to draw edge summary instead of all edges separately.
    // Helps with rendering performance when too many edges would be drawn on
    // the screen. These two fields get set in the layouter, depending on the
    // number of in/out_connectors of a node. They also get toggled in the
    // mousehandler when the hover status changes. Currently only used for
    // NestedSDFGs and ScopeNodes.
    public summarize_in_edges: boolean = false;
    public summarize_out_edges: boolean = false;
    // Used in draw_edge_summary to decide if edge summary is applicable. Set
    // in the layouter only for NestedSDFGs and ScopeNodes. This prevents the
    // summary to get toggled on by the mousehandler when it is not applicable.
    public in_summary_has_effect: boolean = false;
    public out_summary_has_effect: boolean = false;

    public x: number = 0;
    public y: number = 0;
    public width: number = 0;
    public height: number = 0;

    // Parent ID is the state ID, if relevant
    public constructor(
        public data: any,
        public id: number,
        public sdfg: JsonSDFG,
        public cfg: JsonSDFGControlFlowRegion | null,
        public parent_id: number | null = null,
        public parentElem?: SDFGElement
    ) {
        this.set_layout();
    }

    public set_layout(): void {
        // dagre does not work well with properties, only fields
        this.width = this.data.layout.width;
        this.height = this.data.layout.height;
    }

    public draw(
        _renderer: SDFGRenderer, _ctx: CanvasRenderingContext2D,
        _mousepos?: Point2D
    ): void {
        return;
    }

    public simple_draw(
        _renderer: SDFGRenderer, _ctx: CanvasRenderingContext2D,
        _mousepos?: Point2D
    ): void {
        return;
    }

    public shade(
        _renderer: SDFGRenderer, _ctx: CanvasRenderingContext2D, _color: string,
        _alpha: number = 0.4
    ): void {
        return;
    }

    public debug_draw(
        renderer: SDFGRenderer, ctx: CanvasRenderingContext2D
    ): void {
        if (renderer.debug_draw) {
            // Print the center and bounding box in debug mode.
            ctx.beginPath();
            ctx.arc(this.x, this.y, 1, 0, 2 * Math.PI, false);
            ctx.fillStyle = 'red';
            ctx.fill();
            ctx.strokeStyle = 'red';
            ctx.stroke();
            ctx.strokeRect(
                this.x - (this.width / 2.0), this.y - (this.height / 2.0),
                this.width, this.height
            );
        }
    }

    public attributes(): any {
        return this.data.attributes;
    }

    public type(): string {
        return this.data.type;
    }

    public label(): string {
        return this.data.label;
    }

    // Text used for matching the element during a search
    public text_for_find(): string {
        return this.label();
    }

    // Produces HTML for a hover-tooltip
    public tooltip(container: HTMLElement): void {
        container.className = 'sdfvtooltip';
    }

    public topleft(): Point2D {
        return { x: this.x - this.width / 2, y: this.y - this.height / 2 };
    }

    public strokeStyle(renderer: SDFGRenderer | undefined = undefined): string {
        if (!renderer)
            return 'black';

        if (this.selected) {
            if (this.hovered) {
                return this.getCssProperty(
                    renderer, '--color-selected-hovered'
                );
            } else if (this.highlighted) {
                return this.getCssProperty(
                    renderer, '--color-selected-highlighted'
                );
            } else {
                return this.getCssProperty(renderer, '--color-selected');
            }
        } else {
            if (this.hovered)
                return this.getCssProperty(renderer, '--color-hovered');
            else if (this.highlighted)
                return this.getCssProperty(renderer, '--color-highlighted');
        }
        return this.getCssProperty(renderer, '--color-default');
    }

    // General bounding-box intersection function. Returns true iff point or
    // rectangle intersect element.
    public intersect(
        x: number, y: number, w: number = 0, h: number = 0
    ): boolean {
        if (w === 0 || h === 0) {  // Point-element intersection
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

    public contained_in(
        x: number, y: number, w: number = 0, h: number = 0
    ): boolean {
        if (w === 0 || h === 0)
            return false;

        const box_start_x = x;
        const box_end_x = x + w;
        const box_start_y = y;
        const box_end_y = y + h;

        const el_start_x = this.x - (this.width / 2.0);
        const el_end_x = this.x + (this.width / 2.0);
        const el_start_y = this.y - (this.height / 2.0);
        const el_end_y = this.y + (this.height / 2.0);

        return box_start_x <= el_start_x &&
            box_end_x >= el_end_x &&
            box_start_y <= el_start_y &&
            box_end_y >= el_end_y;
    }

    public getCssProperty(
        renderer: SDFGRenderer, propertyName: string
    ): string {
        return renderer.getCssProperty(propertyName);
    }

    public draw_edge_summary(
        renderer: SDFGRenderer, ctx: CanvasRenderingContext2D
    ): void {
        // Only draw if close enough
        const canvas_manager = renderer.get_canvas_manager();
        const ppp = canvas_manager?.points_per_pixel();
        if (!renderer.adaptiveHiding || (ppp && ppp < SDFV.EDGE_LOD)) {
            const topleft = this.topleft();
            ctx.strokeStyle = this.strokeStyle(renderer);
            ctx.fillStyle = ctx.strokeStyle;

            if (this.summarize_in_edges && this.in_summary_has_effect) {
                // Find the left most and right most connector coordinates
                if (this.in_connectors.length > 0) {
                    let min_connector_x = Number.MAX_SAFE_INTEGER;
                    let max_connector_x = Number.MIN_SAFE_INTEGER;
                    this.in_connectors.forEach((c: Connector) => {
                        if (c.x < min_connector_x)
                            min_connector_x = c.x;
                        if (c.x > max_connector_x)
                            max_connector_x = c.x;
                    });

                    let drawInSummarySymbol = true;
                    const preds = this.parentElem?.data.graph?.predecessors(
                        this.id
                    ) ?? [];
                    if (preds.length === 1) {
                        const predElem = this.parentElem?.data.graph.node(
                            preds[0]
                        ) as SDFGElement;
                        if (predElem.summarize_out_edges &&
                            predElem.out_summary_has_effect) {
                            // If the previous element has its outgoing edges
                            // summarized, draw the sumary symbol halfway in
                            // between them. This is handled by the predecessor.
                            // noop.
                            drawInSummarySymbol = false;
                        }
                    }

                    if (drawInSummarySymbol) {
                        // Draw the summary symbol above the node
                        draw_summary_symbol(
                            ctx, min_connector_x, max_connector_x,
                            topleft.y - 8, true
                        );
                    }
                }
            }
            if (this.summarize_out_edges && this.out_summary_has_effect) {
                // Find the left most and right most connector coordinates
                if (this.out_connectors.length > 0) {
                    let min_connector_x = Number.MAX_SAFE_INTEGER;
                    let max_connector_x = Number.MIN_SAFE_INTEGER;
                    this.out_connectors.forEach((c: Connector) => {
                        if (c.x < min_connector_x)
                            min_connector_x = c.x;
                        if (c.x > max_connector_x)
                            max_connector_x = c.x;
                    });

                    let drawOutSummarySymbol = true;
                    const succs = this.parentElem?.data.graph?.successors(
                        this.id
                    ) ?? [];
                    if (succs.length === 1) {
                        const succElem = this.parentElem?.data.graph.node(
                            succs[0]
                        ) as SDFGElement;
                        if (succElem.summarize_in_edges &&
                            succElem.in_summary_has_effect) {
                            // If the next element has its incoming edges
                            // summarized, draw the sumary symbol halfway in
                            // between them.
                            const succTopLeft = succElem.topleft();
                            const minX = Math.min(succTopLeft.x, topleft.x);
                            const maxX = Math.max(
                                succTopLeft.x + succElem.width,
                                topleft.x + this.width
                            );
                            const linePosY = (
                                (topleft.y + (
                                    succTopLeft.y + succElem.height
                                )) / 2
                            ) - 8;
                            draw_summary_symbol(
                                ctx, minX, maxX, linePosY, false
                            );
                            drawOutSummarySymbol = false;
                        }
                    }

                    if (drawOutSummarySymbol) {
                        // Draw the summary symbol below the node
                        draw_summary_symbol(
                            ctx, min_connector_x, max_connector_x,
                            topleft.y + this.height + 8, false
                        );
                    }
                }
            }
        }
    }

}

// SDFG as an element (to support properties)
export class SDFG extends SDFGElement {

    public constructor(sdfg: JsonSDFG) {
        super(sdfg, -1, sdfg, null);
    }

    public set_layout(): void {
        return;
    }

    public label(): string {
        return this.data.attributes.name;
    }

}

export class SDFGShell extends SDFG {
}

export class ControlFlowBlock extends SDFGElement {

    public get COLLAPSIBLE(): boolean {
        return true;
    }

}

export class BasicBlock extends ControlFlowBlock {
}

export class ControlFlowRegion extends ControlFlowBlock {

    public static readonly META_LABEL_MARGIN: number = 5;

    public draw(
        renderer: SDFGRenderer, ctx: CanvasRenderingContext2D,
        _mousepos?: Point2D
    ): void {
        const topleft = this.topleft();
        const visibleRect = renderer.get_visible_rect();

        let clamped;
        if (visibleRect) {
            clamped = {
                x: Math.max(topleft.x, visibleRect.x),
                y: Math.max(topleft.y, visibleRect.y),
                x2: Math.min(
                    topleft.x + this.width, visibleRect.x + visibleRect.w
                ),
                y2: Math.min(
                    topleft.y + this.height, visibleRect.y + visibleRect.h
                ),
                w: 0,
                h: 0,
            };
        } else {
            clamped = {
                x: topleft.x,
                y: topleft.y,
                x2: topleft.x + this.width,
                y2: topleft.y + this.height,
                w: 0,
                h: 0,
            };
        }
        clamped.w = clamped.x2 - clamped.x;
        clamped.h = clamped.y2 - clamped.y;
        if (!renderer.viewportOnly) {
            clamped = {
                x: topleft.x,
                y: topleft.y,
                x2: 0,
                y2: 0,
                w: this.width,
                h: this.height,
            };
        }

        // Draw the region's background below everything and stroke the border.
        ctx.fillStyle = this.getCssProperty(
            renderer, '--control-flow-region-background-color'
        );
        ctx.strokeStyle = this.getCssProperty(
            renderer, '--control-flow-region-foreground-color'
        );
        ctx.fillRect(clamped.x, clamped.y, clamped.w, clamped.h);

        // Only draw line if close enough.
        const ppp = renderer.get_canvas_manager()?.points_per_pixel();
        if (!renderer.adaptiveHiding || (ppp && ppp < SDFV.NODE_LOD))
            ctx.strokeRect(clamped.x, clamped.y, clamped.w, clamped.h);

        ctx.fillStyle = this.getCssProperty(
            renderer, '--control-flow-region-foreground-color'
        );

        if (visibleRect && visibleRect.x <= topleft.x &&
            visibleRect.y <= topleft.y + SDFV.LINEHEIGHT &&
            SDFVSettings.get<boolean>('showStateNames')) {
            if (!too_far_away_for_text(renderer)) {
                ctx.fillText(
                    this.label(), topleft.x + LoopRegion.META_LABEL_MARGIN,
                    topleft.y + SDFV.LINEHEIGHT
                );
            }
        }

        // If this state is selected or hovered
        if (!renderer.adaptiveHiding || (ppp && ppp < SDFV.NODE_LOD)) {
            if ((this.selected || this.highlighted || this.hovered) &&
                (clamped.x === topleft.x ||
                    clamped.y === topleft.y ||
                    clamped.x2 === topleft.x + this.width ||
                    clamped.y2 === topleft.y + this.height)) {
                ctx.strokeStyle = this.strokeStyle(renderer);
                ctx.strokeRect(clamped.x, clamped.y, clamped.w, clamped.h);
            }
        }

        // If collapsed, draw a "+" sign in the middle
        if (this.attributes().is_collapsed) {
            ctx.beginPath();
            ctx.moveTo(this.x, this.y - SDFV.LINEHEIGHT);
            ctx.lineTo(this.x, this.y + SDFV.LINEHEIGHT);
            ctx.moveTo(this.x - SDFV.LINEHEIGHT, this.y);
            ctx.lineTo(this.x + SDFV.LINEHEIGHT, this.y);
            ctx.stroke();
        }

        ctx.strokeStyle = 'black';
    }

    public simple_draw(
        renderer: SDFGRenderer, ctx: CanvasRenderingContext2D,
        mousepos?: Point2D
    ): void {
        // Fast drawing function for small states
        const topleft = this.topleft();

        ctx.fillStyle = this.getCssProperty(
            renderer, '--control-flow-region-background-simple-color'
        );
        ctx.fillRect(topleft.x, topleft.y, this.width, this.height);
        ctx.fillStyle = this.getCssProperty(
            renderer, '--control-flow-region-foreground-color'
        );

        if (mousepos && this.intersect(mousepos.x, mousepos.y))
            renderer.set_tooltip((c) => this.tooltip(c));
    }

    public shade(
        _renderer: SDFGRenderer, ctx: CanvasRenderingContext2D, color: string,
        alpha: number = 0.4
    ): void {
        // Save the current style properties.
        const orig_fill_style = ctx.fillStyle;
        const orig_alpha = ctx.globalAlpha;

        ctx.globalAlpha = alpha;
        ctx.fillStyle = color;

        const topleft = this.topleft();
        ctx.fillRect(topleft.x, topleft.y, this.width, this.height);

        // Restore the previous style properties.
        ctx.fillStyle = orig_fill_style;
        ctx.globalAlpha = orig_alpha;
    }

    public tooltip(container: HTMLElement): void {
        container.innerText = 'Loop: ' + this.label();
    }

    public attributes(): any {
        return this.data.block.attributes;
    }

    public label(): string {
        return this.data.block.label;
    }

    public type(): string {
        return this.data.block.type;
    }

}

export class State extends BasicBlock {

    public draw(
        renderer: SDFGRenderer, ctx: CanvasRenderingContext2D,
        _mousepos?: Point2D
    ): void {
        const topleft = this.topleft();
        const visible_rect = renderer.get_visible_rect();
        let clamped;
        if (visible_rect) {
            clamped = {
                x: Math.max(topleft.x, visible_rect.x),
                y: Math.max(topleft.y, visible_rect.y),
                x2: Math.min(
                    topleft.x + this.width, visible_rect.x + visible_rect.w
                ),
                y2: Math.min(
                    topleft.y + this.height, visible_rect.y + visible_rect.h
                ),
                w: 0,
                h: 0,
            };
        } else {
            clamped = {
                x: topleft.x,
                y: topleft.y,
                x2: topleft.x + this.width,
                y2: topleft.y + this.height,
                w: 0,
                h: 0,
            };
        }
        clamped.w = clamped.x2 - clamped.x;
        clamped.h = clamped.y2 - clamped.y;
        if (!renderer.viewportOnly) {
            clamped = {
                x: topleft.x,
                y: topleft.y,
                x2: 0,
                y2: 0,
                w: this.width,
                h: this.height,
            };
        }

        ctx.fillStyle = this.getCssProperty(
            renderer, '--state-background-color'
        );
        ctx.fillRect(clamped.x, clamped.y, clamped.w, clamped.h);
        ctx.fillStyle = this.getCssProperty(
            renderer, '--state-foreground-color'
        );

        if (visible_rect && visible_rect.x <= topleft.x &&
            visible_rect.y <= topleft.y + SDFV.LINEHEIGHT &&
            SDFVSettings.get<boolean>('showStateNames')) {
            if (!too_far_away_for_text(renderer)) {
                ctx.fillText(
                    this.label(), topleft.x, topleft.y + SDFV.LINEHEIGHT
                );
            }
        }

        // If this state is selected or hovered
        const ppp = renderer.get_canvas_manager()?.points_per_pixel();
        if (!renderer.adaptiveHiding || (ppp && ppp < SDFV.NODE_LOD)) {
            if ((this.selected || this.highlighted || this.hovered) &&
                (clamped.x === topleft.x ||
                    clamped.y === topleft.y ||
                    clamped.x2 === topleft.x + this.width ||
                    clamped.y2 === topleft.y + this.height)) {
                ctx.strokeStyle = this.strokeStyle(renderer);
                ctx.strokeRect(clamped.x, clamped.y, clamped.w, clamped.h);
            }
        }

        // If collapsed, draw a "+" sign in the middle
        if (this.attributes().is_collapsed) {
            ctx.beginPath();
            ctx.moveTo(this.x, this.y - SDFV.LINEHEIGHT);
            ctx.lineTo(this.x, this.y + SDFV.LINEHEIGHT);
            ctx.moveTo(this.x - SDFV.LINEHEIGHT, this.y);
            ctx.lineTo(this.x + SDFV.LINEHEIGHT, this.y);
            ctx.stroke();
        }

        ctx.strokeStyle = 'black';
    }

    public simple_draw(
        renderer: SDFGRenderer, ctx: CanvasRenderingContext2D,
        mousepos?: Point2D
    ): void {
        // Fast drawing function for small states
        const topleft = this.topleft();

        ctx.fillStyle = this.getCssProperty(
            renderer, '--state-background-color'
        );
        ctx.fillRect(topleft.x, topleft.y, this.width, this.height);
        ctx.fillStyle = this.getCssProperty(renderer, '--state-text-color');

        if (mousepos && this.intersect(mousepos.x, mousepos.y))
            renderer.set_tooltip((c) => this.tooltip(c));

        // Draw state name in center without contents (does not look good)
        /*
        let FONTSIZE = Math.min(
            renderer.canvas_manager.points_per_pixel() * 16, 100
        );
        let label = this.label();

        let oldfont = ctx.font;
        ctx.font = FONTSIZE + "px Arial";

        let textmetrics = ctx.measureText(label);
        ctx.fillText(
            label, this.x - textmetrics.width / 2.0,
            this.y - this.height / 6.0 + FONTSIZE / 2.0
        );

        ctx.font = oldfont;
        */
    }

    public shade(
        _renderer: SDFGRenderer, ctx: CanvasRenderingContext2D, color: string,
        alpha: number = 0.4
    ): void {
        // Save the current style properties.
        const orig_fill_style = ctx.fillStyle;
        const orig_alpha = ctx.globalAlpha;

        ctx.globalAlpha = alpha;
        ctx.fillStyle = color;

        const topleft = this.topleft();
        ctx.fillRect(topleft.x, topleft.y, this.width, this.height);

        // Restore the previous style properties.
        ctx.fillStyle = orig_fill_style;
        ctx.globalAlpha = orig_alpha;
    }

    public tooltip(container: HTMLElement): void {
        container.innerText = 'State: ' + this.label();
    }

    public attributes(): any {
        return this.data.state.attributes;
    }

    public label(): string {
        return this.data.state.label;
    }

    public type(): string {
        return this.data.state.type;
    }

}

export class BreakState extends State {
}

export class ContinueState extends State {
}

export class LoopRegion extends ControlFlowRegion {

    public static get CONDITION_SPACING(): number {
        return 3 * SDFV.LINEHEIGHT;
    }

    public static get INIT_SPACING(): number {
        return 3 * SDFV.LINEHEIGHT;
    }

    public static get UPDATE_SPACING(): number {
        return 3 * SDFV.LINEHEIGHT;
    }

    public static get LOOP_STATEMENT_FONT(): string {
        return (SDFV.DEFAULT_CANVAS_FONTSIZE * 1.5).toString() +
            'px sans-serif';
    }

    public draw(
        renderer: SDFGRenderer, ctx: CanvasRenderingContext2D,
        _mousepos?: Point2D
    ): void {
        const topleft = this.topleft();
        const visibleRect = renderer.get_visible_rect();

        let clamped;
        if (visibleRect) {
            clamped = {
                x: Math.max(topleft.x, visibleRect.x),
                y: Math.max(topleft.y, visibleRect.y),
                x2: Math.min(
                    topleft.x + this.width, visibleRect.x + visibleRect.w
                ),
                y2: Math.min(
                    topleft.y + this.height, visibleRect.y + visibleRect.h
                ),
                w: 0,
                h: 0,
            };
        } else {
            clamped = {
                x: topleft.x,
                y: topleft.y,
                x2: topleft.x + this.width,
                y2: topleft.y + this.height,
                w: 0,
                h: 0,
            };
        }
        clamped.w = clamped.x2 - clamped.x;
        clamped.h = clamped.y2 - clamped.y;
        if (!renderer.viewportOnly) {
            clamped = {
                x: topleft.x,
                y: topleft.y,
                x2: 0,
                y2: 0,
                w: this.width,
                h: this.height,
            };
        }

        // Draw the loop background below everything and stroke the border.
        ctx.fillStyle = this.getCssProperty(
            renderer, '--loop-background-color'
        );
        ctx.strokeStyle = this.getCssProperty(
            renderer, '--loop-foreground-color'
        );
        ctx.fillRect(clamped.x, clamped.y, clamped.w, clamped.h);

        // Only draw line if close enough.
        const ppp = renderer.get_canvas_manager()?.points_per_pixel();
        if (!renderer.adaptiveHiding || (ppp && ppp < SDFV.NODE_LOD))
            ctx.strokeRect(clamped.x, clamped.y, clamped.w, clamped.h);

        ctx.fillStyle = this.getCssProperty(
            renderer, '--loop-foreground-color'
        );

        const oldFont = ctx.font;
        let topSpacing = LoopRegion.META_LABEL_MARGIN;
        let remainingHeight = this.height;

        // Draw the init statement if there is one.
        if (this.attributes().init_statement) {
            topSpacing += LoopRegion.INIT_SPACING;
            const initBottomLineY = topleft.y + LoopRegion.INIT_SPACING;
            ctx.beginPath();
            ctx.moveTo(topleft.x, initBottomLineY);
            ctx.lineTo(topleft.x + this.width, initBottomLineY);
            ctx.stroke();

            if (!too_far_away_for_text(renderer)) {
                ctx.font = LoopRegion.LOOP_STATEMENT_FONT;
                const initStatement =
                    this.attributes().init_statement?.string_data;
                const initTextY = (
                    (topleft.y + (LoopRegion.INIT_SPACING / 2)) +
                    (SDFV.LINEHEIGHT / 2)
                );
                if (initStatement) {
                    const initTextMetrics = ctx.measureText(initStatement);
                    const initTextX = this.x - (initTextMetrics.width / 2);
                    ctx.fillText(initStatement, initTextX, initTextY);
                }

                ctx.font = oldFont;
                ctx.fillText(
                    'init', topleft.x + LoopRegion.META_LABEL_MARGIN, initTextY
                );
            }
        }

        // Draw the condition (either on top if the loop is a regularly
        // structured loop, or on the bottom if the loop is an inverted
        // (do-while-style) loop). If the condition is drawn on top, make sure
        // the init statement spacing is respected if there is one.
        let condTopY = topleft.y;
        let condLineY = condTopY + LoopRegion.CONDITION_SPACING;
        if (this.attributes().inverted) {
            condTopY = topleft.y +
                (this.height - LoopRegion.CONDITION_SPACING);
            condLineY = condTopY - LoopRegion.CONDITION_SPACING;
        } else if (this.attributes().init_statement) {
            condTopY += LoopRegion.INIT_SPACING;
            condLineY = condTopY + LoopRegion.CONDITION_SPACING;
        }
        topSpacing += LoopRegion.CONDITION_SPACING;
        ctx.beginPath();
        ctx.moveTo(topleft.x, condLineY);
        ctx.lineTo(topleft.x + this.width, condLineY);
        ctx.stroke();


        if (!too_far_away_for_text(renderer)) {
            ctx.font = LoopRegion.LOOP_STATEMENT_FONT;
            const condStatement = this.attributes().loop_condition?.string_data;
            const condTextY = (
                (condTopY + (LoopRegion.CONDITION_SPACING / 2)) +
                (SDFV.LINEHEIGHT / 2)
            );
            if (condStatement) {
                const condTextMetrics = ctx.measureText(condStatement);
                const condTextX = this.x - (condTextMetrics.width / 2);
                ctx.fillText(condStatement, condTextX, condTextY);
                ctx.font = oldFont;
                ctx.fillText(
                    'while', topleft.x + LoopRegion.META_LABEL_MARGIN, condTextY
                );
            }
        }

        // Draw the update statement if there is one.
        if (this.attributes().update_statement) {
            remainingHeight -= LoopRegion.UPDATE_SPACING;
            const updateTopY = topleft.y + (
                this.height - LoopRegion.UPDATE_SPACING
            );
            ctx.beginPath();
            ctx.moveTo(topleft.x, updateTopY);
            ctx.lineTo(topleft.x + this.width, updateTopY);
            ctx.stroke();


            if (!too_far_away_for_text(renderer)) {
                ctx.font = LoopRegion.LOOP_STATEMENT_FONT;
                const updateStatement =
                    this.attributes().update_statement.string_data;
                const updateTextY = (
                    (updateTopY + (LoopRegion.UPDATE_SPACING / 2)) +
                    (SDFV.LINEHEIGHT / 2)
                );
                const updateTextMetrics = ctx.measureText(updateStatement);
                const updateTextX = this.x - (updateTextMetrics.width / 2);
                ctx.fillText(updateStatement, updateTextX, updateTextY);
                ctx.font = oldFont;
                ctx.fillText(
                    'update', topleft.x + LoopRegion.META_LABEL_MARGIN,
                    updateTextY
                );
            }
        }
        remainingHeight -= topSpacing;

        ctx.font = oldFont;

        if (visibleRect && visibleRect.x <= topleft.x &&
            visibleRect.y <= topleft.y + SDFV.LINEHEIGHT &&
            SDFVSettings.get<boolean>('showStateNames')) {
            if (!too_far_away_for_text(renderer)) {
                ctx.fillText(
                    this.label(), topleft.x + LoopRegion.META_LABEL_MARGIN,
                    topleft.y + topSpacing + SDFV.LINEHEIGHT
                );
            }
        }

        // If this state is selected or hovered
        if (!renderer.adaptiveHiding || (ppp && ppp < SDFV.NODE_LOD)) {
            if ((this.selected || this.highlighted || this.hovered) &&
                (clamped.x === topleft.x ||
                    clamped.y === topleft.y ||
                    clamped.x2 === topleft.x + this.width ||
                    clamped.y2 === topleft.y + this.height)) {
                ctx.strokeStyle = this.strokeStyle(renderer);
                ctx.strokeRect(clamped.x, clamped.y, clamped.w, clamped.h);
            }
        }

        // If collapsed, draw a "+" sign in the middle
        if (this.attributes().is_collapsed) {
            const plusCenterY = topleft.y + (remainingHeight / 2) + topSpacing;
            ctx.beginPath();
            ctx.moveTo(this.x, plusCenterY - SDFV.LINEHEIGHT);
            ctx.lineTo(this.x, plusCenterY + SDFV.LINEHEIGHT);
            ctx.moveTo(this.x - SDFV.LINEHEIGHT, plusCenterY);
            ctx.lineTo(this.x + SDFV.LINEHEIGHT, plusCenterY);
            ctx.stroke();
        }

        ctx.strokeStyle = 'black';
    }

    public tooltip(container: HTMLElement): void {
        container.innerText = 'Loop: ' + this.label();
    }

}

export class SDFGNode extends SDFGElement {

    public draw(
        renderer: SDFGRenderer, ctx: CanvasRenderingContext2D,
        _mousepos?: Point2D,
        fgstyle: string = '--node-foreground-color',
        bgstyle: string = '--node-background-color'
    ): void {
        const topleft = this.topleft();
        const visible_rect = renderer.get_visible_rect();
        let clamped;
        if (visible_rect) {
            clamped = {
                x: Math.max(topleft.x, visible_rect.x),
                y: Math.max(topleft.y, visible_rect.y),
                x2: Math.min(
                    topleft.x + this.width, visible_rect.x + visible_rect.w
                ),
                y2: Math.min(
                    topleft.y + this.height, visible_rect.y + visible_rect.h
                ),
                w: 0,
                h: 0,
            };
        } else {
            clamped = {
                x: topleft.x,
                y: topleft.y,
                x2: topleft.x + this.width,
                y2: topleft.y + this.height,
                w: 0,
                h: 0,
            };
        }
        clamped.w = clamped.x2 - clamped.x;
        clamped.h = clamped.y2 - clamped.y;
        if (!renderer.viewportOnly) {
            clamped = {
                x: topleft.x,
                y: topleft.y,
                x2: 0,
                y2: 0,
                w: this.width,
                h: this.height,
            };
        }

        ctx.fillStyle = this.getCssProperty(renderer, bgstyle);
        ctx.fillRect(clamped.x, clamped.y, clamped.w, clamped.h);

        // Only draw line if close enough to see it.
        const ppp = renderer.get_canvas_manager()?.points_per_pixel();
        if (!renderer.adaptiveHiding || (ppp && ppp < SDFV.NODE_LOD)) {
            if (clamped.x === topleft.x &&
                clamped.y === topleft.y &&
                clamped.x2 === topleft.x + this.width &&
                clamped.y2 === topleft.y + this.height) {
                ctx.strokeStyle = this.strokeStyle(renderer);
                ctx.strokeRect(clamped.x, clamped.y, clamped.w, clamped.h);
            }
        }
        if (this.label()) {
            if (!too_far_away_for_text(renderer)) {
                ctx.fillStyle = this.getCssProperty(renderer, fgstyle);
                const textw = ctx.measureText(this.label()).width;
                if (!visible_rect) {
                    ctx.fillText(
                        this.label(), this.x - textw / 2,
                        this.y + SDFV.LINEHEIGHT / 4
                    );
                } else if (visible_rect && visible_rect.x <= topleft.x &&
                    visible_rect.y <= topleft.y + SDFV.LINEHEIGHT) {
                    ctx.fillText(
                        this.label(), this.x - textw / 2,
                        this.y + SDFV.LINEHEIGHT / 4
                    );
                }
            }
        }
    }

    public simple_draw(
        renderer: SDFGRenderer, ctx: CanvasRenderingContext2D,
        _mousepos?: Point2D
    ): void {
        // Fast drawing function for small nodes
        const topleft = this.topleft();
        ctx.fillStyle = this.getCssProperty(
            renderer, '--node-background-color'
        );
        ctx.fillRect(topleft.x, topleft.y, this.width, this.height);
        ctx.fillStyle = this.getCssProperty(
            renderer, '--node-foreground-color'
        );
    }

    public shade(
        _renderer: SDFGRenderer, ctx: CanvasRenderingContext2D, color: string,
        alpha: number = 0.4
    ): void {
        // Save the current style properties.
        const orig_fill_style = ctx.fillStyle;
        const orig_alpha = ctx.globalAlpha;

        ctx.globalAlpha = alpha;
        ctx.fillStyle = color;

        const topleft = this.topleft();
        ctx.fillRect(topleft.x, topleft.y, this.width, this.height);

        // Restore the previous style properties.
        ctx.fillStyle = orig_fill_style;
        ctx.globalAlpha = orig_alpha;
    }

    public label(): string {
        return this.data.node.label;
    }

    public attributes(): any {
        return this.data.node.attributes;
    }

    public type(): string {
        return this.data.node.type;
    }

    public set_layout(): void {
        this.width = this.data.node.attributes.layout.width;
        this.height = this.data.node.attributes.layout.height;
    }

}

export abstract class Edge extends SDFGElement {

    public points: any[] = [];
    public src_connector: any;
    public dst_connector: any;

    public get_points(): any[] {
        return this.points;
    }

    public setViewToSource(renderer: SDFGRenderer): void {
        const tPoint = this.points[0];
        renderer.moveViewTo(tPoint.x, tPoint.y);
    }

    public setViewToDestination(renderer: SDFGRenderer): void {
        const tPoint = this.points[this.points.length - 1];
        renderer.moveViewTo(tPoint.x, tPoint.y);
    }

    protected drawArrow(
        ctx: CanvasRenderingContext2D, p1: Point2D, p2: Point2D, size: number,
        offset: number = 0, padding: number = 0
    ): void {
        // Rotate the context to point along the path
        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;
        const rot = Math.atan2(dy, dx);
        ctx.translate(p2.x, p2.y);
        ctx.rotate(rot);

        // arrowhead
        ctx.beginPath();
        ctx.moveTo(0 + padding + offset, 0);
        ctx.lineTo(((-2 * size) - padding) - offset, -(size + padding));
        ctx.lineTo(((-2 * size) - padding) - offset, (size + padding));
        ctx.closePath();
        ctx.fill();

        // Restore context
        ctx.rotate(-rot);
        ctx.translate(-p2.x, -p2.y);
    }

    public create_arrow_line(ctx: CanvasRenderingContext2D): void {
        ctx.moveTo(this.points[0].x, this.points[0].y);
        if (this.points.length === 2) {
            // Straight line can be drawn
            ctx.lineTo(this.points[1].x, this.points[1].y);
        } else {
            let i;
            for (i = 1; i < this.points.length - 2; i++) {
                const xm = (this.points[i].x + this.points[i + 1].x) / 2.0;
                const ym = (this.points[i].y + this.points[i + 1].y) / 2.0;
                ctx.quadraticCurveTo(
                    this.points[i].x, this.points[i].y, xm, ym
                );
            }
            ctx.quadraticCurveTo(this.points[i].x, this.points[i].y,
                this.points[i + 1].x, this.points[i + 1].y);
        }
    }

    public debug_draw(
        renderer: SDFGRenderer, ctx: CanvasRenderingContext2D
    ): void {
        if (renderer.debug_draw) {
            // Print the center and bounding box in debug mode.
            ctx.beginPath();
            ctx.arc(this.x, this.y, 1, 0, 2 * Math.PI, false);
            ctx.fillStyle = 'red';
            ctx.fill();
            ctx.strokeStyle = 'red';
            ctx.stroke();
            ctx.strokeRect(
                this.x - (this.width / 2.0), this.y - (this.height / 2.0),
                this.width, this.height
            );

            // Print the points
            for (const p of this.points)
                ctx.strokeRect(p.x - 2, p.y - 2, 4, 4);
        }
    }

    public shade(
        renderer: SDFGRenderer, ctx: CanvasRenderingContext2D, color: string,
        alpha: number = 0.4
    ): void {
        ctx.beginPath();
        this.create_arrow_line(ctx);

        // Save current style properties.
        const orig_stroke_style = ctx.strokeStyle;
        const orig_fill_style = ctx.fillStyle;
        const orig_line_cap = ctx.lineCap;
        const orig_line_width = ctx.lineWidth;
        const orig_alpha = ctx.globalAlpha;

        ctx.globalAlpha = alpha;
        ctx.lineWidth = orig_line_width + 4;
        ctx.fillStyle = color;
        ctx.strokeStyle = color;
        ctx.lineCap = 'butt';

        ctx.stroke();

        if (this.points.length < 2)
            return;

        const canvas_manager = renderer.get_canvas_manager();
        const ppp = canvas_manager?.points_per_pixel();
        if (!renderer.adaptiveHiding || (ppp && ppp < SDFV.ARROW_LOD)) {
            this.drawArrow(ctx, this.points[this.points.length - 2],
                this.points[this.points.length - 1], 3, 0, 4);
        }

        // Restore previous stroke style, width, and opacity.
        ctx.strokeStyle = orig_stroke_style;
        ctx.fillStyle = orig_fill_style;
        ctx.lineCap = orig_line_cap;
        ctx.lineWidth = orig_line_width;
        ctx.globalAlpha = orig_alpha;
    }

    public set_layout(): void {
        // NOTE: Setting this.width/height will disrupt dagre in self-edges
    }

    public intersect(
        x: number, y: number, w: number = 0, h: number = 0
    ): boolean {
        // First, check bounding box
        if (!super.intersect(x, y, w, h))
            return false;

        // Then (if point), check distance from line
        if (w === 0 || h === 0) {
            for (let i = 0; i < this.points.length - 1; i++) {
                const dist = ptLineDistance(
                    { x: x, y: y }, this.points[i], this.points[i + 1]
                );
                if (dist <= 5.0)
                    return true;
            }
            return false;
        } else {
            // It is a rectangle. Check if any of the rectangles, spanned by
            // pairs of points of the line, intersect the input rectangle.
            // This is needed for long Interstate edges that have a huge
            // bounding box and intersect almost always with the viewport even
            // if they are not visible. This is only an approximation to detect
            // if a line is in the viewport and could be made more accurate at
            // the cost of more computation.
            for (let i = 0; i < this.points.length - 1; i++) {
                const linepoint_0 = this.points[i];
                const linepoint_1 = this.points[i + 1];
                // Rectangle spanned by the two line points
                const r = {
                    x: Math.min(linepoint_0.x, linepoint_1.x),
                    y: Math.min(linepoint_0.y, linepoint_1.y),
                    w: Math.abs(linepoint_1.x - linepoint_0.x),
                    h: Math.abs(linepoint_1.y - linepoint_0.y),
                };

                // Check if the two rectangles intersect
                if (r.x + r.w >= x && r.x <= x+w &&
                    r.y + r.h >= y && r.y <= y+h)
                    return true;
            }
            return false;
        }
    }

}

export class Memlet extends Edge {

    // Currently used for Memlets to decide if they need to be drawn or not.
    // Set in the layouter.
    public summarized: boolean = false;

    public create_arrow_line(ctx: CanvasRenderingContext2D): void {
        // Draw memlet edges with quadratic curves through the arrow points.
        ctx.moveTo(this.points[0].x, this.points[0].y);
        if (this.points.length === 2) {
            // Straight line can be drawn
            ctx.lineTo(this.points[1].x, this.points[1].y);
        } else {
            let i;
            if (SDFVSettings.get<boolean>('curvedEdges')) {
                for (i = 1; i < this.points.length - 2; i++) {
                    const xm = (this.points[i].x + this.points[i + 1].x) / 2.0;
                    const ym = (this.points[i].y + this.points[i + 1].y) / 2.0;
                    ctx.quadraticCurveTo(
                        this.points[i].x, this.points[i].y, xm, ym
                    );
                }
                ctx.quadraticCurveTo(this.points[i].x, this.points[i].y,
                    this.points[i + 1].x, this.points[i + 1].y);
            } else {
                // Straight lines
                for (i = 1; i < this.points.length; i++)
                    ctx.lineTo(this.points[i].x, this.points[i].y);
            }
        }
    }

    public draw(
        renderer: SDFGRenderer, ctx: CanvasRenderingContext2D,
        _mousepos?: Point2D
    ): void {
        ctx.beginPath();
        this.create_arrow_line(ctx);

        if (this.hovered)
            renderer.set_tooltip((c) => this.tooltip(c, renderer));
        ctx.fillStyle = ctx.strokeStyle = this.strokeStyle(renderer);

        let skipArrow = false;
        if (this.attributes().data) {
            // CR edges have dashed lines
            if (this.data.attributes.wcr)
                ctx.setLineDash([3, 2]);
            else
                ctx.setLineDash([1, 0]);
        } else {
            // Empty memlet, i.e., a dependency edge. Do not draw the arrowhead.
            skipArrow = true;
        }

        ctx.stroke();

        ctx.setLineDash([1, 0]);

        if (this.points.length < 2)
            return;

        // Show anchor points for moving
        if (this.selected && renderer.get_mouse_mode() === 'move') {
            let i;
            for (i = 1; i < this.points.length - 1; i++) {
                ctx.strokeRect(
                    this.points[i].x - 5, this.points[i].y - 5, 8, 8
                );
            }
        }

        if (!skipArrow) {
            const canvas_manager = renderer.get_canvas_manager();
            const ppp = canvas_manager?.points_per_pixel();
            if (!renderer.adaptiveHiding || (ppp && ppp < SDFV.ARROW_LOD)) {
                this.drawArrow(
                    ctx, this.points[this.points.length - 2],
                    this.points[this.points.length - 1], 3
                );
            }
        }
    }

    public tooltip(
        container: HTMLElement, renderer?: SDFGRenderer
    ): void {
        if (!renderer)
            return;

        super.tooltip(container);

        const dsettings = renderer.view_settings();
        const attr = this.attributes();

        if (attr.data === null || attr.data === undefined) {  // Empty memlet
            container.style.display = 'none';
            return;
        }

        let contents = attr.data;
        contents += sdfg_property_to_string(attr.subset, dsettings);

        if (attr.other_subset) {
            contents += ' -> ' + sdfg_property_to_string(
                attr.other_subset, dsettings
            );
        }

        if (attr.wcr) {
            contents += '<br /><b>CR: ' + sdfg_property_to_string(
                attr.wcr, dsettings
            ) + '</b>';
        }

        let num_accesses = null;
        if (attr.volume) {
            num_accesses = sdfg_property_to_string(attr.volume, dsettings);
        } else {
            num_accesses = sdfg_property_to_string(
                attr.num_accesses, dsettings
            );
        }

        if (attr.dynamic) {
            if (num_accesses === '0' || num_accesses === '-1') {
                num_accesses = '<b>Dynamic (unbounded)</b>';
            } else {
                num_accesses = '<b>Dynamic</b> (up to ' +
                    num_accesses + ')';
            }
        } else if (num_accesses === '-1') {
            num_accesses = '<b>Dynamic (unbounded)</b>';
        }

        contents += '<br /><font style="font-size: 14px">Volume: ' +
            num_accesses + '</font>';
        container.innerHTML = contents;
    }

    public label(): string {
        return '';
    }

}

export class InterstateEdge extends Edge {

    // Parent ID is the state ID, if relevant
    public constructor(
        data: any,
        id: number,
        sdfg: JsonSDFG,
        cfg: JsonSDFGControlFlowRegion,
        parent_id: number | null = null,
        parentElem?: SDFGElement,
        public readonly src?: string,
        public readonly dst?: string
    ) {
        super(data, id, sdfg, cfg, parent_id, parentElem);
    }

    public create_arrow_line(ctx: CanvasRenderingContext2D): void {
        // Draw intersate edges with bezier curves through the arrow points.
        ctx.moveTo(this.points[0].x, this.points[0].y);
        let i;

        if (SDFVSettings.get<boolean>('curvedEdges')) {
            let lastX = this.points[0].x;
            let lastY = this.points[0].y;
            for (i = 1; i < this.points.length; i++) {
                const intermediateY = (lastY + this.points[i].y) / 2.0;
                ctx.bezierCurveTo(
                    lastX, intermediateY,
                    this.points[i].x, intermediateY,
                    this.points[i].x, this.points[i].y
                );
                lastX = this.points[i].x;
                lastY = this.points[i].y;
            }
        } else {
            // Straight lines
            for (i = 1; i < this.points.length; i++)
                ctx.lineTo(this.points[i].x, this.points[i].y);
        }
    }

    protected drawArrow(
        ctx: CanvasRenderingContext2D, p1: Point2D, p2: Point2D, size: number,
        offset: number = 0, padding: number = 0
    ): void {
        // Rotate the context to point along the path. This overrides the
        // default (memlet-style) arrow drawing, because the arrow line is
        // interpolated differently for interstate edges (using bezier curves
        // through arrow points rather than quadratic curves). As such, the
        // angle of the last line segment is different and needs to be
        // calculated differently.
        if (!SDFVSettings.get<boolean>('useVerticalStateMachineLayout')) {
            // This is not used if the 'old-style' layout is used.
            super.drawArrow(ctx, p1, p2, size, offset, padding);
        } else {
            const dx = 0;
            const dy = p2.y - p1.y;
            const rot = Math.atan2(dy, dx);
            ctx.translate(p2.x, p2.y);
            ctx.rotate(rot);

            // arrowhead
            ctx.beginPath();
            ctx.moveTo(0 + padding + offset, 0);
            ctx.lineTo(((-2 * size) - padding) - offset, -(size + padding));
            ctx.lineTo(((-2 * size) - padding) - offset, (size + padding));
            ctx.closePath();
            ctx.fill();

            // Restore context
            ctx.rotate(-rot);
            ctx.translate(-p2.x, -p2.y);
        }
    }

    public draw(
        renderer: SDFGRenderer, ctx: CanvasRenderingContext2D,
        _mousepos?: Point2D
    ): void {
        ctx.beginPath();
        this.create_arrow_line(ctx);

        let style = this.strokeStyle(renderer);

        // Interstate edge
        if (style === this.getCssProperty(renderer, '--color-default'))
            style = this.getCssProperty(renderer, '--interstate-edge-color');
        ctx.fillStyle = ctx.strokeStyle = style;
        ctx.setLineDash([1, 0]);
        ctx.stroke();

        if (this.points.length < 2)
            return;

        // Show anchor points for moving
        if (this.selected && renderer.get_mouse_mode() === 'move') {
            let i;
            for (i = 1; i < this.points.length - 1; i++) {
                ctx.strokeRect(
                    this.points[i].x - 5, this.points[i].y - 5, 8, 8
                );
            }
        }

        const canvas_manager = renderer.get_canvas_manager();
        const ppp = canvas_manager?.points_per_pixel();
        if (!renderer.adaptiveHiding || (ppp && ppp < SDFV.ARROW_LOD)) {
            this.drawArrow(
                ctx, this.points[this.points.length - 2],
                this.points[this.points.length - 1], 3
            );
        }

        if (SDFVSettings.get<boolean>('alwaysOnISEdgeLabels'))
            this.drawLabel(renderer, ctx);

        if (this.hovered)
            renderer.set_tooltip((c) => this.tooltip(c, renderer));
    }

    public tooltip(container: HTMLElement, renderer?: SDFGRenderer): void {
        if (!renderer)
            return;
        super.tooltip(container);
        container.classList.add('sdfvtooltip--interstate-edge');
        container.innerText = this.label();
        if (!this.label())
            container.style.display = 'none';
    }

    public drawLabel(
        renderer: SDFGRenderer, ctx: CanvasRenderingContext2D
    ): void {
        const ppp = renderer.get_canvas_manager()?.points_per_pixel();
        if (ppp === undefined)
            return;
        if (renderer.adaptiveHiding && ppp > SDFV.SCOPE_LOD)
            return;

        const labelLines = [];
        if (this.attributes().assignments) {
            for (const k of Object.keys(this.attributes().assignments ?? []))
                labelLines.push(k + ' 🡐 ' + this.attributes().assignments[k]);
        }
        const cond = this.attributes().condition?.string_data;
        if (cond && cond !== '1' && cond !== 'true')
            labelLines.push('if ' + cond);

        if (labelLines.length < 1)
            return;

        const oldFont = ctx.font;
        ctx.font = '8px sans-serif';
        const labelHs = [];
        const labelWs = [];
        for (const l of labelLines) {
            const labelMetrics = ctx.measureText(l);

            let label_width = Math.abs(labelMetrics.actualBoundingBoxLeft) +
                Math.abs(labelMetrics.actualBoundingBoxRight);
            let label_height = Math.abs(labelMetrics.actualBoundingBoxDescent) +
                Math.abs(labelMetrics.actualBoundingBoxAscent);

            // In case of canvas2pdf context, that only has width and height
            // as TextMetrics properties
            if (label_width !== label_width)
                label_width = (labelMetrics as any).width;
            if (label_height !== label_height)
                label_height = (labelMetrics as any).height;

            labelWs.push(label_width);
            labelHs.push(label_height);
        }
        const labelW = Math.max(...labelWs);
        const labelH = labelHs.reduce((pv, cv) => {
            if (!cv)
                return pv;
            return cv + SDFV.LINEHEIGHT + pv;
        });

        // The label is positioned at the origin of the interstate edge, offset
        // so that it does not intersect the edge or the state it originates
        // from. There are a few cases to consider:
        // 1. The edge exits from the top/bottom of a node. Then the label is
        //    placed right next to the source point, offset up/down by
        //    LABEL_PADDING pixels to not intersect with the state. If the edge
        //    moves to the right/left, place the label to the left/right of the
        //    edge to avoid intersection.
        // 2. The edge exits from the side of a node. Then the label is placed
        //    next to the source point, offset up/down by LABEL_PADDING pixels
        //    depending on whether the edge direction is down/up, so it does not
        //    intersect with the edge. To avoid intersecting with the node, the
        //    label is also offset LABEL_PADDING pixels to the left/right,
        //    depending on whether the edge exits to the left/right of the node.
        const LABEL_PADDING = 3;
        const srcP = this.points[0];
        const srcNode = this.src !== undefined ?
            renderer.get_graph()?.node(this.src) : null;
        // Initial offsets are good for edges coming out of a node's top border.
        let offsetX = LABEL_PADDING;
        let offsetY = -LABEL_PADDING;
        if (srcNode) {
            const stl = srcNode.topleft();
            if (Math.abs(srcP.y - (stl.y + srcNode.height)) < 1) {
                // Edge exits the bottom of a node.
                offsetY = LABEL_PADDING + labelH;
                // If the edge moves right, offset the label to the left.
                if (this.points[1].x > srcP.x)
                    offsetX = -(LABEL_PADDING + labelW);
            } else if (Math.abs(srcP.x - stl.x) < 1) {
                // Edge exits to the left of a node.
                offsetX = -(LABEL_PADDING + labelW);
                // If the edge moves down, offset the label upwards.
                if (this.points[1].y <= srcP.y)
                    offsetY = LABEL_PADDING + labelH;
            } else if (Math.abs(srcP.x - (stl.x + srcNode.width)) < 1) {
                // Edge exits to the right of a node.
                // If the edge moves down, offset the label upwards.
                if (this.points[1].y <= srcP.y)
                    offsetY = LABEL_PADDING + labelH;
            } else {
                // Edge exits the top of a node.
                // If the edge moves right, offset the label to the left.
                if (this.points[1].x > srcP.x)
                    offsetX = -(LABEL_PADDING + labelW);
            }
        } else {
            // Failsafe offset calculation if no source node is present.
            if (this.points[0].x > this.points[1].x)
                offsetX = -(labelW + LABEL_PADDING);
            if (this.points[0].y <= this.points[1].y)
                offsetY = labelH + LABEL_PADDING;
        }

        ctx.fillStyle = this.getCssProperty(
            renderer, '--interstate-edge-color'
        );
        for (let i = 0; i < labelLines.length; i++) {
            ctx.fillText(
                labelLines[i],
                srcP.x + offsetX,
                (srcP.y + offsetY) - (i * (labelHs[0] + SDFV.LINEHEIGHT))
            );
        }
        ctx.font = oldFont;
    }

}

export class Connector extends SDFGElement {

    public custom_label: string | null = null;
    public linkedElem?: SDFGElement;
    public connectorType: 'in' | 'out' = 'in';

    public draw(
        renderer: SDFGRenderer, ctx: CanvasRenderingContext2D,
        _mousepos?: Point2D, edge: Edge | null = null
    ): void {
        const scope_connector = (
            this.data.name.startsWith('IN_') ||
            this.data.name.startsWith('OUT_')
        );
        const topleft = this.topleft();
        ctx.beginPath();
        drawEllipse(ctx, topleft.x, topleft.y, this.width, this.height);
        ctx.closePath();
        ctx.strokeStyle = this.strokeStyle(renderer);
        let fillColor;
        if (scope_connector) {
            let cname = this.data.name;
            if (cname.startsWith('IN_'))
                cname = cname.substring(3);
            else
                cname = cname.substring(4);

            ctx.lineWidth = 0.4;
            ctx.stroke();
            ctx.lineWidth = 1.0;
            fillColor = this.getCssProperty(
                renderer, '--connector-scoped-color'
            );
            this.custom_label = null;
        } else if (!edge) {
            ctx.stroke();
            fillColor = this.getCssProperty(
                renderer, '--node-missing-background-color'
            );
            this.custom_label = 'No edge connected';
        } else {
            ctx.stroke();
            fillColor = this.getCssProperty(
                renderer, '--connector-unscoped-color'
            );
            this.custom_label = null;
        }

        // PDFs do not support transparent fill colors
        if ((ctx as any).pdf)
            fillColor = fillColor.substr(0, 7);

        ctx.fillStyle = fillColor;

        // PDFs do not support stroke and fill on the same object
        if ((ctx as any).pdf) {
            ctx.beginPath();
            drawEllipse(ctx, topleft.x, topleft.y, this.width, this.height);
            ctx.closePath();
        }
        ctx.fill();

        if (this.strokeStyle(renderer) !==
            this.getCssProperty(renderer, '--color-default'))
            renderer.set_tooltip((c) => this.tooltip(c));
    }

    public attributes(): any {
        return {};
    }

    public set_layout(): void {
        return;
    }

    public label(): string {
        if (this.custom_label)
            return this.data.name + ': ' + this.custom_label;
        return this.data.name;
    }

    public tooltip(container: HTMLElement): void {
        super.tooltip(container);
        if (this.custom_label)
            container.classList.add('sdfvtooltip--error');
        else
            container.classList.add('sdfvtooltip--connector');

        container.innerText = this.label();
    }

}

export class AccessNode extends SDFGNode {

    public draw(
        renderer: SDFGRenderer, ctx: CanvasRenderingContext2D,
        _mousepos?: Point2D
    ): void {
        const topleft = this.topleft();
        ctx.beginPath();
        drawEllipse(ctx, topleft.x, topleft.y, this.width, this.height);
        ctx.closePath();
        ctx.strokeStyle = this.strokeStyle(renderer);

        const name = this.data.node.attributes.data;
        const nodedesc = this.sdfg.attributes._arrays[name];
        // Streams have dashed edges
        if (nodedesc && nodedesc.type === 'Stream')
            ctx.setLineDash([5, 3]);
        else
            ctx.setLineDash([1, 0]);

        // Non-transient (external) data is thicker
        if (nodedesc && nodedesc.attributes.transient === true)
            ctx.lineWidth = 1.0;
        else
            ctx.lineWidth = 3.0;

        ctx.stroke();
        ctx.lineWidth = 1.0;
        ctx.setLineDash([1, 0]);

        // Views are colored like connectors
        if (nodedesc && nodedesc.type.includes('View')) {
            ctx.fillStyle = this.getCssProperty(
                renderer, '--connector-unscoped-color'
            );
        } else if (nodedesc && nodedesc.type.includes('Reference')) {
            ctx.fillStyle = this.getCssProperty(
                renderer, '--reference-background-color'
            );
        } else if (nodedesc && this.sdfg.attributes.constants_prop &&
            this.sdfg.attributes.constants_prop[name] !== undefined) {
            ctx.fillStyle = this.getCssProperty(
                renderer, '--connector-scoped-color'
            );
        } else if (nodedesc) {
            ctx.fillStyle = this.getCssProperty(
                renderer, '--node-background-color'
            );
        } else {
            ctx.fillStyle = this.getCssProperty(
                renderer, '--node-missing-background-color'
            );
        }

        // PDFs do not support stroke and fill on the same object
        if ((ctx as any).pdf) {
            ctx.beginPath();
            drawEllipse(ctx, topleft.x, topleft.y, this.width, this.height);
            ctx.closePath();
        }
        ctx.fill();
        if (nodedesc) {
            ctx.fillStyle = this.getCssProperty(
                renderer, '--node-foreground-color'
            );
        } else {
            ctx.fillStyle = this.getCssProperty(
                renderer, '--node-missing-foreground-color'
            );
            if (this.strokeStyle(renderer) !==
                this.getCssProperty(renderer, '--color-default'))
                renderer.set_tooltip((c) => this.tooltip(c));
        }

        // If we are far away, don't show the text
        if (too_far_away_for_text(renderer))
            return;

        const textmetrics = ctx.measureText(this.label());
        ctx.fillText(
            this.label(), this.x - textmetrics.width / 2.0,
            this.y + SDFV.LINEHEIGHT / 4.0
        );
    }

    public label(): string {
        const name = this.data.node.attributes.data;
        let lbl = name;
        if (SDFVSettings.get<boolean>('showDataDescriptorSizes')) {
            const nodedesc = this.sdfg.attributes._arrays[name];
            if (nodedesc && nodedesc.attributes.shape)
                lbl = ' ' + sdfg_property_to_string(nodedesc.attributes.shape);
        }
        return lbl;
    }

    public shade(
        _renderer: SDFGRenderer, ctx: CanvasRenderingContext2D, color: string,
        alpha: number = 0.4
    ): void {
        // Save the current style properties.
        const orig_fill_style = ctx.fillStyle;
        const orig_alpha = ctx.globalAlpha;

        ctx.globalAlpha = alpha;
        ctx.fillStyle = color;

        const topleft = this.topleft();
        ctx.beginPath();
        drawEllipse(ctx, topleft.x, topleft.y, this.width, this.height);
        ctx.closePath();
        ctx.fill();

        // Restore the previous style properties.
        ctx.fillStyle = orig_fill_style;
        ctx.globalAlpha = orig_alpha;
    }

    public tooltip(container: HTMLElement): void {
        super.tooltip(container);
        const nodedesc = this.sdfg.attributes._arrays[
            this.data.node.attributes.data
        ];
        if (nodedesc)
            return;
        container.classList.add('sdfvtooltip--error');
        container.innerText = 'Undefined array';
    }

}

export class ScopeNode extends SDFGNode {

    public get COLLAPSIBLE(): boolean {
        return true;
    }

    private cached_far_label: string | null = null;
    private cached_close_label: string | null = null;

    private schedule_label_dict: { [key: string]: string } = {
        'Default': 'Default',
        'Sequential': 'Seq',
        'MPI': 'MPI',
        'CPU_Multicore': 'OMP',
        'Unrolled': 'Unroll',
        'SVE_Map': 'SVE',
        'GPU_Default': 'GPU',
        'GPU_Device': 'GPU',
        'GPU_ThreadBlock': 'Block',
        'GPU_ThreadBlock_Dynamic': 'Block-Dyn',
        'GPU_Persistent': 'GPU-P',
        'FPGA_Device': 'FPGA',
        'Snitch': 'Snitch',
        'Snitch_Multicore': 'Snitch MC',
    };

    public draw(
        renderer: SDFGRenderer, ctx: CanvasRenderingContext2D,
        _mousepos?: Point2D
    ): void {
        this.draw_edge_summary(renderer, ctx);

        let draw_shape;
        if (this.data.node.attributes.is_collapsed) {
            draw_shape = () => {
                drawHexagon(ctx, this.x, this.y, this.width, this.height, {
                    x: 0,
                    y: 0,
                });
            };
        } else {
            draw_shape = () => {
                drawTrapezoid(ctx, this.topleft(), this, this.scopeend());
            };
        }
        ctx.strokeStyle = this.strokeStyle(renderer);

        // Consume scopes have dashed edges
        if (this.data.node.type.startsWith('Consume'))
            ctx.setLineDash([5, 3]);
        else
            ctx.setLineDash([1, 0]);

        draw_shape();
        ctx.stroke();
        ctx.setLineDash([1, 0]);
        ctx.fillStyle = this.getCssProperty(
            renderer, '--node-background-color'
        );
        // PDFs do not support stroke and fill on the same object
        if ((ctx as any).pdf)
            draw_shape();
        ctx.fill();
        ctx.fillStyle = this.getCssProperty(
            renderer, '--node-foreground-color'
        );

        // If we are far away, don't show the text
        if (too_far_away_for_text(renderer))
            return;

        drawAdaptiveText(
            ctx, renderer, this.far_label(renderer),
            this.close_label(renderer), this.x, this.y,
            this.width, this.height,
            SDFV.SCOPE_LOD
        );

        if (SDFVSettings.get<boolean>('showMapSchedules')) {
            drawAdaptiveText(
                ctx, renderer, '', this.schedule_label(), this.x, this.y,
                this.width, this.height,
                SDFV.SCOPE_LOD, SDFV.DEFAULT_MAX_FONTSIZE, 0.7,
                SDFV.DEFAULT_FAR_FONT_MULTIPLIER, true,
                TextVAlign.BOTTOM, TextHAlign.RIGHT, {
                    bottom: 2.0,
                    right: this.height,
                }
            );
        }
    }

    public shade(
        _renderer: SDFGRenderer, ctx: CanvasRenderingContext2D, color: string,
        alpha: number = 0.4
    ): void {
        // Save the current style properties.
        const orig_fill_style = ctx.fillStyle;
        const orig_alpha = ctx.globalAlpha;

        ctx.globalAlpha = alpha;
        ctx.fillStyle = color;

        if (this.data.node.attributes.is_collapsed) {
            drawHexagon(ctx, this.x, this.y, this.width, this.height, {
                x: 0,
                y: 0,
            });
        } else {
            drawTrapezoid(ctx, this.topleft(), this, this.scopeend());
        }
        ctx.fill();

        // Restore the previous style properties.
        ctx.fillStyle = orig_fill_style;
        ctx.globalAlpha = orig_alpha;
    }

    public schedule_label(): string {
        let attrs = this.attributes();
        if (this.scopeend() && this.parent_id !== null) {
            const entry = this.parentElem?.data.state.nodes[
                this.data.node.scope_entry
            ];
            if (entry !== undefined)
                attrs = entry.attributes;
        }

        let label = attrs.schedule ?? 'Default';
        try {
            label = this.schedule_label_dict[label];
        } catch (_err) {
        }

        // If this isn't a pre-defined schedule, show the raw name.
        if (!label)
            label = attrs.schedule;

        return label;
    }

    public far_label(
        renderer: SDFGRenderer, recompute: boolean = false
    ): string {
        if (!recompute && this.cached_far_label)
            return this.cached_far_label;

        let result = '[';

        let attrs = this.attributes();
        if (this.scopeend() && this.parent_id !== null) {
            const entry = this.parentElem?.data.state.nodes[
                this.data.node.scope_entry
            ];
            if (entry !== undefined)
                attrs = entry.attributes;
            else
                return this.label();
        }

        if (this instanceof ConsumeEntry || this instanceof ConsumeExit) {
            result += sdfg_consume_elem_to_string(
                attrs.num_pes ?? 1, renderer.view_settings()
            );
        } else {
            for (let i = 0; i < attrs.params.length; ++i) {
                result += sdfg_range_elem_to_string(
                    attrs.range.ranges[i], renderer.view_settings()
                ) + ', ';
            }
            // Remove trailing comma
            result = result.substring(0, result.length - 2);
        }
        result += ']';

        this.cached_far_label = result;

        return result;
    }

    public close_label(
        renderer: SDFGRenderer, recompute: boolean = false
    ): string {
        if (!recompute && this.cached_close_label)
            return this.cached_close_label;

        let attrs = this.attributes();

        let result = '';
        if (this.scopeend() && this.parent_id !== null) {
            const entry = this.parentElem?.data.state.nodes[
                this.data.node.scope_entry
            ];
            if (entry !== undefined) {
                attrs = entry.attributes;
            } else {
                this.cached_close_label = 'MISSING ENTRY NODE';
                return 'MISSING ENTRY NODE';
            }
        }

        result += '[';
        if (this instanceof ConsumeEntry || this instanceof ConsumeExit) {
            result += attrs.pe_index + '=' + sdfg_consume_elem_to_string(
                attrs.num_pes ?? 1, renderer.view_settings()
            );
        } else {
            for (let i = 0; i < attrs.params.length; ++i) {
                result += attrs.params[i] + '=';
                result += sdfg_range_elem_to_string(
                    attrs.range.ranges[i], renderer.view_settings()
                ) + ', ';
            }
            // Remove trailing comma
            result = result.substring(0, result.length - 2);
        }
        result += ']';

        this.cached_close_label = result;

        return result;
    }

    public scopeend(): boolean {
        return false;
    }

    public clear_cached_labels(): void {
        this.cached_close_label = null;
        this.cached_far_label = null;
    }

}

export class EntryNode extends ScopeNode {

    public scopeend(): boolean {
        return false;
    }

}

export class ExitNode extends ScopeNode {

    public scopeend(): boolean {
        return true;
    }

}

export class MapEntry extends EntryNode {

    public stroketype(ctx: CanvasRenderingContext2D): void {
        ctx.setLineDash([1, 0]);
    }

}

export class MapExit extends ExitNode {

    public stroketype(ctx: CanvasRenderingContext2D): void {
        ctx.setLineDash([1, 0]);
    }

}

export class ConsumeEntry extends EntryNode {

    public stroketype(ctx: CanvasRenderingContext2D): void {
        ctx.setLineDash([5, 3]);
    }

}

export class ConsumeExit extends ExitNode {

    public stroketype(ctx: CanvasRenderingContext2D): void {
        ctx.setLineDash([5, 3]);
    }

}

export class PipelineEntry extends EntryNode {

    public stroketype(ctx: CanvasRenderingContext2D): void {
        ctx.setLineDash([10, 3]);
    }

}
export class PipelineExit extends ExitNode {

    public stroketype(ctx: CanvasRenderingContext2D): void {
        ctx.setLineDash([10, 3]);
    }

}

enum TaskletCodeTokenType {
    Number,
    Input,
    Output,
    Symbol,
    Other,
}

type TaskletCodeToken = {
    token: string,
    type: TaskletCodeTokenType,
    highlighted: boolean,
};

export class Tasklet extends SDFGNode {

    public constructor(
        public data: any,
        public id: number,
        public sdfg: JsonSDFG,
        public cfg: JsonSDFGControlFlowRegion,
        public parent_id: number | null = null,
        public parentElem?: SDFGElement
    ) {
        super(data, id, sdfg, cfg, parent_id, parentElem);
        this.highlightCode();
    }

    public text_for_find(): string {
        // Include code when searching
        const code = this.attributes().code.string_data;
        return this.label() + ' ' + code;
    }

    private highlightedCode: TaskletCodeToken[][] = [];
    public readonly inputTokens: Set<TaskletCodeToken> = new Set();
    public readonly outputTokens: Set<TaskletCodeToken> = new Set();
    private longestCodeLine?: string;

    public async highlightCode(): Promise<void> {
        this.inputTokens.clear();
        this.outputTokens.clear();
        this.highlightedCode = [];

        const lang = this.attributes().code.language?.toLowerCase() || 'python';
        const code = this.attributes().code.string_data;

        const sdfgSymbols = Object.keys(this.sdfg.attributes.symbols ?? []);
        const inConnectors = Object.keys(this.attributes().in_connectors ?? []);
        const outConnectors = Object.keys(
            this.attributes().out_connectors ?? []
        );

        const lines = code.split('\n');
        let maxline_len = 0;
        for (const line of lines) {
            if (line.length > maxline_len) {
                this.longestCodeLine = line;
                maxline_len = line.length;
            }

            const highlightedLine: TaskletCodeToken[] = [];
            try {
                const tokens = editor.tokenize(line, lang)[0];
                if (tokens.length < 2) {
                    highlightedLine.push({
                        token: line,
                        type: TaskletCodeTokenType.Other,
                        highlighted: false,
                    });
                } else {
                    for (let i = 0; i < tokens.length; i++) {
                        const token = tokens[i];
                        const next = i + 1 < tokens.length ?
                            tokens[i + 1] : null;
                        const endPos = next?.offset;
                        const tokenValue = line.substring(token.offset, endPos);

                        const taskletToken: TaskletCodeToken = {
                            token: tokenValue,
                            type: TaskletCodeTokenType.Other,
                            highlighted: false,
                        };
                        if (token.type.startsWith('identifier')) {
                            if (sdfgSymbols.includes(tokenValue)) {
                                taskletToken.type = TaskletCodeTokenType.Symbol;
                            } else if (inConnectors.includes(tokenValue)) {
                                taskletToken.type = TaskletCodeTokenType.Input;
                                this.inputTokens.add(taskletToken);
                            } else if (outConnectors.includes(tokenValue)) {
                                taskletToken.type = TaskletCodeTokenType.Output;
                                this.outputTokens.add(taskletToken);
                            }
                        } else if (token.type.startsWith('number')) {
                            taskletToken.type = TaskletCodeTokenType.Number;
                        }

                        highlightedLine.push(taskletToken);
                    }
                }
            } catch (_ignored) {
            }
            this.highlightedCode.push(highlightedLine);
        }
    }

    private drawTaskletCode(
        renderer: SDFGRenderer, ctx: CanvasRenderingContext2D
    ): void {
        if (!this.longestCodeLine)
            return;

        const oldfont = ctx.font;
        ctx.font = '10px courier new';
        const textmetrics = ctx.measureText(this.longestCodeLine);

        // Fit font size to 80% height and width of tasklet
        const height = this.highlightedCode.length * SDFV.LINEHEIGHT * 1.05;
        const width = textmetrics.width;
        const TASKLET_WRATIO = 0.9, TASKLET_HRATIO = 0.5;
        const hr = height / (this.height * TASKLET_HRATIO);
        const wr = width / (this.width * TASKLET_WRATIO);
        const fontSize = Math.min(10 / hr, 10 / wr);
        const textYOffset = fontSize / 4;

        ctx.font = fontSize + 'px courier new';
        const defaultColor = this.getCssProperty(
            renderer, '--node-foreground-color'
        );
        // Set the start offset such that the middle row of the text is in
        // this.y
        const startY = this.y + textYOffset - (
            (this.highlightedCode.length - 1) / 2
        ) * fontSize * 1.05;
        const startX = this.x - (this.width * TASKLET_WRATIO) / 2.0;
        let i = 0;
        for (const line of this.highlightedCode) {
            const lineY = startY + i * fontSize * 1.05;
            let tokenX = startX;
            for (const token of line) {
                const ofont = ctx.font;
                if (token.highlighted) {
                    ctx.font = 'bold ' + fontSize + 'px courier new';
                    ctx.fillStyle = this.getCssProperty(
                        renderer, '--tasklet-highlighted-color'
                    );
                } else {
                    switch (token.type) {
                        case TaskletCodeTokenType.Input:
                            ctx.fillStyle = this.getCssProperty(
                                renderer, '--tasklet-input-color'
                            );
                            break;
                        case TaskletCodeTokenType.Output:
                            ctx.fillStyle = this.getCssProperty(
                                renderer, '--tasklet-output-color'
                            );
                            break;
                        case TaskletCodeTokenType.Symbol:
                            ctx.font = 'bold ' + fontSize + 'px courier new';
                            ctx.fillStyle = this.getCssProperty(
                                renderer, '--tasklet-symbol-color'
                            );
                            break;
                        case TaskletCodeTokenType.Number:
                            ctx.fillStyle = this.getCssProperty(
                                renderer, '--tasklet-number-color'
                            );
                            break;
                        default:
                            ctx.fillStyle = defaultColor;
                            break;
                    }
                }

                ctx.fillText(token.token, tokenX, lineY);
                const tokenWidth = ctx.measureText(token.token).width;
                tokenX += tokenWidth;
                ctx.font = ofont;
            }
            i++;
        }

        ctx.font = oldfont;
    }

    public draw(
        renderer: SDFGRenderer, ctx: CanvasRenderingContext2D,
        _mousepos?: Point2D
    ): void {
        const canvas_manager = renderer.get_canvas_manager();
        if (!canvas_manager)
            return;

        const topleft = this.topleft();
        drawOctagon(ctx, topleft, this.width, this.height);
        ctx.strokeStyle = this.strokeStyle(renderer);
        ctx.stroke();
        ctx.fillStyle = this.getCssProperty(
            renderer, '--node-background-color'
        );

        // PDFs do not support stroke and fill on the same object
        if ((ctx as any).pdf)
            drawOctagon(ctx, topleft, this.width, this.height);
        ctx.fill();
        ctx.fillStyle = this.getCssProperty(
            renderer, '--node-foreground-color'
        );

        // If we are far away, don't show the text
        if (too_far_away_for_text(renderer))
            return;

        const ppp = canvas_manager.points_per_pixel();
        if (!renderer.adaptiveHiding || ppp < SDFV.TASKLET_LOD) {
            // If we are close to the tasklet, show its contents
            this.drawTaskletCode(renderer, ctx);
        } else {
            const textmetrics = ctx.measureText(this.label());
            ctx.fillText(
                this.label(), this.x - textmetrics.width / 2.0,
                this.y + SDFV.LINEHEIGHT / 2.0
            );
        }
    }

    public shade(
        _renderer: SDFGRenderer, ctx: CanvasRenderingContext2D, color: string,
        alpha: number = 0.4
    ): void {
        // Save the current style properties.
        const orig_fill_style = ctx.fillStyle;
        const orig_alpha = ctx.globalAlpha;

        ctx.globalAlpha = alpha;
        ctx.fillStyle = color;

        drawOctagon(ctx, this.topleft(), this.width, this.height);
        ctx.fill();

        // Restore the previous style properties.
        ctx.fillStyle = orig_fill_style;
        ctx.globalAlpha = orig_alpha;
    }

}

export class Reduce extends SDFGNode {

    public draw(
        renderer: SDFGRenderer, ctx: CanvasRenderingContext2D,
        _mousepos?: Point2D
    ): void {
        const topleft = this.topleft();
        const draw_shape = () => {
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
        ctx.fillStyle = this.getCssProperty(
            renderer, '--node-background-color'
        );
        // PDFs do not support stroke and fill on the same object
        if ((ctx as any).pdf)
            draw_shape();
        ctx.fill();

        if (!too_far_away_for_text(renderer)) {
            ctx.fillStyle = this.getCssProperty(
                renderer, '--node-foreground-color'
            );
            const far_label = this.label().substring(
                4, this.label().indexOf(',')
            );
            drawAdaptiveText(
                ctx, renderer, far_label,
                this.label(), this.x, this.y - this.height * 0.2,
                this.width, this.height,
                SDFV.SCOPE_LOD
            );
        }
    }

    public shade(
        _renderer: SDFGRenderer, ctx: CanvasRenderingContext2D, color: string,
        alpha: number = 0.4
    ): void {
        // Save the current style properties.
        const orig_fill_style = ctx.fillStyle;
        const orig_alpha = ctx.globalAlpha;

        ctx.globalAlpha = alpha;
        ctx.fillStyle = color;

        const topleft = this.topleft();
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

export class NestedSDFG extends SDFGNode {

    public get COLLAPSIBLE(): boolean {
        return true;
    }

    public draw(
        renderer: SDFGRenderer, ctx: CanvasRenderingContext2D,
        mousepos?: Point2D
    ): void {
        this.draw_edge_summary(renderer, ctx);

        if (this.data.node.attributes.is_collapsed) {
            const topleft = this.topleft();
            drawOctagon(ctx, topleft, this.width, this.height);
            ctx.strokeStyle = this.strokeStyle(renderer);
            ctx.stroke();
            drawOctagon(
                ctx, { x: topleft.x + 2.5, y: topleft.y + 2.5 }, this.width - 5,
                this.height - 5
            );
            ctx.strokeStyle = this.strokeStyle(renderer);
            ctx.stroke();
            ctx.fillStyle = this.getCssProperty(
                renderer, '--node-background-color'
            );
            // PDFs do not support stroke and fill on the same object
            if ((ctx as any).pdf) {
                drawOctagon(
                    ctx, { x: topleft.x + 2.5, y: topleft.y + 2.5 },
                    this.width - 5, this.height - 5
                );
            }
            ctx.fill();


            if (!too_far_away_for_text(renderer)) {
                ctx.fillStyle = this.getCssProperty(
                    renderer, '--node-foreground-color'
                );
                let label = this.data.node.attributes.label;
                if (!this.data.node.attributes.sdfg)
                    label += ' (not loaded)';
                const textmetrics = ctx.measureText(label);
                ctx.fillText(
                    label, this.x - textmetrics.width / 2.0,
                    this.y + SDFV.LINEHEIGHT / 4.0
                );
            }
        } else {
            // Draw square around nested SDFG.
            super.draw(
                renderer, ctx, mousepos, '--nested-sdfg-foreground-color',
                '--nested-sdfg-background-color'
            );

            if (this.attributes().sdfg &&
                this.attributes().sdfg.type !== 'SDFGShell') {
                // Draw nested graph.
                drawSDFG(renderer, ctx, this.data.graph, mousepos);
            } else {
                // Expanded, but no SDFG present or loaded yet.
                if (!too_far_away_for_text(renderer)) {
                    const errColor = this.getCssProperty(
                        renderer, '--node-missing-background-color'
                    );
                    const label = 'No SDFG loaded';
                    const textmetrics = ctx.measureText(label);
                    ctx.fillStyle = errColor;
                    ctx.fillText(
                        label, this.x - textmetrics.width / 2.0,
                        this.y + SDFV.LINEHEIGHT / 4.0
                    );
                }
            }
        }
    }

    public shade(
        renderer: SDFGRenderer, ctx: CanvasRenderingContext2D, color: string,
        alpha: number = 0.4
    ): void {
        if (this.data.node.attributes.is_collapsed) {
            // Save the current style properties.
            const orig_fill_style = ctx.fillStyle;
            const orig_alpha = ctx.globalAlpha;

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

    public set_layout(): void {
        if (this.data.node.attributes.is_collapsed) {
            const labelsize =
                this.data.node.attributes.label.length * SDFV.LINEHEIGHT * 0.8;
            const inconnsize = 2 * SDFV.LINEHEIGHT * Object.keys(
                this.data.node.attributes.in_connectors ?? []
            ).length - SDFV.LINEHEIGHT;
            const outconnsize = 2 * SDFV.LINEHEIGHT * Object.keys(
                this.data.node.attributes.out_connectors ?? []
            ).length - SDFV.LINEHEIGHT;
            const maxwidth = Math.max(labelsize, inconnsize, outconnsize);
            let maxheight = 2 * SDFV.LINEHEIGHT;
            maxheight += 4 * SDFV.LINEHEIGHT;

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

    public label(): string {
        return '';
    }

}

export class ExternalNestedSDFG extends NestedSDFG {
}

export class LibraryNode extends SDFGNode {

    private _path(ctx: CanvasRenderingContext2D): void {
        const hexseg = this.height / 6.0;
        const topleft = this.topleft();
        ctx.beginPath();
        ctx.moveTo(topleft.x, topleft.y);
        ctx.lineTo(topleft.x + this.width - hexseg, topleft.y);
        ctx.lineTo(topleft.x + this.width, topleft.y + hexseg);
        ctx.lineTo(topleft.x + this.width, topleft.y + this.height);
        ctx.lineTo(topleft.x, topleft.y + this.height);
        ctx.closePath();
    }

    private _path2(ctx: CanvasRenderingContext2D): void {
        const hexseg = this.height / 6.0;
        const topleft = this.topleft();
        ctx.beginPath();
        ctx.moveTo(topleft.x + this.width - hexseg, topleft.y);
        ctx.lineTo(topleft.x + this.width - hexseg, topleft.y + hexseg);
        ctx.lineTo(topleft.x + this.width, topleft.y + hexseg);
    }

    public draw(
        renderer: SDFGRenderer, ctx: CanvasRenderingContext2D,
        _mousepos?: Point2D
    ): void {
        ctx.fillStyle = this.getCssProperty(
            renderer, '--node-background-color'
        );
        this._path(ctx);
        ctx.fill();
        ctx.strokeStyle = this.strokeStyle(renderer);
        this._path(ctx);
        ctx.stroke();
        this._path2(ctx);
        ctx.stroke();
        ctx.fillStyle = this.getCssProperty(
            renderer, '--node-foreground-color'
        );

        // If we are far away, don't show the text
        if (too_far_away_for_text(renderer))
            return;

        const textw = ctx.measureText(this.label()).width;
        ctx.fillText(
            this.label(), this.x - textw / 2, this.y + SDFV.LINEHEIGHT / 4
        );
    }

    public shade(
        _renderer: SDFGRenderer, ctx: CanvasRenderingContext2D, color: string,
        alpha: number = 0.4
    ): void {
        // Save the current style properties.
        const orig_fill_style = ctx.fillStyle;
        const orig_alpha = ctx.globalAlpha;

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

// Checks if graph is zoomed out far (defined by SDFV.TEXT_LOD), using
// Points-per-Pixel. Used before ctx.fillText calls to only draw text when
// zoomed in close enough.
function too_far_away_for_text(
    renderer: SDFGRenderer
): boolean {
    const canvas_manager = renderer.get_canvas_manager();
    const ppp = canvas_manager?.points_per_pixel();
    if (ppp) {
        if (renderer.adaptiveHiding && ppp > SDFV.TEXT_LOD)
            return true;
        else
            return false;
    }

    return false;
}

/**
 * Batched drawing of graph edges, given a specific default color.
 *
 * Speed up edge drawing by batching together all 'standard' edges into one
 * beginPath/stroke call pair. Edges are considered to be 'standard', if they're
 * not hovered, highlighted, or selected, and do not contain a conflict
 * resultion. Any edges NOT in that category are deferred for a separate drawl
 * loop that handles them in the traditional manner. That is computationally
 * cheap because the number of these edges should always be relatively low.
 * Arrow-heads are drawn separately, but only the ones that are in frame.
 *
 * @param renderer     An SDFG renderer instance.
 * @param graph        Graph for which to draw eges.
 * @param ctx          Canvas context.
 * @param visible_rect Visible area of the graph.
 * @param mousepos     Mouse position.
 * @param color        Default edge color to use.
 */
function batchedDrawEdges(
    renderer: SDFGRenderer, graph: DagreGraph, ctx: CanvasRenderingContext2D,
    visible_rect?: SimpleRect, mousepos?: Point2D,
    color: string = '--color-default',
    labelled: boolean = false
): void {
    const deferredEdges: any[] = [];
    const arrowEdges: any[] = [];
    const labelEdges: any[] = [];
    ctx.beginPath();
    graph.edges().forEach((e: any) => {
        const edge: Edge = (graph.edge(e) as Edge);
        if (renderer.viewportOnly && visible_rect && !edge.intersect(
            visible_rect.x, visible_rect.y, visible_rect.w, visible_rect.h
        ))
            return;

        if (!(graph instanceof State)) {
            if (edge.parent_id !== null) {
                // WCR edge or dependency edge.
                if (edge.attributes().wcr || !edge.attributes().data) {
                    deferredEdges.push(edge);
                    return;
                }
            }
        }

        // Colored edge through selection/hovering/highlighting.
        if (edge.selected || edge.hovered || edge.highlighted) {
            deferredEdges.push(edge);
            return;
        } else if (edge instanceof Memlet && edge.summarized) {
            // Don't draw if Memlet is summarized
            return;
        }

        const lPoint = edge.points[edge.points.length - 1];
        if (visible_rect && lPoint.x >= visible_rect.x &&
            lPoint.x <= visible_rect.x + visible_rect.w &&
            lPoint.y >= visible_rect.y &&
            lPoint.y <= visible_rect.y + visible_rect.h)
            arrowEdges.push(edge);

        const fPoint = edge.points[0];
        if (labelled && visible_rect && fPoint.x >= visible_rect.x &&
            fPoint.x <= visible_rect.x + visible_rect.w &&
            fPoint.y >= visible_rect.y &&
            fPoint.y <= visible_rect.y + visible_rect.h)
            labelEdges.push(edge);

        edge.create_arrow_line(ctx);
    });
    ctx.setLineDash([1, 0]);
    ctx.fillStyle = ctx.strokeStyle = renderer.getCssProperty(color);
    ctx.stroke();

    // Only draw Arrowheads when close enough to see them
    const canvas_manager = renderer.get_canvas_manager();
    const ppp = canvas_manager?.points_per_pixel();
    if (!renderer.adaptiveHiding || (ppp && ppp < SDFV.ARROW_LOD)) {
        arrowEdges.forEach(e => {
            e.drawArrow(
                ctx,
                e.points[e.points.length - 2],
                e.points[e.points.length - 1],
                3
            );
        });
    }

    labelEdges.forEach(e => {
        (e as InterstateEdge).drawLabel(renderer, ctx);
    });

    deferredEdges.forEach(e => {
        e.draw(renderer, ctx, mousepos);
    });

    if (renderer.debug_draw) {
        for (const e of graph.edges()) {
            const edge: Edge = (graph.edge(e) as Edge);
            edge.debug_draw(renderer, ctx);
        }
    }
}

export function drawStateContents(
    stateGraph: DagreGraph, ctx: CanvasRenderingContext2D,
    renderer: SDFGRenderer, ppp: number, visibleRect?: SimpleRect,
    mousePos?: Point2D
): void {
    for (const nodeId of stateGraph.nodes()) {
        const node = stateGraph.node(nodeId);

        if (renderer.viewportOnly && visibleRect && !node.intersect(
            visibleRect.x, visibleRect.y, visibleRect.w, visibleRect.h
        ))
            continue;

        // Simple draw for non-collapsed NestedSDFGs
        if (node instanceof NestedSDFG &&
            !node.data.node.attributes.is_collapsed) {
            const nodeppp = Math.sqrt(node.width * node.height) / ppp;
            if (renderer.adaptiveHiding && nodeppp < SDFV.STATE_LOD) {
                node.simple_draw(renderer, ctx, mousePos);
                node.debug_draw(renderer, ctx);
                continue;
            }
        } else {
            // Simple draw node
            if (renderer.adaptiveHiding && ppp > SDFV.NODE_LOD) {
                node.simple_draw(renderer, ctx, mousePos);
                node.debug_draw(renderer, ctx);
                continue;
            }
        }

        node.draw(renderer, ctx, mousePos);
        node.debug_draw(renderer, ctx);

        // Only draw connectors when close enough to see them
        if (!renderer.adaptiveHiding || ppp < SDFV.CONNECTOR_LOD) {
            node.in_connectors.forEach((c: Connector) => {
                // Only draw connectors if actually visible. This is needed for
                // large nodes in the background like NestedSDFGs, that are
                // visible, but their connectors are actually not.
                if (visibleRect && !c.intersect(
                    visibleRect.x, visibleRect.y,
                    visibleRect.w, visibleRect.h
                ))
                    return;

                let edge: Edge | null = null;
                stateGraph.inEdges(nodeId)?.forEach((e) => {
                    const eobj = stateGraph.edge(e);
                    if (eobj.dst_connector === c.data.name)
                        edge = eobj as any;
                });

                c.draw(renderer, ctx, mousePos, edge);
                c.debug_draw(renderer, ctx);
            });
            node.out_connectors.forEach((c: Connector) => {
                if (visibleRect && !c.intersect(
                    visibleRect.x, visibleRect.y,
                    visibleRect.w, visibleRect.h
                ))
                    return;

                let edge: Edge | null = null;
                stateGraph.outEdges(nodeId)?.forEach((e) => {
                    const eobj = stateGraph.edge(e);
                    if (eobj.src_connector === c.data.name)
                        edge = eobj as any;
                });

                c.draw(renderer, ctx, mousePos, edge);
                c.debug_draw(renderer, ctx);
            });
        }
    }

    if (renderer.adaptiveHiding && ppp > SDFV.EDGE_LOD)
        return;

    batchedDrawEdges(
        renderer, stateGraph, ctx, visibleRect, mousePos, '--color-default',
        false
    );
}

export function drawStateMachine(
    stateMachineGraph: DagreGraph, ctx: CanvasRenderingContext2D,
    renderer: SDFGRenderer, ppp: number, visibleRect?: SimpleRect,
    mousePos?: Point2D
): void {
    if (!renderer.adaptiveHiding || ppp < SDFV.EDGE_LOD) {
        batchedDrawEdges(
            renderer, stateMachineGraph, ctx, visibleRect, mousePos,
            '--interstate-edge-color',
            SDFVSettings.get<boolean>('alwaysOnISEdgeLabels')
        );
    }

    for (const nodeId of stateMachineGraph.nodes()) {
        const block = stateMachineGraph.node(nodeId);

        // Skip invisible states.
        if (renderer.viewportOnly && visibleRect && !block.intersect(
            visibleRect.x, visibleRect.y, visibleRect.w, visibleRect.h
        ))
            continue;

        const blockppp = Math.sqrt(block.width * block.height) / ppp;
        if (renderer.adaptiveHiding && blockppp < SDFV.STATE_LOD) {
            block.simple_draw(renderer, ctx, mousePos);
            block.debug_draw(renderer, ctx);
            continue;
        }

        block.draw(renderer, ctx, mousePos);
        block.debug_draw(renderer, ctx);

        const ng = block.data.graph;
        if (!block.attributes().is_collapsed && ng) {
            if (block instanceof State) {
                drawStateContents(
                    ng, ctx, renderer, ppp, visibleRect, mousePos
                );
            } else {
                drawStateMachine(
                    ng, ctx, renderer, ppp, visibleRect, mousePos
                );
            }
        }
    }
}

// Draw an entire SDFG.
export function drawSDFG(
    renderer: SDFGRenderer, ctx: CanvasRenderingContext2D, g: DagreGraph,
    mousePos?: Point2D
): void {
    const cManager = renderer.get_canvas_manager();
    if (!cManager)
        return;
    const ppp = cManager.points_per_pixel();
    const visibleRect = renderer.get_visible_rect() ?? undefined;

    drawStateMachine(g, ctx, renderer, ppp, visibleRect, mousePos);
}

// Translate an SDFG by a given offset
export function offset_sdfg(
    sdfg: JsonSDFG, sdfg_graph: DagreGraph, offset: Point2D
): void {
    sdfg.nodes.forEach((state: JsonSDFGBlock, id: number) => {
        const g = sdfg_graph.node(id.toString());
        g.x += offset.x;
        g.y += offset.y;
        if (!state.attributes.is_collapsed) {
            if (state.type === SDFGElementType.SDFGState)
                offset_state(state as JsonSDFGState, g, offset);
            else
                offset_sdfg(state as any, g.data.graph, offset);
        }
    });
    sdfg.edges.forEach((e: JsonSDFGEdge, _eid: number) => {
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
export function offset_state(
    state: JsonSDFGState, state_graph: State, offset: Point2D
): void {
    const drawn_nodes: Set<string> = new Set();

    state.nodes.forEach((_n: JsonSDFGNode, nid: number) => {
        const node = state_graph.data.graph.node(nid);
        if (!node)
            return;
        drawn_nodes.add(nid.toString());

        node.x += offset.x;
        node.y += offset.y;
        node.in_connectors.forEach((c: Connector) => {
            c.x += offset.x;
            c.y += offset.y;
        });
        node.out_connectors.forEach((c: Connector) => {
            c.x += offset.x;
            c.y += offset.y;
        });

        if (node.data.node.type === SDFGElementType.NestedSDFG &&
            node.data.node.attributes.sdfg) {
            offset_sdfg(
                node.data.node.attributes.sdfg, node.data.graph, offset
            );
        }
    });
    state.edges.forEach((e: JsonSDFGEdge, eid: number) => {
        const ne = check_and_redirect_edge(e, drawn_nodes, state);
        if (!ne)
            return;
        e = ne;
        const edge = state_graph.data.graph.edge(e.src, e.dst, eid);
        if (!edge)
            return;
        edge.x += offset.x;
        edge.y += offset.y;
        edge.points.forEach((p: Point2D) => {
            p.x += offset.x;
            p.y += offset.y;
        });
    });
}


///////////////////////////////////////////////////////

enum TextVAlign {
    TOP,
    MIDDLE,
    BOTTOM,
}

enum TextHAlign {
    LEFT,
    CENTER,
    RIGHT,
}

type AdaptiveTextPadding = {
    left?: number,
    top?: number,
    right?: number,
    bottom?: number,
};

export function drawAdaptiveText(
    ctx: CanvasRenderingContext2D, renderer: SDFGRenderer, far_text: string,
    close_text: string, x: number, y: number, w: number, h: number,
    ppp_thres: number,
    max_font_size: number = SDFV.DEFAULT_MAX_FONTSIZE,
    close_font_multiplier: number = 1.0,
    far_font_multiplier: number = SDFV.DEFAULT_FAR_FONT_MULTIPLIER,
    bold: boolean = false,
    valign: TextVAlign = TextVAlign.MIDDLE,
    halign: TextHAlign = TextHAlign.CENTER,
    padding: AdaptiveTextPadding = {}
): void {
    // Save font.
    const oldfont = ctx.font;

    const ppp = renderer.get_canvas_manager()?.points_per_pixel();
    if (ppp === undefined)
        return;

    const is_far: boolean = renderer.adaptiveHiding && ppp > ppp_thres;
    const label = is_far ? far_text : close_text;

    let font_size = Math.min(
        SDFV.DEFAULT_CANVAS_FONTSIZE * close_font_multiplier, max_font_size
    );
    if (is_far)
        font_size = Math.min(ppp * far_font_multiplier, max_font_size);
    ctx.font = font_size + 'px sans-serif';

    const label_metrics = ctx.measureText(label);

    let label_width = Math.abs(label_metrics.actualBoundingBoxLeft) +
        Math.abs(label_metrics.actualBoundingBoxRight);
    let label_height = Math.abs(label_metrics.actualBoundingBoxDescent) +
        Math.abs(label_metrics.actualBoundingBoxAscent);
    if (label_width !== label_width)
        label_width = label_metrics.width;
    if (label_height !== label_height)
        label_height = (label_metrics as any).height;  // Account for canvas2pdf

    const padding_left = padding.left !== undefined ? padding.left : 1.0;
    const padding_top = padding.top !== undefined ? padding.top : 0.0;
    const padding_right = padding.right !== undefined ? padding.right : 1.0;
    const padding_bottom = padding.bottom !== undefined ? padding.bottom : 4.0;

    // Ensure text is not resized beyond the bounds of the box
    if (is_far && label_width > w) {
        const old_font_size = font_size;
        font_size = font_size / (label_width / w);
        label_width /= (label_width / w);
        label_height /= (old_font_size / font_size);
        ctx.font = font_size + 'px sans-serif';
    }

    let text_center_x;
    let text_center_y;
    switch (valign) {
        case TextVAlign.TOP:
            text_center_y = y - (h / 2.0) + (label_height + padding_top);
            break;
        case TextVAlign.BOTTOM:
            text_center_y = y + (h / 2.0) - padding_bottom;
            break;
        case TextVAlign.MIDDLE:
        default:
            text_center_y = y + (label_height / 2.0);
            break;
    }
    switch (halign) {
        case TextHAlign.LEFT:
            text_center_x = (x - (w / 2.0)) + padding_left;
            break;
        case TextHAlign.RIGHT:
            text_center_x = (x + (w / 2.0)) - (label_width + padding_right);
            break;
        case TextHAlign.CENTER:
        default:
            text_center_x = x - (label_width / 2.0);
            break;
    }

    if (bold)
        ctx.font = 'bold ' + ctx.font;

    ctx.fillText(label, text_center_x, text_center_y);

    // Restore previous font.
    ctx.font = oldfont;
}

export function drawHexagon(
    ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number,
    _offset: Point2D
): void {
    const topleft = { x: x - w / 2.0, y: y - h / 2.0 };
    const hexseg = h / 3.0;
    ctx.beginPath();
    ctx.moveTo(topleft.x, y);
    ctx.lineTo(topleft.x + hexseg, topleft.y);
    ctx.lineTo(topleft.x + w - hexseg, topleft.y);
    ctx.lineTo(topleft.x + w, y);
    ctx.lineTo(topleft.x + w - hexseg, topleft.y + h);
    ctx.lineTo(topleft.x + hexseg, topleft.y + h);
    ctx.lineTo(topleft.x, y);
    ctx.closePath();
}

export function drawOctagon(
    ctx: CanvasRenderingContext2D, topleft: Point2D, width: number,
    height: number
): void {
    const octseg = height / 3.0;
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

export function drawEllipse(
    ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number
): void {
    ctx.ellipse(x+w/2, y+h/2, w/2, h/2, 0, 0, 2 * Math.PI);
}

export function drawTrapezoid(
    ctx: CanvasRenderingContext2D, topleft: Point2D, node: SDFGNode,
    inverted: boolean = false
): void {
    ctx.beginPath();
    if (inverted) {
        ctx.moveTo(topleft.x, topleft.y);
        ctx.lineTo(topleft.x + node.width, topleft.y);
        ctx.lineTo(
            topleft.x + node.width - node.height, topleft.y + node.height
        );
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

// Returns the distance from point p to line defined by two points
// (line1, line2)
export function ptLineDistance(
    p: Point2D, line1: Point2D, line2: Point2D
): number {
    const dx = (line2.x - line1.x);
    const dy = (line2.y - line1.y);
    const res = dy * p.x - dx * p.y + line2.x * line1.y - line2.y * line1.x;

    return Math.abs(res) / Math.sqrt(dy * dy + dx * dx);
}

export const SDFGElements: { [name: string]: typeof SDFGElement } = {
    SDFGElement,
    SDFG,
    SDFGShell,
    SDFGNode,
    InterstateEdge,
    Memlet,
    Connector,
    AccessNode,
    ScopeNode,
    EntryNode,
    ExitNode,
    MapEntry,
    MapExit,
    ConsumeEntry,
    ConsumeExit,
    Tasklet,
    Reduce,
    PipelineEntry,
    PipelineExit,
    NestedSDFG,
    ExternalNestedSDFG,
    LibraryNode,
    ControlFlowBlock,
    BasicBlock,
    State,
    BreakState,
    ContinueState,
    ControlFlowRegion,
    LoopRegion,
};
