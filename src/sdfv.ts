// Copyright 2019-2025 ETH Zurich and the DaCe authors. All rights reserved.

import $ from 'jquery';

import 'bootstrap';

import '../scss/sdfv.scss';

import { editor } from 'monaco-editor';
import { EventEmitter } from 'events';
import { mean, median } from 'mathjs';
import { LViewRenderer } from './local_view/lview_renderer';
import {
    RuntimeMicroSecondsOverlay,
} from './overlays/runtime_micro_seconds_overlay';
import { OverlayManager } from './overlay_manager';
import { DagreGraph, SDFGRenderer } from './renderer/sdfg/sdfg_renderer';
import {
    ConditionalBlock,
    InterstateEdge,
    SDFG,
    SDFGElement,
    State,
} from './renderer/sdfg/sdfg_elements';
import { htmlSanitize } from './utils/sanitization';
import {
    checkCompatLoad,
    checkCompatSave,
    parseSDFG,
    readOrDecompress,
    stringifySDFG,
} from './utils/sdfg/json_serializer';
import { SDFVSettings } from './utils/sdfv_settings';
import { DiffMap, WebSDFGDiffViewer } from './sdfg_diff_viewer';
import { ISDFVUserInterface, SDFVWebUI } from './sdfv_ui';
import { GenericSdfgOverlay } from './overlays/common/generic_sdfg_overlay';
import { JsonSDFG, ModeButtons } from './types';
import {
    doForAllJsonSDFGElements,
    traverseSDFGScopes,
} from './utils/sdfg/traversal';
import { showErrorModal } from './utils/utils';
import { read as graphlibDotRead } from '@dagrejs/graphlib-dot';
import { graphlib } from '@dagrejs/dagre';
import { DUMMY_NODE_SIZE } from './layout/state_machine/sm_layouter';


declare const vscode: any;

export interface ISDFV {
    linkedUI: ISDFVUserInterface;

    outline(): void;
}

interface ITraceEvent {
    ph: string;
    args: {
        sdfg_id: string;
        state_id?: string;
        id?: string;
    };
    dur: number;
}

export abstract class SDFV extends EventEmitter implements ISDFV {

    public static LINEHEIGHT: number = 10;
    public static LABEL_MARGIN_H: number = 5;
    public static LABEL_MARGIN_V: number = 1;
    // Points-per-pixel threshold for not drawing Arrowheads of
    // memlets/interstate edges.
    public static ARROW_LOD: number = 2.0; // 2.0
    // Points-per-pixel threshold for not drawing connectors.
    public static CONNECTOR_LOD = 2.0; // 2.0

    public static DEFAULT_CANVAS_FONTSIZE: number = 10;
    public static DEFAULT_MAX_FONTSIZE: number = 20; // 20
    public static DEFAULT_FAR_FONT_MULTIPLIER: number = 16; // 16

    protected _renderer?: SDFGRenderer;
    protected _localViewRenderer?: LViewRenderer;

    public constructor() {
        super();
        return;
    }

    public abstract get linkedUI(): ISDFVUserInterface;

    public onLoadedRuntimeReport(
        report: { traceEvents?: ITraceEvent[] }, renderer?: SDFGRenderer
    ): void {
        const runtimeMap: Record<string, number[] | undefined> = {};
        const summaryMap: Record<string, Record<string, number>> = {};

        renderer = this.renderer;

        if (report.traceEvents && renderer) {
            for (const event of report.traceEvents) {
                if (event.ph === 'X') {
                    let uuid = event.args.sdfg_id + '/';
                    if (event.args.state_id !== undefined) {
                        uuid += event.args.state_id + '/';
                        if (event.args.id !== undefined)
                            uuid += event.args.id + '/-1';
                        else
                            uuid += '-1/-1';
                    } else {
                        uuid += '-1/-1/-1';
                    }

                    if (runtimeMap[uuid] !== undefined)
                        runtimeMap[uuid]!.push(event.dur);
                    else
                        runtimeMap[uuid] = [event.dur];
                }
            }

            for (const key in runtimeMap) {
                const values = runtimeMap[key] ?? [];
                const minmax = getMinMax(values);
                const min = minmax[0];
                const max = minmax[1];
                const rtSummary = {
                    'min': min,
                    'max': max,
                    'mean': mean(values),
                    'med': median(values),
                    'count': values.length,
                };
                summaryMap[key] = rtSummary;
            }

            if (!renderer.overlayManager.isOverlayActive(
                RuntimeMicroSecondsOverlay
            )) {
                renderer.overlayManager.registerOverlay(
                    RuntimeMicroSecondsOverlay
                );
            }
            const ol = renderer.overlayManager.getOverlay(
                RuntimeMicroSecondsOverlay
            );
            if (ol && ol instanceof RuntimeMicroSecondsOverlay) {
                ol.setRuntimeMap(summaryMap);
                ol.refresh();
            }
        }
    }

