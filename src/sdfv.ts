// Copyright 2019-2024 ETH Zurich and the DaCe authors. All rights reserved.

import $ from 'jquery';

import 'bootstrap';

import '../scss/sdfv.scss';

import { mean, median } from 'mathjs';
import {
    DagreGraph,
    GenericSdfgOverlay,
    JsonSDFG,
    ModeButtons,
    Point2D,
    sdfg_property_to_string,
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
    AccessNode, Edge, Memlet, NestedSDFG, SDFG,
    SDFGElement,
    SDFGNode,
} from './renderer/renderer_elements';
import { htmlSanitize } from './utils/sanitization';
import {
    checkCompatLoad,
    parse_sdfg,
    stringify_sdfg,
} from './utils/sdfg/json_serializer';
import { SDFVSettings } from './utils/sdfv_settings';
import { WebSDFGDiffViewer } from './sdfg_diff_viewr';

declare const vscode: any;

export interface ISDFVUserInterface {
    get infoContentContainer(): JQuery<HTMLElement>;
    init(): void;
    infoClear(): void;
    infoShow(): void;
    infoSetTitle(title: string): void;
    disableInfoClear(): void;
    enableInfoClear(): void;
}

export class SDFVWebUI implements ISDFVUserInterface {

    private static readonly INSTANCE: SDFVWebUI = new SDFVWebUI();

    private constructor() {
    }

    public static getInstance(): SDFVWebUI {
        return this.INSTANCE;
    }

    public get infoContentContainer(): JQuery<HTMLElement> {
        return $('#sidebar-contents');
    }

    private initInfo(): void {
        const right = document.getElementById('sidebar');
        const bar = document.getElementById('dragbar');

        const drag = (e: MouseEvent) => {
            if ((document as any).selection)
                (document as any).selection.empty();
            else
                window.getSelection()?.removeAllRanges();

            if (right) {
                right.style.width = Math.max(
                    ((e.view ? e.view.innerWidth - e.pageX : 0)), 20
                ) + 'px';
            }
        };

        if (bar) {
            bar.addEventListener('mousedown', () => {
                document.addEventListener('mousemove', drag);
                document.addEventListener('mouseup', () => {
                    document.removeEventListener('mousemove', drag);
                });
            });
        }
    }

    public init(): void {
        this.initInfo();

        // Set up any external interaction mode buttons that may override the
        // renderer.
        const pan_btn = document.getElementById('pan-btn');
        const move_btn = document.getElementById('move-btn');
        const select_btn = document.getElementById('select-btn');
        const add_btns: HTMLElement[] = [];
        add_btns.push(document.getElementById('elem_map')!);
        add_btns.push(document.getElementById('elem_consume')!);
        add_btns.push(document.getElementById('elem_tasklet')!);
        add_btns.push(document.getElementById('elem_nested_sdfg')!);
        add_btns.push(document.getElementById('elem_access_node')!);
        add_btns.push(document.getElementById('elem_stream')!);
        add_btns.push(document.getElementById('elem_state')!);
        if (pan_btn) {
            WebSDFV.getInstance().setModeButtons({
                pan: pan_btn,
                move: move_btn,
                select: select_btn,
                add_btns: add_btns,
            });
        }
    }

    public infoClear(): void {
        this.infoContentContainer.html('');
        $('#sidebar').css('display', 'none');
    }

    public infoShow(): void {
        // Open sidebar if closed
        $('#sidebar').css('display', 'flex');
    }

    public infoSetTitle(title: string): void {
        $('#sidebar-header')?.text(title);
    }

    public disableInfoClear(): void {
        $('#menuclose').hide();
    }

    public enableInfoClear(): void {
        $('#menuclose').show();
    }

}

