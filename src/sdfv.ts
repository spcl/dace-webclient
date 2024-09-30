// Copyright 2019-2024 ETH Zurich and the DaCe authors. All rights reserved.

import $ from 'jquery';

import 'bootstrap';

import '../scss/sdfv.scss';

import { EventEmitter } from 'events';
import { mean, median } from 'mathjs';
import {
    DagreGraph,
    JsonSDFG,
    ModeButtons,
    showErrorModal,
    traverseSDFGScopes,
} from './index';
import { LViewRenderer } from './local_view/lview_renderer';
import {
    RuntimeMicroSecondsOverlay,
} from './overlays/runtime_micro_seconds_overlay';
import { OverlayManager } from './overlay_manager';
import { SDFGRenderer } from './renderer/renderer';
import {
    ConditionalBlock,
    SDFG,
    SDFGElement,
    SDFGNode,
} from './renderer/renderer_elements';
import { htmlSanitize } from './utils/sanitization';
import {
    checkCompatLoad,
    checkCompatSave,
    parse_sdfg,
    stringify_sdfg,
} from './utils/sdfg/json_serializer';
import { SDFVSettings } from './utils/sdfv_settings';
import { DiffMap, WebSDFGDiffViewer } from './sdfg_diff_viewer';
import { ISDFVUserInterface, SDFVWebUI } from './sdfv_ui';
import { GenericSdfgOverlay } from './overlays/generic_sdfg_overlay';

declare const vscode: any;

export interface ISDFV {
    linkedUI: ISDFVUserInterface;

    outline(): void;
}

export abstract class SDFV extends EventEmitter implements ISDFV {

    public static LINEHEIGHT: number = 10;
    // Points-per-pixel threshold for not drawing Arrowheads of
    // memlets/interstate edges.
    public static ARROW_LOD: number = 2.0; // 2.0
    // Points-per-pixel threshold for not drawing connectors.
    public static CONNECTOR_LOD = 2.0; // 2.0

    public static DEFAULT_CANVAS_FONTSIZE: number = 10;
    public static DEFAULT_MAX_FONTSIZE: number = 20; // 20
    public static DEFAULT_FAR_FONT_MULTIPLIER: number = 16; // 16

    protected renderer: SDFGRenderer | null = null;
    protected localViewRenderer: LViewRenderer | null = null;

    public constructor() {
        super();
        return;
    }

    public abstract get linkedUI(): ISDFVUserInterface;

