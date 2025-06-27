// Copyright 2019-2025 ETH Zurich and the DaCe authors. All rights reserved.

import { editor } from 'monaco-editor';
import { SDFV } from '../../sdfv';
import {
    DataSubset,
    JsonSDFG,
    JsonSDFGBlock,
    JsonSDFGCodeBlock,
    JsonSDFGControlFlowRegion,
    JsonSDFGDataDesc,
    JsonSDFGElement,
    JsonSDFGNode,
    JsonSDFGState,
    Point2D,
    SimpleRect,
} from '../../types';
import {
    bytesToString,
    memletToHtml,
    sdfgConsumeElemToString,
    sdfgPropertyToString,
    sdfgRangeElemToString,
} from '../../utils/sdfg/display';
import { SDFVColorThemeColor, SDFVSettings } from '../../utils/sdfv_settings';
import { Renderable } from '../core/common/renderable';
import type { DagreGraph, SDFGRenderer } from './sdfg_renderer';
import { ptLineDistance } from '../core/common/renderer_utils';
import {
    drawAdaptiveText,
    drawEllipse,
    drawHexagon,
    drawOctagon,
    drawTrapezoid,
    TextHAlign,
    TextVAlign,
} from '../core/html_canvas/html_canvas_utils';


interface ElemDrawingOptions {
    colorBG?: SDFVColorThemeColor,
    colorFG?: SDFVColorThemeColor,
    colorText?: SDFVColorThemeColor,
    overrideTooFarForText?: boolean,
    topMargin?: number,
    label?: boolean,
    expandPlus?: boolean,
    summary?: boolean,
}

export enum SDFGElementType {
    Edge = 'Edge',
    MultiConnectorEdge = 'MultiConnectorEdge',

    ControlFlowBlock = 'ControlFlowBlock',
    ContinueBlock = 'ContinueBlock',
    BreakBlock = 'BreakBlock',
    ReturnBlock = 'ReturnBlock',
    ConditionalBlock = 'ConditionalBlock',
    SDFGState = 'SDFGState',

    ControlFlowRegion = 'ControlFlowRegion',
    LoopRegion = 'LoopRegion',
    BranchRegion = 'BranchRegion',
    NamedRegion = 'NamedRegion',
    FunctionCallRegion = 'FunctionCallRegion',
    UnstructuredControlFlow = 'UnstructuredControlFlow',

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
}

function drawSummarySymbol(
    ctx: CanvasRenderingContext2D,
    minConnectorX: number, maxConnectorX: number,
    horizontalLineLevel: number, drawArrowsAboveLine: boolean
): void {
    // Draw left arrow
    const middleOfLine = (minConnectorX + maxConnectorX) / 2;
    const lArrowX = middleOfLine - 10;
    const rArrowX = middleOfLine + 10;
    let arrowStartY = horizontalLineLevel + 2;
    let arrowEndY = horizontalLineLevel + 8;
    if (drawArrowsAboveLine) {
        arrowStartY = horizontalLineLevel - 10;
        arrowEndY = horizontalLineLevel - 4;
    }
    const dotHeight = (arrowStartY + arrowEndY) / 2;

    // Arrow line left
    ctx.beginPath();
    ctx.moveTo(lArrowX, arrowStartY);
    ctx.lineTo(lArrowX, arrowEndY);
    // Arrow line right
    ctx.moveTo(rArrowX, arrowStartY);
    ctx.lineTo(rArrowX, arrowEndY);
    // 3 dots
    ctx.moveTo(middleOfLine - 5, dotHeight);
    ctx.lineTo(middleOfLine - 4, dotHeight);
    ctx.moveTo(middleOfLine - 0.5, dotHeight);
    ctx.lineTo(middleOfLine + 0.5, dotHeight);
    ctx.moveTo(middleOfLine + 4, dotHeight);
    ctx.lineTo(middleOfLine + 5, dotHeight);
    ctx.closePath();
    ctx.stroke();

    // Arrow heads
    ctx.beginPath();
    ctx.moveTo(lArrowX, arrowEndY + 2);
    ctx.lineTo(lArrowX - 2, arrowEndY);
    ctx.lineTo(lArrowX + 2, arrowEndY);
    ctx.lineTo(lArrowX, arrowEndY + 2);
    ctx.closePath();
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(rArrowX, arrowEndY + 2);
    ctx.lineTo(rArrowX - 2, arrowEndY);
    ctx.lineTo(rArrowX + 2, arrowEndY);
    ctx.lineTo(rArrowX, arrowEndY + 2);
    ctx.closePath();
    ctx.fill();
}

export class SDFGElement extends Renderable {

    public readonly COLLAPSIBLE: boolean = false;

    public inConnectors: Connector[] = [];
    public outConnectors: Connector[] = [];

    // Used to draw edge summary instead of all edges separately.
    // Helps with rendering performance when too many edges would be drawn on
    // the screen. These two fields get set in the layouter, depending on the
    // number of in/out_connectors of a node. They also get toggled in the
    // mousehandler when the hover status changes. Currently only used for
    // NestedSDFGs and ScopeNodes.
    public summarizeInEdges: boolean = false;
    public summarizeOutEdges: boolean = false;
    // Used in draw_edge_summary to decide if edge summary is applicable. Set
    // in the layouter only for NestedSDFGs and ScopeNodes. This prevents the
    // summary to get toggled on by the mousehandler when it is not applicable.
    public inSummaryHasEffect: boolean = false;
    public outSummaryHasEffect: boolean = false;

    public constructor(
        data: Record<string, unknown> | undefined,
        id: number,
        public sdfg: JsonSDFG,
        public cfg?: JsonSDFGControlFlowRegion,
        public parentStateId?: number,
        public parentElem?: SDFGElement
    ) {
        super(id, data);
    }

    protected get defaultColorBG(): string {
        return SDFVSettings.get<string>('stateBackgroundColor');
    }

    protected get defaultColorText(): string {
        return SDFVSettings.get<string>('defaultTextColor');
    }

    protected get defaultColorFG(): string {
        return SDFVSettings.get<string>('stateForegroundColor');
    }

    public get jsonData(): JsonSDFGElement | undefined {
        return this.data as JsonSDFGElement | undefined;
    }

    public get graph(): DagreGraph | undefined {
        return this.data?.graph as DagreGraph | undefined;
    }

    public attributes(): Record<string, unknown> | undefined {
        return this.jsonData?.attributes;
    }

    public get type(): string {
        return this.jsonData?.type ?? '';
    }

    public get label(): string {
        return (this.jsonData?.label as string | undefined) ?? '';
    }

    public get guid(): string {
        const attrs = this.attributes();
        if (attrs?.guid)
            return attrs.guid as string;
        // If GUID does not exist, fall back to element ID
        return (this.cfg?.cfg_list_id ?? 0).toString() + '/' + (
            this.parentStateId ?? -1).toString() + '/' + this.id.toString();
    }

    protected _drawLabel(
        renderer: SDFGRenderer, ctx: CanvasRenderingContext2D,
        mousepos?: Point2D, colorOverrideText?: SDFVColorThemeColor,
        overrideTopMargin?: number,
        overrideTooFarForText: boolean = false
    ): void {
        const topleft = this.topleft();
        if (overrideTooFarForText || !tooFarForText(renderer)) {
            ctx.fillStyle = colorOverrideText ?
                SDFVSettings.get<string>(colorOverrideText) :
                this.defaultColorText;
            ctx.fillText(
                this.label, topleft.x + SDFV.LABEL_MARGIN_H,
                topleft.y + SDFV.LINEHEIGHT + (
                    overrideTopMargin ?? SDFV.LABEL_MARGIN_V
                )
            );
        }
    }

    protected _drawExpandPlus(
        ctx: CanvasRenderingContext2D, contentBox?: SimpleRect
    ): void {
        ctx.strokeStyle = this.defaultColorFG;
        const centerX = contentBox ?
            contentBox.x + contentBox.w / 2 : this.x + this.width / 2;
        const centerY = contentBox ?
            contentBox.y + contentBox.h / 2 : this.y + this.height / 2;
        ctx.beginPath();
        ctx.moveTo(centerX, centerY - SDFV.LINEHEIGHT);
        ctx.lineTo(centerX, centerY + SDFV.LINEHEIGHT);
        ctx.moveTo(centerX - SDFV.LINEHEIGHT, centerY);
        ctx.lineTo(centerX + SDFV.LINEHEIGHT, centerY);
        ctx.stroke();
    }

    protected _internalDraw(
        renderer: SDFGRenderer, ctx: CanvasRenderingContext2D,
        mousepos?: Point2D, options?: ElemDrawingOptions
    ): void {
        ctx.fillStyle = options?.colorBG ?
            SDFVSettings.get<string>(options.colorBG) : this.defaultColorBG;

        // If selected or hovered.
        const ppp = renderer.canvasManager.pointsPerPixel;
        ctx.strokeStyle = this.strokeStyle(renderer);
        let stroke = false;
        if (!renderer.adaptiveHiding ||
            (ppp && ppp < SDFVSettings.get<number>('nodeLOD')))
            stroke = this.selected || this.highlighted || this.hovered;

        this._drawShape(renderer, ctx, true, stroke);

        if (SDFVSettings.get<boolean>('showStateNames') &&
            options?.label !== false) {
            this._drawLabel(
                renderer, ctx, mousepos, options?.colorText, options?.topMargin,
                false
            );
        }

        // If collapsed, draw a "+" sign in the middle and add summary
        // information.
        if (this.COLLAPSIBLE && this.attributes()?.is_collapsed) {
            if (options?.expandPlus)
                this._drawExpandPlus(ctx);
            if (options?.summary) {
                this.drawSummaryInfo(
                    renderer, ctx, mousepos,
                    options.overrideTooFarForText ?? false
                );
            }
        }
    }

