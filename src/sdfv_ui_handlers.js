// Copyright 2019-2021 ETH Zurich and the DaCe authors. All rights reserved.

import { sdfg_property_to_string } from "./utils/sdfg/display";
import { traverse_sdfg_scopes } from "./utils/sdfg/traversal";
import { htmlSanitize } from "./utils/sanitization";

export const SDFVUIHandlers = {
    on_init_menu,
    on_sidebar_set_title,
    on_sidebar_show,
    sidebar_get_contents,
    on_close_menu,
    on_outline,
    on_fill_info,
};

function on_sidebar_set_title(title) {
    // Modify sidebar header
    document.getElementById("sidebar-header").innerText = title;
}

function sidebar_get_contents() {
    return document.getElementById("sidebar-contents");
}

function on_sidebar_show() {
    // Open sidebar if closed
    document.getElementById("sidebar").style.display = "flex";
}

function on_fill_info(elem) {
    let contents = sidebar_get_contents();
    let html = "";
    if (elem instanceof Edge && elem.data.type === "Memlet") {
        let sdfg_edge = elem.sdfg.nodes[elem.parent_id].edges[elem.id];
        html += "<h4>Connectors: " + sdfg_edge.src_connector + " &rarr; " +
            sdfg_edge.dst_connector + "</h4>";
    }
    html += "<hr />";

    for (let attr of Object.entries(elem.attributes())) {
        if (attr[0] === "layout" || attr[0] === "sdfg" ||
            attr[0] === "_arrays" || attr[0].startsWith("_meta_") ||
            attr[0] == "position")
            continue;
        html += "<b>" + attr[0] + "</b>:&nbsp;&nbsp;";
        html += sdfg_property_to_string(attr[1], renderer.view_settings()) +
            "</p>";
    }

    // If access node, add array information too
    if (elem instanceof AccessNode) {
        let sdfg_array = elem.sdfg.attributes._arrays[elem.attributes().data];
        html += "<br /><h4>" + sdfg_array.type + " properties:</h4>";
        for (let attr of Object.entries(sdfg_array.attributes)) {
            if (attr[0] === "layout" || attr[0] === "sdfg" ||
                attr[0].startsWith("_meta_"))
                continue;
            html += "<b>" + attr[0] + "</b>:&nbsp;&nbsp;";
            html += sdfg_property_to_string(attr[1], renderer.view_settings()) +
                "</p>";
        }
    }

    contents.innerHTML = html;
}

function on_outline(renderer, sdfg) {
    on_sidebar_set_title('SDFG Outline');

    const sidebar = sidebar_get_contents();
    sidebar.innerHTML = '';

    // Entire SDFG
    const d = document.createElement('div');
    d.className = 'context_menu_option';
    d.innerHTML = htmlSanitize`<i class="material-icons" style="font-size: inherit">filter_center_focus</i> SDFG ${renderer.sdfg.attributes.name}`;
    d.onclick = () => renderer.zoom_to_view();
    sidebar.appendChild(d);

    const stack = [sidebar];

    // Add elements to tree view in sidebar
    traverse_sdfg_scopes(sdfg, (node, parent) => {
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
        if (node.type().endsWith('Entry')) {
            const state = node.sdfg.nodes[node.parent_id];
            if (state.scope_dict[node.id] !== undefined) {
                node_type = node_type.slice(0, -5);
            }
        }

        d.innerHTML = htmlSanitize`${node_type} ${node.label()}${is_collapsed ? " (collapsed)" : ""}`;
        d.onclick = (e) => {
            // Show node or entire scope
            const nodes_to_display = [node];
            if (node.type().endsWith('Entry')) {
                const state = node.sdfg.nodes[node.parent_id];
                if (state.scope_dict[node.id] !== undefined) {
                    for (const subnode_id of state.scope_dict[node.id])
                        nodes_to_display.push(parent.node(subnode_id));
                }
            }

            renderer.zoom_to_view(nodes_to_display);

            // Ensure that the innermost div is the one that handles the event
            if (!e) e = window.event;
            e.cancelBubble = true;
            if (e.stopPropagation) e.stopPropagation();
        };
        stack.push(d);

        // If is collapsed, don't traverse further
        if (is_collapsed)
            return false;

    }, (node, parent) => {
        // After scope ends, pop ourselves as the current element 
        // and add to parent
        const elem = stack.pop();
        if (elem)
            stack[stack.length - 1].appendChild(elem);
    });

    on_sidebar_show();
}

function on_close_menu() {
    document.getElementById("sidebar").style.display = "none";
}

function on_init_menu() {
    const right = document.getElementById('sidebar');
    const bar = document.getElementById('dragbar');

    const drag = (e) => {
        document.selection ? document.selection.empty() : window.getSelection().removeAllRanges();
        right.style.width = Math.max(((e.view.innerWidth - e.pageX)), 20) + 'px';
    };

    bar.addEventListener('mousedown', () => {
        document.addEventListener('mousemove', drag);
        document.addEventListener('mouseup', () => {
            document.removeEventListener('mousemove', drag);
        });
    });
}