export abstract class SDFV {

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
        return;
    }

    protected onRendererMouseEvent(
        evtype: string,
        _event: Event,
        _mousepos: Point2D,
        _elements: {
            states: any[],
            nodes: any[],
            connectors: any[],
            edges: any[],
            isedges: any[],
        },
        renderer: SDFGRenderer,
        selected_elements: SDFGElement[],
        ends_pan: boolean
    ): boolean {
        // If the click ends a pan, we don't want to open the sidebar.
        if (evtype === 'click' && !ends_pan) {
            let element;
            if (selected_elements.length === 0)
                element = new SDFG(renderer.get_sdfg());
            else if (selected_elements.length === 1)
                element = selected_elements[0];
            else
                element = null;

            if (element !== null) {
                SDFVWebUI.getInstance().infoSetTitle(
                    element.type() + ' ' + element.label()
                );
                this.fill_info(element);
            } else {
                SDFVWebUI.getInstance().infoClear();
                SDFVWebUI.getInstance().infoSetTitle(
                    'Multiple elements selected'
                );
            }
            SDFVWebUI.getInstance().infoShow();
        }
        return false;
    }

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

    public fill_info(elem: SDFGElement | DagreGraph | null): void {
        const contentsRaw = SDFVWebUI.getInstance().infoContentContainer;
        if (!contentsRaw || !elem || !(elem instanceof SDFGElement))
            return;
        const contents = $(contentsRaw);
        contents.html('');

        if (elem instanceof Memlet) {
            contents.append($('<p>', {
                html: 'Connectors: ' + elem.src_connector + ' &rarr; ' +
                    elem.dst_connector,
            }));
        }
        contents.append($('<hr>'));

        if (elem instanceof Edge) {
            const btnContainer = $('<div>', {
                class: 'd-flex',
            });
            btnContainer.append($('<button>', {
                text: 'Jump to start',
                class: 'btn btn-sm btn-secondary',
                css: {
                    'margin-right': '10px',
                },
                click: () => {
                    elem.setViewToSource(this.get_renderer()!);
                },
            }));
            btnContainer.append($('<button>', {
                text: 'Jump to end',
                class: 'btn btn-sm btn-secondary',
                click: () => {
                    elem.setViewToDestination(this.get_renderer()!);
                },
            }));
            contents.append(btnContainer);
            contents.append($('<br>'));
        }

        for (const attr of Object.entries(elem.attributes() ?? {})) {
            if (attr[0].startsWith('_meta_'))
                continue;

            switch (attr[0]) {
                case 'layout':
                case 'sdfg':
                case '_arrays':
                case 'orig_sdfg':
                case 'transformation_hist':
                case 'position':
                    continue;
                default:
                    contents.append($('<b>', {
                        html: attr[0] + ':&nbsp;&nbsp;',
                    }));
                    contents.append($('<span>', {
                        html: sdfg_property_to_string(
                            attr[1], this.renderer?.view_settings()
                        ),
                    }));
                    contents.append($('<br>'));
                    break;
            }
        }

        // If access node, add array information too
        if (elem instanceof AccessNode) {
            const sdfg_array = elem.sdfg.attributes._arrays[
                elem.attributes().data
            ];
            contents.append($('<br>'));
            contents.append($('<h4>', {
                text: sdfg_array.type + ' properties:',
            }));
            for (const attr of Object.entries(sdfg_array.attributes)) {
                if (attr[0] === 'layout' || attr[0] === 'sdfg' ||
                    attr[0].startsWith('_meta_'))
                    continue;
                contents.append($('<b>', {
                    html: attr[0] + ':&nbsp;&nbsp;',
                }));
                contents.append($('<span>', {
                    html: sdfg_property_to_string(
                        attr[1], this.renderer?.view_settings()
                    ),
                }));
                contents.append($('<br>'));
            }
        }

        // If nested SDFG, add SDFG information too
        if (elem instanceof NestedSDFG && elem.attributes().sdfg) {
            const sdfg_sdfg = elem.attributes().sdfg;
            contents.append($('<br>'));
            contents.append($('<h4>', {
                text: 'SDFG properties:',
            }));
            for (const attr of Object.entries(sdfg_sdfg.attributes)) {
                if (attr[0].startsWith('_meta_'))
                    continue;

                switch (attr[0]) {
                    case 'layout':
                    case 'sdfg':
                        continue;
                    default:
                        contents.append($('<b>', {
                            html: attr[0] + ':&nbsp;&nbsp;',
                        }));
                        contents.append($('<span>', {
                            html: sdfg_property_to_string(
                                attr[1], this.renderer?.view_settings()
                            ),
                        }));
                        contents.append($('<br>'));
                        break;
                }
            }
        }
    }

}

export class WebSDFV extends SDFV {

    private static readonly INSTANCE: WebSDFV = new WebSDFV();

    private constructor() {
        super();
    }

    public static getInstance(): WebSDFV {
        return this.INSTANCE;
    }

    private readonly UI: SDFVWebUI = SDFVWebUI.getInstance();

    private currentSDFGFile: File | null = null;
    private modeButtons: ModeButtons | null = null;

