// Copyright 2019-2021 ETH Zurich and the DaCe authors. All rights reserved.

import dagre from 'dagre';
import { intersectRect } from 'dagre/lib/util';
import { find_exit_for_entry } from '../utils/sdfg/sdfg_utils';
import { deepCopy } from '../utils/utils.ts';
import { traverse_sdfg_scopes } from "../utils/sdfg/traversal";
import { ContextMenu } from "../utils/context_menu";
import { Connector, Edge, offset_state, SDFGElements, draw_sdfg } from "./renderer_elements";
import { check_and_redirect_edge } from '../utils/sdfg/sdfg_utils';
import { memlet_tree_complete } from '../utils/sdfg/traversal';
import { CanvasManager } from './canvas_manager';
import { boundingBox, calculateBoundingBox, calculateEdgeBoundingBox } from '../utils/bounding_box';
import { OverlayManager } from '../overlay_manager';
import { GenericSdfgOverlay } from "../overlays/generic_sdfg_overlay";

export class SDFGRenderer {
    constructor(sdfg, container, on_mouse_event = null, user_transform = null,
        debug_draw = false, background = null) {
        // DIODE/SDFV-related fields
        this.sdfg = sdfg;
        this.sdfg_list = {};
        this.state_parent_list = {}; // List of all state's parent elements

        // Rendering-related fields
        this.container = container;
        this.ctx = null;
        this.canvas = null;
        this.last_visible_elements = null;
        this.last_hovered_elements = null;
        this.last_clicked_elements = null;
        this.last_dragged_element = null;
        this.tooltip = null;
        this.tooltip_container = null;

        // Toolbar-related fields
        this.menu = null;
        this.toolbar = null;
        this.movemode_btn = null;
        this.selectmode_btn = null;

        // Memlet-Tree related fields
        this.all_memlet_trees_sdfg = [];

        // View options
        this.inclusive_ranges = false;
        this.omit_access_nodes = false;

        // Mouse-related fields
        this.mouse_mode = 'pan'; // Mouse mode - pan, move, select
        this.box_select_rect = null;
        this.mousepos = null; // Last position of the mouse pointer (in canvas coordinates)
        this.realmousepos = null; // Last position of the mouse pointer (in pixel coordinates)
        this.dragging = false;
        this.drag_start = null; // Null if the mouse/touch is not activated
        this.drag_second_start = null; // Null if two touch points are not activated
        this.external_mouse_handler = on_mouse_event;

        // Selection related fields
        this.selected_elements = [];

        // Overlay fields
        try {
            this.overlay_manager = new OverlayManager(this);
        } catch (ex) {
            console.error("Error initializing overlay manager!", ex);
            this.overlay_manager = null;
        }

        // Draw debug aids.
        this.debug_draw = debug_draw;

        this.init_elements(user_transform, background);

        this.all_memlet_trees_sdfg = memlet_tree_complete(this.sdfg);

        this.update_fast_memlet_lookup();
    }

    destroy() {
        try {
            if (this.menu)
                this.menu.destroy();
            this.canvas_manager.destroy();
            this.container.removeChild(this.canvas);
            this.container.removeChild(this.toolbar);
            this.container.removeChild(this.tooltip_container);
        } catch (ex) {
            // TODO instead of catching exceptions, make sure non are thrown?
            console.error(`Error destroying renderer!`, ex);
        }
    }

    view_settings() {
        return { inclusive_ranges: this.inclusive_ranges };
    }

    // Updates buttons based on cursor mode
    update_toggle_buttons() {
        // First clear out of all modes, then jump in to the correct mode.
        this.selectmode_btn.innerHTML =
            '<i class="material-icons">border_style</i>';
        this.selectmode_btn.title = 'Enter box select mode';
        this.movemode_btn.innerHTML =
            '<i class="material-icons">open_with</i>';
        this.movemode_btn.title = 'Enter object moving mode';
        this.canvas.style.cursor = 'default';
        this.interaction_info_box.style.display = 'none';
        this.interaction_info_text.innerHTML = '';

        switch (this.mouse_mode) {
            case 'move':
                this.interaction_info_box.style.display = 'block';
                this.movemode_btn.innerHTML =
                    '<i class="material-icons">done</i>';
                this.movemode_btn.title = 'Exit object moving mode';
                this.interaction_info_text.innerHTML = 'Middle Mouse: Pan view';
                break;
            case 'select':
                this.interaction_info_box.style.display = 'block';
                this.selectmode_btn.innerHTML =
                    '<i class="material-icons">done</i>';
                this.selectmode_btn.title = 'Exit box select mode';
                this.canvas.style.cursor = 'crosshair';
                this.interaction_info_text.innerHTML =
                    'Shift: Add to selection<br>' +
                    'Ctrl: Remove from selection<br>' +
                    'Middle Mouse: Pan view';
                break;
            case 'pan':
            default:
                break;
        }
    }