    public draw(
        renderer: SDFGRenderer, ctx: CanvasRenderingContext2D,
        mousepos?: Point2D
    ): void {
        this._internalDraw(renderer, ctx, mousepos);
    }

    public simpleDraw(
        renderer: SDFGRenderer, ctx: CanvasRenderingContext2D,
        _mousePos?: Point2D
    ): void {
        ctx.fillStyle = this.defaultColorBG;
        ctx.strokeStyle = this.strokeStyle(renderer);
        this._drawShape(renderer, ctx, true, false);
    }

    protected _drawShape(
        renderer: SDFGRenderer, ctx: CanvasRenderingContext2D,
        fill: boolean = true, stroke: boolean = true
    ): void {
        const clamped = this.getViewClampedBoundingBox(renderer);
        if (fill)
            ctx.fillRect(clamped.x, clamped.y, clamped.w, clamped.h);
        if (stroke)
            ctx.strokeRect(clamped.x, clamped.y, clamped.w, clamped.h);
    }

    public shade(
        renderer: SDFGRenderer, ctx: CanvasRenderingContext2D, color: string,
        alpha: number = 0.4
    ): void {
        const origAlpha = ctx.globalAlpha;
        const origFillStyle = ctx.fillStyle;
        ctx.fillStyle = color;
        ctx.globalAlpha = alpha;
        this._drawShape(renderer, ctx, true, false);
        ctx.globalAlpha = origAlpha;
        ctx.fillStyle = origFillStyle;
    }

    public drawSummaryInfo(
        renderer: SDFGRenderer, ctx: CanvasRenderingContext2D,
        mousepos?: Point2D,
        overrideTooFarForText: boolean = false
    ): void {
        const topleft = this.topleft();
        if (!tooFarForText(renderer) || overrideTooFarForText) {
            if (this.attributes()?.maxFootprintBytes !== undefined) {
                const oldFont = ctx.font;
                const fontSize = SDFV.DEFAULT_CANVAS_FONTSIZE * 0.8;
                ctx.font = fontSize.toString() + 'px sans-serif';
                const footprintText = bytesToString(
                    this.attributes()!.maxFootprintBytes as number, true, 2
                );
                const measurements = ctx.measureText(footprintText);
                const txtY = (
                    (topleft.y + this.height +
                        measurements.fontBoundingBoxAscent) -
                        (SDFV.LINEHEIGHT + SDFV.LABEL_MARGIN_V)
                );
                const txtX = (
                    (topleft.x + this.width) -
                    (measurements.width + SDFV.LABEL_MARGIN_H)
                );
                ctx.fillStyle = this.defaultColorText;
                ctx.fillText(footprintText, txtX, txtY);
                ctx.font = oldFont;
            }
        }
    }

    public drawEdgeSummary(
        renderer: SDFGRenderer, ctx: CanvasRenderingContext2D
    ): void {
        // Only draw if close enough
        const ppp = renderer.canvasManager.pointsPerPixel;
        if (!renderer.adaptiveHiding ||
            (ppp && ppp < SDFVSettings.get<number>('edgeLOD'))) {
            const topleft = this.topleft();
            ctx.strokeStyle = this.strokeStyle(renderer);
            ctx.fillStyle = ctx.strokeStyle;

            if (this.summarizeInEdges && this.inSummaryHasEffect) {
                // Find the left most and right most connector coordinates
                if (this.inConnectors.length > 0) {
                    let minConnectorX = Number.MAX_SAFE_INTEGER;
                    let maxConnectorX = Number.MIN_SAFE_INTEGER;
                    this.inConnectors.forEach(c => {
                        if (c.x < minConnectorX)
                            minConnectorX = c.x;
                        if (c.x > maxConnectorX)
                            maxConnectorX = c.x;
                    });

                    let drawInSummarySymbol = true;
                    const parGraph =
                        this.parentElem?.data?.graph as DagreGraph | undefined;
                    const preds = parGraph?.predecessors(
                        this.id.toString()
                    ) ?? [];
                    if (preds.length === 1) {
                        const predElem = parGraph!.node(preds[0].id.toString());
                        if (predElem?.summarizeOutEdges &&
                            predElem.outSummaryHasEffect) {
                            // If the previous element has its outgoing edges
                            // summarized, draw the sumary symbol halfway in
                            // between them. This is handled by the predecessor.
                            // noop.
                            drawInSummarySymbol = false;
                        }
                    }

                    if (drawInSummarySymbol) {
                        // Draw the summary symbol above the node
                        drawSummarySymbol(
                            ctx, minConnectorX, maxConnectorX,
                            topleft.y - 8, true
                        );
                    }
                }
            }
            if (this.summarizeOutEdges && this.outSummaryHasEffect) {
                // Find the left most and right most connector coordinates
                if (this.outConnectors.length > 0) {
                    let minConnectorX = Number.MAX_SAFE_INTEGER;
                    let maxConnectorX = Number.MIN_SAFE_INTEGER;
                    this.outConnectors.forEach((c: Connector) => {
                        if (c.x < minConnectorX)
                            minConnectorX = c.x;
                        if (c.x > maxConnectorX)
                            maxConnectorX = c.x;
                    });

                    let drawOutSummarySymbol = true;
                    const parGraph =
                        this.parentElem?.data?.graph as DagreGraph | undefined;
                    const succs = parGraph?.successors(
                        this.id.toString()
                    ) ?? [];
                    if (succs.length === 1) {
                        const succElem = parGraph!.node(succs[0].id.toString());
                        if (succElem?.summarizeInEdges &&
                            succElem.inSummaryHasEffect) {
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
                            drawSummarySymbol(
                                ctx, minX, maxX, linePosY, false
                            );
                            drawOutSummarySymbol = false;
                        }
                    }

                    if (drawOutSummarySymbol) {
                        // Draw the summary symbol below the node
                        drawSummarySymbol(
                            ctx, minConnectorX, maxConnectorX,
                            topleft.y + this.height + 8, false
                        );
                    }
                }
            }
        }
    }

    protected getViewClampedBoundingBox(renderer: SDFGRenderer): SimpleRect {
        const topleft = this.topleft();
        let clamped = {
            x: Math.max(topleft.x, renderer.viewport.x),
            y: Math.max(topleft.y, renderer.viewport.y),
            x2: Math.min(
                topleft.x + this.width,
                renderer.viewport.x + renderer.viewport.w
            ),
            y2: Math.min(
                topleft.y + this.height,
                renderer.viewport.y + renderer.viewport.h
            ),
            w: 0,
            h: 0,
        };

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
        return {
            x: clamped.x,
            y: clamped.y,
            w: clamped.w,
            h: clamped.h,
        };
    }

    protected isBorderVisible(renderer: SDFGRenderer): boolean {
        const clamped = this.getViewClampedBoundingBox(renderer);
        return clamped.x === this.x || clamped.y === this.y ||
            clamped.x + clamped.w === this.x + this.width ||
            clamped.y + clamped.h === this.y + this.height;
    }

}

export class SDFG extends SDFGElement {

    public sdfgDagreGraph?: DagreGraph;

    public constructor(sdfg: JsonSDFG) {
        super(sdfg, -1, sdfg);
    }

    public get label(): string {
        return (this.attributes()?.name as string | undefined) ?? '';
    }

}

export class SDFGShell extends SDFG {}

export class ControlFlowBlock extends SDFGElement {

    public readonly COLLAPSIBLE: boolean = true;

    public static get BLOCK_MARGIN(): number {
        return 3 * SDFV.LINEHEIGHT;
    }

    public get jsonData(): JsonSDFGBlock | undefined {
        return this.data?.block as JsonSDFGBlock | undefined;
    }

    public get type(): string {
        return this.jsonData?.type ?? SDFGElementType.ControlFlowBlock;
    }

}

export class ControlFlowRegion extends ControlFlowBlock {

    protected get defaultColorBG(): string {
        return SDFVSettings.get<string>('controlFlowRegionColor');
    }

    public get jsonData(): JsonSDFGControlFlowRegion | undefined {
        return super.jsonData as JsonSDFGControlFlowRegion | undefined;
    }

}

export class State extends ControlFlowBlock {

    public get jsonData(): JsonSDFGState | undefined {
        return this.data?.state as JsonSDFGState | undefined;
    }

    public get type(): string {
        return this.jsonData?.type ?? SDFGElementType.SDFGState;
    }

}

export class BreakBlock extends ControlFlowBlock {

    public readonly COLLAPSIBLE: boolean = false;

    protected get defaultColorBG(): string {
        return SDFVSettings.get<string>('breakBlockColor');
    }

}

export class ContinueBlock extends ControlFlowBlock {

    public readonly COLLAPSIBLE: boolean = false;

