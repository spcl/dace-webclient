// Copyright 2019-2021 ETH Zurich and the DaCe authors. All rights reserved.

import { parse_sdfg, stringify_sdfg } from "./utils/sdfg/json_serializer";
import { mean, median } from 'mathjs';
import { SDFGRenderer } from './renderer/renderer';
import { GenericSdfgOverlay } from "./overlays/generic_sdfg_overlay";
import { SDFVUIHandlers } from "./sdfv_ui_handlers";
import { htmlSanitize } from "./utils/sanitization";
import { SDFGElements } from "./renderer/renderer_elements";
import { assignIfNotExists } from "./utils/utils"
import {
    sdfg_property_to_string,
    sdfg_range_elem_to_string,
    sdfg_typeclass_to_string,
    string_to_sdfg_typeclass,
} from "./utils/sdfg/display";
import {
    find_graph_element_by_uuid,
    get_uuid_graph_element,
} from "./utils/sdfg/sdfg_utils";
import { traverse_sdfg_scopes } from "./utils/sdfg/traversal";
import { RuntimeMicroSecondsOverlay } from "./overlays/runtime_micro_seconds_overlay";
import { MemoryVolumeOverlay } from "./overlays/memory_volume_overlay";
import { StaticFlopsOverlay } from "./overlays/static_flops_overlay";
const { $ } = globalThis;

let fr;
let file = null;
let instrumentation_file = null;


// TODO: This is a workaround to utilize components of this module in non-ts
// components of the vscode extension. This is subject to change when these
// components are moved over from js to ts.
export const globals = assignIfNotExists(
    /** @type {{}} */ (globalThis),
    {
        daceRenderer: null,
        daceUIHandlers: SDFVUIHandlers,
        daceInitSDFV: init_sdfv,
        daceParseSDFG: parse_sdfg,
        daceStringifySDFG: stringify_sdfg,
        daceFindInGraph: find_in_graph,
        daceSDFGPropertyToString: sdfg_property_to_string,
        daceSDFGRangeElemToString: sdfg_range_elem_to_string,
        daceGetUUIDGraphElement: get_uuid_graph_element,
        daceFindGraphElementByUUID: find_graph_element_by_uuid,
        daceTraverseSDFGScopes: traverse_sdfg_scopes,
        daceSDFGTypeclassToString: sdfg_typeclass_to_string,
        daceStringToSDFGTypeclass: string_to_sdfg_typeclass,
        daceSDFGRenderer: SDFGRenderer,
        daceSDFGElements: SDFGElements,
        daceGenericSDFGOverlay: GenericSdfgOverlay,
        daceMemoryVolumeOverlay: MemoryVolumeOverlay,
        daceRuntimeMicroSecondsOverlay: RuntimeMicroSecondsOverlay,
        daceStaticFlopsOverlay: StaticFlopsOverlay,
        daceMouseEvent: mouse_event,
    }
);



if (document.currentScript.hasAttribute('data-sdfg-json')) {
    init_sdfv(parse_sdfg(document.currentScript.getAttribute('data-sdfg-json')));
} else {
    const url = getParameterByName('url');
    if (url)
        load_sdfg_from_url(url);
    else
        init_sdfv(null);
}


function init_sdfv(sdfg, user_transform = null, debug_draw = false) {
    $('#sdfg-file-input').change((e) => {
        if (e.target.files.length < 1)
            return;
        file = e.target.files[0];
        reload_file();
    });
    $('#menuclose').click(() => close_menu());
    $('#reload').click(() => {
        reload_file();
    });
    $('#instrumentation-report-file-input').change((e) => {
        if (e.target.files.length < 1)
            return;
        instrumentation_file = e.target.files[0];
        load_instrumentation_report();
    });
    $('#outline').click(() => {
        if (globals.daceRenderer)
            setTimeout(() => outline(globals.daceRenderer, globals.daceRenderer.graph), 1);
    });
    $('#search-btn').click(() => {
        if (globals.daceRenderer)
            setTimeout(() => {
                find_in_graph(globals.daceRenderer, globals.daceRenderer.graph, $('#search').val(),
                    $('#search-case')[0].checked);
            }, 1);
    });
    $('#search').on('keydown', (e) => {
        if (e.key == 'Enter' || e.which == 13) {
            start_find_in_graph();
            e.preventDefault();
        }
    });

    let mode_buttons = null;
    let pan_btn = document.getElementById("pan-btn");
    let move_btn = document.getElementById("move-btn");
    let select_btn = document.getElementById("select-btn");
    let add_btns = [];
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
        globals.daceRenderer = new SDFGRenderer(
            sdfg, document.getElementById('contents'), mouse_event,
            user_transform, debug_draw, null, mode_buttons
        );
}

function start_find_in_graph() {
    if (globals.daceRenderer)
        setTimeout(() => {
            find_in_graph(
                globals.daceRenderer, globals.daceRenderer.graph,
                $('#search').val(), $('#search-case')[0].checked
            );
        }, 1);
}

function reload_file() {
    if (!file)
        return;
    fr = new FileReader();
    fr.onload = file_read_complete;
    fr.readAsText(file);
}

function file_read_complete() {
    const sdfg = parse_sdfg(fr.result);
    globals.daceRenderer?.destroy();
    globals.daceRenderer = new SDFGRenderer(sdfg, document.getElementById('contents'), mouse_event);
    close_menu();
}

