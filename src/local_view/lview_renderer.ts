// Copyright 2019-2022 ETH Zurich and the DaCe authors. All rights reserved.

import {
    BarController,
    BarElement,
    CategoryScale,
    Chart,
    ChartData,
    Legend,
    LinearScale,
    Tooltip
} from 'chart.js';
import annotationPlugin from 'chartjs-plugin-annotation';
import $ from 'jquery';
import { Viewport } from 'pixi-viewport';
import { Application } from 'pixi.js';
import { SDFV } from '../sdfv';
import { MapNode } from './elements/map_node';
import { MemoryMovementEdge } from './elements/memory_movement_edge';
import { MemoryNode } from './elements/memory_node';
import { Graph } from './graph/graph';
import { AccessPatternOverlay } from './overlays/access_pattern_overlay';
import { EdgeOverlay, NodeOverlay, NoEdgeOverlay, NoNodeOverlay } from './overlays/base_overlays';
import { CacheLineOverlay } from './overlays/cache_line_overlay';
import { PhysicalMovementOverlay } from './overlays/physical_movement_overlay';
import { ReuseDistanceOverlay } from './overlays/reuse_distance_overlay';

export class LViewRenderer {

    public readonly pixiApp: Application | null = null;
    public readonly viewport: Viewport | null = null;

    protected tooltipContainer?: JQuery<HTMLDivElement>;
    protected tooltipText?: JQuery<HTMLSpanElement>;

    protected sidebarContents?: JQuery<HTMLDivElement>;
    protected sidebarTitle?: JQuery<HTMLDivElement>;
    protected chartContainer?: JQuery<HTMLDivElement>;
    protected reuseDistanceHistogramCanvas?: JQuery<HTMLCanvasElement>;
    protected reuseDistanceHistogram?: Chart;

    protected nViewModeSelector?: JQuery<HTMLSelectElement>;
    protected nViewModeSelectorAdditional?: JQuery<HTMLDivElement>;
    protected eViewModeSelector?: JQuery<HTMLSelectElement>;
    protected eViewModeSelectorAdditional?: JQuery<HTMLDivElement>;

    protected nOverlay?: NodeOverlay;
    protected eOverlay?: EdgeOverlay;

    public globalMemoryMovementHistogram: Map<number, number> = new Map();

    public constructor(
        protected sdfvInstance: SDFV,
        protected container: HTMLElement,
        protected _graph?: Graph,
    ) {
        this.initLocalViewSidebar();

        const containerRect = this.container.getBoundingClientRect();
        this.pixiApp = new Application({
            width: containerRect.width - 10,
            height: containerRect.height - 10,
            backgroundColor: 0xdeebf7, // TODO: Make this color themeable
            antialias: true,
            resizeTo: this.container,
        });

        this.container.appendChild(this.pixiApp.view);

        this.viewport = new Viewport({
            screenWidth: containerRect.width,
            screenHeight: containerRect.height,
            interaction: this.pixiApp.renderer.plugins.interaction,
        });

        const resizeObserver = new ResizeObserver(entries => {
            entries.forEach(entry => {
                if (entry.contentBoxSize) {
                    this.pixiApp?.resize();
                    this.viewport?.resize(
                        entry.contentRect.width, entry.contentRect.height
                    );
                }
            });
        });
        resizeObserver.observe(this.container);

        this.pixiApp.stage.addChild(this.viewport);

        this.viewport
            .drag()
            .pinch()
            .wheel()
            .decelerate({
                friction: 0.3,
            });

        if (this._graph)
            this.viewport?.addChild(this._graph);
        this._graph?.draw();
    }

    public showTooltip(x: number, y: number, text: string): void {
        this.tooltipText = $('<span>', {
            id: 'lview-tooltip-text',
            text: text,
            css: {
                'white-space': 'pre-line',
            },
        });
        this.tooltipContainer = $('<div>', {
            id: 'lview-tooltip-container',
            css: {
                left: '0px',
                top: '0px',
            },
        });
        this.tooltipText.appendTo(this.tooltipContainer);
        this.tooltipContainer.appendTo(document.body);
        const bcr = this.tooltipContainer[0].getBoundingClientRect();
        const containerBcr = this.container.getBoundingClientRect();
        this.tooltipContainer.css(
            'left', (x - bcr.width / 2).toString() + 'px'
        );
        this.tooltipContainer.css(
            'top', (((y + containerBcr.y) - bcr.height) - 8).toString() + 'px'
        );
    }

    public hideTooltip(): void {
        if (this.tooltipContainer)
            this.tooltipContainer.remove();
    }

    public set graph(g: Graph | undefined) {
        if (g) {
            this._graph = g;
            this.viewport?.addChild(this._graph);
            this._graph.draw();
        } else {
            this.viewport?.removeChildren();
            this._graph = undefined;
        }
    }

