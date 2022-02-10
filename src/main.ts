// Copyright 2019-2021 ETH Zurich and the DaCe authors. All rights reserved.

import $ from 'jquery';
import { mean, median } from 'mathjs';
import {
    DagreSDFG,
    Point2D, traverse_sdfg_scopes
} from './index';
import { GraphElement } from './renderer/graph/graph_element';
import { Renderer } from './renderer/renderer';
import {
    AccessNode, Edge,
    SDFG,
    SDFGElement,
    SDFGNode,
    State
} from './renderer/renderer_elements';
import { SDFGRenderer } from './renderer/sdfg_renderer';
import { htmlSanitize } from './utils/sanitization';
import { parse_sdfg } from './utils/sdfg/json_serializer';

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

    public static DEFAULT_CANVAS_FONTSIZE: number = 10;
    public static DEFAULT_MAX_FONTSIZE: number = 50;
    public static DEFAULT_FAR_FONT_MULTIPLIER: number = 16;

    public constructor() {
        return;
    }

    public start_find_in_graph(): void {
        start_find_in_graph(this);
    }

}

function init_sdfv(
    sdfg: any,
    user_transform: DOMMatrix | null = null,
    debug_draw: boolean = false,
    existing_sdfv: SDFV | null = null
): void {
    /*
    let mode_buttons = null;
    const pan_btn = document.getElementById('pan-btn');
    const move_btn = document.getElementById('move-btn');
    const select_btn = document.getElementById('select-btn');
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

    if (sdfg !== null) {
        const container = $('#contents');
        if (container) {
            sdfv.set_renderer(new Renderer(sdfv, sdfg, container));
            sdfv.set_renderer(new Renderer(
                sdfv, sdfg, container, mouse_event, user_transform, debug_draw,
                null, mode_buttons
            ));
        }
    }
    */
}

function start_find_in_graph(sdfv: SDFV): void {
    /*
    const renderer = sdfv.get_renderer();
    if (renderer)
        setTimeout(() => {
            const graph = renderer.get_graph();
            const query = $('#search').val();
            if (graph && query)
                find_in_graph(
                    sdfv, renderer, graph, query.toString(),
                    $('#search-case').is(':checked')
                );
        }, 1);
    */
}

function reloadFile(viewer: SDFGViewer): void {
    if (!file)
        return;

    fr = new FileReader();
    fr.onload = () => {
        fileReadComplete(viewer);
    };
    fr.readAsText(file);
}

function fileReadComplete(viewer: SDFGViewer): void {
    const resultString = fr.result;
    if (resultString) {
        const sdfg = parse_sdfg(resultString.toString());
        viewer.renderer.sdfg = sdfg;
        viewer.clearInfo();
    }
}

function loadInstrumentationReport(viewer: SDFGViewer): void {
    if (!instrumentation_file)
        return;
    fr = new FileReader();
    fr.onload = () => {
        loadInstrumentationReportCallback(viewer);
    };
    fr.readAsText(instrumentation_file);
}