    public onLoadedRuntimeReport(
        report: { traceEvents: any[] },
        renderer: SDFGRenderer | null = null
    ): void {
        const runtimeMap: { [uuids: string]: number[] } = {};
        const summaryMap: { [uuids: string]: { [key: string]: number } } = {};

        if (!renderer)
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
                        runtimeMap[uuid].push(event.dur);
                    else
                        runtimeMap[uuid] = [event.dur];
                }
            }

            for (const key in runtimeMap) {
                const values = runtimeMap[key];
                const minmax = get_minmax(values);
                const min = minmax[0];
                const max = minmax[1];
                const runtime_summary = {
                    'min': min,
                    'max': max,
                    'mean': mean(values),
                    'med': median(values),
                    'count': values.length,
                };
                summaryMap[key] = runtime_summary;
            }

            if (!renderer.overlayManager.is_overlay_active(
                RuntimeMicroSecondsOverlay
            )) {
                renderer.overlayManager.register_overlay(
                    RuntimeMicroSecondsOverlay
                );
            }
            const ol = renderer.overlayManager.get_overlay(
                RuntimeMicroSecondsOverlay
            );
            if (ol && ol instanceof RuntimeMicroSecondsOverlay) {
                ol.set_runtime_map(summaryMap);
                ol.refresh();
            }
        }
    }

    public abstract outline(): void;

    public set_renderer(renderer: SDFGRenderer | null): void {
        if (renderer) {
            this.localViewRenderer?.destroy();
            this.localViewRenderer?.resizeObserver.disconnect();
            this.localViewRenderer = null;
        }
        this.renderer = renderer;

        SDFVWebUI.getInstance().enableInfoClear();
        SDFVWebUI.getInstance().infoClear();
    }

    public setLocalViewRenderer(localViewRenderer: LViewRenderer | null): void {
        if (localViewRenderer) {
            this.renderer?.destroy();
            this.renderer = null;
        }
        this.localViewRenderer = localViewRenderer;
    }

    public get_renderer(): SDFGRenderer | null {
        return this.renderer;
    }

    public getLocalViewRenderer(): LViewRenderer | null {
        return this.localViewRenderer;
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

    private currentSDFGFile: File | null = null;
    private modeButtons: ModeButtons | null = null;

    public get inittialized(): boolean {
        return this._initialized;
    }

    public init(): void {
        if (this._initialized)
            return;

        this.registerEventListeners();
        this.UI.init();

        this._initialized = true;

        this.emit('initialized');
    }

    public setModeButtons(modeButtons: ModeButtons): void {
        this.modeButtons = modeButtons;
    }

    private loadSDFG(change: any): void {
        if (change.target.files.length < 1)
            return;
        this.currentSDFGFile = change.target.files[0];
        this.readSDFGFile();
    }

    private readSDFGFile(): void {
        if (!this.currentSDFGFile)
            return;

        const fileReader = new FileReader();
        fileReader.onload = (e) => {
            const resultString = e.target?.result;
            const container = document.getElementById('contents');
            const infoField = document.getElementById('task-info-field');

            if (resultString && container && infoField) {
                // Create the loader element before starting to parse and layout
                // the graph. The layouting can take several seconds for large
                // graphs on slow machines. The user sees a loading animation in
                // the meantime so that the site doesn't appear unresponsive.
                // The loader element is removed/cleared again at the end of the
                // layout function in the SDFGRenderer.
                const loaderDiv = document.createElement('div');
                loaderDiv.classList.add('loader');
                infoField.appendChild(loaderDiv);

                // Use setTimeout function to force the browser to reload the
                // dom with the above loader element.
                setTimeout(() => {
                    this.setSDFG(checkCompatLoad(parse_sdfg(resultString)));
                }, 10);
            }
        };
        fileReader.readAsArrayBuffer(this.currentSDFGFile);
    }

    public enterDiffView(sdfgA: JsonSDFG, sdfgB: JsonSDFG, precomputedDiff?: DiffMap): void {
        $('#contents').hide();

        this.renderer?.destroy();

        this.UI.infoClear();
        this.deregisterEventListeners();

        WebSDFGDiffViewer.init(sdfgA, sdfgB, precomputedDiff);

        $('#diff-container').show();
    }

    private loadDiffSDFG(e: any): void {
        if (e.target.files.length < 1 || !e.target.files[0])
            return;

        const fileReader = new FileReader();
        fileReader.onload = (e) => {
            const sdfgB = this.renderer?.get_sdfg();
            if (e.target?.result && sdfgB) {
                const sdfgA = checkCompatLoad(parse_sdfg(e.target.result));
                this.enterDiffView(sdfgA, sdfgB);
            }
        };
        fileReader.readAsArrayBuffer(e.target.files[0]);
        // Reset the input to nothing so we are able to observe a change event
        // again if the user wants to re-diff with the same file again.
        e.target.value = '';
    }

    private loadRuntimeReportFile(e: any): void {
        if (e.target.files.length < 1 || !e.target.files[0])
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
            this.onLoadedRuntimeReport(JSON.parse(resultString));
        };
        fileReader.readAsText(e.target.files[0]);
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
        const graph = this.renderer?.get_graph();
        if (!graph)
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
                </span> SDFG ${this.renderer?.get_sdfg().attributes.name}
            `,
            click: () => {
                this.renderer?.zoom_to_view();
            },
        }).appendTo(sidebar);

        const stack: (JQuery<HTMLElement> | null)[] = [sidebar];

        // Add elements to tree view in sidebar
        traverseSDFGScopes(graph, (node, parent) => {
            // Skip exit nodes when scopes are known
            if (node.type().endsWith('Exit') &&
                node.data.node.scope_entry >= 0) {
                stack.push(null);
                return true;
            }

            let is_collapsed = node.attributes().is_collapsed;
            is_collapsed = (is_collapsed === undefined) ? false : is_collapsed;
            let node_type = node.type();

            // If a scope has children, remove the name "Entry" from the type
            if (node.type().endsWith('Entry') && node.parent_id && node.id) {
                const state = node.parentElem?.data.state;
                if (state.scope_dict[node.id] !== undefined)
                    node_type = node_type.slice(0, -5);
            }

            // Create element
            const entry = $('<div>', {
                class: 'context_menu_option',
                html: htmlSanitize`
                    ${node_type} ${node.label()}${is_collapsed ? ' (collapsed)' : ''}
                `,
                click: (e: JQuery.Event) => {
                    // Show node or entire scope
                    const nodes_to_display = [node];
                    if (node.type().endsWith('Entry') && node.parentElem &&
                        node.id) {
                        const state = node.parentElem?.data.state;
                        if (state.scope_dict[node.id] !== undefined) {
                            for (const subnode_id of state.scope_dict[node.id])
                                nodes_to_display.push(parent.node(subnode_id));
                        }
                    }

                    this.renderer?.zoom_to_view(nodes_to_display);

                    // Ensure that the innermost div handles the event.
                    if (!e) {
                        if (window.event) {
                            window.event.cancelBubble = true;
                            window.event.stopPropagation();
                        }
                    } else {
                        if (e.stopPropagation)
                            e.stopPropagation();
                    }
                },
            });
            stack.push(entry);

            // If is collapsed, don't traverse further
            if (is_collapsed)
                return false;

            return true;
        }, (_node: SDFGNode, _parent: DagreGraph) => {
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
                    const predicate = eval(query.toString());
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

    public setSDFG(
        sdfg: JsonSDFG | null = null,
        userTransform: DOMMatrix | null = null,
        debugDraw: boolean = false
    ): void {
        this.renderer?.destroy();
        const container = document.getElementById('contents');
        if (container && sdfg) {
            const renderer = new SDFGRenderer(
                sdfg, container, this, null, userTransform, debugDraw, null,
                this.modeButtons
            );
            this.set_renderer(renderer);
            renderer.on('selection_changed', () => {
                const selectedElements = renderer.get_selected_elements();
                let element;
                if (selectedElements.length === 0)
                    element = new SDFG(renderer.get_sdfg());
                else if (selectedElements.length === 1)
                    element = selectedElements[0];
                else
                    element = null;

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
        }
        this.UI.infoClear();
        $('#load-instrumentation-report-btn').prop('disabled', false);
        $('#diff-view-btn').prop('disabled', false);
    }

}

/**
 * Get the min/max values of an array.
 * This is more stable than Math.min/max for large arrays, since Math.min/max
 * is recursive and causes a too high stack-length with long arrays.
 */
function get_minmax(arr: number[]): [number, number] {
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
            const sdfg = checkCompatLoad(parse_sdfg(request.response));
            WebSDFV.getInstance().setSDFG(sdfg, null);
        } else {
            showErrorModal('Failed to load SDFG from URL');
            WebSDFV.getInstance().setSDFG(null);
        }
    };
    request.onerror = () => {
        showErrorModal(
            'Failed to load SDFG from URL. Error code: ' + request.status
        );
        WebSDFV.getInstance().setSDFG(null);
    };
    request.open(
        'GET', url + ((/\?/).test(url) ? '&' : '?') + (new Date()).getTime(),
        true
    );
    request.send();
}

export function graphFindRecursive(
    graph: DagreGraph, predicate: CallableFunction,
    results: (dagre.Node<SDFGElement> | dagre.GraphEdge)[]
): void {
    for (const nodeid of graph.nodes()) {
        const node = graph.node(nodeid);
        if (predicate(graph, node))
            results.push(node);
        // Enter states or nested SDFGs recursively
        if (node.data.graph) {
            graphFindRecursive(node.data.graph, predicate, results);
        } else if (node instanceof ConditionalBlock) {
            for (const [_, branch] of node.branches) {
                if (branch.data.graph)
                    graphFindRecursive(branch.data.graph, predicate, results);
            }
        }
    }
    for (const edgeid of graph.edges()) {
        const edge = graph.edge(edgeid);
        if (predicate(graph, edge))
            results.push(edge);
    }
}

export function findInGraphPredicate(
    ui: ISDFVUserInterface, renderer: SDFGRenderer, predicate: CallableFunction
): void {
    const sdfg = renderer.get_graph();
    if (!sdfg)
        return;

    ui.infoSetTitle('Search Results');

    const results: (dagre.Node<SDFGElement> | dagre.GraphEdge)[] = [];
    graphFindRecursive(sdfg, predicate, results);

    // Zoom to bounding box of all results first
    if (results.length > 0)
        renderer.zoom_to_view(results);

    // Show clickable results in sidebar
    const sidebar = ui.infoContentContainer;
    if (sidebar) {
        sidebar.html('');
        for (const result of results) {
            const d = $('<div>', {
                class: 'context_menu_option',
                html: htmlSanitize`${result.type()} ${result.label()}`,
                click: () => {
                    renderer.zoom_to_view([result]);
                },
            });
            d.on('mouseenter', () => {
                if (!result.highlighted) {
                    result.highlighted = true;
                    renderer.draw_async();
                }
            });
            d.on('mouseleave', () => {
                if (result.highlighted) {
                    result.highlighted = false;
                    renderer.draw_async();
                }
            });
            sidebar.append(d);
        }
    }

    ui.infoShow();
}

export function findInGraph(
    ui: ISDFVUserInterface, renderer: SDFGRenderer, query: string,
    case_sensitive: boolean = false
): void {
    if (!case_sensitive)
        query = query.toLowerCase();
    findInGraphPredicate(
        ui, renderer, (graph: DagreGraph, element: SDFGElement) => {
            let text = element.text_for_find();
            if (!case_sensitive)
                text = text.toLowerCase();
            return text.indexOf(query) !== -1;
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
        const attr = document.currentScript?.getAttribute(name);
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

    // If the renderer is not null, an SDFG has already been set from somewhere else.
    if (WebSDFV.getInstance().get_renderer() === null) {
        if (document.currentScript?.hasAttribute('data-sdfg-json')) {
            const sdfg_string =
                document.currentScript?.getAttribute('data-sdfg-json');
            if (sdfg_string) {
                WebSDFV.getInstance().setSDFG(
                    checkCompatLoad(parse_sdfg(sdfg_string)), null
                );
            }
        } else if (document.currentScript?.hasAttribute('data-url')) {
            const url =
                document.currentScript?.getAttribute('data-url');
            if (url)
                loadSDFGFromURL(url);
        } else {
            const url = getParameterByName('url');
            if (url)
                loadSDFGFromURL(url);
            else
                WebSDFV.getInstance().setSDFG(null);
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
        parse_sdfg: (sdfg_json: string) => JsonSDFG;
        stringify_sdfg: (sdfg: JsonSDFG) => string;
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
window.parse_sdfg = parse_sdfg;
window.stringify_sdfg = stringify_sdfg;
window.checkCompatLoad = checkCompatLoad;
window.checkCompatSave = checkCompatSave;