    // Initializes the DOM
    init_elements(user_transform, background) {

        this.canvas = document.createElement('canvas');
        this.canvas.classList.add('sdfg_canvas')
        if (background)
            this.canvas.style.backgroundColor = background;
        else
            this.canvas.style.backgroundColor = 'inherit';
        this.container.append(this.canvas);

        if (this.debug_draw) {
            this.dbg_info_box = document.createElement('div');
            this.dbg_info_box.style.position = 'absolute';
            this.dbg_info_box.style.bottom = '.5rem';
            this.dbg_info_box.style.right = '.5rem';
            this.dbg_info_box.style.backgroundColor = 'black';
            this.dbg_info_box.style.padding = '.3rem';
            this.dbg_mouse_coords = document.createElement('span');
            this.dbg_mouse_coords.style.color = 'white';
            this.dbg_mouse_coords.style.fontSize = '1rem';
            this.dbg_mouse_coords.innerText = 'x: N/A / y: N/A';
            this.dbg_info_box.appendChild(this.dbg_mouse_coords);
            this.container.appendChild(this.dbg_info_box);
        }

        // Add an info box for interaction hints to the bottom left of the
        // canvas.
        this.interaction_info_box = document.createElement('div');
        this.interaction_info_box.style.position = 'absolute';
        this.interaction_info_box.style.bottom = '.5rem',
            this.interaction_info_box.style.left = '.5rem',
            this.interaction_info_box.style.backgroundColor = 'rgba(0, 0, 0, 0.5)';
        this.interaction_info_box.style.borderRadius = '5px';
        this.interaction_info_box.style.padding = '.3rem';
        this.interaction_info_box.style.display = 'none';
        this.interaction_info_text = document.createElement('span');
        this.interaction_info_text.style.color = '#eeeeee';
        this.interaction_info_text.innerHTML = '';
        this.interaction_info_box.appendChild(this.interaction_info_text);
        this.container.appendChild(this.interaction_info_box);

        // Add buttons
        this.toolbar = document.createElement('div');
        this.toolbar.style = 'position:absolute; top:10px; left: 10px;';
        let d;

        let in_vscode = typeof vscode !== 'undefined';

        // Menu bar
        try {
            d = document.createElement('button');
            d.className = 'button';
            d.innerHTML = '<i class="material-icons">menu</i>';
            d.style = 'padding-bottom: 0px; user-select: none';
            const that = this;
            d.onclick = function () {
                if (that.menu && that.menu.visible()) {
                    that.menu.destroy();
                    return;
                }
                const rect = this.getBoundingClientRect();
                const cmenu = new ContextMenu();
                cmenu.addOption("Save view as PNG", x => that.save_as_png());
                if (that.has_pdf()) {
                    cmenu.addOption("Save view as PDF", x => that.save_as_pdf());
                    cmenu.addOption("Save all as PDF", x => that.save_as_pdf(true));
                }
                cmenu.addCheckableOption("Inclusive ranges", that.inclusive_ranges, (x, checked) => { that.inclusive_ranges = checked; });
                cmenu.addCheckableOption("Adaptive content hiding", that.ctx.lod, (x, checked) => { that.ctx.lod = checked; });
                if (!in_vscode)
                    cmenu.addOption(
                        'Overlays',
                        () => {
                            if (that.overlays_menu && that.overlays_menu.visible()) {
                                that.overlays_menu.destroy();
                                return;
                            }
                            const rect = cmenu._cmenu_elem.getBoundingClientRect();
                            const overlays_cmenu = new ContextMenu();
                            overlays_cmenu.addCheckableOption(
                                'Memory volume analysis',
                                that.overlay_manager.memory_volume_overlay_active,
                                (x, checked) => {
                                    if (checked)
                                        that.overlay_manager.register_overlay(
                                            GenericSdfgOverlay.OVERLAY_TYPE.MEMORY_VOLUME
                                        );
                                    else
                                        that.overlay_manager.deregister_overlay(
                                            GenericSdfgOverlay.OVERLAY_TYPE.MEMORY_VOLUME
                                        );
                                    that.draw_async();
                                    if (in_vscode)
                                        refresh_analysis_pane();
                                }
                            );
                            that.overlays_menu = overlays_cmenu;
                            that.overlays_menu.show(rect.left, rect.top);
                        }
                    );
                cmenu.addCheckableOption("Hide Access Nodes", that.omit_access_nodes, (x, checked) => { that.omit_access_nodes = checked; that.relayout() });
                that.menu = cmenu;
                that.menu.show(rect.left, rect.bottom);
            };
            d.title = 'Menu';
            this.toolbar.appendChild(d);
        } catch (ex) {
            console.error(`Error setting up menu bar - is this intentional?`);
        }

        // Zoom to fit
        d = document.createElement('button');
        d.className = 'button';
        d.innerHTML = '<i class="material-icons">filter_center_focus</i>';
        d.style = 'padding-bottom: 0px; user-select: none';
        d.onclick = () => this.zoom_to_view();
        d.title = 'Zoom to fit SDFG';
        this.toolbar.appendChild(d);

        // Collapse all
        d = document.createElement('button');
        d.className = 'button';
        d.innerHTML = '<i class="material-icons">unfold_less</i>';
        d.style = 'padding-bottom: 0px; user-select: none';
        d.onclick = () => this.collapse_all();
        d.title = 'Collapse all elements';
        this.toolbar.appendChild(d);

        // Expand all
        d = document.createElement('button');
        d.className = 'button';
        d.innerHTML = '<i class="material-icons">unfold_more</i>';
        d.style = 'padding-bottom: 0px; user-select: none';
        d.onclick = () => this.expand_all();
        d.title = 'Expand all elements';
        this.toolbar.appendChild(d);

        // Enter object moving mode
        const move_mode_btn = document.createElement('button');
        this.movemode_btn = move_mode_btn;
        move_mode_btn.className = 'button';
        move_mode_btn.innerHTML = '<i class="material-icons">open_with</i>';
        move_mode_btn.style = 'padding-bottom: 0px; user-select: none';
        move_mode_btn.onclick = () => {
            if (this.mouse_mode === 'move')
                this.mouse_mode = 'pan';
            else
                this.mouse_mode = 'move';
            this.update_toggle_buttons();
        };
        move_mode_btn.title = 'Enter object moving mode';
        this.toolbar.appendChild(move_mode_btn);

        // Enter box selection mode
        const box_select_btn = document.createElement('button');
        this.selectmode_btn = box_select_btn;
        box_select_btn.className = 'button';
        box_select_btn.innerHTML =
            '<i class="material-icons">border_style</i>';
        box_select_btn.style = 'padding-bottom: 0px; user-select: none';
        box_select_btn.onclick = () => {
            if (this.mouse_mode === 'select')
                this.mouse_mode = 'pan';
            else
                this.mouse_mode = 'select';
            this.update_toggle_buttons();
        };
        box_select_btn.title = 'Enter box select mode';
        this.toolbar.appendChild(box_select_btn);

        // Exit previewing mode
        if (in_vscode) {
            const exit_preview_btn = document.createElement('button');
            exit_preview_btn.id = 'exit-preview-button';
            exit_preview_btn.className = 'button hidden';
            exit_preview_btn.innerHTML = '<i class="material-icons">close</i>';
            exit_preview_btn.style = 'padding-bottom: 0px; user-select: none';
            exit_preview_btn.onclick = () => {
                exit_preview_btn.className = 'button hidden';
                window.viewing_history_state = false;
                if (vscode) {
                    vscode.postMessage({
                        type: 'sdfv.get_current_sdfg',
                        prevent_refreshes: true,
                    });
                    vscode.postMessage({
                        type: 'transformation_history.refresh',
                        reset_active: true,
                    });
                }
            };
            exit_preview_btn.title = 'Exit preview';
            this.toolbar.appendChild(exit_preview_btn);
        }

        this.container.append(this.toolbar);
        // End of buttons

        // Tooltip HTML container
        this.tooltip_container = document.createElement('div');
        this.tooltip_container.innerHTML = '';
        this.tooltip_container.className = 'sdfvtooltip';
        this.tooltip_container.onmouseover = () => this.tooltip_container.style.display = "none";
        this.container.appendChild(this.tooltip_container);

        // HTML container for error popovers with invalid SDFGs
        this.error_popover_container = document.createElement('div');
        this.error_popover_container.innerHTML = '';
        this.error_popover_container.className = 'invalid_popup';
        this.error_popover_text = document.createElement('div');
        const error_popover_dismiss = document.createElement('button');
        const that = this;
        error_popover_dismiss.onclick = () => {
            that.sdfg.error = undefined;
            that.error_popover_text.innerText = '';
            that.error_popover_container.style.display = 'none';
        };
        error_popover_dismiss.style.float = 'right';
        error_popover_dismiss.style.cursor = 'pointer';
        error_popover_dismiss.style.color = 'white';
        error_popover_dismiss.innerHTML = '<i class="material-icons">close</i>';
        this.error_popover_container.appendChild(error_popover_dismiss);
        this.error_popover_container.appendChild(this.error_popover_text);
        this.container.appendChild(this.error_popover_container);

        this.ctx = this.canvas.getContext("2d");

        // Translation/scaling management
        this.canvas_manager = new CanvasManager(this.ctx, this, this.canvas);
        if (user_transform !== null)
            this.canvas_manager.user_transform = user_transform;

        // Resize event for container
        const observer = new MutationObserver((mutations) => { this.onresize(); this.draw_async(); });
        observer.observe(this.container, { attributes: true });

        // Set inherited properties
        if (background)
            this.bgcolor = background;
        else
            this.bgcolor = window.getComputedStyle(this.canvas).backgroundColor;

        // Create the initial SDFG layout
        this.relayout();

        // Set mouse event handlers
        this.set_mouse_handlers();

        // Set initial zoom, if not already set
        if (user_transform === null)
            this.zoom_to_view();

        // Queue first render
        this.draw_async();
    }

    draw_async() {
        this.canvas_manager.draw_async();
    }

    set_sdfg(new_sdfg) {
        this.sdfg = new_sdfg;
        this.relayout();
        this.draw_async();
    }

    // Set mouse events (e.g., click, drag, zoom)
    set_mouse_handlers() {
        const canvas = this.canvas;
        const br = () => canvas.getBoundingClientRect();

        const comp_x = event => this.canvas_manager.mapPixelToCoordsX(event.clientX - br().left);
        const comp_y = event => this.canvas_manager.mapPixelToCoordsY(event.clientY - br().top);

        // Mouse handler event types
        for (const evtype of ['mousedown', 'mousemove', 'mouseup', 'touchstart', 'touchmove', 'touchend',
            'wheel', 'click', 'dblclick', 'contextmenu']) {
            canvas.addEventListener(evtype, x => {
                const cancelled = this.on_mouse_event(x, comp_x, comp_y, evtype);
                if (cancelled)
                    return;
                x.stopPropagation();
                x.preventDefault();
            });
        }
    }

