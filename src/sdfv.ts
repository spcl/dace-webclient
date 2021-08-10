// Copyright 2019-2021 ETH Zurich and the DaCe authors. All rights reserved.

import { parse_sdfg } from './utils/sdfg/json_serializer';
import { mean, median } from 'mathjs';
import { SDFGRenderer } from './renderer/renderer';
import { htmlSanitize } from './utils/sanitization';
import {
    Edge,
    SDFG,
    SDFGElement,
    SDFGNode,
    State
} from './renderer/renderer_elements';
import {
    RuntimeMicroSecondsOverlay
} from './overlays/runtime_micro_seconds_overlay';
import { DagreSDFG, Point2D } from './types';
import { SDFVUIHandlers } from './sdfv_ui_handlers';
import $ from 'jquery';

let fr: FileReader;
let file: File | null = null;
let instrumentation_file: File | null = null;

export class SDFV {

    public static LINEHEIGHT: number = 10;
    // Points-per-pixel threshold for drawing tasklet contents.
    public static TASKLET_LOD: number = 0.35;
    // Points-per-pixel threshold for simple version of map nodes (label only).
    public static SCOPE_LOD: number = 1.5;
    // Points-per-pixel threshold for not drawing memlets/interstate edges.
    public static EDGE_LOD: number = 8;
    // Points-per-pixel threshold for not drawing node shapes and labels.
    public static NODE_LOD: number = 5;
    // Pixel threshold for not drawing state contents.
    public static STATE_LOD: number = 50;

    private static readonly INSTANCE = new SDFV();

    private renderer: SDFGRenderer | null = null;

    private constructor() {
        return;
    }

    public static get_instance(): SDFV {
        return this.INSTANCE;
    }

    public set_renderer(renderer: SDFGRenderer | null): void {
        this.renderer = renderer;
    }

    public get_renderer(): SDFGRenderer | null {
        return this.renderer;
    }

}

if (document.currentScript?.hasAttribute('data-sdfg-json')) {
    const sdfg_string = document.currentScript?.getAttribute('data-sdfg-json');
    if (sdfg_string)
        init_sdfv(parse_sdfg(sdfg_string));
} else {
    const url = getParameterByName('url');
    if (url)
        load_sdfg_from_url(url);
    else
        init_sdfv(null);
}


function init_sdfv(
    sdfg: any,
    user_transform: DOMMatrix | null = null,
    debug_draw: boolean = false
): void {
    $('#sdfg-file-input').on('change', (e: any) => {
        if (e.target.files.length < 1)
            return;
        file = e.target.files[0];
        reload_file();
    });
    $('#menuclose').on('click', () => close_menu());
    $('#reload').on('click', () => {
        reload_file();
    });
    $('#instrumentation-report-file-input').on('change', (e: any) => {
        if (e.target.files.length < 1)
            return;
        instrumentation_file = e.target.files[0];
        load_instrumentation_report();
    });
    $('#outline').on('click', () => {
        const renderer = SDFV.get_instance().get_renderer();
        if (renderer)
            setTimeout(() => outline(renderer, renderer.get_graph()), 1);
    });
    $('#search-btn').on('click', () => {
        const renderer = SDFV.get_instance().get_renderer();
        if (renderer)
            setTimeout(() => {
                const graph = renderer.get_graph();
                const query = $('#search').val();
                if (graph && query)
                    find_in_graph(
                        renderer, graph, query.toString(),
                        $('#search-case').is(':checked')
                    );
            }, 1);
    });
    $('#search').on('keydown', (e: any) => {
        if (e.key == 'Enter' || e.which == 13) {
            start_find_in_graph();
            e.preventDefault();
        }
    });

    let mode_buttons = null;
    const pan_btn = document.getElementById("pan-btn");
    const move_btn = document.getElementById("move-btn");
    const select_btn = document.getElementById("select-btn");
    const add_btns = [];
    add_btns.push(document.getElementById('elem_map'));
    add_btns.push(document.getElementById('elem_consume'));
    add_btns.push(document.getElementById('elem_tasklet'));
    add_btns.push(document.getElementById('elem_nested_sdfg'));
    add_btns.push(document.getElementById('elem_access_node'));
    add_btns.push(document.getElementById('elem_stream'));
    add_btns.push(document.getElementById('elem_state'));
    if (pan_btn)
        mode_buttons = {
            pan: pan_btn,
            move: move_btn,
            select: select_btn,
            add_btns: add_btns,
        };

    if (sdfg !== null)
        SDFV.get_instance().set_renderer(new SDFGRenderer(
            sdfg, document.getElementById('contents'), mouse_event,
            user_transform, debug_draw, null, mode_buttons
        ));
}

