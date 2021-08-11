// Copyright 2019-2021 ETH Zurich and the DaCe authors. All rights reserved.

import { sdfg_property_to_string } from './utils/sdfg/display';
import { traverse_sdfg_scopes } from './utils/sdfg/traversal';
import { htmlSanitize } from './utils/sanitization';
import {
    AccessNode,
    Edge,
    SDFGElement,
    SDFGNode
} from './renderer/renderer_elements';
import { SDFGRenderer } from './renderer/renderer';
import { DagreSDFG } from './types';
import { SDFV } from './sdfv';

export const SDFVUIHandlers = {
    on_init_menu,
    on_sidebar_set_title,
    on_sidebar_show,
    sidebar_get_contents,
    on_close_menu,
    on_outline,
    on_fill_info,
};

function on_sidebar_set_title(title: string): void {
    // Modify sidebar header
    const sidebar_header = document.getElementById('sidebar-header');
    if (sidebar_header)
        sidebar_header.innerText = title;
}

function sidebar_get_contents(): HTMLElement | null {
    return document.getElementById('sidebar-contents');
}

function on_sidebar_show(): void {
    // Open sidebar if closed
    const sidebar = document.getElementById('sidebar');
    if (sidebar)
        sidebar.style.display = 'flex';
    
}

function on_fill_info(elem: SDFGElement): void {
    const contents = sidebar_get_contents();
    if (!contents)
        return;

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
            attr[1], SDFV.get_instance().get_renderer()?.view_settings()
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
                attr[1], SDFV.get_instance().get_renderer()?.view_settings()
            ) + '</p>';
        }
    }

    contents.innerHTML = html;
}

function on_outline(renderer: SDFGRenderer, sdfg: DagreSDFG): void {
    on_sidebar_set_title('SDFG Outline');

    const sidebar = sidebar_get_contents();
    if (!sidebar)
        return;

    sidebar.innerHTML = '';

    // Entire SDFG
    const d = document.createElement('div');
    d.className = 'context_menu_option';
    d.innerHTML = htmlSanitize`
        <i class="material-icons" style="font-size: inherit">
            filter_center_focus
        </i> SDFG ${renderer.get_sdfg().attributes.name}
    `;
    d.onclick = () => renderer.zoom_to_view();
    sidebar.appendChild(d);

    const stack: any[] = [sidebar];

    // Add elements to tree view in sidebar
    traverse_sdfg_scopes(sdfg, (node: SDFGNode, parent: DagreSDFG) => {
        // Skip exit nodes when scopes are known
        if (node.type().endsWith('Exit') && node.data.node.scope_entry >= 0) {
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
            if (node.type().endsWith('Entry') && node.parent_id && node.id) {
                const state = node.sdfg.nodes[node.parent_id];
                if (state.scope_dict[node.id] !== undefined) {
                    for (const subnode_id of state.scope_dict[node.id])
                        nodes_to_display.push(parent.node(subnode_id));
                }
            }

            renderer.zoom_to_view(nodes_to_display);

            // Ensure that the innermost div is the one that handles the event
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

    on_sidebar_show();
}

function on_close_menu(): void {
    const sidebar_contents = sidebar_get_contents();
    if (sidebar_contents)
        sidebar_contents.innerHTML = '';
    const sidebar = document.getElementById('sidebar');
    if (sidebar)
        sidebar.style.display = 'none';
}

function on_init_menu(): void {
    const right = document.getElementById('sidebar');
    const bar = document.getElementById('dragbar');

    const drag = (e: MouseEvent) => {
        if ((document as any).selection)
            (document as any).selection.empty();
        else
            window.getSelection()?.removeAllRanges();

        if (right)
            right.style.width = Math.max(
                ((e.view ? e.view.innerWidth - e.pageX : 0)), 20
            ) + 'px';
    };

    bar?.addEventListener('mousedown', () => {
        document.addEventListener('mousemove', drag);
        document.addEventListener('mouseup', () => {
            document.removeEventListener('mousemove', drag);
        });
    });
}