    onresize() {
        // Set canvas size
        this.canvas.style.width = '99%';
        this.canvas.style.height = '99%';
        this.canvas.width = this.canvas.offsetWidth;
        this.canvas.height = this.canvas.offsetHeight;
    }

    // Update memlet tree collection for faster lookup
    update_fast_memlet_lookup() {
        this.all_memlet_trees = [];
        for (const tree of this.all_memlet_trees_sdfg) {
            const s = new Set();
            for (const edge of tree) {
                s.add(edge.attributes.data.edge);
            }
            this.all_memlet_trees.push(s);
        }
    }

    // Re-layout graph and nested graphs
    relayout() {
        this.sdfg_list = {};
        this.graph = relayout_sdfg(this.ctx, this.sdfg, this.sdfg_list,
            this.state_parent_list, this.omit_access_nodes);
        this.onresize();

        this.update_fast_memlet_lookup();

        // Make sure all visible overlays get recalculated if there are any.
        if (this.overlay_manager !== null)
            this.overlay_manager.refresh();

        // If we're in a VSCode context, we also want to refresh the outline.
        if (typeof vscode !== 'undefined')
            outline(this, this.graph);

        return this.graph;
    }

    // Change translation and scale such that the chosen elements
    // (or entire graph if null) is in view
    zoom_to_view(elements = null) {
        if (!elements || elements.length == 0)
            elements = this.graph.nodes().map(x => this.graph.node(x));

        const bb = boundingBox(elements);
        this.canvas_manager.set_view(bb, true);

        this.draw_async();
    }

    collapse_all() {
        this.for_all_sdfg_elements((otype, odict, obj) => {
            if ('is_collapsed' in obj.attributes && !obj.type.endsWith('Exit'))
                obj.attributes.is_collapsed = true;
        });
        this.relayout();
        this.draw_async();
    }

    expand_all() {
        this.for_all_sdfg_elements((otype, odict, obj) => {
            if ('is_collapsed' in obj.attributes && !obj.type.endsWith('Exit'))
                obj.attributes.is_collapsed = false;
        });
        this.relayout();
        this.draw_async();
    }

    // Save functions
    save(filename, contents) {
        const link = document.createElement('a');
        link.setAttribute('download', filename);
        link.href = contents;
        document.body.appendChild(link);

        // wait for the link to be added to the document
        window.requestAnimationFrame(() => {
            const event = new MouseEvent('click');
            link.dispatchEvent(event);
            document.body.removeChild(link);
        });
    }

    save_as_png() {
        this.save('sdfg.png', this.canvas.toDataURL('image/png'));
    }

    /**
     * Some environments (notably Jupyter Notebooks) don't support PDF export
     */
    has_pdf() {
        try {
            blobStream;
            canvas2pdf.PdfContext;
            return true;
        } catch (e) {
            return false;
        }
    }

    save_as_pdf(save_all = false) {
        const stream = blobStream();

        // Compute document size
        const curx = this.canvas_manager.mapPixelToCoordsX(0);
        const cury = this.canvas_manager.mapPixelToCoordsY(0);
        let size;
        if (save_all) {
            // Get size of entire graph
            const elements = this.graph.nodes().map(x => this.graph.node(x));
            const bb = boundingBox(elements);
            size = [bb.width, bb.height];
        } else {
            // Get size of current view
            const endx = this.canvas_manager.mapPixelToCoordsX(this.canvas.width);
            const endy = this.canvas_manager.mapPixelToCoordsY(this.canvas.height);
            const curw = endx - curx, curh = endy - cury;
            size = [curw, curh];
        }
        //

        const ctx = new canvas2pdf.PdfContext(stream, {
            size: size
        });
        const oldctx = this.ctx;
        this.ctx = ctx;
        this.ctx.lod = !save_all;
        this.ctx.pdf = true;
        // Center on saved region
        if (!save_all)
            this.ctx.translate(-curx, -cury);

        this.draw_async();

        ctx.stream.on('finish', () => {
            this.save('sdfg.pdf', ctx.stream.toBlobURL('application/pdf'));
            this.ctx = oldctx;
            this.draw_async();
        });
    }

    // Draw a debug grid on the canvas to indicate coordinates.
    debug_draw_grid(curx, cury, endx, endy, grid_width = 100) {
        const lim_x_min = Math.floor(curx / grid_width) * grid_width;
        const lim_x_max = Math.ceil(endx / grid_width) * grid_width;
        const lim_y_min = Math.floor(cury / grid_width) * grid_width;
        const lim_y_max = Math.ceil(endy / grid_width) * grid_width;
        for (var i = lim_x_min; i <= lim_x_max; i += grid_width) {
            this.ctx.moveTo(i, lim_y_min);
            this.ctx.lineTo(i, lim_y_max);
        }
        for (var i = lim_y_min; i <= lim_y_max; i += grid_width) {
            this.ctx.moveTo(lim_x_min, i);
            this.ctx.lineTo(lim_x_max, i);
        }
        this.ctx.strokeStyle = 'yellow';
        this.ctx.stroke();

        // Draw the zero-point.
        this.ctx.beginPath();
        this.ctx.arc(0, 0, 10, 0, 2 * Math.PI, false);
        this.ctx.fillStyle = 'red';
        this.ctx.fill();
        this.ctx.strokeStyle = 'red';
        this.ctx.stroke();
    }

    // Render SDFG
    draw(dt) {
        const ctx = this.ctx;
        const g = this.graph;
        const curx = this.canvas_manager.mapPixelToCoordsX(0);
        const cury = this.canvas_manager.mapPixelToCoordsY(0);
        const endx = this.canvas_manager.mapPixelToCoordsX(this.canvas.width);
        const endy = this.canvas_manager.mapPixelToCoordsY(this.canvas.height);
        const curw = endx - curx, curh = endy - cury;

        this.visible_rect = { x: curx, y: cury, w: curw, h: curh };

        this.on_pre_draw();

        draw_sdfg(this, ctx, g, this.mousepos, this.debug_draw);

        if (this.box_select_rect) {
            this.ctx.beginPath();
            const old_line_width = this.ctx.lineWidth;
            this.ctx.lineWidth = this.canvas_manager.points_per_pixel();
            this.ctx.strokeStyle = 'grey';
            this.ctx.rect(this.box_select_rect.x_start, this.box_select_rect.y_start,
                this.box_select_rect.x_end - this.box_select_rect.x_start,
                this.box_select_rect.y_end - this.box_select_rect.y_start);
            this.ctx.stroke();
            this.ctx.lineWidth = old_line_width;
        }

        if (this.debug_draw) {
            this.debug_draw_grid(curx, cury, endx, endy, 100);
            if (this.mousepos) {
                this.dbg_mouse_coords.innerText = 'x: ' + Math.floor(this.mousepos.x) +
                    ' / y: ' + Math.floor(this.mousepos.y);
            } else {
                this.dbg_mouse_coords.innerText = 'x: N/A / y: N/A';
            }
        }

        this.on_post_draw();
    }

    on_pre_draw() { }