    public get graph(): Graph | undefined {
        return this._graph;
    }

    public getGraph(): Graph | undefined {
        return this._graph;
    }

    public destroy(): void {
        if (this.pixiApp) {
            this.container.removeChild(this.pixiApp.view);
            this.pixiApp.destroy();
        }
    }

    private initOverlays(): void {
        this.nViewModeSelector = $('#node-viewmode-input');
        this.nViewModeSelectorAdditional =
            $('#node-viewmode-selector-additional');
        this.eViewModeSelector = $('#edge-viewmode-input');
        this.eViewModeSelectorAdditional =
            $('#edge-viewmode-selector-additional');

        for (const cls of [
            NoNodeOverlay,
            AccessPatternOverlay,
            ReuseDistanceOverlay,
            CacheLineOverlay,
        ]) {
            const inst = new cls(this);
            NodeOverlay.availableOverlays.push(inst.value);
            NodeOverlay.overlayMap.set(inst.value, inst);
            const option = new Option(
                inst.displayName, inst.value, cls === NoNodeOverlay,
                cls === NoNodeOverlay
            );
            if (cls == NoNodeOverlay) {
                this.nOverlay = inst;
                inst.onSelect();
            }
            this.nViewModeSelector?.append(option);
        }

        for (const cls of [
            NoEdgeOverlay,
            PhysicalMovementOverlay,
        ]) {
            const inst = new cls(this);
            EdgeOverlay.availableOverlays.push(inst.value);
            EdgeOverlay.overlayMap.set(inst.value, inst);
            const option = new Option(
                inst.displayName, inst.value, cls === NoEdgeOverlay,
                cls === NoEdgeOverlay
            );
            if (cls == NoEdgeOverlay) {
                this.eOverlay = inst;
                inst.onSelect();
            }
            this.eViewModeSelector?.append(option);
        }

        // TODO: When changing the node overlay, any selected memory node tiles
        // should be cleared.
        this.nViewModeSelector?.on('change', () => {
            const newVal = this.nViewModeSelector?.val();
            if (newVal && typeof newVal === 'string') {
                const inst = NodeOverlay.overlayMap.get(newVal);
                if (inst) {
                    if (this.nOverlay)
                        this.nOverlay.onDeselect();
                    this.nOverlay = inst;
                    inst.onSelect();
                }
            }
        });

        this.eViewModeSelector?.on('change', () => {
            const newVal = this.eViewModeSelector?.val();
            if (newVal && typeof newVal === 'string') {
                const inst = EdgeOverlay.overlayMap.get(newVal);
                if (inst) {
                    if (this.eOverlay)
                        this.eOverlay.onDeselect();
                    this.eOverlay = inst;
                    inst.onSelect();
                }
            }
        });
    }

    private initLocalViewSidebar(): void {
        this.sdfvInstance.sidebar_set_title('Local View');
        this.sdfvInstance.close_menu();
        this.sdfvInstance.disable_menu_close();

        const rawContents = this.sdfvInstance.sidebar_get_contents();
        if (!rawContents)
            return;
        const contents = $(rawContents);
        contents.html(`
<div id="lview-sidebar">
    <label for="map-playback-speed-input">
        Access Pattern Playback Speed:
    </label>
    <br>
    <input type="number" id="map-playback-speed-input" min="1" max="10"
        value="1">

    <br>

    <label for="cache-line-size-input">
        Cache Line Size (bytes):
    </label>
    <br>
    <input type="number" id="cache-line-size-input" min="1" value="32">

    <br>

    <label for="reuse-distance-threshold-input">
        Reuse Distance Threshold:
    </label>
    <br>
    <input type="number" id="reuse-distance-threshold-input" min="1" value="10">

    <hr>

    <div id="node-viewmode-selector-box">
        <label for="node-viewmode-input">
            Node Overlay:
        </label>
        <br>
        <select id="node-viewmode-input"></select>
        <div id="node-viewmode-selector-additional"></div>
    </div>

    <div id="edge-viewmode-selector-box">
        <label for="edge-viewmode-input">
            Edge Overlay:
        </label>
        <br>
        <select id="edge-viewmode-input"></select>
        <div id="edge-viewmode-selector-additional"></div>
    </div>

    <hr>

    <div id="lview-sidebar-title">
    </div>

    <div id="lview-chart-container">
        <canvas id="reuse-distance-histogram"></canvas>
    </div>

    <div id="lview-sidebar-contents">
    </div>

</div>
        `);

        $('#cache-line-size-input')?.on('change', () => {
            this.recalculateAll();
        });
        $('#reuse-distance-threshold-input')?.on('change', () => {
            this.recalculateAll();
        });

        this.initOverlays();

        // Set up the reuse distance historgram.
        this.reuseDistanceHistogramCanvas = $('#reuse-distance-histogram');
        Chart.register(annotationPlugin);
        Chart.register(
            BarController, BarElement, CategoryScale, Tooltip, Legend,
            LinearScale
        );
        this.reuseDistanceHistogram = new Chart(
            this.reuseDistanceHistogramCanvas,
            {
                type: 'bar',
                data: {
                    labels: [],
                    datasets: [],
                },
                options: {},
            }
        );
        this.hideReuseDistanceHist();

        this.sidebarTitle = $('#lview-sidebar-title');
        this.chartContainer = $('#lview-chart-container');
        this.sidebarContents = $('#lview-sidebar-contents');

        this.sdfvInstance.sidebar_show();
    }