    protected get defaultColorBG(): string {
        return SDFVSettings.get<string>('continueBlockColor');
    }

}

export class ReturnBlock extends ControlFlowBlock {

    public readonly COLLAPSED: boolean = false;

    protected get defaultColorBG(): string {
        return SDFVSettings.get<string>('returnBlockColor');
    }

}

export class ConditionalBlock extends ControlFlowBlock {

    protected get defaultColorBG(): string {
        return SDFVSettings.get<string>('conditionalColor');
    }

    public static get CONDITION_SPACING(): number {
        return 4 * SDFV.LINEHEIGHT;
    }

    public branches: [JsonSDFGCodeBlock | null, ControlFlowRegion][] = [];

    protected _internalDraw(
        renderer: SDFGRenderer, ctx: CanvasRenderingContext2D,
        mousepos?: Point2D, options?: ElemDrawingOptions
    ): void {
        const withLabel = options?.label === true || (
            SDFVSettings.get<boolean>('showStateNames') &&
            !tooFarForText(renderer)
        );
        const nOptions: ElemDrawingOptions = {};
        Object.assign(nOptions, options);
        nOptions.label = withLabel;

        super._internalDraw(renderer, ctx, mousepos, nOptions);

        if (!tooFarForText(renderer)) {
            const topleft = this.topleft();
            ctx.fillStyle = this.defaultColorText;
            const labelHeight = 1.5 * SDFV.LINEHEIGHT;
            ctx.beginPath();
            ctx.moveTo(topleft.x, topleft.y + labelHeight);
            ctx.lineTo(topleft.x + this.width, topleft.y + labelHeight);
            ctx.stroke();

            const oldFont = ctx.font;
            ctx.font = 'bold ' + oldFont;

            let nextX = topleft.x;
            const nextY = topleft.y + labelHeight;
            const condHeight = ConditionalBlock.CONDITION_SPACING - labelHeight;
            for (const [condition, region] of this.branches) {
                ctx.beginPath();
                ctx.moveTo(nextX, nextY);
                ctx.lineTo(nextX, nextY + condHeight);
                ctx.stroke();

                const condTextY = nextY + condHeight / 2 + SDFV.LINEHEIGHT / 4;
                const condText = condition?.string_data ?
                    'if ' + condition.string_data : 'else';
                const condTextMetrics = ctx.measureText(condText);
                const initTextX = (
                    nextX + region.width / 2 - condTextMetrics.width / 2
                );
                ctx.fillText(condText, initTextX, condTextY);

                nextX = nextX + region.width;
            }

            ctx.font = oldFont;
        }
    }

    public textForFind(): string {
        let searchText = super.textForFind();
        for (const branch of this.branches) {
            if (branch[0])
                searchText += ' ' + (branch[0].string_data ?? '');
        }
        return searchText;
    }

}

export class LoopRegion extends ControlFlowRegion {

    protected get defaultColorBG(): string {
        return SDFVSettings.get<string>('loopColor');
    }

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

    protected _internalDraw(
        renderer: SDFGRenderer, ctx: CanvasRenderingContext2D,
        mousepos?: Point2D, options?: ElemDrawingOptions
    ): void {
        super._internalDraw(renderer, ctx, mousepos, {
            label: false,
            expandPlus: false,
        });

        const oldFont = ctx.font;
        const topleft = this.topleft();
        let topSpacing = options?.topMargin ?? SDFV.LABEL_MARGIN_V;
        let remainingHeight = this.height;
        ctx.fillStyle = this.defaultColorText;
        ctx.strokeStyle = this.defaultColorFG;

        // Draw the init statement if there is one.
        const initStatement =
            this.attributes()?.init_statement as JsonSDFGCodeBlock | undefined;
        if (initStatement?.string_data) {
            topSpacing += LoopRegion.INIT_SPACING;
            const initBottomLineY = topleft.y + LoopRegion.INIT_SPACING;
            ctx.beginPath();
            ctx.moveTo(topleft.x, initBottomLineY);
            ctx.lineTo(topleft.x + this.width, initBottomLineY);
            ctx.stroke();

            if (!tooFarForText(renderer)) {
                ctx.font = LoopRegion.LOOP_STATEMENT_FONT;
                const initTextY = (
                    (topleft.y + (LoopRegion.INIT_SPACING / 2)) +
                    (SDFV.LINEHEIGHT / 2)
                );
                const initTextMetrics = ctx.measureText(
                    initStatement.string_data
                );
                const initTextX = this.x - (initTextMetrics.width / 2);
                ctx.fillText(initStatement.string_data, initTextX, initTextY);

                ctx.font = oldFont;
                ctx.fillText(
                    'init', topleft.x + SDFV.LABEL_MARGIN_H, initTextY
                );
            }
        }

        // Draw the condition (either on top if the loop is a regularly
        // structured loop, or on the bottom if the loop is an inverted
        // (do-while-style) loop). If the condition is drawn on top, make sure
        // the init statement spacing is respected if there is one.
        let condTopY = topleft.y;
        let condLineY = condTopY + LoopRegion.CONDITION_SPACING;
        if (this.attributes()?.inverted) {
            condTopY = topleft.y +
                (this.height - LoopRegion.CONDITION_SPACING);
            condLineY = condTopY - LoopRegion.CONDITION_SPACING;
        } else if (initStatement?.string_data) {
            condTopY += LoopRegion.INIT_SPACING;
            condLineY = condTopY + LoopRegion.CONDITION_SPACING;
        }
        topSpacing += LoopRegion.CONDITION_SPACING;
        ctx.beginPath();
        ctx.moveTo(topleft.x, condLineY);
        ctx.lineTo(topleft.x + this.width, condLineY);
        ctx.stroke();


        if (!tooFarForText(renderer)) {
            ctx.font = LoopRegion.LOOP_STATEMENT_FONT;
            const condStatement = this.attributes()?.loop_condition as
                JsonSDFGCodeBlock | undefined;
            const condTextY = (
                (condTopY + (LoopRegion.CONDITION_SPACING / 2)) +
                (SDFV.LINEHEIGHT / 2)
            );
            if (condStatement?.string_data) {
                const condTextMetrics = ctx.measureText(
                    condStatement.string_data
                );
                const condTextX = this.x - (condTextMetrics.width / 2);
                ctx.fillText(condStatement.string_data, condTextX, condTextY);
                ctx.font = oldFont;
                ctx.fillText(
                    'while', topleft.x + SDFV.LABEL_MARGIN_H, condTextY
                );
            }
        }

        // Draw the update statement if there is one.
        const updateStatement = this.attributes()?.update_statement as
            JsonSDFGCodeBlock | undefined;
        if (updateStatement?.string_data) {
            remainingHeight -= LoopRegion.UPDATE_SPACING;
            const updateTopY = topleft.y + (
                this.height - LoopRegion.UPDATE_SPACING
            );
            ctx.beginPath();
            ctx.moveTo(topleft.x, updateTopY);
            ctx.lineTo(topleft.x + this.width, updateTopY);
            ctx.stroke();


            if (!tooFarForText(renderer)) {
                ctx.font = LoopRegion.LOOP_STATEMENT_FONT;
                const updateTextY = (
                    (updateTopY + (LoopRegion.UPDATE_SPACING / 2)) +
                    (SDFV.LINEHEIGHT / 2)
                );
                const updateTextMetrics = ctx.measureText(
                    updateStatement.string_data
                );
                const updateTextX = this.x - (updateTextMetrics.width / 2);
                ctx.fillText(
                    updateStatement.string_data, updateTextX, updateTextY
                );
                ctx.font = oldFont;
                ctx.fillText(
                    'update', topleft.x + SDFV.LABEL_MARGIN_H,
                    updateTextY
                );
            }
        }
        remainingHeight -= topSpacing;
        const contentBox = {
            x: topleft.x,
            y: topleft.y + topSpacing,
            w: this.width,
            h: remainingHeight,
        };
        this._drawExpandPlus(ctx, contentBox);
        this._drawLabel(renderer, ctx, mousepos, undefined, topSpacing);
    }

    public textForFind(): string {
        let searchText = super.textForFind();
        const attr = this.attributes();
        if (attr?.loop_variable)
            searchText += ' ' + (attr.loop_variable as string);
        const initCode = attr?.init_statement as JsonSDFGCodeBlock | undefined;
        if (initCode?.string_data)
            searchText += ' ' + initCode.string_data;
        const updCode = attr?.update_statement as JsonSDFGCodeBlock | undefined;
        if (updCode?.string_data)
            searchText += ' ' + updCode.string_data;
        const condCode = attr?.loop_condition as JsonSDFGCodeBlock | undefined;
        if (condCode?.string_data)
            searchText += ' ' + condCode.string_data;
        return searchText;
    }

}

export class BranchRegion extends ControlFlowRegion {}

export class NamedRegion extends ControlFlowRegion {}

export class FunctionCallRegion extends ControlFlowRegion {}

export class UnstructuredControlFlow extends ControlFlowRegion {}

export class SDFGNode extends SDFGElement {

    protected get defaultColorBG(): string {
        return SDFVSettings.get<string>('nodeBackgroundColor');
    }