    on_post_draw() {
        if (this.overlay_manager !== null)
            this.overlay_manager.draw();

        try {
            this.ctx.end();
        } catch (ex) {
            // TODO make sure no error is thrown instead of catching and silently ignoring it?
        }

        if (this.tooltip) {
            const br = this.canvas.getBoundingClientRect();
            const pos = {
                x: this.realmousepos.x - br.x,
                y: this.realmousepos.y - br.y
            };

            // Clear style and contents
            this.tooltip_container.style = '';
            this.tooltip_container.innerHTML = '';
            this.tooltip_container.style.display = 'block';

            // Invoke custom container
            this.tooltip(this.tooltip_container);

            // Make visible near mouse pointer
            this.tooltip_container.style.top = pos.y + 'px';
            this.tooltip_container.style.left = (pos.x + 20) + 'px';
        } else {
            this.tooltip_container.style.display = 'none';
        }

        if (this.sdfg.error) {
            const error = this.sdfg.error;

            let type = '';
            let state_id = -1;
            let el_id = -1;
            if (error.isedge_id !== undefined) {
                type = 'isedge';
                el_id = error.isedge_id;
            } else if (error.state_id !== undefined) {
                state_id = error.state_id;
                if (error.node_id !== undefined) {
                    type = 'node';
                    el_id = error.node_id;
                } else if (error.edge_id !== undefined) {
                    type = 'edge';
                    el_id = error.edge_id;
                } else {
                    type = 'state';
                }
            } else {
                return;
            }
            const offending_element = find_graph_element(
                this.graph, type, error.sdfg_id, state_id, el_id
            );
            if (offending_element) {
                this.zoom_to_view([offending_element]);
                this.error_popover_container.style.display = 'block';
                this.error_popover_container.style.bottom = '5%';
                this.error_popover_container.style.left = '5%';
                this.error_popover_text.innerText = error.message;
            }
        } else {
            this.error_popover_container.style.display = 'none';
        }
    }

    visible_elements() {
        const curx = this.canvas_manager.mapPixelToCoordsX(0);
        const cury = this.canvas_manager.mapPixelToCoordsY(0);
        const endx = this.canvas_manager.mapPixelToCoordsX(this.canvas.width);
        const endy = this.canvas_manager.mapPixelToCoordsY(this.canvas.height);
        const curw = endx - curx;
        const curh = endy - cury;
        const elements = [];
        this.do_for_intersected_elements(curx, cury, curw, curh, (type, e, obj) => {
            const state_id = e.state ? Number(e.state) : -1;
            let el_type = 'other';
            if (type === 'nodes')
                el_type = 'node';
            else if (type === 'states')
                el_type = 'state';
            else if (type === 'edges')
                el_type = 'edge';
            else if (type === 'isedges')
                el_type = 'isedge';
            else if (type === 'connectors')
                el_type = 'connector';
            elements.push({
                type: el_type,
                sdfg_id: Number(e.sdfg_id),
                state_id: state_id,
                id: Number(e.id),
            });
        });
        return elements;
    }

    // Returns a dictionary of SDFG elements in a given rectangle. Used for
    // selection, rendering, localized transformations, etc.
    // The output is a dictionary of lists of dictionaries. The top-level keys are:
    // states, nodes, connectors, edges, isedges (interstate edges). For example:
    // {'states': [{sdfg: sdfg_name, state: 1}, ...], nodes: [sdfg: sdfg_name, state: 1, node: 5],
    //              edges: [], isedges: [], connectors: []}
    elements_in_rect(x, y, w, h) {
        const elements = {
            states: [], nodes: [], connectors: [],
            edges: [], isedges: []
        };
        this.do_for_intersected_elements(x, y, w, h, (type, e, obj) => {
            e.obj = obj;
            elements[type].push(e);
        });
        return elements;
    }

    do_for_intersected_elements(x, y, w, h, func) {
        // Traverse nested SDFGs recursively
        function traverse_recursive(g, sdfg_name, sdfg_id) {
            g.nodes().forEach(state_id => {
                const state = g.node(state_id);
                if (!state) return;

                if (state.intersect(x, y, w, h)) {
                    // States
                    func('states', { sdfg: sdfg_name, sdfg_id: sdfg_id, id: state_id }, state);

                    if (state.data.state.attributes.is_collapsed)
                        return;

                    const ng = state.data.graph;
                    if (!ng)
                        return;
                    ng.nodes().forEach(node_id => {
                        const node = ng.node(node_id);
                        if (node.intersect(x, y, w, h)) {
                            // Selected nodes
                            func('nodes', { sdfg: sdfg_name, sdfg_id: sdfg_id, state: state_id, id: node_id }, node);

                            // If nested SDFG, traverse recursively
                            if (node.data.node.type === "NestedSDFG")
                                traverse_recursive(node.data.graph,
                                    node.data.node.attributes.sdfg.attributes.name,
                                    node.data.node.attributes.sdfg.sdfg_list_id);
                        }
                        // Connectors
                        node.in_connectors.forEach((c, i) => {
                            if (c.intersect(x, y, w, h))
                                func('connectors', {
                                    sdfg: sdfg_name, sdfg_id: sdfg_id, state: state_id, node: node_id,
                                    connector: i, conntype: "in"
                                }, c);
                        });
                        node.out_connectors.forEach((c, i) => {
                            if (c.intersect(x, y, w, h))
                                func('connectors', {
                                    sdfg: sdfg_name, sdfg_id: sdfg_id, state: state_id, node: node_id,
                                    connector: i, conntype: "out"
                                }, c);
                        });
                    });

                    // Selected edges
                    ng.edges().forEach(edge_id => {
                        const edge = ng.edge(edge_id);
                        if (edge.intersect(x, y, w, h)) {
                            func('edges', { sdfg: sdfg_name, sdfg_id: sdfg_id, state: state_id, id: edge.id }, edge);
                        }
                    });
                }
            });

            // Selected inter-state edges
            g.edges().forEach(isedge_id => {
                const isedge = g.edge(isedge_id);
                if (isedge.intersect(x, y, w, h)) {
                    func('isedges', { sdfg: sdfg_name, sdfg_id: sdfg_id, id: isedge.id }, isedge);
                }
            });
        }

        // Start with top-level SDFG
        traverse_recursive(this.graph, this.sdfg.attributes.name,
            this.sdfg.sdfg_list_id);
    }

    for_all_sdfg_elements(func) {
        // Traverse nested SDFGs recursively
        function traverse_recursive(sdfg) {
            sdfg.nodes.forEach((state, state_id) => {
                // States
                func('states', { sdfg: sdfg, id: state_id }, state);

                state.nodes.forEach((node, node_id) => {
                    // Nodes
                    func('nodes', { sdfg: sdfg, state: state_id, id: node_id }, node);

                    // If nested SDFG, traverse recursively
                    if (node.type === "NestedSDFG")
                        traverse_recursive(node.attributes.sdfg);
                });

                // Edges
                state.edges.forEach((edge, edge_id) => {
                    func('edges', { sdfg: sdfg, state: state_id, id: edge_id }, edge);
                });
            });

            // Selected inter-state edges
            sdfg.edges.forEach((isedge, isedge_id) => {
                func('isedges', { sdfg: sdfg, id: isedge_id }, isedge);
            });
        }

        // Start with top-level SDFG
        traverse_recursive(this.sdfg);
    }

    for_all_elements(x, y, w, h, func) {
        // Traverse nested SDFGs recursively
        function traverse_recursive(g, sdfg_name) {
            g.nodes().forEach(state_id => {
                const state = g.node(state_id);
                if (!state) return;

                // States
                func('states', { sdfg: sdfg_name, id: state_id, graph: g }, state, state.intersect(x, y, w, h));

                if (state.data.state.attributes.is_collapsed)
                    return;

                const ng = state.data.graph;
                if (!ng)
                    return;
                ng.nodes().forEach(node_id => {
                    const node = ng.node(node_id);
                    // Selected nodes
                    func('nodes', { sdfg: sdfg_name, state: state_id, id: node_id, graph: ng }, node, node.intersect(x, y, w, h));

                    // If nested SDFG, traverse recursively
                    if (node.data.node.type === "NestedSDFG")
                        traverse_recursive(node.data.graph, node.data.node.attributes.sdfg.attributes.name);

                    // Connectors
                    node.in_connectors.forEach((c, i) => {
                        func('connectors', {
                            sdfg: sdfg_name, state: state_id, node: node_id,
                            connector: i, conntype: "in", graph: ng
                        }, c, c.intersect(x, y, w, h));
                    });
                    node.out_connectors.forEach((c, i) => {
                        func('connectors', {
                            sdfg: sdfg_name, state: state_id, node: node_id,
                            connector: i, conntype: "out", graph: ng
                        }, c, c.intersect(x, y, w, h));
                    });
                });

                // Selected edges
                ng.edges().forEach(edge_id => {
                    const edge = ng.edge(edge_id);
                    func('edges', { sdfg: sdfg_name, state: state_id, id: edge.id, graph: ng }, edge, edge.intersect(x, y, w, h));
                });
            });

            // Selected inter-state edges
            g.edges().forEach(isedge_id => {
                const isedge = g.edge(isedge_id);
                func('isedges', { sdfg: sdfg_name, id: isedge.id, graph: g }, isedge, isedge.intersect(x, y, w, h));
            });
        }

        // Start with top-level SDFG
        traverse_recursive(this.graph, this.sdfg.attributes.name);
    }