    public clearGraphAccesses(g: Graph, redraw: boolean = true): void {
        g.nodes.forEach(node => {
            if (node instanceof MemoryNode) {
                node.clearAllAccesses();
            } else if (node instanceof MapNode) {
                node.playbackPause();
                node.playbackReset();
                this.clearGraphAccesses(node.innerGraph, false);
            }
        });
        if (redraw)
            g.draw();
    }

    public graphShowAllAccesses(g: Graph, redraw: boolean = true): void {
        g.nodes.forEach(node => {
            if (node instanceof MapNode) {
                const accessPattern = node.getAccessPattern();
                for (let i = 0; i < accessPattern.length; i++) {
                    const map = accessPattern[i][1];
                    node.showAccesses(map, false);
                }
                node.playButton.draw();
                this.graphShowAllAccesses(node.innerGraph, false);
            }
        });
        if (redraw)
            g.draw();
    }

    public constructMemoryMovementHistForGraph(g: Graph): void {
        g.edges.forEach(edge => {
            if (edge instanceof MemoryMovementEdge) {
                const volume = edge.calculateMovementVolume();
                const prev = this.globalMemoryMovementHistogram.get(volume);
                if (prev !== undefined)
                    this.globalMemoryMovementHistogram.set(volume, prev + 1);
                else
                    this.globalMemoryMovementHistogram.set(volume, 1);
            }
        });

        g.nodes.forEach(node => {
            if (node instanceof MapNode)
                this.constructMemoryMovementHistForGraph(node.innerGraph);
        });
    }

    public showReuseDistanceHist(data: ChartData): void {
        this.chartContainer?.show();
        if (data && this.reuseDistanceHistogram) {
            this.reuseDistanceHistogram.data = data;
            this.reuseDistanceHistogram.update();
        }
    }

    public hideReuseDistanceHist(): void {
        this.chartContainer?.hide();
    }

    private recalculateForGraph(g: Graph): void {
        g.nodes.forEach(node => {
            if (node instanceof MapNode) {
                node.calculateStackDistances();
                this.recalculateForGraph(node.innerGraph);
            }
        });
    }

    private graphClearCalculatedValue(g: Graph): void {
        g.edges.forEach(edge => {
            if (edge instanceof MemoryMovementEdge)
                edge.clearVolume();
        });

        g.nodes.forEach(node => {
            if (node instanceof MemoryNode)
                node.applyToAll(undefined, t => {
                    t.stackDistancesFlattened = [];
                    t.stackDistances.clear();
                    t.coldMisses = 0;
                    t.totalMisses = 0;
                });
            else if (node instanceof MapNode)
                this.graphClearCalculatedValue(node.innerGraph);
        });
    }

    public recalculateAll(): void {
        if (!this._graph)
            return;

        this.graphClearCalculatedValue(this._graph);

        MemoryNode.reuseDistanceHistogram.clear();
        MemoryNode.minReuseDistanceHistogram.clear();
        MemoryNode.maxReuseDistanceHistogram.clear();
        MemoryNode.missesHistogram.clear();

        this.recalculateForGraph(this._graph);

        this.globalMemoryMovementHistogram.clear();
        this.constructMemoryMovementHistForGraph(this._graph);

        this._graph.draw();
    }

    public get nodeOverlay(): NodeOverlay | undefined {
        return this.nOverlay;
    }

    public get edgeOverlay(): EdgeOverlay | undefined {
        return this.eOverlay;
    }

    public hideNodeViewModeSelectorAdditional(): void {
        this.nViewModeSelectorAdditional?.empty();
        this.nViewModeSelectorAdditional?.hide();
    }

    public hideEdgeViewModeSelectorAdditional(): void {
        this.eViewModeSelectorAdditional?.empty();
        this.eViewModeSelectorAdditional?.hide();
    }

    public get nodeOverlayAdditional(): JQuery<HTMLDivElement> | undefined {
        return this.nViewModeSelectorAdditional;
    }

}