function load_instrumentation_report() {
    if (!instrumentation_file)
        return;
    fr = new FileReader();
    fr.onload = load_instrumentation_report_callback;
    fr.readAsText(instrumentation_file);
}

function load_instrumentation_report_callback() {
    instrumentation_report_read_complete(JSON.parse(fr.result));
}

/**
 * Get the min/max values of an array.
 * This is more stable than Math.min/max for large arrays, since Math.min/max
 * is recursive and causes a too high stack-length with long arrays.
 */
function get_minmax(arr) {
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

function instrumentation_report_read_complete(report) {
    const runtime_map = {};

    if (report.traceEvents && globals.daceRenderer?.sdfg) {
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
            runtime_map[key] = runtime_summary;
        }

        const renderer = globals.daceRenderer;

        if (renderer.overlay_manager) {
            if (!renderer.overlay_manager.is_overlay_active(
                RuntimeMicroSecondsOverlay
            )) {
                renderer.overlay_manager.register_overlay(
                    RuntimeMicroSecondsOverlay
                );
            }
            const ol = renderer.overlay_manager.get_overlay(
                RuntimeMicroSecondsOverlay
            );
            if (ol) {
                ol.runtime_map = runtime_map;
                ol.refresh();
            }
        }
    }
}

// https://stackoverflow.com/a/901144/6489142
function getParameterByName(name) {
    const url = window.location.href;
    name = name.replace(/[\[\]]/g, '\\$&');
    const regex = new RegExp('[?&]' + name + '(=([^&#]*)|&|#|$)'),
        results = regex.exec(url);
    if (!results) return null;
    if (!results[2]) return '';
    return decodeURIComponent(results[2].replace(/\+/g, ' '));
}

function load_sdfg_from_url(url) {
    const request = new XMLHttpRequest();
    request.responseType = 'text'; // Will be parsed as JSON by parse_sdfg
    request.onload = () => {
        if (request.status == 200) {
            const sdfg = parse_sdfg(request.response);
            if (globals.daceRenderer)
                globals.daceRenderer.destroy();
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
    request.open('GET', url + ((/\?/).test(url) ? "&" : "?") + (new Date()).getTime(), true);
    request.send();
}

function find_recursive(graph, query, results, case_sensitive) {
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

function find_in_graph(renderer, sdfg, query, case_sensitive=false) {
    sidebar_set_title('Search Results for "' + query + '"');

    const results = [];
    if (!case_sensitive)
        query = query.toLowerCase();
    find_recursive(sdfg, query, results, case_sensitive);

    // Zoom to bounding box of all results first
    if (results.length > 0)
        renderer.zoom_to_view(results);

    // Show clickable results in sidebar
    const sidebar = sidebar_get_contents();
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

    sidebar_show();
}

function recursive_find_graph(graph, sdfg_id) {
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

function find_state(graph, state_id) {
    let state = undefined;
    graph.nodes().forEach(s_id => {
        if (Number(s_id) === state_id) {
            state = graph.node(s_id);
            return state;
        }
    });
    return state;
}

function find_node(state, node_id) {
    let node = undefined;
    state.data.graph.nodes().forEach(n_id => {
        if (Number(n_id) === node_id) {
            node = state.data.graph.node(n_id);
            return node;
        }
    });
    return node;
}

function find_edge(state, edge_id) {
    let edge = undefined;
    state.data.graph.edges().forEach(e_id => {
        if (Number(e_id.name) === edge_id) {
            edge = state.data.graph.edge(e_id);
            return edge;
        }
    });
    return edge;
}

function find_graph_element(graph, type, sdfg_id, state_id = -1, el_id = -1) {
    const requested_graph = recursive_find_graph(graph, sdfg_id);
    let state;
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
                let isedge = undefined;
                Object.values(requested_graph._edgeLabels).forEach(ise => {
                    if (ise.id === el_id) {
                        isedge = ise;
                        return isedge;
                    }
                });
                return isedge;
            default:
                return undefined;
        }
    }
    return undefined;
}

function mouse_event(evtype, event, mousepos, elements, renderer,
    selected_elements, ends_drag) {
    if ((evtype === 'click' && !ends_drag) || evtype === 'dblclick') {
        if (renderer.menu)
            renderer.menu.destroy();
        let element;
        if (selected_elements.length === 0)
            element = new SDFG(renderer.sdfg);
        else if (selected_elements.length === 1)
            element = selected_elements[0];
        else
            element = null;

        if (element !== null) {
            sidebar_set_title(element.type() + " " + element.label());
            fill_info(element);
        } else {
            close_menu();
            sidebar_set_title("Multiple elements selected");
        }
        sidebar_show();

    }
}

function init_menu() {
    return globals.daceUIHandlers.on_init_menu();
}

function sidebar_set_title(title) {
    return globals.daceUIHandlers.on_sidebar_set_title(title);
}

function sidebar_show() {
    return globals.daceUIHandlers.on_sidebar_show();
}

function sidebar_get_contents() {
    return globals.daceUIHandlers.sidebar_get_contents();
}

function close_menu() {
    return globals.daceUIHandlers.on_close_menu();
}

function outline(renderer, sdfg) {
    return globals.daceUIHandlers.on_outline(renderer, sdfg);
}

export function fill_info(elem) {
    return globals.daceUIHandlers.on_fill_info(elem);
}

$('document').ready(() => {
    init_menu();
});