    protected _drawLabel(
        renderer: SDFGRenderer, ctx: CanvasRenderingContext2D,
        mousepos?: Point2D, colorOverrideText?: SDFVColorThemeColor,
        overrideTopMargin?: number,
        overrideTooFarForText?: boolean
    ): void {
        if (this.label && this.label !== '') {
            const topleft = this.topleft();
            ctx.fillStyle = colorOverrideText ?
                SDFVSettings.get<string>(colorOverrideText) :
                this.defaultColorText;
            const textw = ctx.measureText(this.label).width;
            if (overrideTooFarForText || !tooFarForText(renderer)) {
                ctx.fillText(
                    this.label, this.x - textw / 2,
                    overrideTopMargin ? topleft.y + overrideTopMargin :
                        this.y + SDFV.LINEHEIGHT / 4
                );
            }
        }
    }

    public get jsonData(): JsonSDFGNode | undefined {
        return this.data?.node as JsonSDFGNode | undefined;
    }

    public setLayout(): void {
        const attrs = this.attributes();
        if (attrs?.layout) {
            const layout = attrs.layout as {
                width: number,
                height: number,
            };
            this.width = layout.width;
            this.height = layout.height;
        }
    }

}

export abstract class Edge extends SDFGElement {

    public points: Point2D[] = [];
    public srcConnector?: string;
    public dstConnector?: string;
    public summarized: boolean = false;

    public setViewToSource(renderer: SDFGRenderer): void {
        const tPoint = this.points[0];
        renderer.moveViewTo(tPoint.x, tPoint.y);
    }

    public setViewToDestination(renderer: SDFGRenderer): void {
        const tPoint = this.points[this.points.length - 1];
        renderer.moveViewTo(tPoint.x, tPoint.y);
    }