    public onLoadedMemoryFootprintFile(
        footprintMap: Record<string, number>, renderer?: SDFGRenderer
    ): void {
        renderer = this.renderer;

        if (!renderer?.sdfg)
            return;

        doForAllJsonSDFGElements((_group, _info, elem) => {
            const guid = elem.attributes?.guid as string | undefined;
            if (guid && guid in footprintMap)
                elem.attributes!.maxFootprintBytes = footprintMap[guid];
        }, renderer.sdfg);

        renderer.drawAsync();
    }

    public abstract outline(): void;

    public setRenderer(renderer?: SDFGRenderer): void {
        if (renderer) {
            this._localViewRenderer?.destroy();
            this._localViewRenderer?.resizeObserver.disconnect();
            this._localViewRenderer = undefined;
        }
        this._renderer = renderer;

        SDFVWebUI.getInstance().enableInfoClear();
        SDFVWebUI.getInstance().infoClear();
    }

    public setLocalViewRenderer(localViewRenderer?: LViewRenderer): void {
        if (localViewRenderer) {
            this._renderer?.destroy();
            this._renderer = undefined;
        }
        this._localViewRenderer = localViewRenderer;
    }

    public get renderer(): SDFGRenderer | undefined {
        return this._renderer;
    }

    public get localViewRenderer(): LViewRenderer | undefined {
        return this._localViewRenderer;
    }

}

export class WebSDFV extends SDFV {

    private static readonly INSTANCE: WebSDFV = new WebSDFV();
    private _initialized: boolean = false;

    private constructor() {
        super();
    }

    public static getInstance(): WebSDFV {
        return this.INSTANCE;
    }

    private readonly UI: SDFVWebUI = SDFVWebUI.getInstance();

    public get linkedUI(): SDFVWebUI {
        return this.UI;
    }

    private currentSDFGFile?: File;
    private modeButtons?: ModeButtons;

    public get initialized(): boolean {
        return this._initialized;
    }

    public init(): void {
        if (this._initialized)
            return;

        // This is called here to initialize the monaco editor web workers for
        // tokenization. There is no way to await this creation, which leads to
        // code not being correctly highlighted in tasklets for the first time
        // an SDFG is loaded. Initializing this here ensures that by the time
        // the user loads an SDFG, the web workers are already created and
        // highlighting works.
        const _tokens = editor.tokenize('a = 0', 'python')[0];
        // Read something from tokens to ensure the call is not optimized away.
        if (_tokens.length < 2)
            console.log('Initializing Monaco');
        else
            console.log('Monaco already initialized');

        this.registerEventListeners();
        this.UI.init();

        this._initialized = true;

        this.emit('initialized');
    }

    public setModeButtons(modeButtons: ModeButtons): void {
        this.modeButtons = modeButtons;
    }

    private loadSDFG(change: JQuery.TriggeredEvent): void {
        const target = change.target as { files?: File[] } | undefined;
        if ((target?.files?.length ?? 0) < 1)
            return;
        this.currentSDFGFile = target!.files![0];
        this.readSDFGFile();
    }