function start_find_in_graph(): void {
    const renderer = SDFV.get_instance().get_renderer();
    if (renderer)
        setTimeout(() => {
            const graph = renderer.get_graph();
            const query = $('#search').val();
            if (graph && query)
                find_in_graph(
                    renderer, graph, query.toString(),
                    $('#search-case').is(':checked')
                );
        }, 1);
}

function reload_file(): void {
    if (!file)
        return;
    fr = new FileReader();
    fr.onload = file_read_complete;
    fr.readAsText(file);
}

function file_read_complete(): void {
    const result_string = fr.result;
    if (result_string) {
        const sdfg = parse_sdfg(result_string.toString());
        SDFV.get_instance().get_renderer()?.destroy();
        SDFV.get_instance().set_renderer(new SDFGRenderer(
            sdfg, document.getElementById('contents'), mouse_event
        ));
        close_menu();
    }
}

function load_instrumentation_report(): void {
    if (!instrumentation_file)
        return;
    fr = new FileReader();
    fr.onload = load_instrumentation_report_callback;
    fr.readAsText(instrumentation_file);
}

function load_instrumentation_report_callback(): void {
    let result_string = '';
    if (fr.result) {
        if (fr.result instanceof ArrayBuffer) {
            const decoder = new TextDecoder('utf-8');
            result_string = decoder.decode(new Uint8Array(fr.result));
        } else {
            result_string = fr.result;
        }
    }
    instrumentation_report_read_complete(JSON.parse(result_string));
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

function instrumentation_report_read_complete(report: any): void {
    const runtime_map: { [uuids: string]: number[] } = {};
    const summarized_map: { [uuids: string]: { [key: string]: number} } = {};

    if (report.traceEvents && SDFV.get_instance().get_renderer()?.get_sdfg()) {
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

                if (runtime_map[uuid] !== undefined)
                    runtime_map[uuid].push(event.dur);
                else
                    runtime_map[uuid] = [event.dur];
            }
        }

        for (const key in runtime_map) {
            const values = runtime_map[key];
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
            summarized_map[key] = runtime_summary;
        }

        const renderer = SDFV.get_instance().get_renderer();

        const overlay_manager = renderer?.get_overlay_manager();
        if (overlay_manager) {
            if (!overlay_manager.is_overlay_active(
                RuntimeMicroSecondsOverlay
            )) {
                overlay_manager.register_overlay(
                    RuntimeMicroSecondsOverlay
                );
            }
            const ol = overlay_manager.get_overlay(
                RuntimeMicroSecondsOverlay
            );
            if (ol && ol instanceof RuntimeMicroSecondsOverlay) {
                ol.set_runtime_map(summarized_map);
                ol.refresh();
            }
        }
    }
}

// https://stackoverflow.com/a/901144/6489142
function getParameterByName(name: string): string | null {
    const url = window.location.href;
    name = name.replace(/[\[\]]/g, '\\$&');
    const regex = new RegExp('[?&]' + name + '(=([^&#]*)|&|#|$)'),
        results = regex.exec(url);
    if (!results) return null;
    if (!results[2]) return '';
    return decodeURIComponent(results[2].replace(/\+/g, ' '));
}

function load_sdfg_from_url(url: string): void {
    const request = new XMLHttpRequest();
    request.responseType = 'text'; // Will be parsed as JSON by parse_sdfg
    request.onload = () => {
        if (request.status == 200) {
            const sdfg = parse_sdfg(request.response);
            SDFV.get_instance().get_renderer()?.destroy();
            init_sdfv(sdfg);
        } else {
            alert("Failed to load SDFG from URL");
            init_sdfv(null);
        }
    };
    request.onerror = () => {
        alert("Failed to load SDFG from URL: " + request.status);
        init_sdfv(null);
    };
    request.open(
        'GET', url + ((/\?/).test(url) ? "&" : "?") + (new Date()).getTime(),
        true
    );
    request.send();
}

function find_recursive(
    graph: DagreSDFG, query: string, results: any[],
    case_sensitive: boolean
): void {
    for (const nodeid of graph.nodes()) {
        const node = graph.node(nodeid);
        let label = node.label();
        if (!case_sensitive)
            label = label.toLowerCase();
        if (label.indexOf(query) !== -1)
            results.push(node);
        // Enter states or nested SDFGs recursively
        if (node.data.graph)
            find_recursive(node.data.graph, query, results, case_sensitive);
    }
    for (const edgeid of graph.edges()) {
        const edge = graph.edge(edgeid);
        let label = edge.label();
        if (label !== undefined) {
            if (!case_sensitive)
                label = label.toLowerCase();
            if (label.indexOf(query) !== -1)
                results.push(edge);
        }
    }
}