    public init(): void {
        this.registerEventListeners();
        this.UI.init();
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

    private loadDiffSDFG(e: any): void {
        if (e.target.files.length < 1 || !e.target.files[0])
            return;

        const fileReader = new FileReader();
        fileReader.onload = (e) => {
            const sdfvContainer = $('#contents');
            const diffContainer = $('#diff-container');
            const sdfgB = this.renderer?.get_sdfg();

            if (e.target?.result && sdfvContainer && diffContainer && sdfgB) {
                // TODO: loading animation.
                sdfvContainer.hide();

                this.renderer?.destroy();

                this.UI.infoClear();
                this.deregisterEventListeners();

                const sdfgA = checkCompatLoad(parse_sdfg(e.target.result));
                WebSDFGDiffViewer.init(sdfgA, sdfgB);

                diffContainer.show();
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
            'click.sdfv', '#menuclose', this.UI.infoClear.bind(this.UI)
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
            const graph = this.renderer?.get_graph();
            const query = advanced ? $('#advsearch').val() : $('#search').val();
            if (graph && query && this.renderer) {
                if (advanced) {
                    const predicate = eval(query.toString());
                    find_in_graph_predicate(
                        this, this.renderer, graph, predicate
                    );
                } else {
                    find_in_graph(
                        this, this.renderer, graph, query.toString(),
                        $('#search-case').is(':checked')
                    );
                }
            }
        }, 1);
    }

    public setSDFG(
        sdfg: any | null = null,
        userTransform: DOMMatrix | null = null,
        debugDraw: boolean = false
    ): void {
        const container = document.getElementById('contents');
        if (container) {
            this.renderer?.destroy();
            if (sdfg) {
                this.set_renderer(
                    new SDFGRenderer(
                        sdfg, container, this, this.onRendererMouseEvent,
                        userTransform, debugDraw, null, this.modeButtons
                    )
                );
            }
            this.UI.infoClear();
            $('#load-instrumentation-report-btn').prop(
                'disabled', false
            );
            $('#diff-view-btn').prop('disabled', false);
        }
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
            WebSDFV.getInstance().setSDFG(sdfg, null, false);
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

function find_recursive(
    graph: DagreGraph, predicate: CallableFunction, results: any[]
): void {
    for (const nodeid of graph.nodes()) {
        const node = graph.node(nodeid);
        if (predicate(graph, node))
            results.push(node);
        // Enter states or nested SDFGs recursively
        if (node.data.graph)
            find_recursive(node.data.graph, predicate, results);
    }
    for (const edgeid of graph.edges()) {
        const edge = graph.edge(edgeid);
        if (predicate(graph, edge))
            results.push(edge);
    }
}

export function find_in_graph_predicate(
    sdfv: SDFV, renderer: SDFGRenderer, sdfg: DagreGraph,
    predicate: CallableFunction
): void {
    SDFVWebUI.getInstance().infoSetTitle('Search Results');

    const results: any[] = [];
    find_recursive(sdfg, predicate, results);

    // Zoom to bounding box of all results first
    if (results.length > 0)
        renderer.zoom_to_view(results);

    // Show clickable results in sidebar
    const sidebar = SDFVWebUI.getInstance().infoContentContainer;
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

    SDFVWebUI.getInstance().infoShow();
}

export function find_in_graph(
    sdfv: SDFV, renderer: SDFGRenderer, sdfg: DagreGraph, query: string,
    case_sensitive: boolean = false
): void {
    if (!case_sensitive)
        query = query.toLowerCase();
    find_in_graph_predicate(
        sdfv, renderer, sdfg, (graph: DagreGraph, element: SDFGElement) => {
            let text = element.text_for_find();
            if (!case_sensitive)
                text = text.toLowerCase();
            return text.indexOf(query) !== -1;
        }
    );
    SDFVWebUI.getInstance().infoSetTitle('Search Results for "' + query + '"');
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

    if (document.currentScript?.hasAttribute('data-sdfg-json')) {
        const sdfg_string =
            document.currentScript?.getAttribute('data-sdfg-json');
        if (sdfg_string) {
            WebSDFV.getInstance().setSDFG(
                checkCompatLoad(parse_sdfg(sdfg_string)), null, false
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
        SDFGRenderer: typeof SDFGRenderer;

        // Exported functions
        parse_sdfg: (sdfg_json: string) => JsonSDFG;
        stringify_sdfg: (sdfg: JsonSDFG) => string;
    }
}

window.OverlayManager = OverlayManager;
window.GenericSdfgOverlay = GenericSdfgOverlay;
window.SDFGElement = SDFGElement;
window.SDFV = SDFV;
window.SDFGRenderer = SDFGRenderer;
window.parse_sdfg = parse_sdfg;
window.stringify_sdfg = stringify_sdfg;