    get_nested_memlet_tree(edge) {
        for (const tree of this.all_memlet_trees)
            if (tree.has(edge))
                return tree;
        return [];
    }

    find_elements_under_cursor(mouse_pos_x, mouse_pos_y) {
        // Find all elements under the cursor.
        const elements = this.elements_in_rect(mouse_pos_x, mouse_pos_y, 0, 0);
        const clicked_states = elements.states;
        const clicked_nodes = elements.nodes;
        const clicked_edges = elements.edges;
        const clicked_interstate_edges = elements.isedges;
        const clicked_connectors = elements.connectors;
        const total_elements =
            clicked_states.length + clicked_nodes.length +
            clicked_edges.length + clicked_interstate_edges.length +
            clicked_connectors.length;
        let foreground_elem = null, foreground_surface = -1;

        // Find the top-most element under the mouse cursor (i.e. the one with
        // the smallest dimensions).
        const categories = [
            clicked_states,
            clicked_interstate_edges,
            clicked_nodes,
            clicked_edges
        ];
        for (const category of categories) {
            for (let i = 0; i < category.length; i++) {
                const s = category[i].obj.width * category[i].obj.height;
                if (foreground_surface < 0 || s < foreground_surface) {
                    foreground_surface = s;
                    foreground_elem = category[i].obj;
                }
            }
        }

        return {
            total_elements,
            elements,
            foreground_elem,
        };
    }