function find_in_graph(
    renderer: SDFGRenderer, sdfg: DagreSDFG, query: string,
    case_sensitive: boolean = false
): void {
    sidebar_set_title('Search Results for "' + query + '"');

    const results: any[] = [];
    if (!case_sensitive)
        query = query.toLowerCase();
    find_recursive(sdfg, query, results, case_sensitive);

    // Zoom to bounding box of all results first
    if (results.length > 0)
        renderer.zoom_to_view(results);

    // Show clickable results in sidebar
    const sidebar = sidebar_get_contents();
    if (sidebar) {
        sidebar.innerHTML = '';
        for (const result of results) {
            const d = document.createElement('div');
            d.className = 'context_menu_option';
            d.innerHTML = htmlSanitize`${result.type()} ${result.label()}`;
            d.onclick = () => { renderer.zoom_to_view([result]) };
            d.onmouseenter = () => {
                if (!result.highlighted) {
                    result.highlighted = true;
                    renderer.draw_async();
                }
            };
            d.onmouseleave = () => {
                if (result.highlighted) {
                    result.highlighted = false;
                    renderer.draw_async();
                }
            };
            sidebar.appendChild(d);
        }
    }

    sidebar_show();
}

function recursive_find_graph(
    graph: DagreSDFG, sdfg_id: number
): DagreSDFG | undefined {
    let found = undefined;
    graph.nodes().forEach(n_id => {
        const n = graph.node(n_id);
        if (n && n.sdfg.sdfg_list_id === sdfg_id) {
            found = graph;
            return found;
        } else if (n && n.data.graph) {
            found = recursive_find_graph(n.data.graph, sdfg_id);
            if (found)
                return found;
        }
    });
    return found;
}

function find_state(graph: DagreSDFG, state_id: number): State | undefined {
    let state = undefined;
    graph.nodes().forEach(s_id => {
        if (Number(s_id) === state_id) {
            state = graph.node(s_id);
            return state;
        }
    });
    return state;
}

function find_node(state: State, node_id: number): SDFGNode | undefined {
    let node = undefined;
    state.data.graph.nodes().forEach((n_id: any) => {
        if (Number(n_id) === node_id) {
            node = state.data.graph.node(n_id);
            return node;
        }
    });
    return node;
}

function find_edge(state: State, edge_id: number): Edge | undefined {
    let edge = undefined;
    state.data.graph.edges().forEach((e_id: any) => {
        if (Number(e_id.name) === edge_id) {
            edge = state.data.graph.edge(e_id);
            return edge;
        }
    });
    return edge;
}

function find_graph_element(
    graph: DagreSDFG, type: string, sdfg_id: number, state_id: number = -1,
    el_id: number = -1
): SDFGElement | undefined {
    const requested_graph = recursive_find_graph(graph, sdfg_id);
    let state = undefined;
    let isedge = undefined;
    if (requested_graph) {
        switch (type) {
            case 'edge':
                state = find_state(requested_graph, state_id);
                if (state)
                    return find_edge(state, el_id);
                break;
            case 'state':
                return find_state(requested_graph, state_id);
            case 'node':
                state = find_state(requested_graph, state_id);
                if (state)
                    return find_node(state, el_id);
                break;
            case 'isedge':
                Object.values((requested_graph as any)._edgeLabels).forEach(
                    (ise: any) => {
                        if (ise.id === el_id) {
                            isedge = ise;
                            return isedge;
                        }
                    }
                );
                return isedge;
            default:
                return undefined;
        }
    }
    return undefined;
}

function mouse_event(
    evtype: string,
    _event: Event,
    _mousepos: Point2D,
    _elements: any[],
    renderer: SDFGRenderer,
    selected_elements: SDFGElement[],
    ends_drag: boolean
): boolean {
    if ((evtype === 'mouseup' && !ends_drag) || evtype === 'dblclick') {
        const menu = renderer.get_menu();
        if (menu)
            menu.destroy();
        let element;
        if (selected_elements.length === 0)
            element = new SDFG(renderer.get_sdfg());
        else if (selected_elements.length === 1)
            element = selected_elements[0];
        else
            element = null;

        if (element !== null) {
            sidebar_set_title(element.type() + ' ' + element.label());
            fill_info(element);
        } else {
            close_menu();
            sidebar_set_title('Multiple elements selected');
        }
        sidebar_show();
    }
    return false;
}

function init_menu(): void {
    return SDFVUIHandlers.on_init_menu();
}

function sidebar_set_title(title: string): void {
    return SDFVUIHandlers.on_sidebar_set_title(title);
}

function sidebar_show(): void {
    return SDFVUIHandlers.on_sidebar_show();
}

function sidebar_get_contents(): HTMLElement | null {
    return SDFVUIHandlers.sidebar_get_contents();
}

function close_menu(): void {
    return SDFVUIHandlers.on_close_menu();
}

export function outline(renderer: SDFGRenderer, sdfg: any): void {
    return SDFVUIHandlers.on_outline(renderer, sdfg);
}

export function fill_info(elem: SDFGElement): void {
    return SDFVUIHandlers.on_fill_info(elem);
}

$(() => {
    init_menu();
});
