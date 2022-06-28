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
import sidebarHtml from './lview_sidebar.html';

export class LViewRenderer {

    public readonly pixiApp: Application | null = null;
    public readonly viewport: Viewport | null = null;

    private sidebarContents?: JQuery<HTMLDivElement>;
    private sidebarTitle?: JQuery<HTMLDivElement>;
    private chartContainer?: JQuery<HTMLDivElement>;
    private reuseDistanceHistogramCanvas?: JQuery<HTMLCanvasElement>;
    private reuseDistanceHistogram?: Chart;

    public globalMemoryMovementHistogram: Map<number, number> = new Map();

    public constructor(
        protected sdfvInstance: SDFV,
        protected graph: Graph,
        protected container: HTMLElement,
    ) {
        this.initLocalViewSidebar();

        const containerRect = this.container.getBoundingClientRect();
        this.pixiApp = new Application({
            width: containerRect.width - 10,
            height: containerRect.height - 10,
            backgroundAlpha: 0.0,
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

        this.viewport?.addChild(this.graph);
        this.graph.draw();
    }

    public destroy(): void {
        if (this.pixiApp)
            this.container.removeChild(this.pixiApp.view);
    }

    private initLocalViewSidebar(): void {
        this.sdfvInstance.sidebar_set_title('Local View');
        this.sdfvInstance.close_menu();
        this.sdfvInstance.disable_menu_close();

        const rawContents = this.sdfvInstance.sidebar_get_contents();
        if (!rawContents)
            return;
        const contents = $(rawContents);
        contents.html(sidebarHtml);

        this.sidebarTitle = $('#lview-sidebar-title');
        this.chartContainer = $('#lview-chart-container');
        this.reuseDistanceHistogramCanvas = $('#reuse-distance-histogram');
        this.sidebarContents = $('#lview-sidebar-contents');

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

        $('#input-reuse-distance-viewmode')?.on('change', () => {
            this.onUpdateReuseDistanceViewmode();
        });
        $('#reuse-distance-metric-box')?.on('change', () => {
            this.onUpdateReuseDistanceViewmode();
        });
        $('#input-physical-data-movement-viewmode')?.on('change', () => {
            this.onUpdateDataMovementViewmode();
        });

        $('#cache-line-size-input')?.on('change', () => {
            this.recalculateAll();
        });
        $('#reuse-distance-threshold-input')?.on('change', () => {
            this.recalculateAll();
        });

        const inputAccessPatternMode = $('#input-access-pattern-viewmode');
        const btnShowAll = $('#show-all-access-pattern-button');
        const btnClearAll = $('#clear-all-access-pattern-button');
        inputAccessPatternMode?.on('change', () => {
            if (inputAccessPatternMode?.is(':checked')) {
                btnShowAll.show();
                btnClearAll.show();
            } else {
                btnShowAll.hide();
                btnClearAll.hide();
            }
            this.clearGraphAccesses(this.graph);
        });
        btnClearAll?.on('click', () => {
            this.clearGraphAccesses(this.graph);
        });
        btnShowAll?.on('click', () => {
            this.clearGraphAccesses(this.graph);
            this.graphShowAllAccesses(this.graph);
        });

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

    private constructMemoryMovementHistForGraph(g: Graph): void {
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
        this.graphClearCalculatedValue(this.graph);

        MemoryNode.reuseDistanceHistogram.clear();
        MemoryNode.minReuseDistanceHistogram.clear();
        MemoryNode.maxReuseDistanceHistogram.clear();
        MemoryNode.missesHistogram.clear();

        this.recalculateForGraph(this.graph);

        this.globalMemoryMovementHistogram.clear();
        this.constructMemoryMovementHistForGraph(this.graph);

        this.graph.draw();
    }

    private onUpdateReuseDistanceViewmode(): void {
        if ($('#input-reuse-distance-viewmode')?.is(':checked'))
            this.graph.enableReuseDistanceOverlay();
        else
            this.graph.disableReuseDistanceOverlay();
    }

    private onUpdateDataMovementViewmode(): void {
        if ($('#input-physical-data-movement-viewmode')?.is(':checked'))
            this.graph.enablePhysMovementOverlay();
        else
            this.graph.disablePhysMovementOverlay();
    }

}