    on_mouse_event(event, comp_x_func, comp_y_func, evtype = "other") {
        let dirty = false; // Whether to redraw at the end
        // Whether the set of visible or selected elements changed
        let element_focus_changed = false;

        if (evtype === "mousedown" || evtype === "touchstart") {
            this.drag_start = event;
        } else if (evtype === "mouseup") {
            this.drag_start = null;
            this.last_dragged_element = null;
        } else if (evtype === "touchend") {
            if (event.touches.length == 0)
                this.drag_start = null;
            else
                this.drag_start = event;
        } else if (evtype === "mousemove") {
            // Calculate the change in mouse position in canvas coordinates
            const old_mousepos = this.mousepos;
            this.mousepos = { x: comp_x_func(event), y: comp_y_func(event) };
            this.realmousepos = { x: event.clientX, y: event.clientY };

            // Only accept the primary mouse button as dragging source
            if (this.drag_start && event.buttons & 1) {
                this.dragging = true;

                if (this.mouse_mode === 'move') {
                    if (this.last_dragged_element) {
                        this.canvas.style.cursor = 'grabbing';
                        this.drag_start.cx = comp_x_func(this.drag_start);
                        this.drag_start.cy = comp_y_func(this.drag_start);
                        this.canvas_manager.translate_element(
                            this.last_dragged_element,
                            old_mousepos, this.mousepos,
                            this.graph, this.sdfg_list, this.state_parent_list,
                            this.drag_start
                        );
                        dirty = true;
                        this.draw_async();
                        return false;
                    } else {
                        const mouse_elements = this.find_elements_under_cursor(
                            this.mousepos.x, this.mousepos.y
                        );
                        if (mouse_elements.foreground_elem) {
                            this.last_dragged_element =
                                mouse_elements.foreground_elem;
                            this.canvas.style.cursor = 'grabbing';
                            return false;
                        }
                        return true;
                    }
                } else if (this.mouse_mode === 'select') {
                    this.box_select_rect = {
                        x_start: comp_x_func(this.drag_start),
                        y_start: comp_y_func(this.drag_start),
                        x_end: this.mousepos.x,
                        y_end: this.mousepos.y,
                    };

                    // Mark for redraw
                    dirty = true;
                } else {
                    this.canvas_manager.translate(event.movementX,
                        event.movementY);

                    // Mark for redraw
                    dirty = true;
                }
            } else if (this.drag_start && event.buttons & 4) {
                // Pan the view with the middle mouse button
                this.dragging = true;
                this.canvas_manager.translate(event.movementX, event.movementY);
                dirty = true;
                element_focus_changed = true;
            } else {
                this.drag_start = null;
                this.last_dragged_element = null;
                if (event.buttons & 1 || event.buttons & 4)
                    return true; // Don't stop propagation
            }
        } else if (evtype === "touchmove") {
            if (this.drag_start.touches.length != event.touches.length) {
                // Different number of touches, ignore and reset drag_start
                this.drag_start = event;
            } else if (event.touches.length == 1) { // Move/drag
                this.canvas_manager.translate(event.touches[0].clientX - this.drag_start.touches[0].clientX,
                    event.touches[0].clientY - this.drag_start.touches[0].clientY);
                this.drag_start = event;

                // Mark for redraw
                dirty = true;
                this.draw_async();
                return false;
            } else if (event.touches.length == 2) {
                // Find relative distance between two touches before and after.
                // Then, center and zoom to their midpoint.
                const touch1 = this.drag_start.touches[0];
                const touch2 = this.drag_start.touches[1];
                let x1 = touch1.clientX, x2 = touch2.clientX;
                let y1 = touch1.clientY, y2 = touch2.clientY;
                const oldCenter = [(x1 + x2) / 2.0, (y1 + y2) / 2.0];
                const initialDistance = Math.sqrt((x1 - x2) ** 2 + (y1 - y2) ** 2);
                x1 = event.touches[0].clientX; x2 = event.touches[1].clientX;
                y1 = event.touches[0].clientY; y2 = event.touches[1].clientY;
                const currentDistance = Math.sqrt((x1 - x2) ** 2 + (y1 - y2) ** 2);
                const newCenter = [(x1 + x2) / 2.0, (y1 + y2) / 2.0];

                // First, translate according to movement of center point
                this.canvas_manager.translate(newCenter[0] - oldCenter[0],
                    newCenter[1] - oldCenter[1]);
                // Then scale
                this.canvas_manager.scale(currentDistance / initialDistance,
                    newCenter[0], newCenter[1]);

                this.drag_start = event;

                // Mark for redraw
                dirty = true;
                this.draw_async();
                return false;
            }
        } else if (evtype === "wheel") {
            // Get physical x,y coordinates (rather than canvas coordinates)
            const br = this.canvas.getBoundingClientRect();
            const x = event.clientX - br.x;
            const y = event.clientY - br.y;
            this.canvas_manager.scale(event.deltaY > 0 ? 0.9 : 1.1, x, y);
            dirty = true;
            element_focus_changed = true;
        }
        // End of mouse-move/touch-based events


        if (!this.mousepos)
            return true;

        // Find elements under cursor
        const elements_under_cursor = this.find_elements_under_cursor(
            this.mousepos.x, this.mousepos.y
        );
        const elements = elements_under_cursor.elements;
        const total_elements = elements_under_cursor.total_elements;
        const foreground_elem = elements_under_cursor.foreground_elem;

        // Change mouse cursor accordingly
        if (this.mouse_mode === 'select') {
            this.canvas.style.cursor = 'crosshair';
        } else if (total_elements > 0) {
            if (this.mouse_mode === 'move' && this.drag_start) {
                this.canvas.style.cursor = 'grabbing';
            } else if (this.mouse_mode === 'move') {
                this.canvas.style.cursor = 'grab';
            } else {
                // Hovering over an element while not in any specific mode.
                if ((foreground_elem.data.state &&
                    foreground_elem.data.state.attributes.is_collapsed) ||
                    (foreground_elem.data.node &&
                        foreground_elem.data.node.attributes.is_collapsed)) {
                    // This is a collapsed node or state, show with the cursor
                    // shape that this can be expanded.
                    this.canvas.style.cursor = 'alias';
                } else {
                    this.canvas.style.cursor = 'pointer';
                }
            }
        } else {
            this.canvas.style.cursor = 'auto';
        }

        this.tooltip = null;
        this.last_hovered_elements = elements;

        // De-highlight all elements.
        this.for_all_elements(this.mousepos.x, this.mousepos.y, 0, 0, (type, e, obj, intersected) => {
            obj.hovered = false;
            obj.highlighted = false;
        });
        // Mark hovered and highlighted elements.
        this.for_all_elements(this.mousepos.x, this.mousepos.y, 0, 0, (type, e, obj, intersected) => {
            // Highlight all edges of the memlet tree
            if (intersected && obj instanceof Edge && obj.parent_id != null) {
                const tree = this.get_nested_memlet_tree(obj);
                tree.forEach(te => {
                    if (te != obj && te !== undefined) {
                        te.highlighted = true;
                    }
                });
            }

            // Highlight all access nodes with the same name in the same nested sdfg
            if (intersected && obj instanceof AccessNode) {
                traverse_sdfg_scopes(this.sdfg_list[obj.sdfg.sdfg_list_id], (node) => {
                    // If node is a state, then visit sub-scope
                    if (node instanceof State) {
                        return true;
                    }
                    if (node instanceof AccessNode && node.data.node.label === obj.data.node.label) {
                        node.highlighted = true;
                    }
                    // No need to visit sub-scope
                    return false;
                });
            }

            // Highlight all access nodes with the same name as the hovered connector in the nested sdfg
            if (intersected && obj instanceof Connector) {
                const nested_graph = e.graph.node(obj.parent_id).data.graph;
                if (nested_graph) {
                    traverse_sdfg_scopes(nested_graph, (node) => {
                        // If node is a state, then visit sub-scope
                        if (node instanceof State) {
                            return true;
                        }
                        if (node instanceof AccessNode && node.data.node.label === obj.label()) {
                            node.highlighted = true;
                        }
                        // No need to visit sub-scope
                        return false;
                    });
                }
            }

            if (intersected)
                obj.hovered = true;
        });



        if (evtype === "mousemove") {
            // TODO: Draw only if elements have changed
            dirty = true;
        }

        if (evtype === "dblclick") {
            const sdfg = (foreground_elem ? foreground_elem.sdfg : null);
            let sdfg_elem = null;
            if (foreground_elem instanceof State)
                sdfg_elem = foreground_elem.data.state;
            else if (foreground_elem instanceof SDFGNode) {
                sdfg_elem = foreground_elem.data.node;

                // If a scope exit node, use entry instead
                if (sdfg_elem.type.endsWith("Exit"))
                    sdfg_elem = sdfg.nodes[foreground_elem.parent_id].nodes[sdfg_elem.scope_entry];
            } else
                sdfg_elem = null;

            // Toggle collapsed state
            if (sdfg_elem && 'is_collapsed' in sdfg_elem.attributes) {
                sdfg_elem.attributes.is_collapsed = !sdfg_elem.attributes.is_collapsed;

                // Re-layout SDFG
                this.relayout();
                dirty = true;
                element_focus_changed = true;
            }
        }

        let ends_drag = false;
        if (evtype === 'click') {
            if (this.dragging) {
                // This click ends a drag.
                this.dragging = false;
                ends_drag = true;

                element_focus_changed = true;

                if (this.box_select_rect) {
                    const elements_in_selection = [];
                    const start_x = Math.min(this.box_select_rect.x_start,
                        this.box_select_rect.x_end);
                    const end_x = Math.max(this.box_select_rect.x_start,
                        this.box_select_rect.x_end);
                    const start_y = Math.min(this.box_select_rect.y_start,
                        this.box_select_rect.y_end);
                    const end_y = Math.max(this.box_select_rect.y_start,
                        this.box_select_rect.y_end);
                    const w = end_x - start_x;
                    const h = end_y - start_y;
                    this.do_for_intersected_elements(start_x, start_y, w, h,
                        (type, e, obj) => {
                            if (obj.contained_in(start_x, start_y, w, h))
                                elements_in_selection.push(obj);
                        });
                    if (event.shiftKey) {
                        elements_in_selection.forEach((el) => {
                            if (!this.selected_elements.includes(el))
                                this.selected_elements.push(el);
                        });
                    } else if (event.ctrlKey) {
                        elements_in_selection.forEach((el) => {
                            if (this.selected_elements.includes(el)) {
                                this.selected_elements =
                                    this.selected_elements.filter((val) => {
                                        val.selected = false;
                                        return val !== el;
                                    });
                            }
                        });
                    } else {
                        this.selected_elements.forEach((el) => {
                            el.selected = false;
                        });
                        this.selected_elements = elements_in_selection;
                    }
                    this.box_select_rect = null;
                    dirty = true;
                    element_focus_changed = true;
                }
            } else {
                if (foreground_elem) {
                    if (event.ctrlKey) {
                        // Ctrl + click on an object, add it, or remove it from
                        // the selection if it was previously in it.
                        if (this.selected_elements.includes(foreground_elem)) {
                            foreground_elem.selected = false;
                            this.selected_elements =
                                this.selected_elements.filter((el) => {
                                    return el !== foreground_elem;
                                });
                        } else {
                            this.selected_elements.push(foreground_elem);
                        }
                    } else if (event.shiftKey) {
                        // TODO: Implement shift-clicks for path selection.
                    } else {
                        // Clicked an element, select it and nothing else.
                        this.selected_elements.forEach((el) => {
                            el.selected = false;
                        });
                        this.selected_elements = [foreground_elem];
                    }
                } else {
                    // Clicked nothing, clear the selection.
                    this.selected_elements.forEach((el) => {
                        el.selected = false;
                    });
                    this.selected_elements = [];
                }
                dirty = true;
                element_focus_changed = true;
            }
        }
        this.selected_elements.forEach((el) => {
            el.selected = true;
        });

        const mouse_x = comp_x_func(event);
        const mouse_y = comp_y_func(event);
        if (this.external_mouse_handler)
            dirty |= this.external_mouse_handler(evtype, event, { x: mouse_x, y: mouse_y }, elements,
                this, this.selected_elements, ends_drag);

        if (this.overlay_manager !== null) {
            dirty |= this.overlay_manager.on_mouse_event(
                evtype,
                event,
                { x: mouse_x, y: mouse_y },
                elements,
                foreground_elem,
                ends_drag
            );
        }

        if (dirty) {
            this.draw_async();
        }

        if (element_focus_changed) {
            // If a listener in VSCode is present, update it about the new
            // viewport and tell it to re-sort the shown transformations.
            try {
                if (vscode)
                    sort_transformations(refresh_transformation_list);
            } catch (ex) {
                // Do nothing
            }
        }

        return false;
    }
}