    private readSDFGFile(): void {
        if (!this.currentSDFGFile)
            return;

        const fileReader = new FileReader();
        fileReader.onload = async (e) => {
            const resultString = e.target?.result;

            if (resultString) {
                if (this.currentSDFGFile?.name.endsWith('.dot')) {
                    const resString = readOrDecompress(resultString)[0];
                    const resGraph = graphlibDotRead(
                        resString
                    ) as graphlib.Graph;
                    void this.setDotGraph(resGraph);
                } else {
                    const parsedSDFG = await this.UI.showActivityIndicatorFor(
                        'Parsing SDFG',
                        () => {
                            return checkCompatLoad(parseSDFG(
                                resultString,
                                !SDFVSettings.get<boolean>(
                                    'loadGraphsCollapsed'
                                )
                            ));
                        }
                    );
                    void this.setSDFG(parsedSDFG);
                }
            }
        };
        fileReader.readAsArrayBuffer(this.currentSDFGFile);
    }

    public enterDiffView(
        sdfgA: JsonSDFG, sdfgB: JsonSDFG, precomputedDiff?: DiffMap
    ): void {
        $('#contents').hide();

        this.renderer?.destroy();

        this.UI.infoClear();
        this.deregisterEventListeners();

        WebSDFGDiffViewer.init(sdfgA, sdfgB, precomputedDiff);

        $('#diff-container').show();
    }

    private loadDiffSDFG(e: JQuery.TriggeredEvent): void {
        const target = e.target as { files?: File[] } | undefined;
        if ((target?.files?.length ?? 0) < 1 || !target!.files![0])
            return;

        const fileReader = new FileReader();
        fileReader.onload = (e) => {
            const sdfgB = this.renderer?.sdfg;
            if (e.target?.result && sdfgB) {
                const sdfgA = checkCompatLoad(parseSDFG(
                    e.target.result,
                    !SDFVSettings.get<boolean>('loadGraphsCollapsed')
                ));
                this.enterDiffView(sdfgA, sdfgB);
            }
        };
        fileReader.readAsArrayBuffer(target!.files![0]);
        // Reset the input to nothing so we are able to observe a change event
        // again if the user wants to re-diff with the same file again.
        (e.target as HTMLInputElement).value = '';
    }

    private loadRuntimeReportFile(e: JQuery.TriggeredEvent): void {
        const target = e.target as { files?: File[] } | undefined;
        if ((target?.files?.length ?? 0) < 1 || !target!.files![0])
            return;

        const fileReader = new FileReader();
        fileReader.onload = (e: ProgressEvent<FileReader>) => {
            let resultString = '';
            const res = e.target?.result;
            if (res) {
                if (res instanceof ArrayBuffer) {
                    const decoder = new TextDecoder('utf-8');
                    resultString = decoder.decode(new Uint8Array(res));
                } else {
                    resultString = res;
                }
            }
            this.onLoadedRuntimeReport(
                JSON.parse(resultString) as { traceEvents?: any[] }
            );
        };
        fileReader.readAsText(target!.files![0]);
    }

    private loadMemoryFootprintFile(e: JQuery.TriggeredEvent): void {
        const target = e.target as { files?: File[] } | undefined;
        if ((target?.files?.length ?? 0) < 1 || !target!.files![0])
            return;

        const fileReader = new FileReader();
        fileReader.onload = (e: ProgressEvent<FileReader>) => {
            let resultString = '';
            const res = e.target?.result;
            if (res) {
                if (res instanceof ArrayBuffer) {
                    const decoder = new TextDecoder('utf-8');
                    resultString = decoder.decode(new Uint8Array(res));
                } else {
                    resultString = res;
                }
            }
            this.onLoadedMemoryFootprintFile(
                JSON.parse(resultString) as Record<string, number>
            );
        };
        fileReader.readAsText(target!.files![0]);
    }

