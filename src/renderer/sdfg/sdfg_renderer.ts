// Copyright 2019-2025 ETH Zurich and the DaCe authors. All rights reserved.

import $ from 'jquery';

import { layoutSDFG } from '../../layout/layout';
import {
    AccessNode,
    Connector,
    ControlFlowBlock,
    ControlFlowRegion,
    drawSDFG,
    Edge,
    EntryNode,
    InterstateEdge,
    NestedSDFG,
    SDFGElement,
    SDFGElementType,
    SDFGNode,
    State,
    Tasklet,
} from '../../renderer/sdfg/sdfg_elements';
import { layoutGraph } from '../../local_view/lview_layouter';
import {
    LViewGraphParseError,
    parseGraph,
} from '../../local_view/lview_parser';
import { LViewRenderer } from '../../local_view/lview_renderer';
import { OverlayManager } from '../../overlay_manager';
import { LogicalGroupOverlay } from '../../overlays/logical_group_overlay';
import { ISDFV, SDFV, WebSDFV } from '../../sdfv';
import {
    JsonSDFG,
    JsonSDFGControlFlowRegion,
    JsonSDFGMultiConnectorEdge,
    ModeButtons,
    Point2D,
    SDFGElementGroup,
    SDFGElementInfo,
    SimpleRect,
} from '../../types';
import { updateEdgeBoundingBox } from '../../utils/bounding_box';
import {
    checkCompatSave,
    parseSDFG,
    stringifySDFG,
} from '../../utils/sdfg/json_serializer';
import { memletTreeComplete } from '../../utils/sdfg/memlet_trees';
import {
    deleteCFGBlocks,
    deletePositioningInfo,
    deleteSDFGNodes,
    findGraphElementByUUID,
    findRootCFG,
    getGraphElementUUID,
    getPositioningInfo,
    initializePositioningInfo,
} from '../../utils/sdfg/sdfg_utils';
import {
    DagreGraphElementInfo,
    doForAllDagreGraphElements,
    doForAllJsonSDFGElements,
    doForIntersectedDagreGraphElements,
    traverseSDFGScopes,
} from '../../utils/sdfg/traversal';
import {
    SDFVSettingKey,
    SDFVSettings,
    SDFVSettingValT,
} from '../../utils/sdfv_settings';
import { showErrorModal } from '../../utils/utils';
import { SDFGRendererUI, SDFGRendererUIFeature } from './sdfg_renderer_ui';
import {
    HTML_CANVAS_RENDERER_DEFAULT_OPTIONS,
    HTMLCanvasRenderer,
    HTMLCanvasRendererOptionKey,
} from 'rendure/src/renderer/core/html_canvas/html_canvas_renderer';
import {
    boundingBox,
    findLineStartRectIntersection,
} from 'rendure/src/renderer/core/common/renderer_utils';


type MouseModeT = 'pan' | 'move' | 'select' | 'add';

export type DagreGraph =
    Omit<Omit<dagre.graphlib.Graph<SDFGElement>, 'node'>, 'edge'> & {
        x: number,
        y: number,
        width: number,
        height: number,
        edge: (edgeObj: dagre.Edge | string) => Edge | undefined,
        node: (key: string) => SDFGNode | ControlFlowBlock | undefined,
    };

export type CFGListType = Record<string, {
    jsonObj: JsonSDFGControlFlowRegion,
    graph?: DagreGraph,
    nsdfgNode?: NestedSDFG,
}>;

export interface SDFGRendererEvent {
    'add_element': (
        type: SDFGElementType, parentUUID: string, lib?: string,
        edgeStartUUID?: string, edgeStartConn?: string, edgeDstConn?: string
    ) => void;
    'query_libnode': (callback: CallableFunction) => void;
    'exit_preview': () => void;
    'collapse_state_changed': (collapsed?: boolean, all?: boolean) => void;
    'element_position_changed': (type?: string) => void;
    'graph_edited': () => void;
    'selection_changed': (multiSelectionChanged: boolean) => void;
    'element_focus_changed': (selectionChanged: boolean) => void;
    'symbol_definition_changed': (symbol: string, definition?: number) => void;
    'active_overlays_changed': () => void;
    'backend_data_requested': (type: string, overlay: string) => void;
    'settings_changed': (
        settings: ReadonlyMap<SDFVSettingKey, SDFVSettingValT>
    ) => void;
}

// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export interface SDFGRenderer {

    on<U extends keyof SDFGRendererEvent>(
        event: U, listener: SDFGRendererEvent[U]
    ): this;

    emit<U extends keyof SDFGRendererEvent>(
        event: U, ...args: Parameters<SDFGRendererEvent[U]>
    ): boolean;

}

// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export class SDFGRenderer extends HTMLCanvasRenderer {

    public readonly overlayManager: OverlayManager;

    protected _graph?: DagreGraph;
    protected graphBoundingBox?: SimpleRect;

    protected _mouseFollowElement?: JQuery;
    protected _mouseFollowSVGs?: Record<string, string>;
    protected _addElementType?: SDFGElementType;
    protected _addModeLib?: string;
    protected _mouseMode: MouseModeT = 'pan';

    protected boxSelectionRect?: SimpleRect;
    private addElementPosition?: Point2D;
    private _addEdgeStart?: SDFGElement;
    private _addEdgeStartConnector?: Connector;
    private _ctrlKeySelection: boolean = false;
    private _shiftKeyMovement: boolean = false;
    private lastDraggedElement?: SDFGElement;
    private dragStartRealPos?: Point2D;
    private dragStartEdgePt?: number;

    protected _cfgList: CFGListType = {};
    protected _cfgTree: Record<number, number> = {};
    protected allMemletTressSDFG: Set<JsonSDFGMultiConnectorEdge>[] = [];
    protected allMemletTrees: Set<Edge>[] = [];
    protected stateParentList: SDFGElement[] = [];

    protected readonly _taskletsWithHighlighting = new Set<Tasklet>();

    protected _sdfg?: JsonSDFG;

    public constructor(
        container: HTMLElement,
        protected sdfvInstance: ISDFV,
        extMouseHandler: (
            (...args: any[]) => boolean
        ) | null = null,
        initialUserTransform: DOMMatrix | null = null,
        debugDraw = false,
        backgroundColor: string | null = null,
        modeButtons?: ModeButtons,
        enableMaskUI?: Partial<Record<SDFGRendererUIFeature, boolean>>
    ) {
        const options = HTML_CANVAS_RENDERER_DEFAULT_OPTIONS;
        for (const key of Object.keys(options)) {
            if (key in SDFVSettings.settingsDict) {
                const nVal = SDFVSettings.get(key as SDFVSettingKey);
                if (nVal !== null) {
                    options[
                        key as HTMLCanvasRendererOptionKey
                    ] = nVal as boolean;
                }
            }
        }
        options.debugDrawing = debugDraw;

        super(
            $(container), extMouseHandler, initialUserTransform,
            backgroundColor, options
        );

        this.overlayManager = new OverlayManager(this);
        // Register overlays that are on by default.
        this.overlayManager.registerOverlay(LogicalGroupOverlay);

        this.on('collapse_state_changed', () => {
            this.emit('graph_edited');
            this.layout().then(() => {
                this.drawAsync();
            }).catch(() => {
                console.error('Error while laying out SDFG');
            });
        });
        this.on('element_position_changed', () => {
            this.emit('graph_edited');
        });
        this.on('selection_changed', () => {
            if (this.ui?.localViewBtn) {
                if (this.isLocalViewViable())
                    this.ui.localViewBtn.show();
                else
                    this.ui.localViewBtn.hide();
            }

            if (this.ui?.cutoutBtn) {
                if (this.selectedRenderables.size > 0)
                    this.ui.cutoutBtn.show();
                else
                    this.ui.cutoutBtn.hide();
            }
        });
        this.on('graph_edited', () => {
            this.drawAsync();
        });

        SDFVSettings.getInstance().on('setting_changed', (setting, key) => {
            if (key in Object.keys(HTML_CANVAS_RENDERER_DEFAULT_OPTIONS)) {
                const rOptKey = key as HTMLCanvasRendererOptionKey;
                const nVal = SDFVSettings.get(key);
                if (nVal !== null)
                    this._desiredOptions[rOptKey] = nVal as boolean;
            }

            if (setting.relayout) {
                this.layout().then(() => {
                    this.drawAsync();
                }).catch(() => {
                    console.error('Error while laying out SDFG');
                });
            }

            if (setting.redrawUI) {
                this.ui?.destroy();
                const rendererUI = new SDFGRendererUI(
                    this.container, this, modeButtons, enableMaskUI
                );
                this.initUI(rendererUI);
            }

            if (setting.redraw !== false && !setting.relayout)
                this.drawAsync();

            this.emit('settings_changed', SDFVSettings.settingsDict);
        });

        const rendererUI = new SDFGRendererUI(
            this.container, this, modeButtons, enableMaskUI
        );
        this.initUI(rendererUI);

        if (initialUserTransform === null)
            this.zoomToFitContents();
    }

    // ====================
    // = Override Methods =
    // ====================

    protected onPostDraw(): void {
        super.onPostDraw();

        this.overlayManager.draw();
    }

    public destroy(): void {
        super.destroy();
        this._mouseFollowElement?.remove();
    }

    protected registerMouseHandlers(): void {
        this.canvas.addEventListener('click', this.onClick.bind(this));
        this.canvas.addEventListener('dblclick', this.onDblClick.bind(this));
        this.canvas.addEventListener('mousedown', this.onMouseDown.bind(this));
        this.canvas.addEventListener(
            'touchstart', this.onTouchStart.bind(this)
        );
        this.canvas.addEventListener('mouseup', this.onMouseUp.bind(this));
        this.canvas.addEventListener('touchend', this.onTouchEnd.bind(this));
        this.canvas.addEventListener('wheel', this.onWheel.bind(this));
        this.canvas.addEventListener('mousemove', this.onMouseMove.bind(this));
        this.canvas.addEventListener('touchmove', this.onTouchMove.bind(this));
        this.canvas.addEventListener(
            'contextmenu', this.onContextMenu.bind(this)
        );
    }

    protected initUI(ui?: SDFGRendererUI): void {
        this._ui = ui;

        this._mouseFollowSVGs = {};
        this._mouseFollowSVGs.MapEntry =
            `<svg width="8rem" height="2rem" viewBox="0 0 800 200" stroke="black" stroke-width="10" version="1.1" xmlns="http://www.w3.org/2000/svg">
                <line x1="10" x2="190" y1="190" y2="10"/>
                <line x1="190" x2="600" y1="10" y2="10"/>
                <line x1="600" x2="790" y1="10" y2="190"/>
                <line x1="790" x2="10" y1="190" y2="190"/>
            </svg>`;
        this._mouseFollowSVGs.ConsumeEntry =
            `<svg width="8rem" height="2rem" viewBox="0 0 800 200" stroke="black" stroke-width="10" stroke-dasharray="60,25" version="1.1" xmlns="http://www.w3.org/2000/svg">
                <line x1="10"x2="190" y1="190" y2="10"/>
                <line x1="190" x2="600" y1="10" y2="10"/>
                <line x1="600" x2="790" y1="10" y2="190"/>
                <line x1="790" x2="10" y1="190" y2="190"/>
            </svg>`;
        this._mouseFollowSVGs.Tasklet =
            `<svg width="2.6rem" height="1.3rem" viewBox="0 0 400 200" stroke="black" stroke-width="10" version="1.1" xmlns="http://www.w3.org/2000/svg">
                <line x1="10" x2="70" y1="130" y2="190"/>
                <line x1="70" x2="330" y1="190" y2="190"/>
                <line x1="330" x2="390" y1="190" y2="130"/>
                <line x1="390" x2="390" y1="130" y2="70"/>
                <line x1="390" x2="330" y1="70" y2="10"/>
                <line x1="330" x2="70" y1="10" y2="10"/>
                <line x1="70" x2="10" y1="10" y2="70"/>
                <line x1="10" x2="10" y1="70" y2="130"/>
            </svg>`;
        this._mouseFollowSVGs.NestedSDFG =
            `<svg width="2.6rem" height="1.3rem" viewBox="0 0 400 200" stroke="black" stroke-width="10" version="1.1" xmlns="http://www.w3.org/2000/svg">
                <line x1="40" x2="80" y1="120" y2="160"/>
                <line x1="80" x2="320" y1="160" y2="160"/>
                <line x1="320" x2="360" y1="160" y2="120"/>
                <line x1="360" x2="360" y1="120" y2="80"/>
                <line x1="360" x2="320" y1="80" y2="40"/>
                <line x1="320" x2="80" y1="40" y2="40"/>
                <line x1="80" x2="40" y1="40" y2="80"/>
                <line x1="40" x2="40" y1="80" y2="120"/>

                <line x1="10" x2="70" y1="130" y2="190"/>
                <line x1="70" x2="330" y1="190" y2="190"/>
                <line x1="330" x2="390" y1="190" y2="130"/>
                <line x1="390" x2="390" y1="130" y2="70"/>
                <line x1="390" x2="330" y1="70" y2="10"/>
                <line x1="330" x2="70" y1="10" y2="10"/>
                <line x1="70" x2="10" y1="10" y2="70"/>
                <line x1="10" x2="10" y1="70" y2="130"/>
            </svg>`;
        this._mouseFollowSVGs.LibraryNode =
            `<svg width="2.6rem" height="1.3rem" viewBox="0 0 400 200" stroke="white" stroke-width="10" version="1.1" xmlns="http://www.w3.org/2000/svg">
                <line x1="10" x2="10" y1="10" y2="190"/>
                <line x1="10" x2="390" y1="190" y2="190"/>
                <line x1="390" x2="390" y1="190" y2="55"/>
                <line x1="390" x2="345" y1="55" y2="10"/>
                <line x1="345" x2="10" y1="10" y2="10"/>
                <line x1="345" x2="345" y1="10" y2="55"/>
                <line x1="345" x2="390" y1="55" y2="55"/>
            </svg>`;
        this._mouseFollowSVGs.AccessNode =
            `<svg width="1.3rem" height="1.3rem" viewBox="0 0 200 200" stroke="black" stroke-width="10" version="1.1" xmlns="http://www.w3.org/2000/svg">
                <circle cx="100" cy="100" r="90" fill="none"/>
            </svg>`;
        this._mouseFollowSVGs.Stream =
            `<svg width="1.3rem" height="1.3rem" viewBox="0 0 200 200" stroke="black" stroke-width="10" version="1.1" xmlns="http://www.w3.org/2000/svg">
                <circle cx="100" cy="100" r="90" fill="none" stroke-dasharray="60,25"/>
            </svg>`;
        this._mouseFollowSVGs.SDFGState =
            `<svg width="1.3rem" height="1.3rem" viewBox="0 0 200 200" stroke="black" stroke-width="10" version="1.1" xmlns="http://www.w3.org/2000/svg">
                <rect x="20" y="20" width="160" height="160" style="fill:#deebf7;" />
            </svg>`;
        this._mouseFollowSVGs.Connector =
            `<svg width="1.3rem" height="1.3rem" viewBox="0 0 200 200" stroke="white" stroke-width="10" version="1.1" xmlns="http://www.w3.org/2000/svg">
                <circle cx="100" cy="100" r="40" fill="none"/>
            </svg>`;
        this._mouseFollowSVGs.Edge =
            `<svg width="1.3rem" height="1.3rem" viewBox="0 0 200 200" stroke="white" stroke-width="10" version="1.1" xmlns="http://www.w3.org/2000/svg">
                <defs>
                    <marker id="arrowhead" markerWidth="10" markerHeight="7"  refX="0" refY="3.5" orient="auto">
                        <polygon points="0 0, 10 3.5, 0 7" />
                    </marker>
                </defs>
                <line x1="20" y1="20" x2="180" y2="180" marker-end="url(#arrowhead)" />
            </svg>`;

        this._mouseFollowElement = $('<div>', {
            class: 'add-svgs-container',
        }).appendTo(this.container);

        this.ui?.updateToggleButtons();
    }

    protected _drawMinimapContents(): void {
        for (const nd of this.graph?.nodes() ?? [])
            this.graph!.node(nd)?.minimapDraw();
        for (const e of this.graph?.edges() ?? [])
            this.graph!.edge(e)?.minimapDraw();
    }

    protected setTemporaryContext(ctx: CanvasRenderingContext2D): void {
        if (!this.graph || !this.sdfg)
            return;
        doForAllDagreGraphElements((_group, _info, elem) => {
            elem.setTemporaryContext(ctx);
        }, this.graph, this.sdfg);
    }

    protected restoreContext(): void {
        if (!this.graph || !this.sdfg)
            return;
        doForAllDagreGraphElements((_group, _info, elem) => {
            elem.restoreContext();
        }, this.graph, this.sdfg);
    }

    protected internalDraw(dt?: number, ctx?: CanvasRenderingContext2D): void {
        if (!this.graph)
            return;

        drawSDFG(this, ctx ?? this.ctx, this.graph, this.realMousePos);

        if (this.boxSelectionRect) {
            this.ctx.beginPath();
            const oldLineWidth = this.ctx.lineWidth;
            this.ctx.lineWidth = this.canvasManager.pointsPerPixel;
            this.ctx.strokeStyle = 'grey';
            this.ctx.rect(
                this.boxSelectionRect.x, this.boxSelectionRect.y,
                this.boxSelectionRect.w, this.boxSelectionRect.h
            );
            this.ctx.stroke();
            this.ctx.lineWidth = oldLineWidth;
        }
    }

    public getContentsBoundingBox(): SimpleRect {
        this.recomputeGraphBoundingBox();
        return {
            x: this.graphBoundingBox?.x ?? 0,
            y: this.graphBoundingBox?.y ?? 0,
            w: this.graphBoundingBox?.w ?? 0,
            h: this.graphBoundingBox?.h ?? 0,
        };
    }

    public get selectedRenderables(): ReadonlySet<SDFGElement> {
        return this._selectedRenderables as Set<SDFGElement>;
    }

    public clearHighlighted(): void {
        super.clearHighlighted();
        for (const tasklet of this._taskletsWithHighlighting) {
            for (const token of tasklet.inputTokens)
                token.highlighted = false;
            for (const token of tasklet.outputTokens)
                token.highlighted = false;
        }
        this._taskletsWithHighlighting.clear();
    }

    // ==================
    // = Public Methods =
    // ==================

    public async setSDFG(
        sdfg: JsonSDFG, layout: boolean = true, zoomToFit: boolean = true
    ): Promise<void> {
        return new Promise((resolve) => {
            this._sdfg = sdfg;

            this.resetCFGList();
            this.resetMemletTrees(true);

            // Update info box
            if (this.selectedRenderables.size === 1) {
                const elem = Array.from(this.selectedRenderables)[0];
                const uuid = getGraphElementUUID(elem);
                if (this.graph) {
                    this.sdfvInstance.linkedUI.showElementInfo(
                        findGraphElementByUUID(this.cfgList, uuid), this
                    );
                }
            }

            if (layout) {
                this.layout().then(() => {
                    if (zoomToFit)
                        this.zoomToFitContents();
                    else
                        this.drawAsync();
                    resolve();
                }).catch(() => {
                    console.error('Error while laying out SDFG');
                    resolve();
                });
            } else {
                if (zoomToFit)
                    this.zoomToFitContents();
                else
                    this.drawAsync();
                resolve();
            }
        });
    }

    public async layout(
        instigator?: SDFGElement
    ): Promise<DagreGraph | undefined> {
        const doLayout = () => {
            if (!this.sdfg)
                return undefined;

            // Collect currently-visible elements for reorientation
            const elements = this.getVisibleElementsAsObjects(true);
            if (instigator)
                elements.push(instigator);

            // Clear the CFG list.
            for (const cfgId in this.cfgList) {
                this.cfgList[cfgId].graph = undefined;
                this.cfgList[cfgId].nsdfgNode = undefined;
            }

            this._graph = layoutSDFG(
                this, this.sdfg, this.ctx, this.minimapCtx, this.cfgList,
                this.stateParentList,
                !SDFVSettings.get<boolean>('showAccessNodes')
            );

            this.recomputeGraphBoundingBox();

            // Reorient view based on an approximate set of visible elements.
            this.reorient(elements);

            this.updateFastMemletLookup();

            this.translateMovedElements();

            this.overlayManager.refresh();

            // In a VSCode environment, we need to update the outline.
            if (this.inVSCode)
                this.sdfvInstance.outline();

            return this._graph;
        };

        return this.sdfvInstance.linkedUI.showActivityIndicatorFor(
            'Laying out SDFG', () => {
                return new Promise<DagreGraph | undefined>(
                    (resolve) => {
                        resolve(doLayout());
                    }
                );
            }
        );
    }

    public doForVisibleGraphElements(
        func: (
            group: SDFGElementGroup,
            info: SDFGElementInfo & {
                graph: DagreGraph,
                obj?: SDFGElement,
            },
            elem: SDFGElement
        ) => unknown,
        excludeClipped: boolean = false
    ): void {
        if (!this.graph || !this.sdfg)
            return;
        const viewport = this.canvasManager.updateViewport();
        doForIntersectedDagreGraphElements(
            (group, objInfo, obj) => {
                if (excludeClipped && !obj.fullyContainedInRect(
                    viewport.x, viewport.y, viewport.w, viewport.h
                ))
                    return;
                func(group, objInfo, obj);
            },
            viewport.x, viewport.y, viewport.w, viewport.h,
            this.graph, this.sdfg
        );
    }

    public getVisibleElementsAsObjects(
        excludeClipped: boolean = false
    ): SDFGElement[] {
        const elements: SDFGElement[] = [];
        this.doForVisibleGraphElements(
            (_group, _objInfo, obj) => {
                elements.push(obj);
            },
            excludeClipped
        );
        return elements;
    }

    public setSDFVInstance(instance: ISDFV): void {
        this.sdfvInstance = instance;
    }

    public saveSDFG(): void {
        if (!this.sdfg)
            return;

        const name = this.getSDFGName();
        const sdfgString = stringifySDFG(checkCompatSave(this.sdfg));
        const contents = 'data:text/json;charset=utf-8,' + encodeURIComponent(
            sdfgString
        );
        this.save(name + '.sdfg', contents);
    }

    public collapseNextLevel(): void {
        if (!this.graph)
            return;

        function recursiveCollapse(
            collapsible: NestedSDFG | EntryNode | ControlFlowBlock,
            parentElement: SDFGElement | null,
            graph: DagreGraph
        ): boolean {
            if (collapsible.attributes()?.is_collapsed)
                return false;

            let collapsedSomething = false;
            const collapsibles = [];
            const nParent = collapsible;
            let nGraph: DagreGraph | undefined = graph;
            if (collapsible instanceof NestedSDFG ||
                collapsible instanceof ControlFlowRegion) {
                for (const nid of collapsible.graph?.nodes() ?? [])
                    collapsibles.push(collapsible.graph!.node(nid));
                nGraph = collapsible.graph;
            } else if (collapsible instanceof State) {
                const scopeNodeIds =
                    collapsible.jsonData?.scope_dict?.[-1] ?? [];
                for (const nid of scopeNodeIds)
                    collapsibles.push(collapsible.graph?.node(nid.toString()));
                nGraph = collapsible.graph;
            } else {
                if (parentElement && parentElement instanceof State) {
                    const scopeNodeIds =
                        parentElement.jsonData?.scope_dict?.[collapsible.id];
                    for (const nid of scopeNodeIds ?? [])
                        collapsibles.push(graph.node(nid.toString()));
                }
            }

            for (const node of collapsibles) {
                if ((node instanceof NestedSDFG || node instanceof State ||
                     node instanceof EntryNode ||
                     node instanceof ControlFlowRegion) && nGraph) {
                    const recursiveRes = recursiveCollapse(
                        node, nParent, nGraph
                    );
                    collapsedSomething ||= recursiveRes;
                }
            }

            const attrs = collapsible.attributes();
            if (!collapsedSomething && attrs)
                attrs.is_collapsed = true;
            return true;
        }

        let collapsed = false;
        for (const sId of this.graph.nodes()) {
            const state = this.graph.node(sId) as ControlFlowBlock;
            const res = recursiveCollapse(state, null, this.graph);
            collapsed ||= res;
        }

        if (collapsed)
            this.emit('collapse_state_changed', false, true);
    }

    public collapseAll(): void {
        if (!this.sdfg || !this.graph)
            return;

        doForAllJsonSDFGElements(
            (_t, _d, obj) => {
                if (obj.attributes && 'is_collapsed' in obj.attributes &&
                    !obj.type.endsWith('Exit'))
                    obj.attributes.is_collapsed = true;
            }, this.sdfg
        );

        this.emit('collapse_state_changed', true, true);
    }

    public expandNextLevel(): void {
        if (!this.sdfg || !this.graph)
            return;

        traverseSDFGScopes(
            this.graph, (node, _) => {
                const attrs = node.attributes();
                if (attrs && 'is_collapsed' in attrs && attrs.is_collapsed) {
                    attrs.is_collapsed = false;
                    return false;
                }
                return true;
            }
        );

        this.emit('collapse_state_changed', false, true);
    }

    public expandAll(): void {
        if (!this.sdfg || !this.graph)
            return;

        doForAllJsonSDFGElements(
            (_t, _d, obj) => {
                if (obj.attributes && 'is_collapsed' in obj.attributes &&
                    !obj.type.endsWith('Exit'))
                    obj.attributes.is_collapsed = false;
            }, this.sdfg
        );

        this.emit('collapse_state_changed', false, true);
    }

    public async exitLocalView(): Promise<void> {
        if (!(this.sdfvInstance instanceof SDFV))
            return;

        if (this.sdfvInstance instanceof WebSDFV)
            await this.sdfvInstance.setSDFG(this.sdfg);
    }

    public async localViewSelection(): Promise<void> {
        if (!this.graph || !this.sdfg || !(this.sdfvInstance instanceof SDFV))
            return;

        // Transition to the local view by first cutting out the selection.
        try {
            const origSdfg = stringifySDFG(this.sdfg);
            await this.cutoutSelection(true);
            const lRenderer =
                new LViewRenderer(this.sdfvInstance, this.container[0]);
            const lGraph = await parseGraph(this.graph, lRenderer);
            if (lGraph) {
                layoutGraph(lGraph);
                lRenderer.graph = lGraph;

                // Set a button to exit the local view again.
                const exitBtn = $('<button>', {
                    class: 'button',
                    css: {
                        'position': 'absolute',
                        'top': '10px',
                        'left': '10px',
                        'user-select': 'none',
                        'padding-bottom': '0px',
                    },
                    html: '<i class="material-symbols-outlined">close</i>',
                    title: 'Exit local view',
                }).appendTo(this.container);
                exitBtn.on('click', () => {
                    this._sdfg = parseSDFG(origSdfg);
                    void this.exitLocalView();
                    exitBtn.remove();
                });
                this.container.append(exitBtn);

                this.sdfvInstance.setLocalViewRenderer(lRenderer);
            }
        } catch (e) {
            if (e instanceof LViewGraphParseError)
                showErrorModal(e.message);
            else
                throw e;
        }
    }

    public async cutoutSelection(
        _suppressSave: boolean = false
    ): Promise<void> {
        /* Rule set for creating a cutout subgraph:
         * Edges are selected according to the subgraph nodes - all edges
         * between subgraph nodes are preserved.
         * In any element that contains other elements (state, nested SDFG,
         * scopes), the full contents are used.
         * If more than one element is selected from different contexts (two
         * nodes from two states), the parents will be preserved.
         */
        // Collect nodes and states
        const cfgs: Set<number> = new Set<number>();
        const blocks: Record<string, Set<number>> = {};
        const nodes: Record<string, Set<number>> = {};

        function addCutoutNode(cfgId: number, node: SDFGNode): void {
            const stateId = node.parentStateId ?? -1;
            const stateUUID: string = JSON.stringify([cfgId, stateId]);
            if (stateUUID in nodes)
                nodes[stateUUID].add(node.id);
            else
                nodes[stateUUID] = new Set([node.id]);
            blocks[cfgId].add(stateId);
        }

        function addCutoutBlock(cfgId: number, block: ControlFlowBlock): void {
            // Add all nodes from the state to the filter.
            const uuid: string = JSON.stringify([cfgId, block.id]);
            if (block instanceof State) {
                if (!block.jsonData)
                    nodes[uuid] = new Set();
                else
                    nodes[uuid] = new Set([...block.jsonData.nodes.keys()]);
            }
            blocks[cfgId].add(block.id);
        }

        function addCutoutCFG(cfgId: number, cfgNode: ControlFlowRegion): void {
            // Add all contents of the CFG.
            const ownCfgId = cfgNode.jsonData?.cfg_list_id ?? -1;
            cfgs.add(ownCfgId);
            if (!(ownCfgId in blocks))
                blocks[ownCfgId] = new Set();

            if (cfgNode.data?.graph) {
                for (const blockId of cfgNode.jsonData?.nodes.keys() ?? []) {
                    const block = cfgNode.graph?.node(blockId.toString());
                    if (!block)
                        continue;
                    if (block instanceof ControlFlowRegion) {
                        const nCfgId = block.jsonData?.cfg_list_id ?? -1;
                        cfgs.add(nCfgId);
                        addCutoutCFG(ownCfgId, block);
                    } else {
                        addCutoutBlock(ownCfgId, block);
                    }
                }
            } else {
                for (const blockId of cfgNode.jsonData?.nodes.keys() ?? [])
                    blocks[ownCfgId].add(blockId);
            }

            blocks[cfgId].add(cfgNode.id);
        }

        for (const elem of this.selectedRenderables) {
            // Ignore edges and connectors
            if (elem instanceof Edge || elem instanceof Connector)
                continue;

            const cfg = elem.cfg!;
            const cfgId = cfg.cfg_list_id;
            cfgs.add(cfgId);
            if (!(cfgId in blocks))
                blocks[cfgId] = new Set();

            if (elem instanceof ControlFlowRegion)
                addCutoutCFG(cfgId, elem);
            else if (elem instanceof ControlFlowBlock)
                addCutoutBlock(cfgId, elem);
            else if (elem instanceof SDFGNode)
                addCutoutNode(cfgId, elem);
        }

        // Clear selection and redraw
        this.deselect();

        if (Object.keys(nodes).length + Object.keys(blocks).length === 0) {
            // Nothing to cut out
            this.drawAsync();
            return;
        }

        // Find root SDFG and root state (if possible)
        const rootCFGId = findRootCFG(cfgs, this.cfgTree, this.cfgList, false);
        const rootSDFGId = findRootCFG(
            cfgs, this.cfgTree, this.cfgList, true
        );
        const needToFlatten = rootSDFGId !== rootCFGId;
        if (rootSDFGId !== null && rootCFGId !== null) {
            const rootSDFG = this.cfgList[rootSDFGId].jsonObj;
            const rootCFG = this.cfgList[rootCFGId].jsonObj;
            if (rootSDFG.type !== 'SDFG')
                throw Error('Cutout needs root CFG of type SDFG');

            // For every participating state, filter out irrelevant nodes and
            // memlets.
            for (const nkey of Object.keys(nodes)) {
                const [cfgId, stateId] = JSON.parse(nkey) as [string, number];
                const cfg = this.cfgList[cfgId].jsonObj;
                deleteSDFGNodes(
                    cfg, stateId, Array.from(nodes[nkey].values()), true
                );
            }

            // For every participating CFG, filter out irrelevant states and
            // interstate edges.
            for (const cfgId of Object.keys(blocks)) {
                const cfg = this.cfgList[cfgId].jsonObj;
                deleteCFGBlocks(cfg, Array.from(blocks[cfgId].values()), true);
            }

            // Ensure that the cutout contains only what is being cut out of
            // the target root CFG. The root SDFG is used to piggyback in the
            // necessary SDFG information.
            if (needToFlatten) {
                rootSDFG.nodes = rootCFG.nodes;
                rootSDFG.edges = rootCFG.edges;
            }

            // Set root SDFG as the new SDFG
            return this.setSDFG(rootSDFG as JsonSDFG);
        }
    }

    public deselect(): void {
        const multiSelectionChanged = this.selectedRenderables.size > 1;
        this.clearSelected();
        this.emit('selection_changed', multiSelectionChanged);
    }

    // ====================
    // = Internal Methods =
    // ====================

    public resetElementPositions(): void {
        if (!this.graph || !this.sdfg)
            return;

        doForAllDagreGraphElements(
            (_t, _d, obj) => {
                deletePositioningInfo(obj);
            }, this.graph, this.sdfg
        );

        this.emit('element_position_changed', 'reset');

        this.layout().then(() => {
            this.drawAsync();
        }).catch(() => {
            console.error('Error while laying out SDFG');
        });
    }

    public getSDFGName(): string {
        return (this.sdfg?.attributes && 'name' in this.sdfg.attributes) ?
            this.sdfg.attributes.name as string : 'program';
    }

    /**
     * Reorient view based on an approximate set of visible elements.
     * @param oldVisibleElements The set of visible elements before a change.
     */
    protected reorient(oldVisibleElements: SDFGElement[]): void {
        // Nothing to reorient to.
        if (oldVisibleElements.length === 0 || !this.graph || !this.sdfg)
            return;

        // If the current view contains everything that was visible before,
        // no need to change anything.
        const newVisibleElements = this.getVisibleElementsAsObjects(true);
        const oldNodes = oldVisibleElements.filter(x => (
            x instanceof ControlFlowBlock ||
            x instanceof SDFGNode));
        const newNodes = newVisibleElements.filter(x => (
            x instanceof ControlFlowBlock ||
            x instanceof SDFGNode));
        const oldSet = new Set(oldNodes.map(x => x.guid));
        const newSet = new Set(newNodes.map(x => x.guid));
        const diff = new Set([...oldSet].filter(x => !newSet.has(x)));
        if (diff.size === 0)
            return;

        // Reorient based on old visible elements refreshed to new locations
        const oldElementsInNewLayout: SDFGElement[] = [];
        doForAllDagreGraphElements(
            (
                _group: SDFGElementGroup, _info: SDFGElementInfo,
                elem: SDFGElement
            ) => {
                if (elem instanceof ControlFlowBlock ||
                    elem instanceof SDFGNode
                ) {
                    if (oldSet.has(elem.guid))
                        oldElementsInNewLayout.push(elem);
                }
            }, this.graph, this.sdfg
        );

        this.zoomToFit(oldElementsInNewLayout, true, undefined, false);
    }

    protected recomputeGraphBoundingBox(): void {
        const topLevelBlocks: SDFGElement[] = [];
        if (this.graph) {
            for (const bId of this.graph.nodes()) {
                const node = this.graph.node(bId);
                if (node)
                    topLevelBlocks.push(node);
            }
        }
        this.graphBoundingBox = boundingBox(topLevelBlocks);
    }

    protected resetCFGList(): void {
        if (!this.sdfg)
            return;

        this._cfgTree = {};
        this._cfgList = {};
        this.cfgList[this.sdfg.cfg_list_id] = {
            jsonObj: this.sdfg,
            graph: undefined,
            nsdfgNode: undefined,
        };

        doForAllJsonSDFGElements(
            (_oGroup, oInfo, obj) => {
                const cfgId = (obj as JsonSDFGControlFlowRegion).cfg_list_id;
                if (obj.type === SDFGElementType.NestedSDFG.toString() &&
                    obj.attributes?.sdfg) {
                    const nsdfg = obj.attributes.sdfg as JsonSDFG;
                    this.cfgTree[nsdfg.cfg_list_id] =
                        oInfo.sdfg.cfg_list_id;
                    this.cfgList[nsdfg.cfg_list_id] = {
                        jsonObj: nsdfg,
                        graph: undefined,
                        nsdfgNode: undefined,
                    };
                } else if (cfgId >= 0) {
                    this.cfgTree[cfgId] = oInfo.cfgId;
                    this.cfgList[cfgId] = {
                        jsonObj: obj as JsonSDFGControlFlowRegion,
                        graph: undefined,
                        nsdfgNode: undefined,
                    };
                }
            }, this.sdfg
        );
    }

    protected updateFastMemletLookup(): void {
        this.allMemletTrees = [];
        for (const mt of this.allMemletTressSDFG) {
            const newTree = new Set<Edge>();
            for (const edge of mt) {
                const graphEdge = (edge.attributes?.data as {
                    edge?: Edge
                } | undefined)?.edge;
                if (graphEdge)
                    newTree.add(graphEdge);
            }
            this.allMemletTrees.push(newTree);
        }
    }

    protected resetMemletTrees(ignoreCollapsed: boolean = false): void {
        if (!this.sdfg)
            return;

        this.allMemletTressSDFG = memletTreeComplete(
            this.sdfg, ignoreCollapsed
        );
        this.updateFastMemletLookup();
    }

    protected translateMovedElements(): void {
        if (!this.graph)
            return;

        traverseSDFGScopes(
            this.graph,
            (node: SDFGElement, graph: DagreGraph) => {
                let scopeDx = 0;
                let scopeDy = 0;

                function addScopeMovement(n: SDFGNode) {
                    const nObj = n.jsonData;
                    if (nObj && 'scope_entry' in nObj && nObj.scope_entry) {
                        const scopeEntryNode = graph.node(
                            nObj.scope_entry
                        ) as SDFGNode | undefined;
                        if (scopeEntryNode) {
                            const sp = getPositioningInfo(scopeEntryNode);
                            if (sp && Number.isFinite(sp.scopeDx) &&
                                Number.isFinite(sp.scopeDy)) {
                                scopeDx += sp.scopeDx ?? 0;
                                scopeDy += sp.scopeDy ?? 0;
                            }
                            addScopeMovement(scopeEntryNode);
                        }
                    }
                }

                // Only add scope movement for nodes (and not states)
                if (node instanceof SDFGNode)
                    addScopeMovement(node);

                let dx = scopeDx;
                let dy = scopeDy;

                const position = getPositioningInfo(node);
                if (position) {
                    dx += position.dx ?? 0;
                    dy += position.dy ?? 0;
                }

                if (dx || dy) {
                    // Move the element
                    if (this.graph) {
                        this.translateElement(
                            node, this.graph, { x: node.x, y: node.y },
                            { x: node.x + dx, y: node.y + dy }, false
                        );
                    }
                }

                // Move edges (outgoing only)
                graph.inEdges(node.id.toString())?.forEach(edgeId => {
                    const edge = graph.edge(edgeId);
                    if (!edge)
                        return;
                    const edgePos = getPositioningInfo(edge);

                    let finalPosD;
                    // If edges are moved within a given scope, update the point
                    // movements
                    if (scopeDx || scopeDy) {
                        finalPosD = [];
                        // never move first (and last) point manually
                        finalPosD.push({ x: 0, y: 0 });
                        for (let i = 1; i < edge.points.length - 1; i++) {
                            finalPosD.push({ x: scopeDx, y: scopeDy });
                            if (edgePos?.points) {
                                finalPosD[i].x += edgePos.points[i].x;
                                finalPosD[i].y += edgePos.points[i].y;
                            }
                        }
                        // never move last (and first) point manually
                        finalPosD.push({ x: 0, y: 0 });
                    } else if (edgePos?.points) {
                        finalPosD = edgePos.points;
                    }
                    if (finalPosD) {
                        // Move the element
                        if (this.graph) {
                            this.translateElement(
                                edge, this.graph, { x: 0, y: 0 },
                                { x: 0, y: 0 }, false, false, finalPosD
                            );
                        }
                    }
                });
                return true;
            }
        );
    }

    protected translateElement(
        el: SDFGElement,
        entireGraph: DagreGraph,
        oldMousePos: Point2D,
        newMousePos: Point2D,
        updatePositionInfo: boolean,
        moveEntireEdge: boolean = false,
        edgeDPoints?: Point2D[]
    ): void {
        this.canvasManager.stopAnimation();

        // Edges connected to the moving element
        const outEdges: Edge[] = [];
        const inEdges: Edge[] = [];

        // Find the parent graph in the list of available SDFGs
        let parentGraph = this.cfgList[el.cfg!.cfg_list_id].graph;
        let parentElement: SDFGElement | undefined = undefined;

        if (entireGraph !== parentGraph && (
            el instanceof State || el instanceof InterstateEdge
        )) {
            // If the parent graph and the entire SDFG shown are not the same,
            // we're currently in a nested SDFG. If we're also moving a state,
            // this means that its parent element is found in the list of
            // parents to states (state_parent_list)
            parentElement = this.stateParentList[el.cfg!.cfg_list_id];
        } else if (el.parentStateId !== undefined && parentGraph) {
            // If the parent_id isn't null and there is a parent graph, we can
            // look up the parent node via the element's parent_id
            parentElement = parentGraph.node(el.parentStateId.toString());
            // If our parent element is a state, we want the state's graph
            if (parentElement instanceof State)
                parentGraph = parentElement.graph;
        }

        if (parentGraph && !(el instanceof Edge)) {
            // Find all the edges connected to the moving node
            parentGraph.outEdges(el.id.toString())?.forEach(edgeId => {
                const edge = parentGraph.edge(edgeId);
                if (edge)
                    outEdges.push(edge);
            });
            parentGraph.inEdges(el.id.toString())?.forEach(edgeId => {
                const edge = parentGraph.edge(edgeId);
                if (edge)
                    inEdges.push(edge);
            });
        }

        // Compute theoretical initial displacement/movement
        let dx = newMousePos.x - oldMousePos.x;
        let dy = newMousePos.y - oldMousePos.y;

        // If edge, find closest point to drag start position
        let pt = -1;
        if (el instanceof Edge) {
            if (moveEntireEdge) {
                pt = -2;
            } else if (edgeDPoints && edgeDPoints.length > 0) {
                pt = -3;
            } else if (this.dragStartRealPos) {
                // Find closest point to old mouse position
                if (this.dragStartEdgePt === undefined) {
                    let dist: number | undefined = undefined;
                    el.points.forEach((p, i) => {
                        // Only allow dragging if the memlet has more than two
                        // points
                        if (i === 0 || i === el.points.length - 1)
                            return;
                        const ddx = p.x - this.dragStartRealPos!.x;
                        const ddy = p.y - this.dragStartRealPos!.y;
                        const curdist = ddx * ddx + ddy * ddy;
                        if (dist === undefined || curdist < dist) {
                            dist = curdist;
                            pt = i;
                        }
                    });
                    this.dragStartEdgePt = pt;
                } else {
                    pt = this.dragStartEdgePt;
                }
            }
        }

        if (parentElement) {
            // Calculate the box to bind the element to. This is given by
            // the parent element, i.e. the element where out to-be-moved
            // element is contained within
            const parentLeftBorder =
                (parentElement.x - (parentElement.width / 2));
            const parentRightBorder =
                parentLeftBorder + parentElement.width;
            const parentTopBorder =
                (parentElement.y - (parentElement.height / 2));
            const parentBottomBorder =
                parentTopBorder + parentElement.height;

            let elHMargin = el.height / 2;
            let elWMargin = el.width / 2;
            if (el instanceof Edge)
                elHMargin = elWMargin = 0;
            const minX = parentLeftBorder + elWMargin;
            const minY = parentTopBorder + elHMargin;
            const maxX = parentRightBorder - elWMargin;
            const maxY = parentBottomBorder - elHMargin;

            // Make sure we don't move our element outside its parent's
            // bounding box. If either the element or the mouse pointer are
            // outside the parent, we clamp movement in that direction
            if (el instanceof Edge) {
                if (pt > 0) {
                    const points = el.points;
                    const targetX = points[pt].x + dx;
                    const targetY = points[pt].y + dy;
                    if (targetX <= minX ||
                        newMousePos.x <= parentLeftBorder)
                        dx = minX - points[pt].x;
                    else if (targetX >= maxX ||
                        newMousePos.x >= parentRightBorder)
                        dx = maxX - points[pt].x;
                    if (targetY <= minY ||
                        newMousePos.y <= parentTopBorder)
                        dy = minY - points[pt].y;
                    else if (targetY >= maxY ||
                        newMousePos.y >= parentBottomBorder)
                        dy = maxY - points[pt].y;
                }
            } else {
                const targetX = el.x + dx;
                const targetY = el.y + dy;
                if (targetX <= minX ||
                    newMousePos.x <= parentLeftBorder)
                    dx = minX - el.x;
                else if (targetX >= maxX ||
                    newMousePos.x >= parentRightBorder)
                    dx = maxX - el.x;
                if (targetY <= minY ||
                    newMousePos.y <= parentTopBorder)
                    dy = minY - el.y;
                else if (targetY >= maxY ||
                    newMousePos.y >= parentBottomBorder)
                    dy = maxY - el.y;
            }
        }

        if (el instanceof Edge) {
            const points = el.points;
            let position;
            if (updatePositionInfo) {
                position = getPositioningInfo(el);
                position ??= initializePositioningInfo(el);
            }
            if (pt > 0) {
                // Move point
                points[pt].x += dx;
                points[pt].y += dy;

                // Move edge bounding box
                updateEdgeBoundingBox(el);

                if (updatePositionInfo) {
                    position = getPositioningInfo(el);
                    position ??= initializePositioningInfo(el);

                    position.points = Array(points.length) as Point2D[];
                    for (let i = 0; i < points.length; i++)
                        position.points[i] = { x: 0, y: 0 };

                    position.points[pt].x += dx;
                    position.points[pt].y += dy;
                }
            } else if (pt === -2) {
                // Don't update first and last point (the connectors)
                for (let i = 1; i < points.length - 1; i++) {
                    points[i].x += dx;
                    points[i].y += dy;
                }

                if (updatePositionInfo) {
                    position = getPositioningInfo(el);
                    position ??= initializePositioningInfo(el);

                    for (let i = 1; i < points.length - 1; i++) {
                        position.points[i].x += dx;
                        position.points[i].y += dy;
                    }
                }
            } else if (pt === -3 && edgeDPoints) {
                for (let i = 1; i < points.length - 1; i++) {
                    points[i].x += edgeDPoints[i].x;
                    points[i].y += edgeDPoints[i].y;
                }
            }
            // The rest of the method doesn't apply to Edges
            return;
        }

        // Move a node together with its connectors if it has any.
        function moveNode(node: SDFGNode | ControlFlowBlock) {
            node.x += dx;
            node.y += dy;
            if (node instanceof SDFGNode) {
                if (node instanceof NestedSDFG && node.jsonData && node.graph)
                    translateRecursive(node.graph);
                node.inConnectors.forEach(c => {
                    c.x += dx;
                    c.y += dy;
                });
                node.outConnectors.forEach(c => {
                    c.x += dx;
                    c.y += dy;
                });
            } else if (!node.attributes()?.is_collapsed) {
                // We're moving a control flow block, move all its contents too.
                node.graph?.nodes().forEach(nodeId => {
                    const nNode = node.graph!.node(nodeId);
                    if (nNode)
                        moveNode(nNode);
                });

                // Drag all the edges along
                node.graph?.edges().forEach(edgeId => {
                    const edge = node.graph!.edge(edgeId);
                    if (edge) {
                        edge.x += dx;
                        edge.y += dy;
                        edge.points.forEach((point: Point2D) => {
                            point.x += dx;
                            point.y += dy;
                        });
                        updateEdgeBoundingBox(edge);
                    }
                });
            }
        }

        // Allow recursive translation of nested SDFGs
        function translateRecursive(ng: DagreGraph) {
            ng.nodes().forEach(stateId => {
                const state = ng.node(stateId);
                if (!state)
                    return;
                state.x += dx;
                state.y += dy;
                const g = state.graph;
                g?.nodes().forEach(nodeId => {
                    const node = g.node(nodeId);
                    if (node)
                        moveNode(node);
                });

                g?.edges().forEach(edgeId => {
                    const edge = g.edge(edgeId);
                    if (edge) {
                        edge.x += dx;
                        edge.y += dy;
                        edge.points.forEach((point: Point2D) => {
                            point.x += dx;
                            point.y += dy;
                        });
                        updateEdgeBoundingBox(edge);
                    }
                });
            });
            ng.edges().forEach(edgeId => {
                const edge = ng.edge(edgeId);
                if (edge) {
                    edge.x += dx;
                    edge.y += dy;
                    edge.points.forEach(point => {
                        point.x += dx;
                        point.y += dy;
                    });
                    updateEdgeBoundingBox(edge);
                }
            });
        }

        moveNode(el as SDFGNode | ControlFlowBlock);

        // Store movement information in element (for relayouting).
        if (updatePositionInfo) {
            let position = getPositioningInfo(el);
            position ??= initializePositioningInfo(el);

            position.dx ??= 0;
            position.dy ??= 0;
            position.dx += dx;
            position.dy += dy;

            // Store movement information if EntryNode for other nodes of the
            // same scope.
            if (el instanceof EntryNode && el.attributes()?.is_collapsed) {
                position.scopeDx ??= 0;
                position.scopeDy ??= 0;
                position.scopeDx += dx;
                position.scopeDy += dy;
            }
        }

        // Move the connected edges along with the element
        outEdges.forEach(edge => {
            const points = edge.points;
            const n = points.length - 1;
            let moved = false;
            if (edge.srcConnector !== undefined) {
                for (const conn of el.outConnectors) {
                    if (conn.data?.name === edge.srcConnector) {
                        const connRect = {
                            x: conn.x, y: conn.y, w: conn.width, h: conn.height,
                        };
                        points[0] = findLineStartRectIntersection(
                            connRect, points[1]
                        );
                        moved = true;
                        break;
                    }
                }
            }
            if (!moved) {
                points[0].x += dx;
                points[0].y += dy;
            }
            // Also update destination point of edge
            if (edge.dstConnector !== undefined) {
                const parState = (parentElement as State | undefined)?.jsonData;
                const e = parState?.edges[edge.id];
                if (e) {
                    const dstEl = parentGraph?.node(e.dst);
                    if (dstEl) {
                        for (const conn of dstEl.inConnectors) {
                            const dstName = conn.data?.name;
                            if (dstName === edge.dstConnector) {
                                const connRect = {
                                    x: conn.x,
                                    y: conn.y,
                                    w: conn.width,
                                    h: conn.height,
                                };
                                points[n] = findLineStartRectIntersection(
                                    connRect, points[n - 1]
                                );
                                break;
                            }
                        }
                    }
                }
            }
            updateEdgeBoundingBox(edge);
        });
        inEdges.forEach(edge => {
            const points = edge.points;
            const n = points.length - 1;
            let moved = false;
            if (edge.dstConnector !== undefined) {
                for (const conn of el.inConnectors) {
                    if (conn.data?.name === edge.dstConnector) {
                        const connRect = {
                            x: conn.x, y: conn.y, w: conn.width, h: conn.height,
                        };
                        points[n] = findLineStartRectIntersection(
                            connRect, points[n - 1]
                        );
                        moved = true;
                        break;
                    }
                }
            }
            if (!moved) {
                points[n].x += dx;
                points[n].y += dy;
            }
            // Also update source point of edge
            if (edge.srcConnector !== undefined) {
                const parState = (parentElement as State | undefined)?.jsonData;
                const e = parState?.edges[edge.id];
                if (e) {
                    const srcEl = parentGraph?.node(e.src);
                    if (srcEl) {
                        for (const conn of srcEl.outConnectors) {
                            const srcName = conn.data?.name;
                            if (srcName === edge.srcConnector) {
                                const connRect = {
                                    x: conn.x,
                                    y: conn.y,
                                    w: conn.width,
                                    h: conn.height,
                                };
                                points[0] = findLineStartRectIntersection(
                                    connRect, points[1]
                                );
                                break;
                            }
                        }
                    }
                }
            }
            updateEdgeBoundingBox(edge);
        });
    }

    private isLocalViewViable(): boolean {
        if (this.selectedRenderables.size > 0) {
            if (this.selectedRenderables.size === 1 &&
                Array.from(this.selectedRenderables)[0] instanceof State)
                return true;

            // Multiple elements are selected. The local view is only a viable
            // option if all selected elements are inside the same state. If a
            // state is selected alongside other elements, all elements must be
            // inside that state.
            let parentStateId = undefined;
            for (const elem of this.selectedRenderables) {
                if (elem instanceof State) {
                    if (parentStateId === undefined)
                        parentStateId = elem.id;
                    else if (parentStateId !== elem.id)
                        return false;
                } else if (elem instanceof Connector || elem instanceof Edge) {
                    continue;
                } else {
                    if (elem.parentStateId === undefined)
                        return false;
                    else if (parentStateId === undefined)
                        parentStateId = elem.parentStateId;
                    else if (parentStateId !== elem.parentStateId)
                        return false;
                }
            }
            return true;
        }
        return false;
    }

    // Returns a dictionary of SDFG elements in a given rectangle. Used for
    // selection, rendering, localized transformations, etc.
    // The output is a dictionary of lists of dictionaries. The top-level keys
    // are:
    // states, controlFlowRegions, controlFlowBlocks, nodes, connectors, edges,
    // interstateEdges.
    // For example:
    // {
    //  'states': [{sdfg: sdfg_name, state: 1}, ...],
    //  'nodes': [{sdfg: sdfg_name, state: 1, node: 5}, ...],
    //  'edges': [],
    //  'interstateEdges': [],
    //  'connectors': [],
    //  'controlFlowRegions': [],
    //  'controlFlowBlocks': [],
    // }
    public elementsInRect(
        x: number, y: number, w: number, h: number
    ): Record<SDFGElementGroup, DagreGraphElementInfo[]> {
        const elements: Record<SDFGElementGroup, DagreGraphElementInfo[]> = {
            states: [],
            nodes: [],
            connectors: [],
            edges: [],
            interstateEdges: [],
            controlFlowRegions: [],
            controlFlowBlocks: [],
        };
        if (this.graph && this.sdfg) {
            doForIntersectedDagreGraphElements(
                (group, objInfo, obj) => {
                    objInfo.obj = obj;
                    elements[group].push(objInfo);
                }, x, y, w, h, this.graph, this.sdfg
            );
        }
        return elements;
    }

    private findElementsUnderCursor(mouseX: number, mouseY: number): {
        totalElements: number,
        elements: Record<SDFGElementGroup, DagreGraphElementInfo[]>,
        foregroundElement?: SDFGElement,
        foregroundConnector?: Connector,
    } {
        // Find all elements under the cursor.
        const elements = this.elementsInRect(mouseX, mouseY, 0, 0);
        const states = elements.states;
        const nodes = elements.nodes;
        const edges = elements.edges;
        const interstateEdges = elements.interstateEdges;
        const connectors = elements.connectors;
        const cfRegions = elements.controlFlowRegions;
        const cfBlocks = elements.controlFlowBlocks;
        const totalElements =
            states.length + nodes.length +
            edges.length + interstateEdges.length +
            connectors.length + cfRegions.length +
            cfBlocks.length;
        let foregroundElement = undefined;
        let foregroundSurface = -1;
        let foregroundConnector = undefined;

        // Find the top-most element under the mouse cursor (i.e. the one with
        // the smallest dimensions).
        const categories = [
            states,
            interstateEdges,
            nodes,
            edges,
            cfRegions,
            cfBlocks,
        ];
        for (const category of categories) {
            for (const inf of category) {
                const s = (inf.obj?.width ?? 0) * (inf.obj?.height ?? 0);
                if (foregroundSurface < 0 || s < foregroundSurface) {
                    foregroundSurface = s;
                    foregroundElement = inf.obj;
                }
            }
        }

        for (const c of connectors) {
            const s = (c.obj?.width ?? 0) * (c.obj?.height ?? 0);
            if (foregroundSurface < 0 || s < foregroundSurface) {
                foregroundSurface = s;
                foregroundConnector = c.obj as Connector;
            }
        }

        return {
            totalElements: totalElements,
            elements,
            foregroundElement,
            foregroundConnector,
        };
    }

    // Toggles collapsed state of foreground_elem if applicable.
    // Returns true if re-layout occured and re-draw is necessary.
    private toggleElementCollapse(fgElem?: SDFGElement): boolean {
        if (!fgElem?.COLLAPSIBLE)
            return false;

        const sdfg = fgElem.sdfg;
        let sdfgElem = fgElem.jsonData;
        // If a scope exit node, use entry instead
        if (sdfgElem && fgElem.type.endsWith('Exit') &&
            fgElem.parentStateId !== undefined) {
            const parent = sdfg.nodes[fgElem.parentStateId];
            const scopeEntry = 'scope_entry' in sdfgElem ?
                sdfgElem.scope_entry as number : undefined;
            if (parent.nodes && scopeEntry)
                sdfgElem = parent.nodes[scopeEntry];
        }

        const attrs = sdfgElem?.attributes;
        if (attrs) {
            if ('is_collapsed' in attrs)
                attrs.is_collapsed = !attrs.is_collapsed;
            else
                attrs.is_collapsed = true;
        } else {
            return false;
        }

        this.emit('collapse_state_changed');
        return true;
    }

    private recomputeHoveredElements(
        elements: Record<SDFGElementGroup, DagreGraphElementInfo[]>
    ): boolean {
        if (!this.mousePos)
            return false;

        // Clear the previously hovered elements and add newly hovered elements
        // under the mouse cursor.
        const prevHovered = new Set(this.hoveredRenderables);
        this.clearHovered();
        for (const elInfo of Object.entries(elements)) {
            const elemTypeArray = elInfo[1];
            for (const elemType of elemTypeArray) {
                const hoveredElem = elemType.obj;
                if (hoveredElem !== undefined)
                    this.hoverRenderable(hoveredElem);
            }
        }

        // Local change boolean, for each visible element checked. Prevents
        // recomputations if nothing changed.
        let hoverChanged = false;
        if (this.hoveredRenderables.size !== prevHovered.size) {
            hoverChanged = true;
        } else {
            for (const el of this.hoveredRenderables) {
                if (!prevHovered.has(el)) {
                    hoverChanged = true;
                    break;
                }
            }
        }

        if (!hoverChanged)
            return false;

        // Recompute any elements that need to be highlighted based on the
        // current hovered elements.
        this.clearHighlighted();

        // Only do highlighting re-computation if view is close enough to
        // actually see the highlights. Done by points-per-pixel metric using
        // SDFV.NODE_LOD as the threshold. Hence, the highlights only
        // update/become visible if there are nodes visible to hover over. This
        // greatly reduces CPU utilization when moving/hovering the mouse over
        // large graphs.
        const ppp = this.canvasManager.pointsPerPixel;
        if (ppp < SDFVSettings.get<number>('nodeLOD')) {
            // Mark highlighted elements as a result of hovered elements.
            for (const obj of this.hoveredRenderables) {
                if (obj instanceof Edge && obj.parentStateId !== undefined) {
                    // Highlight all edges of the memlet tree
                    const tree = this.getNestedMemletTree(obj);
                    tree.forEach(te => {
                        if (te !== obj)
                            this.highlightRenderable(te);
                    });
                } else if (obj instanceof AccessNode) {
                    // Highlight all access nodes with the same name in the
                    // same sdfg / nested SDFG.
                    traverseSDFGScopes(
                        this.cfgList[obj.sdfg.cfg_list_id].graph!,
                        node => {
                            // If node is a state, then visit
                            // sub-scope.
                            if (node instanceof State)
                                return true;
                            const nData = node.jsonData;
                            const oNData = obj.jsonData;
                            if (node instanceof AccessNode && nData &&
                                oNData && 'label' in nData &&
                                'label' in oNData &&
                                nData.label === oNData.label)
                                this.highlightRenderable(node);
                            // No need to visit sub-scope
                            return false;
                        }
                    );
                } else if (obj instanceof Connector) {
                    // Highlight the incoming/outgoing Edge
                    const parentNode = obj.linkedElem;
                    if (!(parentNode?.hovered)) {
                        const state = obj.linkedElem?.parentElem;
                        if (state && state instanceof State) {
                            const stateJson = state.jsonData;
                            const stateGraph = state.graph;
                            stateJson?.edges.forEach(
                                (edge, id) => {
                                    if (edge.src_connector === obj.data?.name ||
                                        edge.dst_connector === obj.data?.name) {
                                        const gedge = stateGraph?.edge({
                                            v: edge.src,
                                            w: edge.dst,
                                            name: id.toString(),
                                        });
                                        if (gedge)
                                            this.highlightRenderable(gedge);
                                    }
                                }
                            );
                        }

                        // If the connector is on a nested SDFG, highlight
                        // the corresponding access node inside the nested
                        // sdfg.
                        if (parentNode instanceof NestedSDFG &&
                            parentNode.graph) {
                            traverseSDFGScopes(
                                parentNode.graph, node => {
                                    if (node instanceof ControlFlowRegion ||
                                        node instanceof State)
                                        return true;

                                    if (node instanceof AccessNode &&
                                        node.jsonData &&
                                        'label' in node.jsonData &&
                                        node.jsonData.label === obj.label)
                                        this.highlightRenderable(node);
                                    return false;
                                }
                            );
                        }
                    }

                    // Highlight all access nodes with the same name as
                    // the hovered connector in the nested sdfg.
                    if ((obj.parentElem instanceof State ||
                        obj.parentElem instanceof ControlFlowRegion) &&
                        obj.parentElem.graph
                    ) {
                        traverseSDFGScopes(obj.parentElem.graph, node => {
                            // If node is a state, then visit
                            // sub-scope.
                            if (node instanceof State ||
                                node instanceof ControlFlowRegion)
                                return true;

                            const nData = node.jsonData;
                            if (node instanceof AccessNode && nData &&
                                'label' in nData &&
                                nData.label === obj.label)
                                this.highlightRenderable(node);
                            // No need to visit sub-scope
                            return false;
                        });
                    }

                    // Similarly, highlight any identifiers in a
                    // connector's tasklet, if applicable.
                    if (obj.linkedElem && obj.linkedElem instanceof Tasklet) {
                        const tasklet = obj.linkedElem;
                        if (obj.connectorType === 'in') {
                            for (const token of tasklet.inputTokens) {
                                if (token.token === obj.data?.name) {
                                    token.highlighted = true;
                                    this._taskletsWithHighlighting.add(tasklet);
                                }
                            }
                        } else {
                            for (const token of tasklet.outputTokens) {
                                if (token.token === obj.data?.name) {
                                    token.highlighted = true;
                                    this._taskletsWithHighlighting.add(tasklet);
                                }
                            }
                        }
                    }
                }

                // Make all edges of a node visible and remove the edge
                // summary symbol.
                if (obj instanceof SDFGNode &&
                    (obj.inSummaryHasEffect || obj.outSummaryHasEffect)) {
                    // Setting these to false will cause the summary
                    // symbol not to be drawn in renderer_elements.ts
                    obj.summarizeInEdges = false;
                    obj.summarizeOutEdges = false;
                    const state = obj.parentElem;
                    if (state && state instanceof State) {
                        const stateJson = state.jsonData;
                        const stateGraph = state.graph;
                        stateJson?.edges.forEach(
                            (edge, id) => {
                                if (edge.src === obj.id.toString() ||
                                    edge.dst === obj.id.toString()) {
                                    const gedge = stateGraph?.edge({
                                        v: edge.src,
                                        w: edge.dst,
                                        name: id.toString(),
                                    });
                                    if (gedge)
                                        this.highlightRenderable(gedge);
                                }
                            }
                        );
                    }
                }
            }
        }

        return true;
    }

    public getNestedMemletTree(edge: Edge): Set<Edge> {
        for (const tree of this.allMemletTrees) {
            if (tree.has(edge))
                return tree;
        }
        return new Set<Edge>();
    }

    // ==================
    // = Event handlers =
    // ==================

    protected onMouseUp(_event: MouseEvent): boolean {
        this.lastDraggedElement = undefined;
        return super.onMouseUp(_event);
    }

    protected onTouchEnd(event: TouchEvent): boolean {
        if (event.touches.length === 0)
            this.lastDraggedElement = undefined;
        return super.onTouchEnd(event);
    }

    protected onTouchMove(event: TouchEvent): boolean {
        super.onTouchMove(event);

        if (!this.graph || !this.dragStart ||
            !(this.dragStart instanceof TouchEvent))
            return true;

        if (this.dragStart.touches.length !== event.touches.length) {
            // Different number of touches, ignore and reset dragStart.
            this.dragStart = event;
        } else if (event.touches.length === 1) {
            const movX = (
                event.touches[0].clientX -
                this.dragStart.touches[0].clientX
            );
            const movY = (
                event.touches[0].clientY -
                this.dragStart.touches[0].clientY
            );

            const boundsMovement = this.checkPanMovementInBounds(movX, movY);

            this.canvasManager.translate(boundsMovement.x, boundsMovement.y);
            this.dragStart = event;

            this.drawAsync();
            return false;
        } else if (event.touches.length === 2) {
            // Find relative distance between two touches before and after.
            // Then, center and zoom to their midpoint.
            const touch1 = this.dragStart.touches[0];
            const touch2 = this.dragStart.touches[1];
            let x1 = touch1.clientX, x2 = touch2.clientX;
            let y1 = touch1.clientY, y2 = touch2.clientY;
            const oldCenter = [(x1 + x2) / 2.0, (y1 + y2) / 2.0];
            const initialDistance = Math.sqrt(
                (x1 - x2) ** 2 + (y1 - y2) ** 2
            );
            x1 = event.touches[0].clientX; x2 = event.touches[1].clientX;
            y1 = event.touches[0].clientY; y2 = event.touches[1].clientY;
            const currentDistance = Math.sqrt(
                (x1 - x2) ** 2 + (y1 - y2) ** 2
            );
            const newCenter = [(x1 + x2) / 2.0, (y1 + y2) / 2.0];

            // First, translate according to movement of center point.
            const movX = newCenter[0] - oldCenter[0];
            const movY = newCenter[1] - oldCenter[1];

            const boundsMovement = this.checkPanMovementInBounds(movX, movY);

            this.canvasManager.translate(boundsMovement.x, boundsMovement.y);

            // Then scale.
            this.canvasManager.scale(
                currentDistance / initialDistance, newCenter[0],
                newCenter[1]
            );

            this.dragStart = event;

            this.drawAsync();
            return false;
        }

        return false;
    }

    protected onMouseMove(event: MouseEvent): boolean {
        if (!this.graph)
            return true;

        // Calculate the change in mouse position in canvas coordinates
        const oldMousepos = this.mousePos;
        this.mousePos = this.getMouseEventRealCoords(event);
        this.realMousePos = { x: event.clientX, y: event.clientY };
        const mouseElements = this.findElementsUnderCursor(
            this.mousePos.x, this.mousePos.y
        );

        // Only accept the primary mouse button as dragging source
        if (this.dragStart && this.dragStart instanceof MouseEvent &&
            event.buttons & 1) {
            this.dragging = true;

            if (this.mouseMode === 'move') {
                if (this.lastDraggedElement) {
                    this.canvas.style.cursor = 'grabbing';
                    const realCoord = this.getMouseEventRealCoords(
                        this.dragStart
                    );
                    this.dragStartRealPos = { x: realCoord.x, y: realCoord.y };
                    let elemsToMove = [this.lastDraggedElement];
                    if (this.selectedRenderables.has(
                        this.lastDraggedElement
                    ) && this.selectedRenderables.size > 1) {
                        elemsToMove = Array.from(
                            this.selectedRenderables
                        ).filter(
                            el => {
                                // Do not move connectors (individually)
                                if (el instanceof Connector)
                                    return false;
                                const cfgId = el.sdfg.cfg_list_id;

                                // Do not move element individually if it is
                                // moved together with a nested SDFG
                                const nsdfgParent = this.stateParentList[cfgId];
                                if (this.selectedRenderables.has(nsdfgParent))
                                    return false;

                                // Do not move element individually if it is
                                // moved together with its parent state
                                const stateParent =
                                    this.cfgList[cfgId].graph?.node(
                                        el.parentStateId!.toString()
                                    );
                                if (stateParent &&
                                    this.selectedRenderables.has(stateParent))
                                    return false;

                                // Otherwise move individually
                                return true;
                            }
                        );
                    }

                    const moveEntireEdge = elemsToMove.length > 1;
                    for (const el of elemsToMove) {
                        if (oldMousepos) {
                            this.translateElement(
                                el, this.graph, oldMousepos, this.mousePos,
                                true, moveEntireEdge
                            );
                        }
                    }

                    this.drawAsync();
                    return false;
                } else {
                    if (mouseElements.foregroundElement) {
                        this.lastDraggedElement =
                            mouseElements.foregroundElement;
                        this.canvas.style.cursor = 'grabbing';
                        return false;
                    }
                    return true;
                }
            } else if (this.mouseMode === 'select') {
                const coords = this.getMouseEventRealCoords(this.dragStart);
                const minX = Math.min(coords.x, this.mousePos.x);
                const minY = Math.min(coords.y, this.mousePos.y);
                const width = Math.abs(this.mousePos.x - coords.x);
                const height = Math.abs(this.mousePos.y - coords.y);
                this.boxSelectionRect = {
                    x: minX,
                    y: minY,
                    w: width,
                    h: height,
                };

                this.drawAsync();
                return true;
            } else {
                // Mouse move in panning mode
                this.panOnMouseMove(event);
                return true;
            }
        } else if (this.dragStart && event.buttons & 4) {
            // Pan the view with the middle mouse button.
            this.dragging = true;
            this.panOnMouseMove(event);
            this.emit('element_focus_changed', false);
            return true;
        } else {
            this.dragStart = undefined;
            this.lastDraggedElement = undefined;
            if (event.buttons & 1 || event.buttons & 4)
                return true; // Don't stop propagation

            this.recomputeHoveredElements(mouseElements.elements);

            if (mouseElements.foregroundConnector)
                mouseElements.foregroundConnector.showTooltip();
            else if (mouseElements.foregroundElement)
                mouseElements.foregroundElement.showTooltip();
            else
                this.hideTooltip();

            this.drawAsync();

            return false;
        }
    }

    protected onWheel(event: WheelEvent): boolean {
        super.onWheel(event);
        this.emit('element_focus_changed', false);
        return false;
    }

    protected onClick(event: MouseEvent): boolean {
        super.onClick(event);

        if (!this.graph || !this.sdfg || !this.mousePos)
            return true;

        let dirty = false;
        let selectionChanged = false;
        let multiSelectionChanged = false;
        if (this.dragging) {
            // This click ends a drag.
            this.dragging = false;
            if (this.boxSelectionRect) {
                const elementsInSelection: SDFGElement[] = [];
                const x = this.boxSelectionRect.x;
                const y = this.boxSelectionRect.y;
                const w = this.boxSelectionRect.w;
                const h = this.boxSelectionRect.h;
                doForIntersectedDagreGraphElements(
                    (_group, _objInfo, obj) => {
                        if (obj.fullyContainedInRect(x, y, w, h))
                            elementsInSelection.push(obj);
                    }, x, y, w, h, this.graph, this.sdfg
                );
                if (event.shiftKey && !this.ctrlKeySelection) {
                    elementsInSelection.forEach((el) => {
                        this.selectRenderable(el);
                    });
                } else if (event.ctrlKey && !this.ctrlKeySelection) {
                    elementsInSelection.forEach((el) => {
                        this.deselectRenderable(el);
                    });
                } else {
                    this.clearSelected();
                    elementsInSelection.forEach((el) => {
                        this.selectRenderable(el);
                    });
                }
                this.boxSelectionRect = undefined;
                dirty = true;
                multiSelectionChanged = true;
            }

            if (this.mouseMode === 'move')
                this.emit('element_position_changed', 'manual_move');
        } else {
            const elements = this.findElementsUnderCursor(
                this.mousePos.x, this.mousePos.y
            );
            const fgElement = elements.foregroundElement;
            const fgConnector = elements.foregroundConnector;

            if (this.mouseMode === 'add') {
                if (checkValidAddPosition(
                    this.addElementType!, fgElement, this.addModeLib
                )) {
                    if (this.addElementType === SDFGElementType.Edge) {
                        if (this._addEdgeStart) {
                            const start = this._addEdgeStart;
                            this._addEdgeStart = undefined;
                            const startCName = (
                                this._addEdgeStartConnector?.data?.name
                            ) as string | undefined;
                            const fgConnectorName = (
                                fgConnector?.data?.name
                            ) as string | undefined;
                            this.emit(
                                'add_element',
                                this.addElementType,
                                getGraphElementUUID(fgElement),
                                undefined,
                                getGraphElementUUID(start),
                                startCName,
                                fgConnectorName
                            );
                        } else {
                            this._addEdgeStart = fgElement;
                            this._addEdgeStartConnector = fgConnector;
                            this.ui?.updateToggleButtons();
                        }
                    } else if (this.addElementType ===
                        SDFGElementType.LibraryNode) {
                        this.addElementPosition = this.mousePos;
                        this.emit(
                            'add_element',
                            this.addElementType,
                            getGraphElementUUID(fgElement),
                            this.addModeLib
                        );
                    } else {
                        this.addElementPosition = this.mousePos;
                        if (this.addElementType) {
                            this.emit(
                                'add_element',
                                this.addElementType,
                                getGraphElementUUID(fgElement)
                            );
                        }
                    }

                    if (!event.ctrlKey && !(
                        this.addElementType === SDFGElementType.Edge &&
                        this._addEdgeStart
                    )) {
                        // Cancel add mode.
                        this.ui?.panModeBtn?.trigger('click', event);
                    }
                }
            }

            if (fgElement) {
                if (event.ctrlKey) {
                    // Ctrl + click on an object, add it, or remove it from
                    // the selection if it was previously in it.
                    if (this.selectedRenderables.has(fgElement))
                        this.deselectRenderable(fgElement);
                    else
                        this.selectRenderable(fgElement);

                    // Indicate that the multi-selection changed.
                    multiSelectionChanged = true;
                } else if (event.shiftKey) {
                    // TODO: Implement shift-clicks for path selection.
                } else {
                    // Clicked an element, select it and nothing else.
                    // If there was a multi-selection prior to this,
                    // indicate that it changed.
                    if (this.selectedRenderables.size > 1)
                        multiSelectionChanged = true;

                    this.clearSelected();
                    this.selectRenderable(fgElement);
                    selectionChanged = true;
                }
            } else {
                // Clicked nothing, clear the selection.

                // If there was a multi-selection prior to this, indicate
                // that it changed.
                if (this.selectedRenderables.size > 0)
                    selectionChanged = true;
                if (this.selectedRenderables.size > 1)
                    multiSelectionChanged = true;

                this.clearSelected();
            }
            dirty = true;
        }

        if (selectionChanged) {
            dirty = true;
            this.emit('selection_changed', multiSelectionChanged);
        }

        this.emit('element_focus_changed', selectionChanged);

        if (dirty)
            this.drawAsync();

        return false;
    }

    protected onDblClick(_event: MouseEvent): boolean {
        super.onDblClick(_event);

        if (!this.graph || !this.mousePos)
            return true;

        const elements = this.findElementsUnderCursor(
            this.mousePos.x, this.mousePos.y
        );
        const relayoutHappened = this.toggleElementCollapse(
            elements.foregroundElement
        );

        if (relayoutHappened) {
            this.emit('element_focus_changed', false);
            this.drawAsync();
        }

        return false;
    }

    protected onContextMenu(event: MouseEvent): boolean {
        if (!this.graph || !this.mousePos)
            return true;

        const elements = this.findElementsUnderCursor(
            this.mousePos.x, this.mousePos.y
        );
        const fgElem = elements.foregroundElement;

        if (this.mouseMode === 'move') {
            let elementsToReset: SDFGElement[] = [];
            if (fgElem)
                elementsToReset = [fgElem];

            if (fgElem && this.selectedRenderables.has(fgElem))
                elementsToReset = Array.from(this.selectedRenderables);

            let elementMoved = false;
            let relayoutNecessary = false;
            for (const el of elementsToReset) {
                const position = getPositioningInfo(el);
                if (!(el instanceof Connector) && position) {
                    // Reset the position of the element (if it has been
                    // manually moved)
                    if (el instanceof Edge) {
                        // Create inverted points to move it back
                        const newPoints = new Array(el.points.length);
                        for (let j = 1; j < el.points.length - 1; j++) {
                            newPoints[j] = {
                                dx: - position.points[j].x,
                                dy: - position.points[j].y,
                            };
                            // Reset the point movement
                            position.points[j].x = 0;
                            position.points[j].y = 0;
                        }

                        // Move it to original position
                        this.translateElement(
                            el, this.graph, { x: 0, y: 0 },
                            { x: 0, y: 0 }, false, false, newPoints
                        );

                        elementMoved = true;
                    } else {
                        if (!position.dx && !position.dy)
                            continue;

                        // Calculate original position with the relative
                        // movement
                        const newX = el.x - (position.dx ?? 0);
                        const newY = el.y - (position.dy ?? 0);

                        position.dx = 0;
                        position.dy = 0;

                        // Move it to original position
                        this.translateElement(
                            el, this.graph, { x: el.x, y: el.y },
                            { x: newX, y: newY }, false, false
                        );

                        elementMoved = true;
                    }

                    if (el instanceof EntryNode) {
                        // Also update scope position
                        position.scopeDx = 0;
                        position.scopeDy = 0;

                        if (!el.attributes()?.is_collapsed)
                            relayoutNecessary = true;
                    }
                }
            }

            if (relayoutNecessary) {
                this.layout().then(() => {
                    this.drawAsync();
                }).catch((e: unknown) => {
                    console.error('Error during layout:', e);
                });
            } else {
                this.drawAsync();
            }

            if (elementMoved)
                this.emit('element_position_changed', 'manual_move');
        } else if (this.mouseMode === 'add') {
            // Cancel add mode
            this.ui?.panModeBtn?.trigger('click', event);
        } else if (this.mouseMode === 'pan') {
            // Shift + Rightclick to toggle expand/collapse
            if (event.shiftKey)
                this.toggleElementCollapse(fgElem);
        }

        event.preventDefault();
        event.stopPropagation();
        return false;
    }

    // ===================
    // = Getter / Setter =
    // ===================

    public get ui(): SDFGRendererUI | undefined {
        return this._ui as SDFGRendererUI | undefined;
    }

    public get mouseFollowElement(): JQuery | undefined {
        return this._mouseFollowElement;
    }

    public get mouseFollowSVGs(): Record<SDFGElementType, string> | undefined {
        return this._mouseFollowSVGs;
    }

    public get addElementType(): SDFGElementType | undefined {
        return this._addElementType;
    }

    public set addElementType(type: SDFGElementType | undefined) {
        this._addElementType = type;
    }

    public get addModeLib(): string | undefined {
        return this._addModeLib;
    }

    public set addModeLib(lib: string | undefined) {
        this._addModeLib = lib;
    }

    public get addEdgeStart(): SDFGElement | undefined {
        return this._addEdgeStart;
    }

    public set addEdgeStart(elem: SDFGElement | undefined) {
        this._addEdgeStart = elem;
    }

    public get addEdgeStartConnector(): Connector | undefined {
        return this._addEdgeStartConnector;
    }

    public set addEdgeStartConnector(connector: Connector | undefined) {
        this._addEdgeStartConnector = connector;
    }

    public get mouseMode(): MouseModeT {
        return this._mouseMode;
    }

    public set mouseMode(mode: MouseModeT) {
        this._mouseMode = mode;
    }

    public get ctrlKeySelection(): boolean {
        return this._ctrlKeySelection;
    }

    public set ctrlKeySelection(value: boolean) {
        this._ctrlKeySelection = value;
    }

    public get shiftKeyMovement(): boolean {
        return this._shiftKeyMovement;
    }

    public set shiftKeyMovement(value: boolean) {
        this._shiftKeyMovement = value;
    }

    public get graph(): DagreGraph | undefined {
        return this._graph;
    }

    public get sdfg(): JsonSDFG  | undefined {
        return this._sdfg;
    }

    public get cfgList(): CFGListType {
        return this._cfgList;
    }

    public get cfgTree(): Record<number, number> {
        return this._cfgTree;
    }

}

function checkValidAddPosition(
    type: SDFGElementType, foregroundElement?: SDFGElement, lib?: string
): boolean {
    switch (type) {
        case SDFGElementType.SDFGState:
            return (foregroundElement instanceof NestedSDFG ||
                foregroundElement === undefined);
        case SDFGElementType.Edge:
            return (foregroundElement instanceof SDFGNode ||
                foregroundElement instanceof State);
        case SDFGElementType.LibraryNode:
            return foregroundElement instanceof State && lib !== undefined;
        default:
            return foregroundElement instanceof State;
    }
}