function calculateNodeSize(sdfg_state, node, ctx) {
    const labelsize = ctx.measureText(node.label).width;
    const inconnsize = 2 * LINEHEIGHT * Object.keys(node.attributes.layout.in_connectors).length - LINEHEIGHT;
    const outconnsize = 2 * LINEHEIGHT * Object.keys(node.attributes.layout.out_connectors).length - LINEHEIGHT;
    const maxwidth = Math.max(labelsize, inconnsize, outconnsize);
    let maxheight = 2 * LINEHEIGHT;
    maxheight += 4 * LINEHEIGHT;

    const size = { width: maxwidth, height: maxheight }

    // add something to the size based on the shape of the node
    if (node.type === "AccessNode") {
        size.height -= 4 * LINEHEIGHT;
        size.width += size.height;
    }
    else if (node.type.endsWith("Entry")) {
        size.width += 2.0 * size.height;
        size.height /= 1.75;
    }
    else if (node.type.endsWith("Exit")) {
        size.width += 2.0 * size.height;
        size.height /= 1.75;
    }
    else if (node.type === "Tasklet") {
        size.width += 2.0 * (size.height / 3.0);
        size.height /= 1.75;
    }
    else if (node.type === "LibraryNode") {
        size.width += 2.0 * (size.height / 3.0);
        size.height /= 1.75;
    }
    else if (node.type === "Reduce") {
        size.height -= 4 * LINEHEIGHT;
        size.width *= 2;
        size.height = size.width / 3.0;
    }
    else {
    }

    return size;
}

// Layout SDFG elements (states, nodes, scopes, nested SDFGs)
function relayout_sdfg(ctx, sdfg, sdfg_list, state_parent_list, omit_access_nodes) {
    const STATE_MARGIN = 4 * LINEHEIGHT;

    // Layout the SDFG as a dagre graph
    const g = new dagre.graphlib.Graph();
    g.setGraph({});
    g.setDefaultEdgeLabel((u, v) => { return {}; });

    // layout each state to get its size
    sdfg.nodes.forEach((state) => {
        let stateinfo = {};

        stateinfo.label = state.id;
        let state_g = null;
        if (state.attributes.is_collapsed) {
            stateinfo.width = ctx.measureText(stateinfo.label).width;
            stateinfo.height = LINEHEIGHT;
        }
        else {
            state_g = relayout_state(ctx, state, sdfg, sdfg_list,
                state_parent_list, omit_access_nodes);
            stateinfo = calculateBoundingBox(state_g);
        }
        stateinfo.width += 2 * STATE_MARGIN;
        stateinfo.height += 2 * STATE_MARGIN;
        g.setNode(state.id, new State({
            state: state,
            layout: stateinfo,
            graph: state_g
        }, state.id, sdfg));
    });

    sdfg.edges.forEach((edge, id) => {
        g.setEdge(edge.src, edge.dst, new Edge(edge.attributes.data, id, sdfg));
    });

    dagre.layout(g);

    // Annotate the sdfg with its layout info
    sdfg.nodes.forEach((state) => {
        const gnode = g.node(state.id);
        state.attributes.layout = {};
        state.attributes.layout.x = gnode.x;
        state.attributes.layout.y = gnode.y;
        state.attributes.layout.width = gnode.width;
        state.attributes.layout.height = gnode.height;
    });

    sdfg.edges.forEach((edge) => {
        const gedge = g.edge(edge.src, edge.dst);
        const bb = calculateEdgeBoundingBox(gedge);
        // Convert from top-left to center
        bb.x += bb.width / 2.0;
        bb.y += bb.height / 2.0;

        gedge.x = bb.x;
        gedge.y = bb.y;
        gedge.width = bb.width;
        gedge.height = bb.height;
        edge.attributes.layout = {};
        edge.attributes.layout.width = bb.width;
        edge.attributes.layout.height = bb.height;
        edge.attributes.layout.x = bb.x;
        edge.attributes.layout.y = bb.y;
        edge.attributes.layout.points = gedge.points;
    });

    // Offset node and edge locations to be in state margins
    sdfg.nodes.forEach((s, sid) => {
        if (s.attributes.is_collapsed)
            return;

        const state = g.node(sid);
        const topleft = state.topleft();
        offset_state(s, state, {
            x: topleft.x + STATE_MARGIN,
            y: topleft.y + STATE_MARGIN
        });
    });

    const bb = calculateBoundingBox(g);
    g.width = bb.width;
    g.height = bb.height;

    // Add SDFG to global store
    sdfg_list[sdfg.sdfg_list_id] = g;

    return g;
}