    public registerEventListeners(): void {
        $(document).on(
            'change.sdfv', '#sdfg-file-input', this.loadSDFG.bind(this)
        );
        $(document).on(
            'change.sdfv', '#instrumentation-report-file-input',
            this.loadRuntimeReportFile.bind(this)
        );
        $(document).on(
            'change.sdfv', '#memory-footprint-file-input',
            this.loadMemoryFootprintFile.bind(this)
        );
        $(document).on(
            'change.sdfv', '#second-sdfg-file-input',
            this.loadDiffSDFG.bind(this)
        );

        $(document).on(
            'click.sdfv', '#reload', this.readSDFGFile.bind(this)
        );
        $(document).on(
            'click.sdfv', '#outline', () => {
                // Make sure the UI is not blocked in the meantime.
                setTimeout(() => {
                    this.outline();
                }, 1);
            }
        );
        $(document).on(
            'click.sdfv', '#search-btn', (e) => {
                e.preventDefault();
                this.runSearch(false);
                return false;
            }
        );
        $(document).on(
            'click.sdfv', '#advsearch-btn', (e) => {
                e.preventDefault();
                this.runSearch(true);
                return false;
            }
        );

        $(document).on(
            'keydown.sdfv', '#search', (e) => {
                if (e.key === 'Enter' || e.which === 13) {
                    this.runSearch();
                    e.preventDefault();
                }
            }
        );
    }

    public deregisterEventListeners(): void {
        $(document).off('.sdfv');
    }

    public outline(): void {
        if (!this.renderer?.graph)
            return;

        this.UI.infoSetTitle('SDFG Outline');

        const sidebar = this.UI.infoContentContainer;
        if (!sidebar)
            return;
        sidebar.html('');

        // Entire SDFG
        $('<div>', {
            class: 'context_menu_option',
            html: htmlSanitize`
                <span class="material-symbols-outlined"
                      style="font-size: inherit">
                    filter_center_focus
                </span> SDFG ${this.renderer.sdfg?.attributes?.name}
            `,
            click: () => {
                this.renderer?.zoomToFitContents();
            },
        }).appendTo(sidebar);

        const stack: (JQuery | null)[] = [sidebar];

        // Add elements to tree view in sidebar
        traverseSDFGScopes(this.renderer.graph, (node, parent) => {
            // Skip exit nodes when scopes are known
            if (node.type.endsWith('Exit') && node.jsonData?.scope_entry &&
                node.jsonData.scope_entry as number >= 0) {
                stack.push(null);
                return true;
            }

            let isCollapsed = node.attributes()?.is_collapsed;
            isCollapsed = (isCollapsed === undefined) ? false : isCollapsed;
            let nodeType = node.type;

            // If a scope has children, remove the name "Entry" from the type
            if (node.type.endsWith('Entry') && node.parentStateId && node.id) {
                const state = (node.parentElem as State | undefined)?.jsonData;
                if (state?.scope_dict?.[node.id])
                    nodeType = nodeType.slice(0, -5);
            }

            // Create element
            const entry = $('<div>', {
                class: 'context_menu_option',
                html: htmlSanitize`
                    ${nodeType} ${node.label}${isCollapsed ? ' (collapsed)' : ''}
                `,
                click: (e: JQuery.Event) => {
                    // Show node or entire scope
                    const nodesToDisplay = [node];
                    if (node.type.endsWith('Entry') && node.parentElem &&
                        node.id) {
                        const state = (
                            node.parentElem as State | undefined
                        )?.jsonData;
                        if (state?.scope_dict?.[node.id]) {
                            const scNodes = state.scope_dict[node.id];
                            for (const subnodeId of scNodes ?? []) {
                                const subnd = parent.node(subnodeId.toString());
                                if (subnd)
                                    nodesToDisplay.push(subnd);
                            }
                        }
                    }

                    this.renderer?.zoomToFit(nodesToDisplay);

                    // Ensure that the innermost div handles the event.
                    /* eslint-disable
                       @typescript-eslint/no-unnecessary-condition,
                       @typescript-eslint/no-deprecated */
                    if (!e) {
                        if (window.event) {
                            window.event.cancelBubble = true;
                            window.event.stopPropagation();
                        }
                    } else {
                        if (e.stopPropagation)
                            e.stopPropagation();
                    }
                    /* eslint-enable
                       @typescript-eslint/no-unnecessary-condition,
                       @typescript-eslint/no-deprecated */
                },
            });
            stack.push(entry);

            // If is collapsed, don't traverse further
            if (isCollapsed)
                return false;

            return true;
        }, (_node, _parent) => {
            // After scope ends, pop ourselves as the current element
            // and add to parent
            const elem = stack.pop();
            if (elem)
                stack[stack.length - 1]?.append(elem);
        });

        this.UI.infoShow();
    }