function loadInstrumentationReportCallback(viewer: SDFGViewer): void {
    let resultString = '';
    if (fr.result) {
        if (fr.result instanceof ArrayBuffer) {
            const decoder = new TextDecoder('utf-8');
            resultString = decoder.decode(new Uint8Array(fr.result));
        } else {
            resultString = fr.result;
        }
    }
    instrumentationReportReadComplete(viewer, JSON.parse(resultString));
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

export function instrumentationReportReadComplete(
    viewer: SDFGViewer, report: any, renderer: Renderer | null = null
): void {
    const runtime_map: { [uuids: string]: number[] } = {};
    const summarized_map: { [uuids: string]: { [key: string]: number} } = {};

    if (!renderer)
        renderer = viewer.renderer;
    
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

        // TODO
        /*
        const overlay_manager = renderer.get_overlay_manager();
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
        */
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

function load_sdfg_from_url(viewer: SDFGViewer, url: string): void {
    const request = new XMLHttpRequest();
    request.responseType = 'text';
    request.onload = () => {
        if (request.status == 200) {
            viewer.renderer.sdfg = parse_sdfg(request.response);
        } else {
            alert('Failed to load SDFG from URL');
        }
    };
    request.onerror = () => {
        alert('Failed to load SDFG from URL: ' + request.status);
    };
    request.open(
        'GET', url + ((/\?/).test(url) ? '&' : '?') + (new Date()).getTime(),
        true
    );
    request.send();
}

function find_recursive(
    graph: DagreSDFG, query: string, results: any[],
    case_sensitive: boolean
): void {
    //for (const nodeid of graph.nodes()) {
    //    const node = graph.node(nodeid);
    //    let label = node.label();
    //    if (!case_sensitive)
    //        label = label.toLowerCase();
    //    if (label.indexOf(query) !== -1)
    //        results.push(node);
    //    // Enter states or nested SDFGs recursively
    //    if (node.data.graph)
    //        find_recursive(node.data.graph, query, results, case_sensitive);
    //}
    //for (const edgeid of graph.edges()) {
    //    const edge = graph.edge(edgeid);
    //    let label = edge.label();
    //    if (label !== undefined) {
    //        if (!case_sensitive)
    //            label = label.toLowerCase();
    //        if (label.indexOf(query) !== -1)
    //            results.push(edge);
    //    }
    //}
}

export function find_in_graph(
    sdfv: SDFV, renderer: SDFGRenderer, sdfg: DagreSDFG, query: string,
    case_sensitive: boolean = false
): void {
    /*
    sdfv.sidebar_set_title('Search Results for "' + query + '"');

    const results: any[] = [];
    if (!case_sensitive)
        query = query.toLowerCase();
    find_recursive(sdfg, query, results, case_sensitive);

    // Zoom to bounding box of all results first
    if (results.length > 0)
        renderer.zoom_to_view(results);

    // Show clickable results in sidebar
    const sidebar = sdfv.sidebar_get_contents();
    if (sidebar) {
        sidebar.innerHTML = '';
        for (const result of results) {
            const d = document.createElement('div');
            d.className = 'context_menu_option';
            d.innerHTML = htmlSanitize`${result.type()} ${result.label()}`;
            d.onclick = () => { renderer.zoom_to_view([result]); };
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

    sdfv.sidebar_show();
    */
}

function recursive_find_graph(
    graph: DagreSDFG, sdfg_id: number
): DagreSDFG | undefined {
    //let found = undefined;
    //graph.nodes().forEach(n_id => {
    //    const n = graph.node(n_id);
    //    if (n && n.sdfg.sdfg_list_id === sdfg_id) {
    //        found = graph;
    //        return found;
    //    } else if (n && n.data.graph) {
    //        found = recursive_find_graph(n.data.graph, sdfg_id);
    //        if (found)
    //            return found;
    //    }
    //});
    //return found;
    return undefined;
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

export function mouse_event(
    evtype: string,
    _event: Event,
    _mousepos: Point2D,
    _elements: any[],
    renderer: SDFGRenderer,
    selected_elements: SDFGElement[],
    ends_drag: boolean,
    sdfv: SDFV
): boolean {
    /*
    if ((evtype === 'click' && !ends_drag) || evtype === 'dblclick') {
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
            sdfv.sidebar_set_title(
                element.type() + ' ' + element.label()
            );
            sdfv.fill_info(element);
        } else {
            sdfv.close_menu();
            sdfv.sidebar_set_title('Multiple elements selected');
        }
        sdfv.sidebar_show();
    }
    return false;
    */
    return false;
}

export class SDFGViewer {

    public readonly renderer: Renderer;

    public constructor(
        private readonly container: JQuery<HTMLElement>,
        private readonly infoRegion: InfoRegion,
    ) {
        this.renderer = new Renderer(this, this.container);
    }

    public clearInfo(): void {
        this.infoRegion.clear();
        if (this.infoRegion instanceof CloseableInfoRegion)
            this.infoRegion.close();
    }

    public showInfo(): void {
        if (this.infoRegion instanceof CloseableInfoRegion)
            this.infoRegion.show();
    }

    public setInfoTitle(title: string): void {
        this.infoRegion.setTitle(title);
    }

    public outline(): void {
        this.infoRegion.clear();

        this.setInfoTitle('SDFG Outline');

        // Create an entry for the entire SDFG.
        $('<div>', {
            class: 'context-menu-option',
            html: htmlSanitize`
                <i class="material-icons" style="font-size: inherit">
                    filter_center_focus
                </i> SDFG ${this.renderer.sdfg?.attributes.name}
            `,
            onclick: () => {
                // TODO: Focus entire view.
                return;
            },
        }).appendTo(this.infoRegion.contents);

        const stack: (JQuery<HTMLElement> | null)[] =
            [this.infoRegion.contents];

        /*
        // Add elements to tree view in sidebar
        traverse_sdfg_scopes(this.renderer.graph, (node: SDFGNode, parent: DagreSDFG) => {
            // Skip exit nodes when scopes are known
            if (node.type().endsWith('Exit') &&
                node.data.node.scope_entry >= 0) {
                stack.push(null);
                return true;
            }

            // Create element
            const d = document.createElement('div');
            d.className = 'context_menu_option';
            let is_collapsed = node.attributes().is_collapsed;
            is_collapsed = (is_collapsed === undefined) ? false : is_collapsed;
            let node_type = node.type();

            // If a scope has children, remove the name "Entry" from the type
            if (node.type().endsWith('Entry') && node.parent_id && node.id) {
                const state = node.sdfg.nodes[node.parent_id];
                if (state.scope_dict[node.id] !== undefined) {
                    node_type = node_type.slice(0, -5);
                }
            }

            d.innerHTML = htmlSanitize`
                ${node_type} ${node.label()}${is_collapsed ? ' (collapsed)' : ''}
            `;
            d.onclick = (e) => {
                // Show node or entire scope
                const nodes_to_display = [node];
                if (node.type().endsWith('Entry') && node.parent_id &&
                    node.id) {
                    const state = node.sdfg.nodes[node.parent_id];
                    if (state.scope_dict[node.id] !== undefined) {
                        //for (const subnode_id of state.scope_dict[node.id])
                        //    nodes_to_display.push(parent.node(subnode_id));
                    }
                }

                this.renderer.zoom_to_view(nodes_to_display);

                // Ensure that the innermost div is the one handling the event
                if (!e) {
                    if (window.event) {
                        window.event.cancelBubble = true;
                        window.event.stopPropagation();
                    }
                } else {
                    e.cancelBubble = true;
                    if (e.stopPropagation)
                        e.stopPropagation();
                }
            };
            stack.push(d);

            // If is collapsed, don't traverse further
            if (is_collapsed)
                return false;

        }, (_node: SDFGNode, _parent: DagreSDFG) => {
            // After scope ends, pop ourselves as the current element 
            // and add to parent
            const elem = stack.pop();
            if (elem)
                stack[stack.length - 1].appendChild(elem);
        });
        */

        this.showInfo();
    }

    public fillInfoElement(elem: GraphElement): void {
        /*
        let html = '';
        if (elem instanceof Edge && elem.data.type === 'Memlet' &&
            elem.parent_id && elem.id) {
            const sdfg_edge = elem.sdfg.nodes[elem.parent_id].edges[elem.id];
            html += '<h4>Connectors: ' + sdfg_edge.src_connector + ' &rarr; ' +
                sdfg_edge.dst_connector + '</h4>';
        }
        html += '<hr />';

        for (const attr of Object.entries(elem.attributes())) {
            if (attr[0] === 'layout' || attr[0] === 'sdfg' ||
                attr[0] === '_arrays' || attr[0].startsWith('_meta_') ||
                attr[0] == 'position')
                continue;
            html += '<b>' + attr[0] + '</b>:&nbsp;&nbsp;';
            html += sdfg_property_to_string(
                attr[1], this.renderer?.view_settings()
            ) + '</p>';
        }

        // If access node, add array information too
        if (elem instanceof AccessNode) {
            const sdfg_array = elem.sdfg.attributes._arrays[elem.attributes().data];
            html += '<br /><h4>' + sdfg_array.type + ' properties:</h4>';
            for (const attr of Object.entries(sdfg_array.attributes)) {
                if (attr[0] === 'layout' || attr[0] === 'sdfg' ||
                    attr[0].startsWith('_meta_'))
                    continue;
                html += '<b>' + attr[0] + '</b>:&nbsp;&nbsp;';
                html += sdfg_property_to_string(
                    attr[1], this.renderer?.view_settings()
                ) + '</p>';
            }
        }

        contents.innerHTML = html;
        */
    }

}

export class InfoRegion {

    public constructor(
        public readonly header: JQuery<HTMLElement>,
        public readonly contents: JQuery<HTMLElement>,
    ) {
    }

    public clear(): void {
        this.header.html('');
        this.contents.html('');
    }

    public setTitle(title: string): void {
        this.header.text(title);
    }

}

export class CloseableInfoRegion extends InfoRegion {

    public constructor(
        private readonly container: JQuery<HTMLElement>,
        header: JQuery<HTMLElement>,
        contents: JQuery<HTMLElement>,
    ) {
        super(header, contents);
    }

    public close(): void {
        this.container.hide();
    }

    public show(): void {
        this.container.show();
    }

}

function initSDFGViewerMenu(viewer: SDFGViewer): void {
    $('#sdfg-file-input').on('change', (e: any) => {
        if (e.target.files.length < 1)
            return;
        file = e.target.files[0];
        reloadFile(viewer);
    });

    $('#menuclose').on('click', () => viewer.clearInfo());

    $('#reload').on('click', () => {
        reloadFile(viewer);
    });

    $('#instrumentation-report-file-input').on('change', (e: any) => {
        if (e.target.files.length < 1)
            return;
        instrumentation_file = e.target.files[0];
        loadInstrumentationReport(viewer);
    });

    $('#outline').on('click', () => {
        setTimeout(() => {
            viewer.outline();
        }, 1);
    });

    $('#search-btn').on('click', () => {
        setTimeout(() => {
            // TODO:
            /*
            const graph = renderer.get_graph();
            const query = $('#search').val();
            if (graph && query)
                find_in_graph(
                    sdfv, renderer, graph, query.toString(),
                    $('#search-case').is(':checked')
                );
                */
        }, 1);
    });

    $('#search').on('keydown', (e: any) => {
        if (e.key == 'Enter' || e.which == 13) {
            //viewer.start_find_in_graph();
            e.preventDefault();
        }
    });
}

$(() => {
    const infoRegion = new CloseableInfoRegion(
        $('#sidebar'), $('#sidebar-header'), $('#sidebar-contents')
    );

    // Set up resizing of the info region.
    const sideBar = $('#sidebar');
    const divider = $('#dragbar');
    const drag = (e: MouseEvent) => {
        if ((document as any).selection)
            (document as any).selection.empty();
        else
            window.getSelection()?.removeAllRanges();
        if (sideBar)
            sideBar.css(
                'width', Math.max(
                    20, e.view ? e.view.innerWidth - e.pageX : 0
                ) + 'px'
            );
    };
    divider.on('mousedown', () => {
        document.addEventListener('mousemove', drag);
        document.addEventListener('mouseup', () => {
            document.removeEventListener('mousemove', drag);
        });
    });

    // Initialize the viewer.
    const viewer = new SDFGViewer($('#contents'), infoRegion);

    initSDFGViewerMenu(viewer);

    if (document.currentScript?.hasAttribute('data-sdfg-json')) {
        const sdfgString =
            document.currentScript?.getAttribute('data-sdfg-json');
        if (sdfgString)
            viewer.renderer.sdfg = parse_sdfg(sdfgString);
    } else {
        const url = getParameterByName('url');
        if (url)
            load_sdfg_from_url(viewer, url);
    }
});