    public drawArrow(
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

    public createArrowLine(ctx: CanvasRenderingContext2D): void {
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

    public debugDraw(
        renderer: SDFGRenderer, ctx: CanvasRenderingContext2D,
        overrideDebugDrawEnabled: boolean = false
    ): void {
        if (renderer.debugDraw || overrideDebugDrawEnabled) {
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
        // Save current style properties.
        const origStrokeStyle = ctx.strokeStyle;
        const origFillStyle = ctx.fillStyle;
        const origLineWidth = ctx.lineWidth;
        const origAlpha = ctx.globalAlpha;

        ctx.globalAlpha = alpha;
        ctx.lineWidth = origLineWidth + 4;
        ctx.fillStyle = color;
        ctx.strokeStyle = color;

        this._drawShape(renderer, ctx);

        // Restore previous stroke style, width, and opacity.
        ctx.strokeStyle = origStrokeStyle;
        ctx.fillStyle = origFillStyle;
        ctx.lineWidth = origLineWidth;
        ctx.globalAlpha = origAlpha;
    }

    protected _drawShape(
        renderer: SDFGRenderer, ctx: CanvasRenderingContext2D,
        skipArrow: boolean = false
    ): void {
        const oldLineCap = ctx.lineCap;
        ctx.lineCap = 'butt';
        ctx.beginPath();
        this.createArrowLine(ctx);
        ctx.stroke();
        ctx.lineCap = oldLineCap;

        if (this.points.length < 2 || skipArrow)
            return;

        const ppp = renderer.canvasManager.pointsPerPixel;
        if (!renderer.adaptiveHiding || (ppp && ppp < SDFV.ARROW_LOD)) {
            this.drawArrow(ctx, this.points[this.points.length - 2],
                this.points[this.points.length - 1], 3, 0, 4);
        }
    }

    protected _internalDraw(
        renderer: SDFGRenderer, ctx: CanvasRenderingContext2D,
        _mousepos?: Point2D, _options?: ElemDrawingOptions
    ): void {
        ctx.strokeStyle = this.strokeStyle(renderer);
        ctx.fillStyle = this.strokeStyle(renderer);
        this._drawShape(renderer, ctx);
    }

    public simpleDraw(
        renderer: SDFGRenderer, ctx: CanvasRenderingContext2D,
        _mousePos?: Point2D
    ): void {
        ctx.strokeStyle = this.strokeStyle(renderer);
        ctx.fillStyle = this.strokeStyle(renderer);
        this._drawShape(renderer, ctx);
    }

    public setLayout(): void {
        // NOTE: Setting this.width/height will disrupt dagre in self-edges,
        // so nothing is performed here.
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
                const linePoint0 = this.points[i];
                const linePoint1 = this.points[i + 1];
                // Rectangle spanned by the two line points
                const r = {
                    x: Math.min(linePoint0.x, linePoint1.x),
                    y: Math.min(linePoint0.y, linePoint1.y),
                    w: Math.abs(linePoint1.x - linePoint0.x),
                    h: Math.abs(linePoint1.y - linePoint0.y),
                };

                // Check if the two rectangles intersect
                if (r.x + r.w >= x && r.x <= x + w &&
                    r.y + r.h >= y && r.y <= y + h)
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

    private _label = '';

    public createArrowLine(ctx: CanvasRenderingContext2D): void {
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

    protected _internalDraw(
        renderer: SDFGRenderer, ctx: CanvasRenderingContext2D,
        mousepos?: Point2D, _options?: ElemDrawingOptions
    ): void {
        ctx.fillStyle = ctx.strokeStyle = this.strokeStyle(renderer);

        let skipArrow = false;
        const attr = this.attributes();
        if (attr?.data) {
            // CR edges have dashed lines
            if (attr.wcr)
                ctx.setLineDash([3, 2]);
            else
                ctx.setLineDash([1, 0]);
        } else {
            // Empty memlet, i.e., a dependency edge. Do not draw the arrowhead.
            skipArrow = true;
        }

        this._drawShape(renderer, ctx, skipArrow);

        ctx.setLineDash([1, 0]);

        if (this.points.length >= 2 && this.selected &&
            renderer.mouseMode === 'move') {
            // Show anchor points for moving
            let i;
            for (i = 1; i < this.points.length - 1; i++) {
                ctx.strokeRect(
                    this.points[i].x - 5, this.points[i].y - 5, 8, 8
                );
            }
        }

        if (this.hovered && mousepos) {
            const attr = this.attributes();
            if (attr?.data) {
                renderer.showTooltip(
                    mousepos.x, mousepos.y, memletToHtml(attr), true
                );
            }
        }
    }

    public get label(): string {
        return this._label;
    }

}

export class InterstateEdge extends Edge {

    // Parent ID is the state ID, if relevant
    public constructor(
        data: Record<string, unknown>,
        id: number,
        sdfg: JsonSDFG,
        cfg: JsonSDFGControlFlowRegion,
        parentId: number,
        parentElem?: SDFGElement,
        public readonly src?: string,
        public readonly dst?: string
    ) {
        super(data, id, sdfg, cfg, parentId, parentElem);
    }

    public createArrowLine(ctx: CanvasRenderingContext2D): void {
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

    public drawArrow(
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

    protected _internalDraw(
        renderer: SDFGRenderer, ctx: CanvasRenderingContext2D,
        mousepos?: Point2D, _options?: ElemDrawingOptions
    ): void {
        let style = this.strokeStyle(renderer);

        // Interstate edge
        if (style === SDFVSettings.get<string>('defaultTextColor'))
            style = SDFVSettings.get<string>('interstateEdgeColor');
        ctx.fillStyle = ctx.strokeStyle = style;

        const ppp = renderer.canvasManager.pointsPerPixel;
        const drawArrow = !renderer.adaptiveHiding ||
            (ppp && ppp < SDFV.ARROW_LOD);

        this._drawShape(renderer, ctx, !drawArrow);

        ctx.setLineDash([1, 0]);

        if (this.points.length < 2)
            return;

        // Show anchor points for moving
        if (this.selected && renderer.mouseMode === 'move') {
            let i;
            for (i = 1; i < this.points.length - 1; i++) {
                ctx.strokeRect(
                    this.points[i].x - 5, this.points[i].y - 5, 8, 8
                );
            }
        }


        if (SDFVSettings.get<boolean>('alwaysOnISEdgeLabels'))
            this._drawLabel(renderer, ctx);

        if (this.hovered && mousepos)
            renderer.showTooltip(mousepos.x, mousepos.y, this.label);
    }

    protected _drawLabel(
        renderer: SDFGRenderer, ctx: CanvasRenderingContext2D,
        _mousepos?: Point2D, _colorOverrideText?: SDFVColorThemeColor,
        _overrideTopMargin?: number, overrideTooFarForText?: boolean
    ): void {
        const ppp = renderer.canvasManager.pointsPerPixel;
        if (!overrideTooFarForText || (renderer.adaptiveHiding &&
            ppp > SDFVSettings.get<number>('scopeLOD')))
            return;

        const labelLines = [];
        const attr = this.attributes();
        const assignments =
            attr?.assignments as Record<string, string> | undefined;
        if (assignments) {
            for (const k of Object.keys(assignments))
                labelLines.push(k + ' = ' + assignments[k]);
        }
        const cond = (
            attr?.condition as JsonSDFGCodeBlock | undefined
        )?.string_data;
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

            let labelWidth = Math.abs(labelMetrics.actualBoundingBoxLeft) +
                Math.abs(labelMetrics.actualBoundingBoxRight);
            let labelHeight = Math.abs(labelMetrics.actualBoundingBoxDescent) +
                Math.abs(labelMetrics.actualBoundingBoxAscent);

            // In case of canvas2pdf context, that only has width and height
            // as TextMetrics properties
            if ('pdf' in ctx && ctx.pdf) {
                if (labelWidth !== labelMetrics.width)
                    labelWidth = labelMetrics.width;
                const lMHeight = (
                    labelMetrics as unknown as Record<string, number>
                ).height;
                if (labelHeight !== lMHeight)
                    labelHeight = lMHeight;
            }

            labelWs.push(labelWidth);
            labelHs.push(labelHeight);
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
            renderer.graph?.node(this.src) : null;
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

        ctx.fillStyle = SDFVSettings.get<string>('interstateEdgeColor');
        for (let i = 0; i < labelLines.length; i++) {
            ctx.fillText(
                labelLines[i],
                srcP.x + offsetX,
                (srcP.y + offsetY) - (i * (labelHs[0] + SDFV.LINEHEIGHT))
            );
        }
        ctx.font = oldFont;
    }

    public drawLabel(
        renderer: SDFGRenderer, ctx: CanvasRenderingContext2D
    ): void {
        this._drawLabel(renderer, ctx);
    }

}

export class Connector extends SDFGElement {

    public customLabel?: string;
    public linkedElem?: SDFGElement;
    public connectorType: 'in' | 'out' = 'in';
    private readonly _guid = '';

    public get guid(): string {
        return this._guid;
    }

    protected _internalDraw(
        renderer: SDFGRenderer, ctx: CanvasRenderingContext2D,
        mousepos?: Point2D, options?: ElemDrawingOptions, edge?: Edge
    ): void {
        const topleft = this.topleft();
        ctx.beginPath();
        drawEllipse(ctx, topleft.x, topleft.y, this.width, this.height);
        ctx.closePath();
        ctx.strokeStyle = this.strokeStyle(renderer);
        let fillColor;

        const name = this.data?.name as string | undefined;
        if (this.linkedElem && this.linkedElem instanceof ControlFlowBlock) {
            if (name) {
                if (this.data?.certainAccess) {
                    fillColor = this.getCssProperty(
                        renderer, '--cf-connector-certain-color'
                    );
                } else {
                    fillColor = this.getCssProperty(
                        renderer, '--cf-connector-uncertain-color'
                    );
                }
            }
        } else {
            const scopeConnector = (
                name?.startsWith('IN_') === true ||
                name?.startsWith('OUT_') === true
            );
            if (scopeConnector) {
                const cname = name.startsWith('IN_') ?
                    name.substring(3) : name.substring(4);

                ctx.lineWidth = 0.4;
                ctx.stroke();
                ctx.lineWidth = 1.0;
                fillColor = this.getCssProperty(
                    renderer, '--connector-scoped-color'
                );
                this.customLabel = cname;
            } else if (!edge) {
                ctx.stroke();
                fillColor = SDFVSettings.get<string>(
                    'errorNodeBackgroundColor'
                );
                this.customLabel = 'No edge connected';
            } else {
                ctx.stroke();
                fillColor = this.getCssProperty(
                    renderer, '--connector-unscoped-color'
                );
                this.customLabel = undefined;
            }
        }


        // PDFs do not support transparent fill colors
        if ('pdf' in ctx && ctx.pdf)
            fillColor = fillColor?.slice(0, 7);

        if (fillColor !== undefined)
            ctx.fillStyle = fillColor;

        // PDFs do not support stroke and fill on the same object
        if ('pdf' in ctx && ctx.pdf) {
            ctx.beginPath();
            drawEllipse(ctx, topleft.x, topleft.y, this.width, this.height);
            ctx.closePath();
        }
        ctx.fill();

        if (this.strokeStyle(renderer) !== SDFVSettings.get<string>(
            'defaultTextColor'
        )) {
            if (this.linkedElem && mousepos &&
                this.linkedElem instanceof ControlFlowBlock) {
                let customTooltipHtml = name ?? '';
                const access = this.data?.access as
                    Record<string, unknown> | undefined;
                if (access) {
                    customTooltipHtml += sdfgPropertyToString(
                        access.subset, SDFVSettings.settingsDict
                    );

                    if (access.volume !== undefined) {
                        let numAccesses = (access.volume ?? '0') as string;
                        if (access.dynamic) {
                            if (numAccesses === '0' || numAccesses === '-1') {
                                numAccesses = '<b>Dynamic (unbounded)</b>';
                            } else {
                                numAccesses = '<b>Dynamic</b> (up to ' +
                                    numAccesses + ')';
                            }
                        } else if (numAccesses === '-1') {
                            numAccesses = '<b>Dynamic (unbounded)</b>';
                        }
                        customTooltipHtml += '<br />Volume: ' + numAccesses;
                    }
                }

                const certainAccess = this.data?.certainAccess as
                    Record<string, unknown> | undefined;
                if (certainAccess) {
                    if (access?.subset !== certainAccess.subset) {
                        const certainHtml = sdfgPropertyToString(
                            certainAccess.subset,
                            SDFVSettings.settingsDict
                        );
                        customTooltipHtml += '<p>Certain:<p>';
                        customTooltipHtml += certainHtml;
                    }
                }

                renderer.showTooltip(
                    mousepos.x, mousepos.y, customTooltipHtml, true
                );
            } else if (mousepos) {
                renderer.showTooltip(
                    mousepos.x, mousepos.y, this.label
                );
            }
        }
    }

    public draw(
        renderer: SDFGRenderer, ctx: CanvasRenderingContext2D,
        mousepos?: Point2D, edge?: Edge
    ): void {
        this._internalDraw(renderer, ctx, mousepos, undefined, edge);
    }

    public attributes(): Record<string, unknown> {
        return {};
    }

    public setLayout(): void {
        return;
    }

    public get label(): string {
        const name = (this.data?.name as string | undefined) ?? '';
        if (this.customLabel)
            return name + ': ' + this.customLabel;
        return name;
    }

}

export class AccessNode extends SDFGNode {

    public getDesc(): JsonSDFGDataDesc | undefined {
        const name = this.attributes()?.data as string | undefined;
        const nameParts = name?.split('.');
        const arrays = this.sdfg.attributes?._arrays;
        if (!nameParts || !arrays)
            return undefined;

        if (nameParts.length > 1) {
            let desc = arrays[nameParts[0]];
            let i = 1;
            while (i < nameParts.length) {
                if (!desc.attributes?.members)
                    return undefined;
                const nextName = nameParts[i];
                let foundDesc = undefined;
                for (const mbr of desc.attributes.members) {
                    if (mbr[0] === nextName) {
                        foundDesc = mbr[1];
                        break;
                    }
                }
                if (foundDesc)
                    desc = foundDesc;
                else
                    return undefined;
                i++;
            }
            return desc;
        } else {
            return this.sdfg.attributes?._arrays[nameParts[0]];
        }
    }

    protected _internalDraw(
        renderer: SDFGRenderer, ctx: CanvasRenderingContext2D,
        mousepos?: Point2D, _options?: ElemDrawingOptions
    ): void {
        const name = this.attributes()?.data as string | undefined;
        const nodedesc = this.getDesc();
        // Streams have dashed edges
        if (nodedesc?.type === 'Stream')
            ctx.setLineDash([5, 3]);
        else
            ctx.setLineDash([1, 0]);

        // Non-transient (external) data is thicker
        if (nodedesc?.attributes?.transient === true)
            ctx.lineWidth = 1.0;
        else
            ctx.lineWidth = 3.0;

        // Views are colored like connectors
        if (nodedesc?.type?.includes('View')) {
            ctx.fillStyle = this.getCssProperty(
                renderer, '--connector-unscoped-color'
            );
        } else if (nodedesc?.type?.includes('Reference')) {
            ctx.fillStyle = this.getCssProperty(
                renderer, '--reference-background-color'
            );
        } else if (name && nodedesc &&
            this.sdfg.attributes?.constants_prop?.[name] !== undefined) {
            ctx.fillStyle = this.getCssProperty(
                renderer, '--connector-scoped-color'
            );
        } else if (nodedesc) {
            ctx.fillStyle = this.defaultColorBG;
        } else {
            ctx.fillStyle = SDFVSettings.get<string>(
                'errorNodeBackgroundColor'
            );
        }
        ctx.strokeStyle = this.strokeStyle(renderer);

        this._drawShape(renderer, ctx, true, true);

        if (nodedesc) {
            ctx.fillStyle = SDFVSettings.get<string>('defaultTextColor');
        } else {
            ctx.fillStyle = SDFVSettings.get<string>(
                'errorNodeForegroundColor'
            );
            if (this.strokeStyle(renderer) !== SDFVSettings.get<string>(
                'defaultTextColor'
            )) {
                if (this.hovered && mousepos) {
                    renderer.showTooltip(
                        mousepos.x, mousepos.y, 'Undefined array'
                    );
                }
            }
        }

        this._drawLabel(renderer, ctx, mousepos);
    }

    public get label(): string {
        const name = this.attributes()?.data as string | undefined;
        let lbl = name ?? '';
        if (SDFVSettings.get<boolean>('showDataDescriptorSizes')) {
            const nodedesc = this.sdfg.attributes?._arrays[lbl];
            if (nodedesc?.attributes?.shape)
                lbl = ' ' + sdfgPropertyToString(nodedesc.attributes.shape);
        }
        return lbl;
    }

    protected _drawShape(
        renderer: SDFGRenderer, ctx: CanvasRenderingContext2D,
        fill: boolean = true, stroke: boolean = true
    ): void {
        const topleft = this.topleft();
        drawEllipse(ctx, topleft.x, topleft.y, this.width, this.height);
        if (fill)
            ctx.fill();
        if ('pdf' in ctx && ctx.pdf && fill && stroke) {
            // PDFs do not support stroke and fill on the same object.
            drawEllipse(ctx, topleft.x, topleft.y, this.width, this.height);
            ctx.stroke();
        } else {
            if (stroke)
                ctx.stroke();
        }
    }

}

export class ScopeNode extends SDFGNode {

    public readonly COLLAPSIBLE: boolean = true;

    private cachedFarLabel?: string;
    private cachedCloseLabel?: string;

    private scheduleLabelDict: Record<string, string> = {
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

    protected _drawShape(
        renderer: SDFGRenderer, ctx: CanvasRenderingContext2D,
        fill: boolean = true, stroke: boolean = true
    ): void {
        // Consume scopes have dashed edges
        if (this.type.startsWith('Consume'))
            ctx.setLineDash([5, 3]);
        else
            ctx.setLineDash([1, 0]);
        if (this.attributes()?.is_collapsed) {
            drawHexagon(ctx, this.x, this.y, this.width, this.height, {
                x: 0,
                y: 0,
            });
            if (fill)
                ctx.fill();
            if ('pdf' in ctx && ctx.pdf && fill && stroke) {
                // PDFs do not support stroke and fill on the same object.
                drawHexagon(ctx, this.x, this.y, this.width, this.height, {
                    x: 0,
                    y: 0,
                });
                ctx.stroke();
            } else if (stroke) {
                ctx.stroke();
            }
        } else {
            const topleft = this.topleft();
            drawTrapezoid(
                ctx, topleft.x, topleft.y, this.width, this.height,
                this.isScopeEnd()
            );
            if (fill)
                ctx.fill();
            if ('pdf' in ctx && ctx.pdf && fill && stroke) {
                // PDFs do not support stroke and fill on the same object.
                drawTrapezoid(
                    ctx, topleft.x, topleft.y, this.width, this.height,
                    this.isScopeEnd()
                );
                ctx.stroke();
            } else if (stroke) {
                ctx.stroke();
            }
        }
    }

    protected _drawLabel(
        renderer: SDFGRenderer, ctx: CanvasRenderingContext2D,
        _mousepos?: Point2D, _colorOverrideText?: SDFVColorThemeColor,
        overrideTopMargin?: number, overrideTooFarForText?: boolean
    ): void {
        // If we are far away, don't show the text
        if (tooFarForText(renderer) && !overrideTooFarForText)
            return;

        ctx.fillStyle = SDFVSettings.get<string>('defaultTextColor');

        const topMargin = overrideTopMargin ?? 0;
        drawAdaptiveText(
            ctx, renderer, this.getFarLabel(renderer),
            this.getCloseLabel(renderer), this.x, this.y + topMargin,
            this.width, this.height,
            SDFVSettings.get<number>('scopeLOD')
        );

        if (SDFVSettings.get<boolean>('showMapSchedules')) {
            drawAdaptiveText(
                ctx, renderer, '', this.getScheduleLabel(), this.x,
                this.y + topMargin, this.width, this.height,
                SDFVSettings.get<number>('scopeLOD'),
                SDFV.DEFAULT_MAX_FONTSIZE, 0.7,
                SDFV.DEFAULT_FAR_FONT_MULTIPLIER, true,
                TextVAlign.BOTTOM, TextHAlign.RIGHT, {
                    bottom: 2.0,
                    right: this.height,
                }
            );
        }
    }

    protected _internalDraw(
        renderer: SDFGRenderer, ctx: CanvasRenderingContext2D,
        mousepos?: Point2D, options?: ElemDrawingOptions
    ): void {
        ctx.lineWidth = 1.0;
        ctx.strokeStyle = this.strokeStyle(renderer);
        ctx.fillStyle = SDFVSettings.get<string>('nodeBackgroundColor');
        this._drawShape(renderer, ctx, true, true);

        if (options?.label !== false)
            this._drawLabel(renderer, ctx, mousepos);
    }

    private getScheduleLabel(): string {
        let attrs = this.attributes();
        if (this.isScopeEnd() && this.parentStateId !== undefined) {
            const parState =
                this.parentElem?.data?.state as JsonSDFGState | undefined;
            if (this.jsonData?.scope_entry) {
                const entry = parState?.nodes[
                    parseInt(this.jsonData.scope_entry)
                ];
                if (entry !== undefined)
                    attrs = entry.attributes;
            }
        }

        let label = (attrs?.schedule ?? 'Default') as string;
        try {
            label = this.scheduleLabelDict[label];
        } catch (_err) {
        }

        // If this isn't a pre-defined schedule, show the raw name.
        if (!label)
            label = (attrs?.schedule ?? 'Default') as string;

        return label;
    }

    private getFarLabel(
        renderer: SDFGRenderer, recompute: boolean = false
    ): string {
        if (!recompute && this.cachedFarLabel)
            return this.cachedFarLabel;

        let result = '[';

        let attrs = this.attributes();

        if (this.isScopeEnd() && this.parentStateId !== undefined) {
            const parState =
                this.parentElem?.data?.state as JsonSDFGState | undefined;
            if (this.jsonData?.scope_entry) {
                const entry = parState?.nodes[
                    parseInt(this.jsonData.scope_entry)
                ];
                if (entry !== undefined)
                    attrs = entry.attributes;
                else
                    return this.label;
            }
        }

        if (this instanceof ConsumeEntry || this instanceof ConsumeExit) {
            result += sdfgConsumeElemToString(
                (attrs?.num_pes ?? 1) as number, SDFVSettings.settingsDict
            );
        } else {
            const params = attrs?.params as string[] | undefined;
            const range = attrs?.range as DataSubset | undefined;
            for (let i = 0; i < (params?.length ?? 0); ++i) {
                if (range?.ranges?.[i] !== undefined) {
                    result += sdfgRangeElemToString(
                        range.ranges[i], SDFVSettings.settingsDict
                    ) + ', ';
                }
            }
            // Remove trailing comma
            result = result.substring(0, result.length - 2);
        }
        result += ']';

        this.cachedFarLabel = result;

        return result;
    }

    private getCloseLabel(
        renderer: SDFGRenderer, recompute: boolean = false
    ): string {
        if (!recompute && this.cachedCloseLabel)
            return this.cachedCloseLabel;

        let attrs = this.attributes();
        if (!attrs)
            return '';

        let result = '';
        if (this.isScopeEnd() && this.parentStateId !== undefined) {
            const parState =
                this.parentElem?.data?.state as JsonSDFGState | undefined;
            if (this.jsonData?.scope_entry) {
                const entry =
                    parState?.nodes[parseInt(this.jsonData.scope_entry)];
                if (entry) {
                    attrs = entry.attributes;
                    if (!attrs)
                        return 'MISSING ENTRY NODE ATTRIBUTES';
                } else {
                    this.cachedCloseLabel = 'MISSING ENTRY NODE';
                    return 'MISSING ENTRY NODE';
                }
            }
        }

        result += '[';
        if (this instanceof ConsumeEntry || this instanceof ConsumeExit) {
            result += attrs.pe_index as string + '=' + sdfgConsumeElemToString(
                (attrs.num_pes ?? 1) as number, SDFVSettings.settingsDict
            );
        } else {
            const params = attrs.params as string[] | undefined;
            const range = attrs.range as DataSubset | undefined;
            for (let i = 0; i < (params?.length ?? 0); ++i) {
                result += params![i] + '=';
                if (range?.ranges?.[i] !== undefined) {
                    result += sdfgRangeElemToString(
                        range.ranges[i], SDFVSettings.settingsDict
                    ) + ', ';
                }
            }
            // Remove trailing comma
            result = result.substring(0, result.length - 2);
        }
        result += ']';

        this.cachedCloseLabel = result;

        return result;
    }

    public isScopeEnd(): boolean {
        return false;
    }

    private clearCachedLabels(): void {
        this.cachedCloseLabel = undefined;
        this.cachedFarLabel = undefined;
    }

}

export class EntryNode extends ScopeNode {

    public isScopeEnd(): boolean {
        return false;
    }

}

export class ExitNode extends ScopeNode {

    public isScopeEnd(): boolean {
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

interface TaskletCodeToken {
    token: string;
    type: TaskletCodeTokenType;
    highlighted: boolean;
}

export class Tasklet extends SDFGNode {

    private highlightedCode: TaskletCodeToken[][] = [];
    public readonly inputTokens = new Set<TaskletCodeToken>();
    public readonly outputTokens = new Set<TaskletCodeToken>();
    private longestCodeLine?: string;

    public constructor(
        data: Record<string, unknown>,
        id: number,
        sdfg: JsonSDFG,
        cfg: JsonSDFGControlFlowRegion,
        parentStateId?: number,
        parentElem?: SDFGElement
    ) {
        super(data, id, sdfg, cfg, parentStateId, parentElem);
        this.highlightCode();
    }

    public textForFind(): string {
        // Include code when searching
        const code = (
            this.attributes()?.code as JsonSDFGCodeBlock | undefined
        )?.string_data ?? '';
        return this.label + ' ' + code;
    }

    public highlightCode(): void {
        this.inputTokens.clear();
        this.outputTokens.clear();
        this.highlightedCode = [];

        const cBlock = this.attributes()?.code as JsonSDFGCodeBlock | undefined;
        const lang = cBlock?.language?.toLowerCase() ?? 'python';
        const code = cBlock?.string_data;

        const sdfgSymbols = Object.keys(
            this.sdfg.attributes?.symbols ?? {}
        );
        const inConnectors = Object.keys(
            this.attributes()?.in_connectors ?? {}
        );
        const outConnectors = Object.keys(
            this.attributes()?.out_connectors ?? {}
        );

        const lines = code?.split('\n') ?? [];
        let maxLineLength = 0;
        for (const line of lines) {
            if (line.length > maxLineLength) {
                this.longestCodeLine = line;
                maxLineLength = line.length;
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

        ctx.font = fontSize.toString() + 'px courier new';
        const defaultColor = SDFVSettings.get<string>('defaultTextColor');
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
                    ctx.font = 'bold ' + fontSize.toString() + 'px courier new';
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
                            ctx.font = 'bold ' + fontSize.toString() +
                                'px courier new';
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

    protected _internalDraw(
        renderer: SDFGRenderer, ctx: CanvasRenderingContext2D,
        mousepos?: Point2D, _options?: ElemDrawingOptions
    ): void {
        ctx.fillStyle = this.defaultColorBG;
        ctx.strokeStyle = this.strokeStyle(renderer);
        ctx.lineWidth = 1.0;
        this._drawShape(renderer, ctx, true, true);

        const ppp = renderer.canvasManager.pointsPerPixel;
        if (!renderer.adaptiveHiding ||
            ppp < SDFVSettings.get<number>('taskletLOD')) {
            // If we are close to the tasklet, show its contents
            this.drawTaskletCode(renderer, ctx);
        } else {
            this._drawLabel(renderer, ctx, mousepos);
        }
    }

    protected _drawShape(
        renderer: SDFGRenderer, ctx: CanvasRenderingContext2D,
        fill: boolean = true, stroke: boolean = true
    ): void {
        const topleft = this.topleft();
        drawOctagon(ctx, topleft.x, topleft.y, this.width, this.height);
        if (fill)
            ctx.fill();
        if ('pdf' in ctx && ctx.pdf && fill && stroke) {
            // PDFs do not support stroke and fill on the same object.
            drawOctagon(ctx, topleft.x, topleft.y, this.width, this.height);
            ctx.stroke();
        } else {
            if (stroke)
                ctx.stroke();
        }
    }

}

export class Reduce extends SDFGNode {

    protected _drawShape(
        _renderer: SDFGRenderer, ctx: CanvasRenderingContext2D,
        fill: boolean = true, stroke: boolean = true
    ): void {
        const topleft = this.topleft();
        const mkShape = () => {
            ctx.beginPath();
            ctx.moveTo(topleft.x, topleft.y);
            ctx.lineTo(topleft.x + this.width / 2, topleft.y + this.height);
            ctx.lineTo(topleft.x + this.width, topleft.y);
            ctx.lineTo(topleft.x, topleft.y);
            ctx.closePath();
        };

        if ('pdf' in ctx && ctx.pdf && fill && stroke) {
            // PDFs do not support stroke and fill on the same object.
            mkShape();
            ctx.fill();
            mkShape();
            ctx.stroke();
        } else {
            mkShape();
            if (fill)
                ctx.fill();
            if (stroke)
                ctx.stroke();
        }
    }

    protected _drawLabel(
        renderer: SDFGRenderer, ctx: CanvasRenderingContext2D,
        mousepos?: Point2D, colorOverrideText?: SDFVColorThemeColor,
        overrideTopMargin?: number, overrideTooFarForText?: boolean
    ): void {
        if (overrideTooFarForText || !tooFarForText(renderer)) {
            ctx.fillStyle = SDFVSettings.get<string>('defaultTextColor');
            const farLabel = this.label.substring(
                4, this.label.indexOf(',')
            );
            drawAdaptiveText(
                ctx, renderer, farLabel,
                this.label, this.x, this.y - this.height * 0.2,
                this.width, this.height,
                SDFVSettings.get<number>('scopeLOD')
            );
        }
    }

    protected _internalDraw(
        renderer: SDFGRenderer, ctx: CanvasRenderingContext2D,
        mousepos?: Point2D, options?: ElemDrawingOptions
    ): void {
        const nOptions = {} as ElemDrawingOptions;
        if (options)
            Object.assign(nOptions, options);
        nOptions.label = true;
        super._internalDraw(renderer, ctx, mousepos, nOptions);
    }

}

export class NestedSDFG extends SDFGNode {

    public readonly COLLAPSIBLE: boolean = true;

    protected _drawShape(
        renderer: SDFGRenderer, ctx: CanvasRenderingContext2D,
        fill: boolean = true, stroke: boolean = true
    ): void {
        if (this.attributes()?.is_collapsed) {
            const topleft = this.topleft();
            drawOctagon(ctx, topleft.x, topleft.y, this.width, this.height);
            if (fill)
                ctx.fill();
            if ('pdf' in ctx && ctx.pdf && fill && stroke) {
                // PDFs do not support stroke and fill on the same object.
                drawOctagon(ctx, topleft.x, topleft.y, this.width, this.height);
                ctx.stroke();
            } else {
                if (stroke)
                    ctx.stroke();
            }
            if (stroke) {
                drawOctagon(
                    ctx, topleft.x + 2.5, topleft.y + 2.5,
                    this.width - 5, this.height - 5
                );
                ctx.stroke();
            }
        } else {
            // Draw a rectangle around the nested SDFG.
            super._drawShape(renderer, ctx, fill, stroke);
        }
    }

    protected _internalDraw(
        renderer: SDFGRenderer, ctx: CanvasRenderingContext2D,
        mousepos?: Point2D, _options?: ElemDrawingOptions
    ): void {
        this._drawShape(renderer, ctx, true, true);

        if (this.attributes()?.is_collapsed) {
            this._drawLabel(renderer, ctx, mousepos);
        } else {
            const nsdfg = this.attributes()?.sdfg as JsonSDFG | undefined;
            const ngraph = this.data?.graph as DagreGraph | undefined;
            if (nsdfg?.type !== 'SDFGShell' && ngraph) {
                // Draw nested graph.
                drawSDFG(renderer, ctx, ngraph, mousepos);
            } else {
                // Expanded, but no SDFG present or loaded yet.
                if (!tooFarForText(renderer)) {
                    const errColor = SDFVSettings.get<string>(
                        'errorNodeBackgroundColor'
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

    public setLayout(): void {
        const attr = this.attributes();
        if (attr?.is_collapsed) {
            const labelsize =
                (attr.label as string).length * SDFV.LINEHEIGHT * 0.8;
            const inconnsize = 2 * SDFV.LINEHEIGHT * Object.keys(
                attr.in_connectors ?? {}
            ).length - SDFV.LINEHEIGHT;
            const outconnsize = 2 * SDFV.LINEHEIGHT * Object.keys(
                attr.out_connectors ?? {}
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
            const layout = attr?.layout as {
                width: number,
                height: number,
            } | undefined;
            this.width = layout?.width ?? 0;
            this.height = layout?.height ?? 0;
        }
    }

    public get label(): string {
        let label = (this.attributes()?.label as string | undefined) ?? '';
        if (!this.attributes()?.sdfg)
            label += ' (not loaded)';
        return label;
    }

    public textForFind(): string {
        // Find should include the name of the nested SDFG, and the symbol
        // mapping.
        let findText = super.textForFind();
        const attr = this.attributes();
        const nsdfg = attr?.sdfg as JsonSDFG | undefined;
        findText += ' ' + (nsdfg?.attributes?.name as string | undefined ?? '');
        const symMapping =
            attr?.symbol_mapping as Record<string, string> | undefined;
        if (symMapping) {
            for (const k in symMapping)
                findText += ' ' + k + ' ' + symMapping[k];
        }
        return findText;
    }

}

export class ExternalNestedSDFG extends NestedSDFG {
}

export class LibraryNode extends SDFGNode {

    protected _drawShape(
        renderer: SDFGRenderer, ctx: CanvasRenderingContext2D,
        fill: boolean = true, stroke: boolean = true
    ): void {
        if (fill) {
            this._path(ctx);
            ctx.fill();
        }
        if (stroke) {
            this._path(ctx);
            ctx.stroke();
            this._path2(ctx);
            ctx.stroke();
        }
    }

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

    protected _internalDraw(
        renderer: SDFGRenderer, ctx: CanvasRenderingContext2D,
        mousepos?: Point2D, options?: ElemDrawingOptions
    ): void {
        const nOptions = {} as ElemDrawingOptions;
        if (options)
            Object.assign(nOptions, options);
        nOptions.label = true;
        super._internalDraw(renderer, ctx, mousepos, nOptions);
    }

}

//////////////////////////////////////////////////////

// Checks if graph is zoomed out far (defined by SDFV.TEXT_LOD), using
// Points-per-Pixel. Used before ctx.fillText calls to only draw text when
// zoomed in close enough.
function tooFarForText(renderer: SDFGRenderer): boolean {
    return renderer.adaptiveHiding &&
        renderer.canvasManager.pointsPerPixel > SDFVSettings.get<number>(
            'textLOD'
        );
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
 * @param graph        Graph for which to draw edges.
 * @param ctx          Canvas context.
 * @param viewport     Visible area of the graph.
 * @param mousepos     Mouse position.
 * @param color        Default edge color to use.
 */
function batchedDrawEdges(
    renderer: SDFGRenderer, graph: DagreGraph, ctx: CanvasRenderingContext2D,
    viewport?: SimpleRect, mousepos?: Point2D,
    color: SDFVColorThemeColor = 'defaultTextColor',
    labelled: boolean = false
): void {
    const deferredEdges: Edge[] = [];
    const arrowEdges: Edge[] = [];
    const labelEdges: Edge[] = [];
    ctx.beginPath();
    graph.edges().forEach(e => {
        const edge = graph.edge(e);
        if (!edge || (
            renderer.viewportOnly && viewport && !edge.intersect(
                viewport.x, viewport.y, viewport.w, viewport.h
            )
        ))
            return;

        if (!(graph instanceof State)) {
            if (edge.parentStateId !== undefined) {
                // WCR edge or dependency edge.
                if (edge.attributes()?.wcr || !edge.attributes()?.data) {
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
        if (viewport && lPoint.x >= viewport.x &&
            lPoint.x <= viewport.x + viewport.w &&
            lPoint.y >= viewport.y &&
            lPoint.y <= viewport.y + viewport.h)
            arrowEdges.push(edge);

        const fPoint = edge.points[0];
        if (labelled && viewport && fPoint.x >= viewport.x &&
            fPoint.x <= viewport.x + viewport.w &&
            fPoint.y >= viewport.y &&
            fPoint.y <= viewport.y + viewport.h)
            labelEdges.push(edge);

        edge.createArrowLine(ctx);
    });
    ctx.setLineDash([1, 0]);
    ctx.fillStyle = ctx.strokeStyle = SDFVSettings.get<string>(color);
    ctx.stroke();

    // Only draw Arrowheads when close enough to see them
    const ppp = renderer.canvasManager.pointsPerPixel;
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
        if (e instanceof InterstateEdge)
            e.drawLabel(renderer, ctx);
    });

    deferredEdges.forEach(e => {
        e.draw(renderer, ctx, mousepos);
    });

    if (renderer.debugDraw) {
        for (const e of graph.edges()) {
            const edge = graph.edge(e);
            edge?.debugDraw(renderer, ctx);
        }
    }
}

function drawStateContents(
    stateGraph: DagreGraph, ctx: CanvasRenderingContext2D,
    renderer: SDFGRenderer, ppp: number, visibleRect?: SimpleRect,
    mousePos?: Point2D
): void {
    for (const nodeId of stateGraph.nodes()) {
        const node = stateGraph.node(nodeId);

        if (!node || (
            renderer.viewportOnly && visibleRect && !node.intersect(
                visibleRect.x, visibleRect.y, visibleRect.w, visibleRect.h
            )
        ))
            continue;

        // Simple draw for non-collapsed NestedSDFGs
        if (node instanceof NestedSDFG && !node.attributes()?.is_collapsed) {
            const nodeppp = Math.sqrt(node.width * node.height) / ppp;
            if (renderer.adaptiveHiding &&
                nodeppp < SDFVSettings.get<number>('nestedLOD')) {
                node.simpleDraw(renderer, ctx, mousePos);
                node.debugDraw(renderer, ctx);
                continue;
            }
        } else {
            // Simple draw node
            if (renderer.adaptiveHiding &&
                ppp > SDFVSettings.get<number>('nodeLOD')) {
                node.simpleDraw(renderer, ctx, mousePos);
                node.debugDraw(renderer, ctx);
                continue;
            }
        }

        node.draw(renderer, ctx, mousePos);
        node.debugDraw(renderer, ctx);

        // Only draw connectors when close enough to see them
        if (!renderer.adaptiveHiding || ppp < SDFV.CONNECTOR_LOD) {
            node.inConnectors.forEach(c => {
                // Only draw connectors if actually visible. This is needed for
                // large nodes in the background like NestedSDFGs, that are
                // visible, but their connectors are actually not.
                if (visibleRect && !c.intersect(
                    visibleRect.x, visibleRect.y,
                    visibleRect.w, visibleRect.h
                ))
                    return;

                let edge: Edge | undefined = undefined;
                stateGraph.inEdges(nodeId)?.forEach((e) => {
                    const eobj = stateGraph.edge(e);
                    if (eobj?.dstConnector === c.data?.name)
                        edge = eobj;
                });

                c.draw(renderer, ctx, mousePos, edge);
                c.debugDraw(renderer, ctx);
            });
            node.outConnectors.forEach(c => {
                if (visibleRect && !c.intersect(
                    visibleRect.x, visibleRect.y,
                    visibleRect.w, visibleRect.h
                ))
                    return;

                let edge: Edge | undefined = undefined;
                stateGraph.outEdges(nodeId)?.forEach((e) => {
                    const eobj = stateGraph.edge(e);
                    if (eobj?.srcConnector === c.data?.name)
                        edge = eobj;
                });

                c.draw(renderer, ctx, mousePos, edge);
                c.debugDraw(renderer, ctx);
            });
        }
    }

    if (renderer.adaptiveHiding && ppp > SDFVSettings.get<number>('edgeLOD'))
        return;

    batchedDrawEdges(
        renderer, stateGraph, ctx, visibleRect, mousePos, 'defaultTextColor',
        false
    );
}

function drawStateMachine(
    stateMachineGraph: DagreGraph, ctx: CanvasRenderingContext2D,
    renderer: SDFGRenderer, ppp: number, visibleRect?: SimpleRect,
    mousePos?: Point2D
): void {
    if (!renderer.adaptiveHiding || ppp < SDFVSettings.get<number>('edgeLOD')) {
        batchedDrawEdges(
            renderer, stateMachineGraph, ctx, visibleRect, mousePos,
            'interstateEdgeColor',
            SDFVSettings.get<boolean>('alwaysOnISEdgeLabels')
        );
    }

    for (const nodeId of stateMachineGraph.nodes()) {
        const block = stateMachineGraph.node(nodeId);

        // Skip invisible states.
        if (!block || (
            renderer.viewportOnly && visibleRect && !block.intersect(
                visibleRect.x, visibleRect.y, visibleRect.w, visibleRect.h
            )
        ))
            continue;

        const blockppp = Math.sqrt(block.width * block.height) / ppp;
        if (block instanceof SDFGNode) {
            if (renderer.adaptiveHiding &&
                ppp > SDFVSettings.get<number>('nodeLOD')) {
                block.simpleDraw(renderer, ctx, mousePos);
                block.debugDraw(renderer, ctx);
                continue;
            }
        } else {
            if (renderer.adaptiveHiding &&
                blockppp < SDFVSettings.get<number>('nestedLOD')) {
                block.simpleDraw(renderer, ctx, mousePos);
                block.debugDraw(renderer, ctx);
                continue;
            }
        }

        block.draw(renderer, ctx, mousePos);
        block.debugDraw(renderer, ctx);

        const ng = block.data?.graph as DagreGraph | undefined;
        if (!block.attributes()?.is_collapsed && ng) {
            if (block instanceof State) {
                drawStateContents(
                    ng, ctx, renderer, ppp, visibleRect, mousePos
                );
            } else if (block instanceof ControlFlowRegion) {
                drawStateMachine(
                    ng, ctx, renderer, ppp, visibleRect, mousePos
                );
            } else if (block instanceof ConditionalBlock) {
                for (const [_, region] of block.branches) {
                    region.draw(renderer, ctx, mousePos);
                    const regG = region.data?.graph as DagreGraph | undefined;
                    if (!region.attributes()?.is_collapsed && regG) {
                        drawStateMachine(
                            regG, ctx, renderer, ppp, visibleRect, mousePos
                        );
                    }
                }
            }
        }
    }
}

// Draw an entire SDFG.
export function drawSDFG(
    renderer: SDFGRenderer, ctx: CanvasRenderingContext2D, g: DagreGraph,
    mousePos?: Point2D
): void {
    drawStateMachine(
        g, ctx, renderer, renderer.canvasManager.pointsPerPixel,
        renderer.viewport, mousePos
    );
}

///////////////////////////////////////////////////////


export const SDFGElements: Record<string, typeof SDFGElement> = {
    SDFGElement,
    Connector,

    ControlFlowRegion,
    LoopRegion,
    BranchRegion,
    NamedRegion,
    FunctionCallRegion,
    UnstructuredControlFlow,

    ControlFlowBlock,
    'State': State,
    'SDFGState': State,
    BreakBlock,
    ContinueBlock,
    ReturnBlock,
    ConditionalBlock,

    SDFG,
    SDFGShell,

    InterstateEdge,
    Memlet,

    SDFGNode,
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
};