    public runSearch(advanced: boolean = false): void {
        // Make sure the UI is not blocked during search.
        setTimeout(() => {
            const query = advanced ? $('#advsearch').val() : $('#search').val();
            if (query && this.renderer) {
                if (advanced) {
                    const predicate = eval(query.toString()) as (
                        graph: DagreGraph, element: SDFGElement
                    ) => boolean;
                    findInGraphPredicate(this.UI, this.renderer, predicate);
                } else {
                    findInGraph(
                        this.UI, this.renderer, query.toString(),
                        $('#search-case').is(':checked')
                    );
                }
            }
        }, 1);
    }

    public async setSDFG(
        sdfg: JsonSDFG | null = null,
        userTransform: DOMMatrix | null = null,
        debugDraw: boolean = false,
        contentsContainerId: string = 'contents',
        zoomToFit: boolean = true
    ): Promise<void> {
        this.renderer?.destroy();
        const container = document.getElementById(contentsContainerId);
        this.UI.infoClear();
        if (container && sdfg) {
            const renderer = new SDFGRenderer(
                container, this, null, userTransform, debugDraw, null,
                this.modeButtons
            );
            this.setRenderer(renderer);
            renderer.on('selection_changed', () => {
                const selectedElements = renderer.selectedRenderables;
                let element;
                if (selectedElements.size === 0 && renderer.sdfg) {
                    element = new SDFG(
                        renderer, renderer.ctx, renderer.minimapCtx,
                        renderer.sdfg
                    );
                } else if (selectedElements.size === 1) {
                    element = Array.from(selectedElements)[0];
                } else {
                    element = null;
                }

                if (element !== null) {
                    SDFVWebUI.getInstance().showElementInfo(element, renderer);
                } else {
                    SDFVWebUI.getInstance().infoClear();
                    SDFVWebUI.getInstance().infoSetTitle(
                        'Multiple elements selected'
                    );
                }
                SDFVWebUI.getInstance().infoShow();
            });

            await renderer.setSDFG(sdfg, true, zoomToFit);
            $('#load-instrumentation-report-btn').prop('disabled', false);
            $('#load-memory-footprint-file-btn').prop('disabled', false);
            $('#diff-view-btn').prop('disabled', false);
        }
    }

    public async setDotGraph(
        dotGraph: graphlib.Graph,
        userTransform: DOMMatrix | null = null,
        debugDraw: boolean = false,
        contentsContainerId: string = 'contents',
        zoomToFit: boolean = true
    ): Promise<void> {
        this.renderer?.destroy();
        const container = document.getElementById(contentsContainerId);
        this.UI.infoClear();
        if (container) {
            const renderer = new SDFGRenderer(
                container, this, null, userTransform, debugDraw, null,
                this.modeButtons
            );
            this.setRenderer(renderer);
            renderer.on('selection_changed', () => {
                const selectedElements = renderer.selectedRenderables;
                let element;
                if (selectedElements.size === 0 && renderer.sdfg) {
                    element = new SDFG(
                        renderer, renderer.ctx, renderer.minimapCtx,
                        renderer.sdfg
                    );
                } else if (selectedElements.size === 1) {
                    element = Array.from(selectedElements)[0];
                } else {
                    element = null;
                }

                if (element !== null) {
                    SDFVWebUI.getInstance().showElementInfo(element, renderer);
                } else {
                    SDFVWebUI.getInstance().infoClear();
                    SDFVWebUI.getInstance().infoSetTitle(
                        'Multiple elements selected'
                    );
                }
                SDFVWebUI.getInstance().infoShow();
            });

            for (const node of dotGraph.nodes()) {
                const nObj = dotGraph.node(node);
                const label = nObj.label ?? node;
                const cleanedLabel = label.replace(
                    /\{\%/g, ''
                ).split('|')[0].replace(/\}/g, '');
                const state = new State(
                    renderer, renderer.ctx, renderer.minimapCtx,
                    { state: { label: cleanedLabel } }, +node
                );
                state.width = DUMMY_NODE_SIZE;
                state.height = DUMMY_NODE_SIZE;
                dotGraph.setNode(node, state);
            }
            let i = 0;
            for (const edge of dotGraph.edges()) {
                const isedge = new InterstateEdge(
                    renderer, renderer.ctx, renderer.minimapCtx,
                    undefined, i++
                );
                dotGraph.setEdge(edge, isedge);
            }

            await renderer.setDotGraph(dotGraph, true, zoomToFit);
            $('#load-instrumentation-report-btn').prop('disabled', false);
            $('#load-memory-footprint-file-btn').prop('disabled', false);
            $('#diff-view-btn').prop('disabled', false);
        }
    }

}