function relayout_state(ctx, sdfg_state, sdfg, sdfg_list, state_parent_list, omit_access_nodes) {
    // layout the state as a dagre graph
    const g = new dagre.graphlib.Graph({ multigraph: true });

    // Set layout options and a simpler algorithm for large graphs
    const layout_options = { ranksep: 30 };
    if (sdfg_state.nodes.length >= 1000)
        layout_options.ranker = 'longest-path';

    g.setGraph(layout_options);


    // Set an object for the graph label
    g.setDefaultEdgeLabel((u, v) => { return {}; });

    // Add nodes to the graph. The first argument is the node id. The
    // second is metadata about the node (label, width, height),
    // which will be updated by dagre.layout (will add x,y).

    // Process nodes hierarchically
    let toplevel_nodes = sdfg_state.scope_dict[-1];
    if (toplevel_nodes === undefined)
        toplevel_nodes = Object.keys(sdfg_state.nodes);
    const drawn_nodes = new Set();
    const hidden_nodes = new Map();

    function layout_node(node) {
        if (omit_access_nodes && node.type == "AccessNode") {
            // add access node to hidden nodes; source and destinations will be set later
            hidden_nodes.set(node.id.toString(), { node: node, src: null, dsts: [] });
            return;
        }

        let nested_g = null;
        node.attributes.layout = {};

        // Set connectors prior to computing node size
        node.attributes.layout.in_connectors = node.attributes.in_connectors;
        if ('is_collapsed' in node.attributes && node.attributes.is_collapsed && node.type !== "NestedSDFG")
            node.attributes.layout.out_connectors = find_exit_for_entry(sdfg_state.nodes, node).attributes.out_connectors;
        else
            node.attributes.layout.out_connectors = node.attributes.out_connectors;

        const nodesize = calculateNodeSize(sdfg_state, node, ctx);
        node.attributes.layout.width = nodesize.width;
        node.attributes.layout.height = nodesize.height;
        node.attributes.layout.label = node.label;

        // Recursively lay out nested SDFGs
        if (node.type === "NestedSDFG") {
            nested_g = relayout_sdfg(ctx, node.attributes.sdfg, sdfg_list, state_parent_list, omit_access_nodes);
            const sdfginfo = calculateBoundingBox(nested_g);
            node.attributes.layout.width = sdfginfo.width + 2 * LINEHEIGHT;
            node.attributes.layout.height = sdfginfo.height + 2 * LINEHEIGHT;
        }

        // Dynamically create node type
        const obj = new SDFGElements[node.type]({ node: node, graph: nested_g }, node.id, sdfg, sdfg_state.id);

        // If it's a nested SDFG, we need to record the node as all of its
        // state's parent node
        if (node.type === 'NestedSDFG')
            state_parent_list[node.attributes.sdfg.sdfg_list_id] = obj;

        // Add input connectors
        let i = 0;
        let conns;
        if (Array.isArray(node.attributes.layout.in_connectors))
            conns = node.attributes.layout.in_connectors;
        else
            conns = Object.keys(node.attributes.layout.in_connectors);
        for (const cname of conns) {
            const conn = new Connector({ name: cname }, i, sdfg, node.id);
            obj.in_connectors.push(conn);
            i += 1;
        }

        // Add output connectors -- if collapsed, uses exit node connectors
        i = 0;
        if (Array.isArray(node.attributes.layout.out_connectors))
            conns = node.attributes.layout.out_connectors;
        else
            conns = Object.keys(node.attributes.layout.out_connectors);
        for (const cname of conns) {
            const conn = new Connector({ name: cname }, i, sdfg, node.id);
            obj.out_connectors.push(conn);
            i += 1;
        }

        g.setNode(node.id, obj);
        drawn_nodes.add(node.id.toString());

        // Recursively draw nodes
        if (node.id in sdfg_state.scope_dict) {
            if (node.attributes.is_collapsed)
                return;
            sdfg_state.scope_dict[node.id].forEach((nodeid) => {
                const node = sdfg_state.nodes[nodeid];
                layout_node(node);
            });
        }
    }


    toplevel_nodes.forEach((nodeid) => {
        const node = sdfg_state.nodes[nodeid];
        layout_node(node);
    });

    // add info to calculate shortcut edges
    function add_edge_info_if_hidden(edge) {
        const hidden_src = hidden_nodes.get(edge.src);
        const hidden_dst = hidden_nodes.get(edge.dst);

        if (hidden_src && hidden_dst) {
            // if we have edges from an AccessNode to an AccessNode then just connect destinations
            hidden_src.dsts = hidden_dst.dsts;
            edge.attributes.data.attributes.shortcut = false;
        } else if (hidden_src) {
            // if edge starts at hidden node, then add it as destination
            hidden_src.dsts.push(edge);
            edge.attributes.data.attributes.shortcut = false;
            return true;
        } else if (hidden_dst) {
            // if edge ends at hidden node, then add it as source
            hidden_dst.src = edge;
            edge.attributes.data.attributes.shortcut = false;
            return true;
        }

        // if it is a shortcut edge, but we don't omit access nodes, then ignore this edge
        if (!omit_access_nodes && edge.attributes.data.attributes.shortcut) return true;

        return false;
    }

    sdfg_state.edges.forEach((edge, id) => {
        if (add_edge_info_if_hidden(edge)) return;
        edge = check_and_redirect_edge(edge, drawn_nodes, sdfg_state);
        if (!edge) return;
        const e = new Edge(edge.attributes.data, id, sdfg, sdfg_state.id);
        edge.attributes.data.edge = e;
        e.src_connector = edge.src_connector;
        e.dst_connector = edge.dst_connector;
        g.setEdge(edge.src, edge.dst, e, id);
    });

    hidden_nodes.forEach(hidden_node => {
        if (hidden_node.src) {
            hidden_node.dsts.forEach(e => {
                // create shortcut edge with new destination
                const tmp_edge = e.attributes.data.edge;
                e.attributes.data.edge = null;
                const shortcut_e = deepCopy(e);
                e.attributes.data.edge = tmp_edge;
                shortcut_e.src = hidden_node.src.src;
                shortcut_e.src_connector = hidden_node.src.src_connector;
                shortcut_e.dst_connector = e.dst_connector;
                // attribute that only shortcut edges have; if it is explicitly false, then edge is ignored in omit access node mode
                shortcut_e.attributes.data.attributes.shortcut = true;

                // draw the redirected edge
                const redirected_e = check_and_redirect_edge(shortcut_e, drawn_nodes, sdfg_state);
                if (!redirected_e) return;

                // abort if shortcut edge already exists
                const edges = g.outEdges(redirected_e.src);
                for (const oe of edges) {
                    if (oe.w == e.dst && sdfg_state.edges[oe.name].dst_connector == e.dst_connector) {
                        return;
                    }
                }

                // add shortcut edge (redirection is not done in this list)
                sdfg_state.edges.push(shortcut_e);

                // add redirected shortcut edge to graph
                const edge_id = sdfg_state.edges.length - 1;
                const shortcut_edge = new Edge(deepCopy(redirected_e.attributes.data), edge_id, sdfg, sdfg_state.id);
                shortcut_edge.src_connector = redirected_e.src_connector;
                shortcut_edge.dst_connector = redirected_e.dst_connector;
                shortcut_edge.data.attributes.shortcut = true;

                g.setEdge(redirected_e.src, redirected_e.dst, shortcut_edge, edge_id);
            });
        }
    });

    dagre.layout(g);


    // Layout connectors and nested SDFGs
    sdfg_state.nodes.forEach((node, id) => {
        const gnode = g.node(id);
        if (!gnode || (omit_access_nodes && gnode instanceof AccessNode)) {
            // ignore nodes that should not be drawn
            return;
        }
        const topleft = gnode.topleft();

        // Offset nested SDFG
        if (node.type === "NestedSDFG") {

            offset_sdfg(node.attributes.sdfg, gnode.data.graph, {
                x: topleft.x + LINEHEIGHT,
                y: topleft.y + LINEHEIGHT
            });
        }
        // Connector management 
        const SPACING = LINEHEIGHT;
        const iconn_length = (LINEHEIGHT + SPACING) * Object.keys(node.attributes.layout.in_connectors).length - SPACING;
        const oconn_length = (LINEHEIGHT + SPACING) * Object.keys(node.attributes.layout.out_connectors).length - SPACING;
        let iconn_x = gnode.x - iconn_length / 2.0 + LINEHEIGHT / 2.0;
        let oconn_x = gnode.x - oconn_length / 2.0 + LINEHEIGHT / 2.0;

        for (const c of gnode.in_connectors) {
            c.width = LINEHEIGHT;
            c.height = LINEHEIGHT;
            c.x = iconn_x;
            iconn_x += LINEHEIGHT + SPACING;
            c.y = topleft.y;
        }
        for (const c of gnode.out_connectors) {
            c.width = LINEHEIGHT;
            c.height = LINEHEIGHT;
            c.x = oconn_x;
            oconn_x += LINEHEIGHT + SPACING;
            c.y = topleft.y + gnode.height;
        }
    });

    sdfg_state.edges.forEach((edge, id) => {
        edge = check_and_redirect_edge(edge, drawn_nodes, sdfg_state);
        if (!edge) return;
        const gedge = g.edge(edge.src, edge.dst, id);
        if (!gedge || (omit_access_nodes && gedge.data.attributes.shortcut === false
            || !omit_access_nodes && gedge.data.attributes.shortcut)) {
            // if access nodes omitted, don't draw non-shortcut edges and vice versa
            return;
        }

        // Reposition first and last points according to connectors
        let src_conn = null, dst_conn = null;
        if (edge.src_connector) {
            const src_node = g.node(edge.src);
            let cindex = -1;
            for (let i = 0; i < src_node.out_connectors.length; i++) {
                if (src_node.out_connectors[i].data.name == edge.src_connector) {
                    cindex = i;
                    break;
                }
            }
            if (cindex >= 0) {
                gedge.points[0].x = src_node.out_connectors[cindex].x;
                gedge.points[0].y = src_node.out_connectors[cindex].y;
                src_conn = src_node.out_connectors[cindex];
            }
        }
        if (edge.dst_connector) {
            const dst_node = g.node(edge.dst);
            let cindex = -1;
            for (let i = 0; i < dst_node.in_connectors.length; i++) {
                if (dst_node.in_connectors[i].data.name == edge.dst_connector) {
                    cindex = i;
                    break;
                }
            }
            if (cindex >= 0) {
                gedge.points[gedge.points.length - 1].x = dst_node.in_connectors[cindex].x;
                gedge.points[gedge.points.length - 1].y = dst_node.in_connectors[cindex].y;
                dst_conn = dst_node.in_connectors[cindex];
            }
        }

        const n = gedge.points.length - 1;
        if (src_conn !== null)
            gedge.points[0] = intersectRect(src_conn, gedge.points[n]);
        if (dst_conn !== null)
            gedge.points[n] = intersectRect(dst_conn, gedge.points[0]);

        if (gedge.points.length == 3 && gedge.points[0].x == gedge.points[n].x)
            gedge.points = [gedge.points[0], gedge.points[n]];

        const bb = calculateEdgeBoundingBox(gedge);
        // Convert from top-left to center
        bb.x += bb.width / 2.0;
        bb.y += bb.height / 2.0;

        edge.width = bb.width;
        edge.height = bb.height;
        edge.x = bb.x;
        edge.y = bb.y;
        gedge.width = bb.width;
        gedge.height = bb.height;
        gedge.x = bb.x;
        gedge.y = bb.y;
    });


    return g;
}