/**
 * Get the min/max values of an array.
 * This is more stable than Math.min/max for large arrays, since Math.min/max
 * is recursive and causes a too high stack-length with long arrays.
 */
function getMinMax(arr: number[]): [number, number] {
    let max = -Number.MAX_VALUE;
    let min = Number.MAX_VALUE;
    arr.forEach(val => {
        if (val > max)
            max = val;
        if (val < min)
            min = val;
    });
    return [min, max];
}

// https://stackoverflow.com/a/901144/6489142
function getParameterByName(name: string): string | null {
    const url = window.location.href;
    name = name.replace(/[\[\]]/g, '\\$&');
    const regex = new RegExp('[?&]' + name + '(=([^&#]*)|&|#|$)'),
        results = regex.exec(url);
    if (!results)
        return null;
    if (!results[2])
        return '';
    return decodeURIComponent(results[2].replace(/\+/g, ' '));
}

function loadSDFGFromURL(url: string): void {
    const request = new XMLHttpRequest();
    request.responseType = 'text'; // Will be parsed as JSON by parse_sdfg
    request.onload = () => {
        if (request.status === 200) {
            const sdfg = checkCompatLoad(parseSDFG(request.response as string));
            void WebSDFV.getInstance().setSDFG(sdfg, null);
        } else {
            showErrorModal('Failed to load SDFG from URL');
            void WebSDFV.getInstance().setSDFG(null);
        }
    };
    request.onerror = () => {
        showErrorModal(
            'Failed to load SDFG from URL. Error code: ' +
            request.status.toString()
        );
        void WebSDFV.getInstance().setSDFG(null);
    };
    request.open(
        'GET', url + (url.includes('?') ? '&' : '?') +
        (new Date()).getTime().toString(),
        true
    );
    request.send();
}

export function graphFindRecursive(
    graph: DagreGraph,
    predicate: (graph: DagreGraph, element: SDFGElement) => boolean,
    results: (dagre.Node<SDFGElement> | dagre.GraphEdge)[]
): void {
    for (const nodeid of graph.nodes()) {
        const node = graph.node(nodeid);
        if (node && predicate(graph, node))
            results.push(node);
        // Enter states or nested SDFGs recursively
        if (node?.graph) {
            graphFindRecursive(node.graph, predicate, results);
        } else if (node instanceof ConditionalBlock) {
            for (const [_, branch] of node.branches) {
                if (branch.graph)
                    graphFindRecursive(branch.graph, predicate, results);
            }
        }
    }
    for (const edgeid of graph.edges()) {
        const edge = graph.edge(edgeid);
        if (edge && predicate(graph, edge))
            results.push(edge);
    }
}

export function findInGraphPredicate(
    ui: ISDFVUserInterface, renderer: SDFGRenderer,
    predicate: (graph: DagreGraph, element: SDFGElement) => boolean
): void {
    if (!renderer.graph)
        return;

    ui.infoSetTitle('Search Results');

    const results: SDFGElement[] = [];
    graphFindRecursive(renderer.graph, predicate, results);

    // Zoom to bounding box of all results first
    if (results.length > 0)
        renderer.zoomToFit(results);

    // Show clickable results in sidebar
    const sidebar = ui.infoContentContainer;
    if (sidebar) {
        sidebar.html('');
        for (const result of results) {
            const d = $('<div>', {
                class: 'context_menu_option',
                html: htmlSanitize`${result.type} ${result.label}`,
                click: () => {
                    renderer.zoomToFit([result]);
                },
            });
            d.on('mouseenter', () => {
                if (!result.highlighted)
                    renderer.drawAsync();
            });
            d.on('mouseleave', () => {
                if (result.highlighted)
                    renderer.drawAsync();
            });
            sidebar.append(d);
        }
    }

    ui.infoShow();
}

export function findInGraph(
    ui: ISDFVUserInterface, renderer: SDFGRenderer, query: string,
    caseSensitive: boolean = false
): void {
    if (!caseSensitive)
        query = query.toLowerCase();
    findInGraphPredicate(
        ui, renderer, (graph: DagreGraph, element: SDFGElement) => {
            let text = element.textForFind();
            if (!caseSensitive)
                text = text.toLowerCase();
            return text.includes(query);
        }
    );
}

function parseScriptParamValue(
    val: string
): boolean | string | number | null | undefined {
    if (val === 'true')
        return true;
    if (val === 'false')
        return false;
    if (val === 'null')
        return null;
    if (val === 'undefined')
        return undefined;
    if (!isNaN(+val))
        return +val;
    return val;
}

function settingReadDefault(
    name: string, def: boolean | string | number | null | undefined
): boolean | string | number | null | undefined {
    if (document.currentScript?.hasAttribute(name)) {
        const attr = document.currentScript.getAttribute(name);
        if (attr)
            return parseScriptParamValue(attr);
    }

    const param = getParameterByName(name);
    if (param)
        return parseScriptParamValue(param);

    return def;
}

$(() => {
    // Do not run initiailization code if inside of VSCode.
    try {
        // eslint-disable-next-line @typescript-eslint/no-unused-expressions
        vscode;
        if (vscode)
            return;
    } catch (_) { }

    // Set the default settings based on the current script's attributes
    // or URL parameters.
    const isEmbedded = document.getElementById('embedded') !== null;
    if (isEmbedded) {
        SDFVSettings.set<boolean>('toolbar', false);
        SDFVSettings.set<boolean>('minimap', false);
    }

    // Check if any of the remaining settings are provided via the URL.
    for (const key of SDFVSettings.settingsKeys) {
        const overrideVal = settingReadDefault(key, undefined);
        if (overrideVal !== undefined)
            SDFVSettings.set(key, overrideVal);
    }

    WebSDFV.getInstance().init();

    // If the renderer is not null, an SDFG has already been set from somewhere
    // else.
    if (WebSDFV.getInstance().renderer === undefined) {
        if (document.currentScript?.hasAttribute('data-sdfg-json')) {
            const sdfgString =
                document.currentScript.getAttribute('data-sdfg-json');
            if (sdfgString) {
                void WebSDFV.getInstance().setSDFG(
                    checkCompatLoad(parseSDFG(sdfgString)), null
                );
            }
        } else if (document.currentScript?.hasAttribute('data-url')) {
            const url =
                document.currentScript.getAttribute('data-url');
            if (url)
                loadSDFGFromURL(url);
        } else {
            const url = getParameterByName('url');
            if (url)
                loadSDFGFromURL(url);
            else
                void WebSDFV.getInstance().setSDFG(null);
        }
    }
});

// Define global exports outside of webpack
declare global {
    interface Window {
        // Extensible classes for rendering and overlays
        OverlayManager: typeof OverlayManager;
        GenericSdfgOverlay: typeof GenericSdfgOverlay;
        SDFGElement: typeof SDFGElement;

        // API classes
        SDFV: typeof SDFV;
        WebSDFV: typeof WebSDFV;
        SDFGRenderer: typeof SDFGRenderer;

        // Exported functions
        parseSDFG: (sdfgJson: string) => JsonSDFG;
        stringifySDFG: (sdfg: JsonSDFG) => string;
        checkCompatLoad: (sdfg: JsonSDFG) => JsonSDFG;
        checkCompatSave: (sdfg: JsonSDFG) => JsonSDFG;
    }
}

window.OverlayManager = OverlayManager;
window.GenericSdfgOverlay = GenericSdfgOverlay;
window.SDFGElement = SDFGElement;
window.SDFV = SDFV;
window.WebSDFV = WebSDFV;
window.SDFGRenderer = SDFGRenderer;
window.parseSDFG = parseSDFG;
window.stringifySDFG = stringifySDFG;
window.checkCompatLoad = checkCompatLoad;
window.checkCompatSave = checkCompatSave;
