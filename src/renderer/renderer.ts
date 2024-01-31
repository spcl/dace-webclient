// Copyright 2019-2023 ETH Zurich and the DaCe authors. All rights reserved.

import $ from 'jquery';

import dagre from 'dagre';
import EventEmitter from 'events';
import {
    DagreSDFG,
    GenericSdfgOverlay,
    JsonSDFG,
    JsonSDFGBlock,
    JsonSDFGEdge,
    JsonSDFGNode,
    JsonSDFGState,
    MemoryLocationOverlay,
    MemoryVolumeOverlay,
    ModeButtons,
    Point2D,
    SDFVTooltipFunc,
    SimpleRect,
    checkCompatSave,
    stringify_sdfg
} from '../index';
import { SMLayouter } from '../layouter/state_machine/sm_layouter';
import { LViewLayouter } from '../local_view/lview_layouter';
import { LViewGraphParseError, LViewParser } from '../local_view/lview_parser';
import { LViewRenderer } from '../local_view/lview_renderer';
import { OverlayManager } from '../overlay_manager';
import { LogicalGroupOverlay } from '../overlays/logical_group_overlay';
import { SDFV, reload_file } from '../sdfv';
import {
    boundingBox,
    calculateBoundingBox,
    calculateEdgeBoundingBox
} from '../utils/bounding_box';
import { sdfg_property_to_string } from '../utils/sdfg/display';
import {
    check_and_redirect_edge, deletePositioningInfo, delete_sdfg_nodes,
    delete_sdfg_states, find_exit_for_entry, find_graph_element_by_uuid,
    find_root_sdfg, getPositioningInfo, get_uuid_graph_element
} from '../utils/sdfg/sdfg_utils';
import {
    memlet_tree_complete,
    traverseSDFGScopes
} from '../utils/sdfg/traversal';
import { SDFVSettings } from '../utils/sdfv_settings';
import { deepCopy, intersectRect, showErrorModal } from '../utils/utils';
import { CanvasManager } from './canvas_manager';
import {
    AccessNode, Connector,
    Edge, EntryNode, InterstateEdge, LoopRegion, Memlet, NestedSDFG,
    SDFG,
    SDFGElement,
    SDFGElementType,
    SDFGElements,
    SDFGNode,
    ControlFlowRegion,
    State,
    Tasklet,
    drawSDFG,
    offset_sdfg,
    offset_state
} from './renderer_elements';

// External, non-typescript libraries which are presented as previously loaded
// scripts and global javascript variables:
declare const blobStream: any;
declare const canvas2pdf: any;

// Some global functions and variables which are only accessible within VSCode:
declare const vscode: any | null;

type SDFGElementGroup = 'states' | 'nodes' | 'edges' | 'isedges';
// If type is explicitly set, dagre typecheck fails with integer node ids
export type CFGListType = any[];//{ [key: number]: DagreSDFG };

function check_valid_add_position(
    type: SDFGElementType | null,
    foreground_elem: SDFGElement | undefined | null, lib: any, _mousepos: any
): boolean {
    if (type !== null) {
        switch (type) {
            case SDFGElementType.SDFGState:
                return (foreground_elem instanceof NestedSDFG ||
                    foreground_elem === null);
            case SDFGElementType.Edge:
                return (foreground_elem instanceof SDFGNode ||
                    foreground_elem instanceof State);
            case SDFGElementType.LibraryNode:
                return (foreground_elem instanceof State && lib);
            default:
                return foreground_elem instanceof State;
        }
    }
    return false;
}

export interface SDFGRendererEvent {
    'add_element': (
        type: SDFGElementType, parentUUID: string, lib?: string,
        edgeStartUUID?: string, edgeStartConn?: string, edgeDstConn?: string
    ) => void;
    'query_libnode': (callback: CallableFunction) => void;
    'exit_preview': () => void;
    'collapse_state_changed': (collapsed?: boolean, all?: boolean) => void;
    'element_position_changed': (type?: string) => void;
    'graph_edited': () => void;
    'selection_changed': (multiSelectionChanged: boolean) => void;
    'symbol_definition_changed': (symbol: string, definition?: number) => void;
    'active_overlays_changed': () => void;
    'backend_data_requested': (type: string, overlay: string) => void;
    'settings_changed': (
        settings: Record<string, string | boolean | number>
    ) => void;
}

export interface SDFGRenderer {

    on<U extends keyof SDFGRendererEvent>(
        event: U, listener: SDFGRendererEvent[U]
    ): this;

    emit<U extends keyof SDFGRendererEvent>(
        event: U, ...args: Parameters<SDFGRendererEvent[U]>
    ): boolean;

}

export class SDFGRenderer extends EventEmitter {

    protected cfg_list: any = {};
    protected graph: DagreSDFG | null = null;
    // Parent-pointing SDFG tree.
    protected sdfg_tree: { [key: number]: number } = {};
    // List of all state's parent elements.
    protected state_parent_list: any = {};
    protected in_vscode: boolean = false;
    protected dace_daemon_connected: boolean = false;

    // Rendering related fields.
    protected ctx: CanvasRenderingContext2D | null = null;
    protected canvas: HTMLCanvasElement | null = null;
    protected minimap_ctx: CanvasRenderingContext2D | null = null;
    protected minimap_canvas: HTMLCanvasElement | null = null;
    protected canvas_manager: CanvasManager | null = null;
    protected last_dragged_element: SDFGElement | null = null;
    protected tooltip: SDFVTooltipFunc | null = null;
    protected tooltip_container: HTMLElement | null = null;
    protected overlay_manager: OverlayManager;
    protected bgcolor: string | null = null;
    protected visible_rect: SimpleRect | null = null;
    protected static cssProps: { [key: string]: string } = {};

    // Toolbar related fields.
    protected toolbar: JQuery<HTMLElement> | null = null;
    protected panmode_btn: HTMLElement | null = null;
    protected movemode_btn: HTMLElement | null = null;
    protected selectmode_btn: HTMLElement | null = null;
    protected cutoutBtn: JQuery<HTMLElement> | null = null;
    protected localViewBtn: JQuery<HTMLElement> | null = null;
    protected addmode_btns: HTMLElement[] = [];
    protected add_type: SDFGElementType | null = null;
    protected add_mode_lib: string | null = null;
    protected mode_selected_bg_color: string = '#CCCCCC';
    protected mouse_follow_svgs: any = null;
    protected mouse_follow_element: any = null;
    protected overlays_menu: any = null;

    // Memlet-Tree related fields.
    protected all_memlet_trees_sdfg: Set<any>[] = [];
    protected all_memlet_trees: Set<any>[] = [];

    // Mouse-related fields.
    // Mouse mode - pan, move, select.
    protected mouse_mode: string = 'pan';
    protected box_select_rect: any = null;
    // Last position of the mouse pointer (in canvas coordinates).
    protected mousepos: Point2D | null = null;
    // Last position of the mouse pointer (in pixel coordinates).
    protected realmousepos: Point2D | null = null;
    protected dragging: boolean = false;
    // Null if the mouse/touch is not activated.
    protected drag_start: any = null;
    protected external_mouse_handler: ((...args: any[]) => boolean) | null =
        null;
    protected ctrl_key_selection: boolean = false;
    protected shift_key_movement: boolean = false;
    protected add_position: Point2D | null = null;
    protected add_edge_start: any = null;
    protected add_edge_start_conn: Connector | null = null;

    // Information window fields.
    protected error_popover_container: HTMLElement | null = null;
    protected error_popover_text: HTMLElement | null = null;
    protected interaction_info_box: HTMLElement | null = null;
    protected interaction_info_text: HTMLElement | null = null;
    protected dbg_info_box: HTMLElement | null = null;
    protected dbg_mouse_coords: HTMLElement | null = null;

    // Selection related fields.
    protected selected_elements: SDFGElement[] = [];

    public constructor(
        protected sdfv_instance: SDFV,
        protected sdfg: JsonSDFG,
        protected container: HTMLElement,
        on_mouse_event: ((...args: any[]) => boolean) | null = null,
        user_transform: DOMMatrix | null = null,
        public debug_draw = false,
        background: string | null = null,
        mode_buttons: any = null
    ) {
        super();

        sdfv_instance.enable_menu_close();
        sdfv_instance.close_menu();

        this.external_mouse_handler = on_mouse_event;

        this.overlay_manager = new OverlayManager(this);

        // Register overlays that are turned on by default.
        this.overlay_manager.register_overlay(LogicalGroupOverlay);

        this.in_vscode = false;
        try {
            vscode;
            if (vscode)
                this.in_vscode = true;
        } catch (ex) { }

        this.init_elements(user_transform, background, mode_buttons);

        this.set_sdfg(sdfg, false);

        this.all_memlet_trees_sdfg = memlet_tree_complete(this.sdfg);

        this.update_fast_memlet_lookup();

        this.on('collapse_state_changed', () => {
            this.emit('graph_edited');
        });
        this.on('element_position_changed', () => {
            this.emit('graph_edited');
        });
        this.on('selection_changed', () => {
            this.on_selection_changed();
        });
    }

    public destroy(): void {
        try {
            this.canvas_manager?.destroy();
            if (this.canvas)
                this.container.removeChild(this.canvas);
            if (this.minimap_canvas)
                this.container.removeChild(this.minimap_canvas);
            if (this.toolbar)
                this.container.removeChild(this.toolbar[0]);
            if (this.tooltip_container)
                this.container.removeChild(this.tooltip_container);
            if (this.interaction_info_box)
                this.container.removeChild(this.interaction_info_box);
            if (this.dbg_info_box)
                this.container.removeChild(this.dbg_info_box);
            if (this.error_popover_container)
                this.container.removeChild(this.error_popover_container);
            if (this.mouse_follow_element)
                this.container.removeChild(this.mouse_follow_element);
        } catch (ex) {
            // Do nothing
        }
    }

    public clearCssPropertyCache(): void {
        SDFGRenderer.cssProps = {};
    }

    public getCssProperty(property_name: string): string {
        return SDFGRenderer.getCssProperty(property_name, this.canvas);
    }

    public static getCssProperty(
        property_name: string, canvas?: HTMLElement | null
    ): string {
        if (SDFGRenderer.cssProps[property_name])
            return SDFGRenderer.cssProps[property_name];

        const elem =
            canvas ?? document.getElementsByClassName('sdfg_canvas').item(0);
        if (elem) {
            const prop_val: string = window.getComputedStyle(
                elem
            ).getPropertyValue(property_name).trim();
            SDFGRenderer.cssProps[property_name] = prop_val;
            return prop_val;
        }
        return '';
    }

    public view_settings(): any {
        return {
            inclusive_ranges: SDFVSettings.inclusiveRanges,
            omit_access_nodes: !SDFVSettings.showAccessNodes,
        };
    }

    // Updates buttons based on cursor mode
    public update_toggle_buttons(): void {
        // First clear out of all modes, then jump in to the correct mode.
        if (this.canvas)
            this.canvas.style.cursor = 'default';
        if (this.interaction_info_box)
            this.interaction_info_box.style.display = 'none';
        if (this.interaction_info_text)
            this.interaction_info_text.innerHTML = '';

        if (this.panmode_btn) {
            this.panmode_btn.style.paddingBottom = '0px';
            this.panmode_btn.style.userSelect = 'none';
            this.panmode_btn.classList.remove('selected');
        }
        if (this.movemode_btn) {
            this.movemode_btn.style.paddingBottom = '0px';
            this.movemode_btn.style.userSelect = 'none';
            this.movemode_btn.classList.remove('selected');
        }
        if (this.selectmode_btn) {
            this.selectmode_btn.style.paddingBottom = '0px';
            this.selectmode_btn.style.userSelect = 'none';
            this.selectmode_btn.classList.remove('selected');
        }

        this.mouse_follow_element.innerHTML = null;

        for (const add_btn of this.addmode_btns) {
            const btn_type = add_btn.getAttribute('type');
            if (btn_type === this.add_type && this.add_type) {
                add_btn.style.userSelect = 'none';
                add_btn.classList.add('selected');
                this.mouse_follow_element.innerHTML =
                    this.mouse_follow_svgs[this.add_type];
            } else {
                add_btn.style.userSelect = 'none';
                add_btn.classList.remove('selected');
            }
        }

        switch (this.mouse_mode) {
            case 'move':
                if (this.movemode_btn)
                    this.movemode_btn.classList.add('selected');
                if (this.interaction_info_box)
                    this.interaction_info_box.style.display = 'block';
                if (this.interaction_info_text)
                    this.interaction_info_text.innerHTML =
                        'Middle Mouse: Pan view<br>' +
                        'Right Click: Reset position';
                break;
            case 'select':
                if (this.selectmode_btn)
                    this.selectmode_btn.classList.add('selected');
                if (this.interaction_info_box)
                    this.interaction_info_box.style.display = 'block';
                if (this.interaction_info_text) {
                    if (this.ctrl_key_selection)
                        this.interaction_info_text.innerHTML =
                            'Middle Mouse: Pan view';
                    else
                        this.interaction_info_text.innerHTML =
                            'Shift: Add to selection<br>' +
                            'Ctrl: Remove from selection<br>' +
                            'Middle Mouse: Pan view';
                }
                break;
            case 'add':
                if (this.interaction_info_box)
                    this.interaction_info_box.style.display = 'block';
                if (this.interaction_info_text) {
                    if (this.add_type === 'Edge') {
                        if (this.add_edge_start)
                            this.interaction_info_text.innerHTML =
                                'Left Click: Select second element (to)<br>' +
                                'Middle Mouse: Pan view<br>' +
                                'Right Click / Esc: Abort';
                        else
                            this.interaction_info_text.innerHTML =
                                'Left Click: Select first element (from)<br>' +
                                'Middle Mouse: Pan view<br>' +
                                'Right Click / Esc: Abort';
                    } else {
                        this.interaction_info_text.innerHTML =
                            'Left Click: Place element<br>' +
                            'Ctrl + Left Click: Place and stay in Add ' +
                            'Mode<br>' +
                            'Middle Mouse: Pan view<br>' +
                            'Right Click / Esc: Abort';
                    }
                }
                break;
            case 'pan':
            default:
                if (this.panmode_btn)
                    this.panmode_btn.classList.add('selected');
                break;
        }
    }

    // Initializes the DOM
    public init_elements(
        user_transform: DOMMatrix | null,
        background: string | null,
        mode_buttons: ModeButtons | undefined | null
    ): void {

        this.canvas = document.createElement('canvas');
        this.canvas.classList.add('sdfg_canvas');
        if (background)
            this.canvas.style.backgroundColor = background;
        else
            this.canvas.style.backgroundColor = 'inherit';
        this.container.append(this.canvas);

        if (SDFVSettings.minimap)
            this.enableMinimap();
        else
            this.disableMinimap();

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
        this.interaction_info_box.style.bottom = '.5rem';
        this.interaction_info_box.style.left = '.5rem';
        this.interaction_info_box.style.backgroundColor = 'rgba(0, 0, 0, 0.5)';
        this.interaction_info_box.style.borderRadius = '5px';
        this.interaction_info_box.style.padding = '.3rem';
        this.interaction_info_box.style.display = 'none';
        this.interaction_info_text = document.createElement('span');
        this.interaction_info_text.style.color = '#eeeeee';
        this.interaction_info_text.innerHTML = '';
        this.interaction_info_box.appendChild(this.interaction_info_text);
        this.container.appendChild(this.interaction_info_box);

        if (SDFVSettings.toolbar) {
            // Construct the toolbar.
            this.toolbar = $('<div>', {
                css: {
                    position: 'absolute',
                    top: '10px',
                    left: '10px',
                }
            });
            this.container.appendChild(this.toolbar[0]);

            // Construct menu.
            const menuDropdown = $('<div>', {
                class: 'dropdown',
            });
            $('<button>', {
                class: 'btn btn-light btn-sdfv-light btn-sdfv',
                html: '<i class="material-icons">menu</i>',
                title: 'Menu',
                'data-bs-toggle': 'dropdown',
            }).appendTo(menuDropdown);
            const menu = $('<ul>', {
                class: 'dropdown-menu',
            }).appendTo(menuDropdown);
            $('<div>', {
                class: 'btn-group',
            }).appendTo(this.toolbar).append(menuDropdown);

            $('<li>').appendTo(menu).append($('<span>', {
                class: 'dropdown-item',
                text: 'Save SDFG',
                click: () => this.save_sdfg(),
            }));
            $('<li>').appendTo(menu).append($('<span>', {
                class: 'dropdown-item',
                text: 'Save view as PNG',
                click: () => this.save_as_png(),
            }));
            if (this.has_pdf()) {
                $('<li>').appendTo(menu).append($('<span>', {
                    class: 'dropdown-item',
                    text: 'Save view as PDF',
                    click: () => this.save_as_pdf(false),
                }));
                $('<li>').appendTo(menu).append($('<span>', {
                    class: 'dropdown-item',
                    text: 'Save SDFG as PDF',
                    click: () => this.save_as_pdf(true),
                }));
            }

            $('<li>').appendTo(menu).append($('<hr>', {
                class: 'dropdown-divider',
            }));

            $('<li>').appendTo(menu).append($('<span>', {
                class: 'dropdown-item',
                text: 'Reset positions',
                click: () => this.reset_positions(),
            }));

            // SDFV Options.
            $('<button>', {
                class: 'btn btn-light btn-sdfv-light btn-sdfv',
                html: '<i class="material-icons">settings</i>',
                title: 'Settings',
                click: () => {
                    SDFVSettings.getInstance().show(this);
                },
            }).appendTo(this.toolbar);

            // Overlays menu.
            if (!this.in_vscode) {
                const overlayDropdown = $('<div>', {
                    class: 'dropdown',
                });
                $('<button>', {
                    class: 'btn btn-light btn-sdfv-light btn-sdfv',
                    html: '<i class="material-icons">saved_search</i>',
                    title: 'Overlays',
                    'data-bs-toggle': 'dropdown',
                    'data-bs-auto-close': 'outside',
                }).appendTo(overlayDropdown);
                const overlayMenu = $('<ul>', {
                    class: 'dropdown-menu',
                    css: {
                        'min-width': '200px',
                    },
                }).appendTo(overlayDropdown);
                $('<div>', {
                    class: 'btn-group',
                }).appendTo(this.toolbar).append(overlayDropdown);

                const addOverlayToMenu = (
                    txt: string, ol: typeof GenericSdfgOverlay
                ) => {
                    const olItem = $('<li>', {
                        css: {
                            'padding-left': '.7rem',
                        },
                    }).appendTo(overlayMenu);
                    const olContainer = $('<div>', {
                        class: 'form-check form-switch',
                    }).appendTo(olItem);
                    const olInput = $('<input>', {
                        class: 'form-check-input',
                        type: 'checkbox',
                        change: () => {
                            if (olInput.prop('checked'))
                                this.overlay_manager?.register_overlay(ol);
                            else
                                this.overlay_manager?.deregister_overlay(ol);
                        },
                    }).appendTo(olContainer);
                    $('<label>', {
                        class: 'form-check-label',
                        text: txt,
                    }).appendTo(olContainer);
                };

                addOverlayToMenu('Logical groups', LogicalGroupOverlay);
                addOverlayToMenu('Storage locations', MemoryLocationOverlay);
                addOverlayToMenu(
                    'Logical data movement volume', MemoryVolumeOverlay
                );
            }

            // Zoom to fit.
            $('<button>', {
                class: 'btn btn-light btn-sdfv-light btn-sdfv',
                html: '<i class="material-icons">fit_screen</i>',
                title: 'Zoom to fit SDFG',
                click: () => {
                    this.zoom_to_view();
                },
            }).appendTo(this.toolbar);
            $('<button>', {
                class: 'btn btn-light btn-sdfv-light btn-sdfv',
                html: '<i class="material-symbols-outlined">fit_width</i>',
                title: 'Zoom to fit width',
                click: () => {
                    this.zoomToFitWidth();
                },
            }).appendTo(this.toolbar);

            // Collapse all.
            $('<button>', {
                class: 'btn btn-light btn-sdfv-light btn-sdfv',
                html: '<i class="material-icons">unfold_less</i>',
                title: 'Collapse next level (Shift+click to collapse all)',
                click: (e: MouseEvent) => {
                    if (e.shiftKey) {
                        this.collapse_all();
                    } else {
                        this.collapseNextLevel();
                    }
                },
            }).appendTo(this.toolbar);

            // Expand all.
            $('<button>', {
                class: 'btn btn-light btn-sdfv-light btn-sdfv',
                html: '<i class="material-icons">unfold_more</i>',
                title: 'Expand next level (Shift+click to expand all)',
                click: (e: MouseEvent) => {
                    if (e.shiftKey) {
                        this.expand_all();
                    } else {
                        this.expandNextLevel();
                    }
                },
            }).appendTo(this.toolbar);

            if (mode_buttons) {
                // If we get the "external" mode buttons we are in vscode and do
                // not need to create them.
                this.panmode_btn = mode_buttons.pan;
                this.movemode_btn = mode_buttons.move;
                this.selectmode_btn = mode_buttons.select;
                this.addmode_btns = mode_buttons.add_btns;
                for (const add_btn of this.addmode_btns) {
                    if (add_btn.getAttribute('type') ===
                        SDFGElementType.LibraryNode) {
                        add_btn.onclick = () => {
                            const libnode_callback = () => {
                                this.mouse_mode = 'add';
                                this.add_type = SDFGElementType.LibraryNode;
                                this.add_edge_start = null;
                                this.add_edge_start_conn = null;
                                this.update_toggle_buttons();
                            };
                            this.emit('query_libnode', libnode_callback);
                        };
                    } else {
                        add_btn.onclick = () => {
                            this.mouse_mode = 'add';
                            this.add_type =
                                <SDFGElementType> add_btn.getAttribute('type');
                            this.add_mode_lib = null;
                            this.add_edge_start = null;
                            this.add_edge_start_conn = null;
                            this.update_toggle_buttons();
                        };
                    }
                }
                this.mode_selected_bg_color = '#22A4FE';
            } else {
                // Mode buttons are empty in standalone SDFV.
                this.addmode_btns = [];

                // Enter pan mode.
                this.panmode_btn = $('<button>', {
                    class: 'btn btn-light btn-sdfv-light btn-sdfv selected',
                    html: '<i class="material-icons">pan_tool</i>',
                    title: 'Pan mode',
                }).appendTo(this.toolbar)[0];

                // Enter move mode.
                this.movemode_btn = $('<button>', {
                    class: 'btn btn-light btn-sdfv-light btn-sdfv',
                    html: '<i class="material-icons">open_with</i>',
                    title: 'Object moving mode',
                }).appendTo(this.toolbar)[0];

                // Enter box select mode.
                this.selectmode_btn = $('<button>', {
                    class: 'btn btn-light btn-sdfv-light btn-sdfv',
                    html: '<i class="material-icons">border_style</i>',
                    title: 'Select mode',
                }).appendTo(this.toolbar)[0];
            }

            // Enter pan mode
            if (this.panmode_btn)
                this.panmode_btn.onclick = () => {
                    this.mouse_mode = 'pan';
                    this.add_type = null;
                    this.add_mode_lib = null;
                    this.add_edge_start = null;
                    this.add_edge_start_conn = null;
                    this.update_toggle_buttons();
                };

            // Enter object moving mode
            if (this.movemode_btn) {
                this.movemode_btn.onclick = (
                    _: MouseEvent, shift_click: boolean | undefined = undefined
                ): void => {
                    // shift_click is false if shift key has been released and
                    // undefined if it has been a normal mouse click
                    if (this.shift_key_movement && shift_click === false)
                        this.mouse_mode = 'pan';
                    else
                        this.mouse_mode = 'move';
                    this.add_type = null;
                    this.add_mode_lib = null;
                    this.add_edge_start = null;
                    this.add_edge_start_conn = null;
                    this.shift_key_movement = (
                        shift_click === undefined ? false : shift_click
                    );
                    this.update_toggle_buttons();
                };
            }

            // Enter box selection mode
            if (this.selectmode_btn)
                this.selectmode_btn.onclick = (
                    _: MouseEvent, ctrl_click: boolean | undefined = undefined
                ): void => {
                    // ctrl_click is false if ctrl key has been released and
                    // undefined if it has been a normal mouse click
                    if (this.ctrl_key_selection && ctrl_click === false)
                        this.mouse_mode = 'pan';
                    else
                        this.mouse_mode = 'select';
                    this.add_type = null;
                    this.add_mode_lib = null;
                    this.add_edge_start = null;
                    this.add_edge_start_conn = null;
                    this.ctrl_key_selection = (
                        ctrl_click === undefined ? false : ctrl_click
                    );
                    this.update_toggle_buttons();
                };

            // React to ctrl and shift key presses
            document.addEventListener('keydown', (e) => this.on_key_event(e));
            document.addEventListener('keyup', (e) => this.on_key_event(e));
            document.addEventListener('visibilitychange', () => {
                this.clear_key_events();
            });

            // Filter graph to selection (visual cutout).
            this.cutoutBtn = $('<button>', {
                id: 'cutout-button',
                class: 'btn btn-light btn-sdfv-light btn-sdfv',
                css: {
                    'display': 'none',
                },
                html: '<i class="material-icons">content_cut</i>',
                title: 'Filter selection (cutout)',
                click: () => {
                    this.cutout_selection();
                },
            }).appendTo(this.toolbar);

            // Transition to local view with selection.
            this.localViewBtn = $('<button>', {
                id: 'local-view-button',
                class: 'btn btn-light btn-sdfv-light btn-sdfv',
                css: {
                    'display': 'none',
                },
                html: '<i class="material-icons">memory</i>',
                title: 'Inspect access patterns (local view)',
                click: () => {
                    this.localViewSelection();
                },
            }).appendTo(this.toolbar);

            // Exit previewing mode.
            if (this.in_vscode) {
                const exitPreviewBtn = $('<button>', {
                    id: 'exit-preview-button',
                    class: 'btn btn-light btn-sdfv-light btn-sdfv',
                    css: {
                        'display': 'none',
                    },
                    html: '<i class="material-icons">close</i>',
                    title: 'Exit preview',
                    click: () => {
                        exitPreviewBtn.hide();
                        this.emit('exit_preview');
                    },
                }).appendTo(this.toolbar);
            }
        }

        // Tooltip HTML container
        this.tooltip_container = document.createElement('div');
        this.tooltip_container.innerHTML = '';
        this.tooltip_container.className = 'sdfvtooltip';
        this.tooltip_container.onmouseover = () => {
            if (this.tooltip_container)
                this.tooltip_container.style.display = 'none';
        };
        this.container.appendChild(this.tooltip_container);

        // HTML container for error popovers with invalid SDFGs
        this.error_popover_container = document.createElement('div');
        this.error_popover_container.innerHTML = '';
        this.error_popover_container.className = 'invalid_popup';
        this.error_popover_text = document.createElement('div');
        const error_popover_dismiss = document.createElement('button');
        error_popover_dismiss.onclick = () => {
            this.sdfg.error = undefined;
            if (this.error_popover_container && this.error_popover_text) {
                this.error_popover_text.innerText = '';
                this.error_popover_container.style.display = 'none';
            }
        };
        error_popover_dismiss.style.float = 'right';
        error_popover_dismiss.style.cursor = 'pointer';
        error_popover_dismiss.style.color = 'white';
        error_popover_dismiss.innerHTML = '<i class="material-icons">close</i>';
        this.error_popover_container.appendChild(error_popover_dismiss);
        this.error_popover_container.appendChild(this.error_popover_text);
        this.container.appendChild(this.error_popover_container);

        this.ctx = this.canvas.getContext('2d');
        if (!this.ctx) {
            console.error('Failed to get canvas context, aborting');
            return;
        }

        // Translation/scaling management
        this.canvas_manager = new CanvasManager(this.ctx, this, this.canvas);
        if (user_transform !== null)
            this.canvas_manager.set_user_transform(user_transform);

        // Resize event for container
        const observer = new MutationObserver(() => {
            this.onresize();
            this.draw_async();
        });
        observer.observe(this.container, { attributes: true });
        const resizeObserver = new ResizeObserver(() => {
            this.onresize();
            this.draw_async();
        });
        resizeObserver.observe(this.container);

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

        const svgs: { [key: string]: string } = {};
        svgs['MapEntry'] =
            `<svg width="8rem" height="2rem" viewBox="0 0 800 200" stroke="black" stroke-width="10" version="1.1" xmlns="http://www.w3.org/2000/svg">
                <line x1="10" x2="190" y1="190" y2="10"/>
                <line x1="190" x2="600" y1="10" y2="10"/>
                <line x1="600" x2="790" y1="10" y2="190"/>
                <line x1="790" x2="10" y1="190" y2="190"/>
            </svg>`;
        svgs['ConsumeEntry'] =
            `<svg width="8rem" height="2rem" viewBox="0 0 800 200" stroke="black" stroke-width="10" stroke-dasharray="60,25" version="1.1" xmlns="http://www.w3.org/2000/svg">
                <line x1="10"x2="190" y1="190" y2="10"/>
                <line x1="190" x2="600" y1="10" y2="10"/>
                <line x1="600" x2="790" y1="10" y2="190"/>
                <line x1="790" x2="10" y1="190" y2="190"/>
            </svg>`;
        svgs['Tasklet'] =
            `<svg width="2.6rem" height="1.3rem" viewBox="0 0 400 200" stroke="black" stroke-width="10" version="1.1" xmlns="http://www.w3.org/2000/svg">
                <line x1="10" x2="70" y1="130" y2="190"/>
                <line x1="70" x2="330" y1="190" y2="190"/>
                <line x1="330" x2="390" y1="190" y2="130"/>
                <line x1="390" x2="390" y1="130" y2="70"/>
                <line x1="390" x2="330" y1="70" y2="10"/>
                <line x1="330" x2="70" y1="10" y2="10"/>
                <line x1="70" x2="10" y1="10" y2="70"/>
                <line x1="10" x2="10" y1="70" y2="130"/>
            </svg>`;
        svgs['NestedSDFG'] =
            `<svg width="2.6rem" height="1.3rem" viewBox="0 0 400 200" stroke="black" stroke-width="10" version="1.1" xmlns="http://www.w3.org/2000/svg">
                <line x1="40" x2="80" y1="120" y2="160"/>
                <line x1="80" x2="320" y1="160" y2="160"/>
                <line x1="320" x2="360" y1="160" y2="120"/>
                <line x1="360" x2="360" y1="120" y2="80"/>
                <line x1="360" x2="320" y1="80" y2="40"/>
                <line x1="320" x2="80" y1="40" y2="40"/>
                <line x1="80" x2="40" y1="40" y2="80"/>
                <line x1="40" x2="40" y1="80" y2="120"/>

                <line x1="10" x2="70" y1="130" y2="190"/>
                <line x1="70" x2="330" y1="190" y2="190"/>
                <line x1="330" x2="390" y1="190" y2="130"/>
                <line x1="390" x2="390" y1="130" y2="70"/>
                <line x1="390" x2="330" y1="70" y2="10"/>
                <line x1="330" x2="70" y1="10" y2="10"/>
                <line x1="70" x2="10" y1="10" y2="70"/>
                <line x1="10" x2="10" y1="70" y2="130"/>
            </svg>`;
        svgs['LibraryNode'] =
            `<svg width="2.6rem" height="1.3rem" viewBox="0 0 400 200" stroke="white" stroke-width="10" version="1.1" xmlns="http://www.w3.org/2000/svg">
                        <line x1="10" x2="10" y1="10" y2="190"/>
                        <line x1="10" x2="390" y1="190" y2="190"/>
                        <line x1="390" x2="390" y1="190" y2="55"/>
                        <line x1="390" x2="345" y1="55" y2="10"/>
                        <line x1="345" x2="10" y1="10" y2="10"/>
                        <line x1="345" x2="345" y1="10" y2="55"/>
                        <line x1="345" x2="390" y1="55" y2="55"/>
            </svg>`;
        svgs['AccessNode'] =
            `<svg width="1.3rem" height="1.3rem" viewBox="0 0 200 200" stroke="black" stroke-width="10" version="1.1" xmlns="http://www.w3.org/2000/svg">
                <circle cx="100" cy="100" r="90" fill="none"/>
            </svg>`;
        svgs['Stream'] =
            `<svg width="1.3rem" height="1.3rem" viewBox="0 0 200 200" stroke="black" stroke-width="10" version="1.1" xmlns="http://www.w3.org/2000/svg">
                <circle cx="100" cy="100" r="90" fill="none" stroke-dasharray="60,25"/>
            </svg>`;
        svgs['SDFGState'] =
            `<svg width="1.3rem" height="1.3rem" viewBox="0 0 200 200" stroke="black" stroke-width="10" version="1.1" xmlns="http://www.w3.org/2000/svg">
                <rect x="20" y="20" width="160" height="160" style="fill:#deebf7;" />
            </svg>`;
        svgs['Connector'] =
            `<svg width="1.3rem" height="1.3rem" viewBox="0 0 200 200" stroke="white" stroke-width="10" version="1.1" xmlns="http://www.w3.org/2000/svg">
                <circle cx="100" cy="100" r="40" fill="none"/>
            </svg>`;
        svgs['Edge'] =
            `<svg width="1.3rem" height="1.3rem" viewBox="0 0 200 200" stroke="white" stroke-width="10" version="1.1" xmlns="http://www.w3.org/2000/svg">
                <defs>
                    <marker id="arrowhead" markerWidth="10" markerHeight="7"  refX="0" refY="3.5" orient="auto">
                        <polygon points="0 0, 10 3.5, 0 7" />
                    </marker>
                </defs>
                <line x1="20" y1="20" x2="180" y2="180" marker-end="url(#arrowhead)" />
            </svg>`;

        const el = document.createElement('div');
        el.style.position = 'absolute';
        el.style.top = '0px';
        el.style.left = '0px';
        el.style.userSelect = 'none';
        el.style.pointerEvents = 'none';

        this.container.appendChild(el);

        this.mouse_follow_element = el;
        this.mouse_follow_svgs = svgs;

        this.update_toggle_buttons();

        // Queue first render
        this.draw_async();
    }

    public draw_async(): void {
        this.clearCssPropertyCache();
        this.canvas_manager?.draw_async();
    }

    public set_sdfg(new_sdfg: JsonSDFG, layout: boolean = true): void {
        this.sdfg = new_sdfg;

        if (layout) {
            this.relayout();
            this.draw_async();
        }

        // Update info box
        if (this.selected_elements.length === 1) {
            const uuid = get_uuid_graph_element(this.selected_elements[0]);
            if (this.graph)
                this.sdfv_instance.fill_info(
                    find_graph_element_by_uuid(this.graph, uuid).element
                );
        }

        // Update SDFG metadata
        this.sdfg_tree = {};
        this.for_all_sdfg_elements(
            (otype: SDFGElementGroup, odict: any, obj: any) => {
                if (obj.type === SDFGElementType.NestedSDFG &&
                    obj.attributes.sdfg)
                    this.sdfg_tree[obj.attributes.sdfg.cfg_list_id] =
                        odict.sdfg.cfg_list_id;
            }
        );
    }

    // Set mouse events (e.g., click, drag, zoom)
    public set_mouse_handlers(): void {
        const canvas = this.canvas;
        const br = () => canvas?.getBoundingClientRect();

        const comp_x = (event: any): number | undefined => {
            const left = br()?.left;
            return this.canvas_manager?.mapPixelToCoordsX(
                event.clientX - (left ? left : 0)
            );
        };
        const comp_y = (event: any): number | undefined => {
            const top = br()?.top;
            return this.canvas_manager?.mapPixelToCoordsY(
                event.clientY - (top ? top : 0)
            );
        };

        // Mouse handler event types
        for (const evtype of [
            'mousedown', 'mousemove', 'mouseup', 'touchstart', 'touchmove',
            'touchend', 'wheel', 'click', 'dblclick', 'contextmenu'
        ]) {
            canvas?.addEventListener(evtype, x => {
                const cancelled = this.on_mouse_event(
                    x, comp_x, comp_y, evtype
                );
                if (cancelled)
                    return;
                if (!this.in_vscode) {
                    x.stopPropagation();
                    x.preventDefault();
                }
            });
        }
    }

    public onresize(): void {
        // Set canvas size
        if (this.canvas) {
            this.canvas.style.width = '99%';
            this.canvas.style.height = '99%';
            this.canvas.width = this.canvas.offsetWidth;
            this.canvas.height = this.canvas.offsetHeight;
        }
    }

    // Update memlet tree collection for faster lookup
    public update_fast_memlet_lookup(): void {
        this.all_memlet_trees = [];
        for (const tree of this.all_memlet_trees_sdfg) {
            const s = new Set<any>();
            for (const edge of tree) {
                s.add(edge.attributes.data.edge);
            }
            this.all_memlet_trees.push(s);
        }
    }

    // Re-layout graph and nested graphs
    public relayout(): DagreSDFG {
        if (!this.ctx)
            throw new Error('No context found while performing layouting');

        this.cfg_list = {};
        this.graph = relayoutStateMachine(
            this.ctx, this.sdfg, this.sdfg, this.cfg_list,
            this.state_parent_list, !SDFVSettings.showAccessNodes, undefined
        );
        this.onresize();

        this.update_fast_memlet_lookup();

        // Move the elements based on its positioning information
        this.translateMovedElements();

        // Make sure all visible overlays get recalculated if there are any.
        if (this.overlay_manager !== null)
            this.overlay_manager.refresh();

        // If we're in a VSCode context, we also want to refresh the outline.
        if (this.in_vscode)
            this.sdfv_instance.outline(this, this.graph);

        return this.graph;
    }

    public translateMovedElements(): void {
        if (!this.graph)
            return;

        traverseSDFGScopes(this.graph, (node: any, graph: any) => {
            let scope_dx = 0;
            let scope_dy = 0;

            function addScopeMovement(n: any) {
                if (n.data.node.scope_entry) {
                    const scope_entry_node = graph.node(
                        n.data.node.scope_entry
                    );
                    const sp = getPositioningInfo(scope_entry_node);
                    if (sp && Number.isFinite(sp.scope_dx) &&
                        Number.isFinite(sp.scope_dy)) {
                        scope_dx += sp.scope_dx;
                        scope_dy += sp.scope_dy;
                    }
                    if (scope_entry_node) {
                        addScopeMovement(scope_entry_node);
                    }
                }
            }

            // Only add scope movement for nodes (and not states)
            if (node instanceof SDFGNode)
                addScopeMovement(node);

            let dx = scope_dx;
            let dy = scope_dy;

            const position = getPositioningInfo(node);
            if (position) {
                dx += position.dx;
                dy += position.dy;
            }

            if (dx || dy) {
                // Move the element
                if (this.graph)
                    this.canvas_manager?.translate_element(
                        node, { x: node.x, y: node.y },
                        { x: node.x + dx, y: node.y + dy }, this.graph,
                        this.cfg_list, this.state_parent_list, undefined, false
                    );
            }

            // Move edges (outgoing only)
            graph.inEdges(node.id)?.forEach((e_id: number) => {
                const edge = graph.edge(e_id);
                const edge_pos = getPositioningInfo(edge);

                let final_pos_d;
                // If edges are moved within a given scope, update the point
                // movements
                if (scope_dx || scope_dy) {
                    final_pos_d = [];
                    // never move first (and last) point manually
                    final_pos_d.push({ dx: 0, dy: 0 });
                    for (let i = 1; i < edge.points.length - 1; i++) {
                        final_pos_d.push({ dx: scope_dx, dy: scope_dy });
                        if (edge_pos?.points) {
                            final_pos_d[i].dx += edge_pos.points[i].dx;
                            final_pos_d[i].dx += edge_pos.points[i].dy;
                        }
                    }
                    // never move last (and first) point manually
                    final_pos_d.push({ dx: 0, dy: 0 });
                } else if (edge_pos?.points) {
                    final_pos_d = edge_pos.points;
                }
                if (final_pos_d) {
                    // Move the element
                    if (this.graph)
                        this.canvas_manager?.translate_element(
                            edge, { x: 0, y: 0 },
                            { x: 0, y: 0 }, this.graph, this.cfg_list,
                            this.state_parent_list, undefined, false, false,
                            final_pos_d
                        );
                }
            });
            return true;
        });
    }

    // Change translation and scale such that the chosen elements
    // (or entire graph if null) is in view
    public zoom_to_view(
        elements: any = null, animate: boolean = true, padding?: number
    ): void {
        if (!elements || elements.length === 0) {
            elements = this.graph?.nodes().map(x => this.graph?.node(x));
            padding ??= 0;
        } else {
            // Use a padding equal to 20 percent of the viewport size, if not
            // overridden with a different percentage.
            padding ??= 10;
        }

        let paddingAbs = 0;
        if (padding > 0 && this.canvas)
            paddingAbs = Math.min(
                (this.canvas.width / 100) * padding,
                (this.canvas.height / 100) * padding
            );

        const bb = boundingBox(elements, paddingAbs);
        this.canvas_manager?.set_view(bb, animate);

        this.draw_async();
    }

    public zoomToFitWidth(): void {
        const allElems: dagre.Node<SDFGElement>[] = [];
        this.graph?.nodes().forEach((stateId) => {
            const state = this.graph?.node(stateId);
            if (state)
                allElems.push(state);
        });
        const bb = boundingBox(allElems, 0);

        const startX = bb.left;
        const endX = bb.right;
        let centerY;
        if (this.visible_rect) {
            const currStartY = this.visible_rect.y;
            centerY = currStartY + (this.visible_rect.h / 2);
        } else {
            return;
        }

        const viewBB = new DOMRect(startX, centerY, endX - startX, 1);

        this.canvas_manager?.set_view(viewBB, true);

        this.draw_async();
    }

    public collapseNextLevel(): void {
        if (!this.graph)
            return;

        function recursiveCollapse(
            scopeNode: NestedSDFG | EntryNode | State,
            parent: DagreSDFG
        ): boolean {
            if (scopeNode.attributes().is_collapsed)
                return false;
            let collapsedSomething = false;
            const scopeNodes = [];
            let nParent = parent;
            if (scopeNode instanceof NestedSDFG) {
                for (const nid of scopeNode.data.graph.nodes())
                    scopeNodes.push(scopeNode.data.graph.node(nid));
                nParent = scopeNode.data.graph;
            } else if (scopeNode instanceof State) {
                const scopeNodeIds = scopeNode.data.state.scope_dict[-1];
                for (const nid of scopeNodeIds)
                    scopeNodes.push(scopeNode.data.graph.node(nid));
                nParent = scopeNode.data.graph;
            } else {
                const parentState = scopeNode.sdfg.nodes[scopeNode.parent_id!];
                const scopeNodeIds = parentState.scope_dict[scopeNode.id];
                for (const nid of scopeNodeIds)
                    scopeNodes.push(parent.node(nid.toString()));
            }

            for (const node of scopeNodes) {
                if (node instanceof NestedSDFG || node instanceof State ||
                    node instanceof EntryNode) {
                    const recursiveRes = recursiveCollapse(node, nParent);
                    collapsedSomething ||= recursiveRes;
                }
            }

            if (!collapsedSomething)
                scopeNode.attributes().is_collapsed = true;
            return true;
        }

        let collapsed = false;
        for (const sId of this.graph.nodes()) {
            const state = this.graph.node(sId);
            const res = recursiveCollapse(state, this.graph);
            collapsed ||= res;
        }

        if (collapsed) {
            this.emit('collapse_state_changed', false, true);

            this.relayout();
            this.draw_async();
        }
    }

    public collapse_all(): void {
        this.for_all_sdfg_elements(
            (_t: SDFGElementGroup, _d: any, obj: any) => {
                if ('is_collapsed' in obj.attributes &&
                    !obj.type.endsWith('Exit'))
                    obj.attributes.is_collapsed = true;
            }
        );

        this.emit('collapse_state_changed', true, true);

        this.relayout();
        this.draw_async();
    }

    public expandNextLevel(): void {
        if (!this.graph)
            return;

        traverseSDFGScopes(
            this.graph, (node: SDFGNode, _: DagreSDFG) => {
                if(node.attributes().is_collapsed) {
                    node.attributes().is_collapsed = false;
                    return false;
                }
                return true;
            }
        );

        this.emit('collapse_state_changed', false, true);

        this.relayout();
        this.draw_async();
    }

    public expand_all(): void {
        this.for_all_sdfg_elements(
            (_t: SDFGElementGroup, _d: any, obj: any) => {
                if ('is_collapsed' in obj.attributes &&
                    !obj.type.endsWith('Exit'))
                    obj.attributes.is_collapsed = false;
            }
        );

        this.emit('collapse_state_changed', false, true);

        this.relayout();
        this.draw_async();
    }

    public reset_positions(): void {
        this.for_all_sdfg_elements(
            (_t: SDFGElementGroup, _d: any, obj: any) => {
                deletePositioningInfo(obj);
            }
        );

        this.emit('element_position_changed', 'reset');

        this.relayout();
        this.draw_async();
    }

    // Save functions
    public save(filename: string, contents: string | undefined): void {
        if (!contents)
            return;
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

    public save_sdfg(): void {
        const name = this.sdfg.attributes.name;
        const sdfgString = stringify_sdfg(checkCompatSave(this.sdfg));
        const contents = 'data:text/json;charset=utf-8,' + encodeURIComponent(
            sdfgString
        );
        this.save(name + '.sdfg', contents);
    }

    public save_as_png(): void {
        const name = this.sdfg.attributes.name;
        this.save(name + '.png', this.canvas?.toDataURL('image/png'));
    }

    public has_pdf(): boolean {
        try {
            blobStream;
            canvas2pdf.PdfContext;
            return true;
        } catch (e) {
            return false;
        }
    }

    public save_as_pdf(save_all = false): void {
        const stream = blobStream();

        // Compute document size
        const curx = this.canvas_manager?.mapPixelToCoordsX(0);
        const cury = this.canvas_manager?.mapPixelToCoordsY(0);
        let size;
        if (save_all) {
            // Get size of entire graph
            const elements: SDFGElement[] = [];
            this.graph?.nodes().forEach((n_id: string) => {
                const node = this.graph?.node(n_id);
                if (node)
                    elements.push(node);
            });
            const bb = boundingBox(elements);
            size = [bb.width, bb.height];
        } else {
            // Get size of current view
            const canvasw = this.canvas?.width;
            const canvash = this.canvas?.height;
            let endx = null;
            if (canvasw)
                endx = this.canvas_manager?.mapPixelToCoordsX(canvasw);
            let endy = null;
            if (canvash)
                endy = this.canvas_manager?.mapPixelToCoordsY(canvash);
            const curw = (endx ? endx : 0) - (curx ? curx : 0);
            const curh = (endy ? endy : 0) - (cury ? cury : 0);
            size = [curw, curh];
        }
        //

        const ctx = new canvas2pdf.PdfContext(stream, {
            size: size
        });
        const oldctx = this.ctx;
        this.ctx = ctx;
        (this.ctx as any).lod = !save_all;
        (this.ctx as any).pdf = true;
        // Center on saved region
        if (!save_all)
            this.ctx?.translate(-(curx ? curx : 0), -(cury ? cury : 0));

        this.draw_async();

        ctx.stream.on('finish', () => {
            const name = this.sdfg.attributes.name;
            this.save(name + '.pdf', ctx.stream.toBlobURL('application/pdf'));
            this.ctx = oldctx;
            this.draw_async();
        });
    }

    // Draw a debug grid on the canvas to indicate coordinates.
    public debug_draw_grid(
        curx: number, cury: number, endx: number, endy: number,
        grid_width: number = 100
    ): void {
        if (!this.ctx)
            return;

        const lim_x_min = Math.floor(curx / grid_width) * grid_width;
        const lim_x_max = Math.ceil(endx / grid_width) * grid_width;
        const lim_y_min = Math.floor(cury / grid_width) * grid_width;
        const lim_y_max = Math.ceil(endy / grid_width) * grid_width;
        for (let i = lim_x_min; i <= lim_x_max; i += grid_width) {
            this.ctx.moveTo(i, lim_y_min);
            this.ctx.lineTo(i, lim_y_max);
        }
        for (let i = lim_y_min; i <= lim_y_max; i += grid_width) {
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

    private clear_minimap(): void {
        if (this.minimap_ctx) {
            this.minimap_ctx.save();

            this.minimap_ctx.setTransform(1, 0, 0, 1, 0, 0);
            this.minimap_ctx.clearRect(
                0, 0, this.minimap_ctx.canvas.width,
                this.minimap_ctx.canvas.height
            );

            this.minimap_ctx.restore();
        }
    }

    private on_minimap_click(mouse_event: MouseEvent): void {
        if (!this.minimap_canvas || !this.visible_rect)
            return;

        // Get target offset from graph center in minimap coordinates.
        const centerX = this.minimap_canvas.width / 2;
        const centerY = this.minimap_canvas.height / 2;
        const minimapCenterOffset = {
            x: mouse_event.offsetX - centerX,
            y: mouse_event.offsetY - centerY,
        };

        // Translate minimap coordinate center offset to graph canvas center
        // offset.
        const graphBoundingBox = {
            x: 0,
            y: 0,
            width: (this.graph as any).width,
            height: (this.graph as any).height,
        };
        const scale = Math.min(
            this.minimap_canvas.width / graphBoundingBox.width,
            this.minimap_canvas.height / graphBoundingBox.height
        );
        const targetCenterOffset = {
            x: minimapCenterOffset.x * (1 / scale),
            y: minimapCenterOffset.y * (1 / scale),
        };
        const targetPos = {
            x: (graphBoundingBox.width / 2) + targetCenterOffset.x,
            y: (graphBoundingBox.height / 2) + targetCenterOffset.y,
        };

        this.moveViewTo(targetPos.x, targetPos.y);
    }

    private draw_minimap(): void {
        if (!this.minimap_ctx || !this.minimap_canvas ||
            !this.canvas || !this.graph)
            return;

        // Ensure the minimap isn't taking up too much screen realestate.
        const minDimSize = 180;
        let targetWidth = minDimSize;
        let targetHeight = minDimSize;
        const maxPercentage = 0.22;
        if (targetHeight > this.canvas.height * maxPercentage)
            targetHeight = this.canvas.height * maxPercentage;
        if (targetWidth > this.canvas.width * maxPercentage)
            targetWidth = this.canvas.width * maxPercentage;
        this.minimap_canvas.height = targetHeight;
        this.minimap_canvas.width = targetWidth;
        this.minimap_canvas.style.width = targetWidth.toString() + 'px';
        this.minimap_canvas.style.height = targetHeight.toString() + 'px';

        // Set the zoom level and translation so everything is visible.
        const bb = {
            x: 0,
            y: 0,
            width: (this.graph as any).width,
            height: (this.graph as any).height,
        };
        const scale = Math.min(
            targetWidth / bb.width, targetHeight / bb.height
        );
        const originX = (targetWidth / 2) - ((bb.width / 2) + bb.x) * scale;
        const originY = (targetHeight / 2) - ((bb.height / 2) + bb.y) * scale;
        this.minimap_ctx.setTransform(
            scale, 0, 0,
            scale, originX, originY
        );

        // Draw the top-level state machine on to the minimap.
        this.graph.nodes().forEach(x => {
            const n = this.graph?.node(x);
            if (n && this.minimap_ctx)
                n.simple_draw(this, this.minimap_ctx, undefined);
        });
        this.graph.edges().forEach(x => {
            const e = this.graph?.edge(x);
            if (e && this.minimap_ctx)
                e.draw(this, this.minimap_ctx, undefined);
        });

        // Draw the viewport.
        if (this.visible_rect) {
            this.minimap_ctx.strokeStyle = this.getCssProperty(
                '--color-minimap-viewport'
            );
            this.minimap_ctx.lineWidth = 1 / scale;
            this.minimap_ctx.strokeRect(
                this.visible_rect.x, this.visible_rect.y,
                this.visible_rect.w, this.visible_rect.h
            );
        }
    }

    public disableMinimap(): void {
        this.minimap_canvas?.remove();
        this.minimap_canvas = null;
        this.minimap_ctx = null;
    }

    public enableMinimap(): void {
        this.minimap_canvas = document.createElement('canvas');
        this.minimap_canvas.addEventListener('click', (ev) => {
            this.on_minimap_click(ev);
        });
        this.minimap_canvas.id = 'minimap';
        this.minimap_canvas.classList.add('sdfg_canvas');
        this.minimap_canvas.style.backgroundColor = 'white';
        this.minimap_ctx = this.minimap_canvas.getContext('2d');
        this.container.append(this.minimap_canvas);
    }

    // Render SDFG
    public draw(_dt: number | null): void {
        if (!this.graph || !this.ctx)
            return;

        const ctx = this.ctx;
        const g = this.graph;
        const curx = this.canvas_manager?.mapPixelToCoordsX(0);
        const cury = this.canvas_manager?.mapPixelToCoordsY(0);
        const canvasw = this.canvas?.width;
        const canvash = this.canvas?.height;
        let endx = null;
        if (canvasw)
            endx = this.canvas_manager?.mapPixelToCoordsX(canvasw);
        let endy = null;
        if (canvash)
            endy = this.canvas_manager?.mapPixelToCoordsY(canvash);
        const curw = (endx ? endx : 0) - (curx ? curx : 0);
        const curh = (endy ? endy : 0) - (cury ? cury : 0);

        this.visible_rect = {
            x: curx ? curx : 0,
            y: cury ? cury : 0,
            w: curw,
            h: curh
        };

        this.on_pre_draw();

        drawSDFG(this, ctx, g, this.mousepos ?? undefined);

        if (this.box_select_rect) {
            this.ctx.beginPath();
            const old_line_width = this.ctx.lineWidth;
            const new_line_width = this.canvas_manager?.points_per_pixel();
            if (new_line_width !== undefined)
                this.ctx.lineWidth = new_line_width;
            this.ctx.strokeStyle = 'grey';
            this.ctx.rect(
                this.box_select_rect.x_start, this.box_select_rect.y_start,
                this.box_select_rect.x_end - this.box_select_rect.x_start,
                this.box_select_rect.y_end - this.box_select_rect.y_start
            );
            this.ctx.stroke();
            this.ctx.lineWidth = old_line_width;
        }

        if (this.debug_draw) {
            this.debug_draw_grid(
                (curx ? curx : 0),
                (cury ? cury : 0),
                (endx ? endx : 0),
                (endy ? endy : 0),
                100
            );

            if (this.dbg_mouse_coords) {
                if (this.mousepos) {
                    this.dbg_mouse_coords.innerText =
                        'x: ' + Math.floor(this.mousepos.x) +
                        ' / y: ' + Math.floor(this.mousepos.y);
                } else {
                    this.dbg_mouse_coords.innerText = 'x: N/A / y: N/A';
                }
            }
        }

        this.on_post_draw();
    }

    public on_pre_draw(): void {
        this.clear_minimap();
    }

    public on_post_draw(): void {
        if (this.overlay_manager !== null)
            this.overlay_manager.draw();

        this.draw_minimap();

        try {
            (this.ctx as any).end();
        } catch (ex) {
            // TODO: make sure no error is thrown instead of catching and
            // silently ignoring it?
        }

        if (this.tooltip && this.realmousepos) {
            const br = this.canvas?.getBoundingClientRect();
            const pos = {
                x: this.realmousepos.x - (br ? br.x : 0),
                y: this.realmousepos.y - (br ? br.y : 0),
            };

            if (this.tooltip_container) {
                // Clear style and contents
                this.tooltip_container.style.top = '';
                this.tooltip_container.style.left = '';
                this.tooltip_container.innerHTML = '';
                this.tooltip_container.style.display = 'block';

                // Invoke custom container
                this.tooltip(this.tooltip_container);

                // Make visible near mouse pointer
                this.tooltip_container.style.top = pos.y + 'px';
                this.tooltip_container.style.left = (pos.x + 20) + 'px';
            }
        } else {
            if (this.tooltip_container)
                this.tooltip_container.style.display = 'none';
        }

        if (this.sdfg.error && this.graph) {
            // If the popover is already shown, skip this to save on compute.
            if (this.error_popover_container?.style.display !== 'block') {
                const error = this.sdfg.error;

                let state_id = -1;
                let el_id = -1;
                if (error.isedge_id !== undefined) {
                    el_id = error.isedge_id;
                } else if (error.state_id !== undefined) {
                    state_id = error.state_id;
                    if (error.node_id !== undefined)
                        el_id = error.node_id;
                    else if (error.edge_id !== undefined)
                        el_id = error.edge_id;
                }
                const sdfg_id = error.sdfg_id ?? 0;
                const offending_element = find_graph_element_by_uuid(
                    this.graph, sdfg_id + '/' + state_id + '/' + el_id + '/-1'
                );
                if (offending_element) {
                    if (offending_element.element)
                        this.zoom_to_view([offending_element.element]);
                    else
                        this.zoom_to_view([]);

                    if (this.error_popover_container) {
                        this.error_popover_container.style.display = 'block';
                        this.error_popover_container.style.bottom = '5%';
                        this.error_popover_container.style.left = '5%';
                    }

                    if (this.error_popover_text && error.message)
                        this.error_popover_text.innerText = error.message;
                }
            }
        } else {
            if (this.error_popover_container)
                this.error_popover_container.style.display = 'none';
        }
    }

    public moveViewTo(x: number, y: number): void {
        if (!this.visible_rect)
            return;
        const targetRect = new DOMRect(
            x - (this.visible_rect.w / 2), y - (this.visible_rect.h / 2),
            this.visible_rect.w, this.visible_rect.h
        );
        this.canvas_manager?.set_view(targetRect, true);
        this.draw_async();
    }

    public visible_elements(): {
        type: string,
        state_id: number,
        sdfg_id: number,
        id: number,
    }[] {
        if (!this.canvas_manager)
            return [];

        const curx = this.canvas_manager.mapPixelToCoordsX(0);
        const cury = this.canvas_manager.mapPixelToCoordsY(0);
        const canvasw = this.canvas?.width;
        const canvash = this.canvas?.height;
        let endx = null;
        if (canvasw)
            endx = this.canvas_manager.mapPixelToCoordsX(canvasw);
        let endy = null;
        if (canvash)
            endy = this.canvas_manager.mapPixelToCoordsY(canvash);
        const curw = (endx ? endx : 0) - curx;
        const curh = (endy ? endy : 0) - cury;
        const elements: any[] = [];
        this.doForIntersectedElements(
            curx, cury, curw, curh,
            (type: any, e: any, _obj: any) => {
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
            }
        );
        return elements;
    }

    public doForVisibleElements(func: CallableFunction): void {
        if (!this.canvas_manager)
            return;

        const curx = this.canvas_manager.mapPixelToCoordsX(0);
        const cury = this.canvas_manager.mapPixelToCoordsY(0);
        const canvasw = this.canvas?.width;
        const canvash = this.canvas?.height;
        let endx = null;
        if (canvasw)
            endx = this.canvas_manager.mapPixelToCoordsX(canvasw);
        let endy = null;
        if (canvash)
            endy = this.canvas_manager.mapPixelToCoordsY(canvash);
        const curw = (endx ? endx : 0) - curx;
        const curh = (endy ? endy : 0) - cury;
        this.doForIntersectedElements(curx, cury, curw, curh, func);
    }

    // Returns a dictionary of SDFG elements in a given rectangle. Used for
    // selection, rendering, localized transformations, etc.
    // The output is a dictionary of lists of dictionaries. The top-level keys
    // are:
    // states, nodes, connectors, edges, isedges (interstate edges).
    // For example:
    // {
    //  'states': [{sdfg: sdfg_name, state: 1}, ...],
    //  'nodes': [sdfg: sdfg_name, state: 1, node: 5],
    //  'edges': [],
    //  'isedges': [],
    //  'connectors': [],
    // }
    public elements_in_rect(x: number, y: number, w: number, h: number): any {
        const elements: any = {
            states: [], nodes: [], connectors: [],
            edges: [], isedges: []
        };
        this.doForIntersectedElements(
            x, y, w, h, (type: string, e: any, obj: any) => {
                e.obj = obj;
                elements[type].push(e);
            }
        );
        return elements;
    }

    public doForIntersectedElements(
        x: number, y: number, w: number, h: number, func: CallableFunction
    ): void {
        if (!this.graph)
            return;

        // Traverse nested SDFGs recursively.
        function traverseRecursive(
            g: DagreSDFG, sdfgName: string, sdfgId: number
        ): void {
            g.nodes().forEach((blockId: string) => {
                const block: dagre.Node<SDFGElement> = g.node(blockId);
                if (!block)
                    return;

                if (block.intersect(x, y, w, h)) {
                    // States
                    func(
                        'states',
                        {
                            sdfg: sdfgName, sdfg_id: sdfgId, id: blockId
                        },
                        block
                    );

                    if (block.attributes().is_collapsed)
                        return;

                    const ng = block.data.graph;
                    if (!ng)
                        return;

                    if (block.type() === SDFGElementType.SDFGState) {
                        ng.nodes().forEach((node_id: string) => {
                            const node = ng.node(node_id);
                            if (node.intersect(x, y, w, h)) {
                                // Selected nodes
                                func(
                                    'nodes',
                                    {
                                        sdfg: sdfgName, sdfg_id: sdfgId,
                                        state: blockId, id: node_id
                                    },
                                    node
                                );

                                // If nested SDFG, traverse recursively
                                if (node.data.node.type ===
                                    SDFGElementType.NestedSDFG &&
                                    node.attributes().sdfg)
                                    traverseRecursive(
                                        node.data.graph,
                                        node.attributes().sdfg.attributes.name,
                                        node.attributes().sdfg.cfg_list_id
                                    );
                            }
                            // Connectors
                            node.in_connectors.forEach(
                                (c: Connector, i: number) => {
                                    if (c.intersect(x, y, w, h))
                                        func(
                                            'connectors',
                                            {
                                                sdfg: sdfgName, sdfg_id: sdfgId,
                                                state: blockId, node: node_id,
                                                connector: i, conntype: 'in'
                                            },
                                            c
                                        );
                                }
                            );
                            node.out_connectors.forEach(
                                (c: Connector, i: number) => {
                                    if (c.intersect(x, y, w, h))
                                        func(
                                            'connectors',
                                            {
                                                sdfg: sdfgName, sdfg_id: sdfgId,
                                                state: blockId, node: node_id,
                                                connector: i, conntype: 'out'
                                            },
                                            c
                                        );
                                }
                            );
                        });

                        // Selected edges
                        ng.edges().forEach((edge_id: number) => {
                            const edge = ng.edge(edge_id);
                            if (edge.intersect(x, y, w, h)) {
                                func(
                                    'edges',
                                    {
                                        sdfg: sdfgName, sdfg_id: sdfgId,
                                        state: blockId, id: edge.id
                                    },
                                    edge
                                );
                            }
                        });
                    } else {
                        traverseRecursive(block.data.graph, sdfgName, sdfgId);
                    }
                }
            });

            // Selected inter-state edges
            g.edges().forEach(isedge_id => {
                const isedge = g.edge(isedge_id);
                if (isedge.intersect(x, y, w, h)) {
                    func(
                        'isedges',
                        {
                            sdfg: sdfgName, sdfg_id: sdfgId, id: isedge.id
                        },
                        isedge
                    );
                }
            });
        }

        // Start with top-level SDFG.
        traverseRecursive(
            this.graph, this.sdfg.attributes.name, this.sdfg.cfg_list_id
        );
    }

    public for_all_sdfg_elements(func: CallableFunction): void {
        // Traverse nested SDFGs recursively
        function traverse_recursive(sdfg: JsonSDFG) {
            sdfg.nodes.forEach((state: JsonSDFGState, state_id: number) => {
                // States
                func('states', { sdfg: sdfg, id: state_id }, state);

                state.nodes.forEach((node: JsonSDFGNode, node_id: number) => {
                    // Nodes
                    func(
                        'nodes',
                        {
                            sdfg: sdfg, state: state_id, id: node_id
                        },
                        node
                    );

                    // If nested SDFG, traverse recursively
                    if (node.type === SDFGElementType.NestedSDFG &&
                        node.attributes.sdfg)
                        traverse_recursive(node.attributes.sdfg);
                });

                // Edges
                state.edges.forEach((edge: JsonSDFGEdge, edge_id: number) => {
                    func(
                        'edges',
                        {
                            sdfg: sdfg, state: state_id, id: edge_id
                        },
                        edge
                    );
                });
            });

            // Selected inter-state edges
            sdfg.edges.forEach((isedge: JsonSDFGEdge, isedge_id: number) => {
                func('isedges', { sdfg: sdfg, id: isedge_id }, isedge);
            });
        }

        // Start with top-level SDFG
        traverse_recursive(this.sdfg);
    }

    public for_all_elements(
        x: number, y: number, w: number, h: number, func: CallableFunction
    ): void {
        // Traverse nested SDFGs recursively
        function traverse_recursive(g: DagreSDFG | null, sdfg_name: string) {
            g?.nodes().forEach(state_id => {
                const state: State = g.node(state_id);
                if (!state)
                    return;

                // States
                func(
                    'states',
                    {
                        sdfg: sdfg_name, id: state_id, graph: g
                    },
                    state
                );

                if (state.data.state.attributes.is_collapsed)
                    return;

                const ng = state.data.graph;
                if (!ng)
                    return;
                ng.nodes().forEach((node_id: string) => {
                    const node = ng.node(node_id);
                    // Selected nodes
                    func(
                        'nodes',
                        {
                            sdfg: sdfg_name, state: state_id, id: node_id,
                            graph: ng
                        },
                        node
                    );

                    // If nested SDFG, traverse recursively
                    if (node.data.node.type === SDFGElementType.NestedSDFG)
                        traverse_recursive(
                            node.data.graph,
                            node.data.node.attributes.sdfg.attributes.name
                        );

                    // Connectors
                    node.in_connectors.forEach((c: Connector, i: number) => {
                        func('connectors', {
                            sdfg: sdfg_name, state: state_id, node: node_id,
                            connector: i, conntype: 'in', graph: ng
                        }, c
                        );
                    });
                    node.out_connectors.forEach((c: Connector, i: number) => {
                        func('connectors', {
                            sdfg: sdfg_name, state: state_id, node: node_id,
                            connector: i, conntype: 'out', graph: ng
                        }, c
                        );
                    });
                });

                // Selected edges
                ng.edges().forEach((edge_id: number) => {
                    const edge = ng.edge(edge_id);
                    func(
                        'edges',
                        {
                            sdfg: sdfg_name, state: state_id, id: edge.id,
                            graph: ng
                        },
                        edge
                    );
                });
            });

            // Selected inter-state edges
            g?.edges().forEach(isedge_id => {
                const isedge = g.edge(isedge_id);
                func(
                    'isedges',
                    {
                        sdfg: sdfg_name, id: isedge.id, graph: g
                    },
                    isedge
                );
            });
        }

        // Start with top-level SDFG
        traverse_recursive(this.graph, this.sdfg.attributes.name);
    }

    public get_nested_memlet_tree(edge: Edge): Set<Edge> {
        for (const tree of this.all_memlet_trees)
            if (tree.has(edge))
                return tree;
        return new Set<Edge>();
    }

    public find_elements_under_cursor(
        mouse_pos_x: number, mouse_pos_y: number
    ): any {
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
        let foreground_connector = null;

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

        for (const c of clicked_connectors) {
            const s = c.obj.width * c.obj.height;
            if (foreground_surface < 0 || s < foreground_surface) {
                foreground_surface = s;
                foreground_connector = c.obj;
            }
        }

        return {
            total_elements,
            elements,
            foreground_elem,
            foreground_connector,
        };
    }

    public clear_key_events(): void {
        this.mouse_mode = 'pan';
        this.update_toggle_buttons();
    }

    public on_key_event(event: KeyboardEvent): boolean {
        // Prevent handling of the event if the event is designed for something
        // other than the body, like an input element.
        if (event.target !== document.body)
            return false;

        if (this.ctrl_key_selection && !event.ctrlKey) {
            if (this.selectmode_btn?.onclick)
                (this.selectmode_btn as any)?.onclick(event, false);
        }

        if (this.shift_key_movement && !event.shiftKey) {
            if (this.movemode_btn?.onclick)
                (this.movemode_btn as any)?.onclick(event, false);
        }

        if (this.mouse_mode !== 'pan') {
            if (event.key === 'Escape' && !event.ctrlKey && !event.shiftKey) {
                if (this.panmode_btn?.onclick)
                    (this.panmode_btn as any)?.onclick(event);
            }
            return false;
        } else if (event.key === 'Escape') {
            if (this.selected_elements.length > 0) {
                this.selected_elements.forEach(el => {
                    el.selected = false;
                });
                this.deselect();
                this.draw_async();
            }
        } else if (event.key === 'Delete' && event.type === 'keyup') {
            // Sort in reversed order, so that deletion in sequence always
            // retains original IDs.
            this.selected_elements.sort((a, b) => (b.id - a.id));
            for (const e of this.selected_elements) {
                if (e instanceof Connector) {
                    continue;
                } else if (e instanceof Edge) {
                    if (e.parent_id === null)
                        e.sdfg.edges = e.sdfg.edges.filter(
                            (_, ind: number) => ind !== e.id
                        );
                    else {
                        const state: JsonSDFGState = e.sdfg.nodes[e.parent_id];
                        state.edges = state.edges.filter(
                            (_, ind: number) => ind !== e.id
                        );
                    }
                } else if (e instanceof State) {
                    delete_sdfg_states(e.sdfg, [e.id]);
                } else {
                    delete_sdfg_nodes(e.sdfg, e.parent_id!, [e.id]);
                }
            }
            this.deselect();
            this.set_sdfg(this.sdfg);
            this.emit('graph_edited');
        }

        // Ctrl + Shift Accelerators temporarily disabled due to a bug with
        // stuck accelerator keys when shift/ctrl tabbing.
        // TODO(later): fix and re-add
        //if (event.ctrlKey && !event.shiftKey) {
        //    if (this.selectmode_btn?.onclick)
        //        (this.selectmode_btn as any).onclick(event, true);
        //}

        //if (event.shiftKey && !event.ctrlKey) {
        //    if (this.movemode_btn?.onclick)
        //        (this.movemode_btn as any).onclick(event, true);
        //}

        return true;
    }

    // TODO(later): Improve event system using event types (instanceof) instead
    // of passing string eventtypes.
    /* eslint-disable @typescript-eslint/explicit-module-boundary-types */
    public on_mouse_event(
        event: any, comp_x_func: CallableFunction,
        comp_y_func: CallableFunction, evtype: string = 'other'
    ): boolean {
        /* eslint-enable @typescript-eslint/explicit-module-boundary-types */
        if (!this.graph)
            return false;

        if (this.ctrl_key_selection || this.shift_key_movement)
            this.on_key_event(event);

        let dirty = false; // Whether to redraw at the end
        // Whether the set of visible or selected elements changed
        let element_focus_changed = false;
        // Whether the current multi-selection changed
        let multi_selection_changed = false;
        let selection_changed = false;

        if (evtype === 'mousedown' || evtype === 'touchstart') {
            this.drag_start = event;
        } else if (evtype === 'mouseup') {
            this.drag_start = null;
            this.last_dragged_element = null;
        } else if (evtype === 'touchend') {
            if (event.touches.length === 0)
                this.drag_start = null;
            else
                this.drag_start = event;
        } else if (evtype === 'mousemove') {
            // Calculate the change in mouse position in canvas coordinates
            const old_mousepos = this.mousepos;
            this.mousepos = {
                x: comp_x_func(event),
                y: comp_y_func(event)
            };
            this.realmousepos = { x: event.clientX, y: event.clientY };

            // Only accept the primary mouse button as dragging source
            if (this.drag_start && event.buttons & 1) {
                this.dragging = true;

                if (this.mouse_mode === 'move') {
                    if (this.last_dragged_element) {
                        if (this.canvas)
                            this.canvas.style.cursor = 'grabbing';
                        this.drag_start.cx = comp_x_func(this.drag_start);
                        this.drag_start.cy = comp_y_func(this.drag_start);
                        let elements_to_move = [this.last_dragged_element];
                        if (this.selected_elements.includes(
                            this.last_dragged_element
                        ) && this.selected_elements.length > 1) {
                            elements_to_move = this.selected_elements.filter(
                                el => {
                                    // Do not move connectors (individually)
                                    if (el instanceof Connector)
                                        return false;
                                    const list_id = el.sdfg.cfg_list_id;

                                    // Do not move element individually if it is
                                    // moved together with a nested SDFG
                                    const nested_sdfg_parent =
                                        this.state_parent_list[list_id];
                                    if (nested_sdfg_parent &&
                                        this.selected_elements.includes(
                                            nested_sdfg_parent
                                        ))
                                        return false;

                                    // Do not move element individually if it is
                                    // moved together with its parent state
                                    const state_parent =
                                        this.cfg_list[list_id].node(
                                            el.parent_id!.toString()
                                        );
                                    if (state_parent &&
                                        this.selected_elements.includes(
                                            state_parent
                                        ))
                                        return false;

                                    // Otherwise move individually
                                    return true;
                                }
                            );
                        }

                        const move_entire_edge = elements_to_move.length > 1;
                        for (const el of elements_to_move) {
                            if (old_mousepos)
                                this.canvas_manager?.translate_element(
                                    el, old_mousepos, this.mousepos,
                                    this.graph, this.cfg_list,
                                    this.state_parent_list,
                                    this.drag_start,
                                    true,
                                    move_entire_edge
                                );
                        }

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
                            if (this.canvas)
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
                    this.canvas_manager?.translate(
                        event.movementX, event.movementY
                    );

                    // Mark for redraw
                    dirty = true;
                }
            } else if (this.drag_start && event.buttons & 4) {
                // Pan the view with the middle mouse button
                this.dragging = true;
                this.canvas_manager?.translate(
                    event.movementX, event.movementY
                );
                dirty = true;
                element_focus_changed = true;
            } else {
                this.drag_start = null;
                this.last_dragged_element = null;
                if (event.buttons & 1 || event.buttons & 4)
                    return true; // Don't stop propagation
            }
        } else if (evtype === 'touchmove') {
            if (this.drag_start.touches.length !== event.touches.length) {
                // Different number of touches, ignore and reset drag_start
                this.drag_start = event;
            } else if (event.touches.length === 1) { // Move/drag
                this.canvas_manager?.translate(
                    event.touches[0].clientX -
                        this.drag_start.touches[0].clientX,
                    event.touches[0].clientY -
                        this.drag_start.touches[0].clientY
                );
                this.drag_start = event;

                // Mark for redraw
                dirty = true;
                this.draw_async();
                return false;
            } else if (event.touches.length === 2) {
                // Find relative distance between two touches before and after.
                // Then, center and zoom to their midpoint.
                const touch1 = this.drag_start.touches[0];
                const touch2 = this.drag_start.touches[1];
                let x1 = touch1.clientX, x2 = touch2.clientX;
                let y1 = touch1.clientY, y2 = touch2.clientY;
                const oldCenter = [(x1 + x2) / 2.0, (y1 + y2) / 2.0];
                const initialDistance = Math.sqrt(
                    (x1 - x2) ** 2 + (y1 - y2) ** 2
                );
                x1 = event.touches[0].clientX; x2 = event.touches[1].clientX;
                y1 = event.touches[0].clientY; y2 = event.touches[1].clientY;
                const currentDistance = Math.sqrt(
                    (x1 - x2) ** 2 + (y1 - y2) ** 2
                );
                const newCenter = [(x1 + x2) / 2.0, (y1 + y2) / 2.0];

                // First, translate according to movement of center point
                this.canvas_manager?.translate(
                    newCenter[0] - oldCenter[0], newCenter[1] - oldCenter[1]
                );
                // Then scale
                this.canvas_manager?.scale(
                    currentDistance / initialDistance, newCenter[0],
                    newCenter[1]
                );

                this.drag_start = event;

                // Mark for redraw
                dirty = true;
                this.draw_async();
                return false;
            }
        } else if (evtype === 'wheel') {
            if (SDFVSettings.useVerticalScrollNavigation && !event.ctrlKey) {
                // If vertical scroll navigation is turned on, use this to
                // move the viewport up and down. If the control key is held
                // down while scrolling, treat it as a typical zoom operation.
                this.canvas_manager?.translate(0, -event.deltaY);
                dirty = true;
                element_focus_changed = true;
            } else {
                // Get physical x,y coordinates (rather than canvas coordinates)
                const br = this.canvas?.getBoundingClientRect();
                const x = event.clientX - (br ? br.x : 0);
                const y = event.clientY - (br ? br.y : 0);
                this.canvas_manager?.scale(event.deltaY > 0 ? 0.9 : 1.1, x, y);
                dirty = true;
                element_focus_changed = true;
            }
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
        const foreground_connector = elements_under_cursor.foreground_connector;

        if (this.mouse_mode === 'add') {
            const el = this.mouse_follow_element;
            if (check_valid_add_position(
                (this.add_type ? this.add_type : null),
                foreground_elem, this.add_mode_lib, this.mousepos
            ))
                el.firstElementChild.setAttribute('stroke', 'green');
            else
                el.firstElementChild.setAttribute('stroke', 'red');

            el.style.left =
                (event.layerX - el.firstElementChild.clientWidth / 2) + 'px';
            el.style.top =
                (event.layerY - el.firstElementChild.clientHeight / 2) + 'px';
        }

        // Change mouse cursor accordingly
        if (this.canvas) {
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
                        // This is a collapsed node or state, show with the
                        // cursor shape that this can be expanded.
                        this.canvas.style.cursor = 'alias';
                    } else {
                        this.canvas.style.cursor = 'pointer';
                    }
                }
            } else {
                this.canvas.style.cursor = 'auto';
            }
        }

        this.tooltip = null;

        // De-highlight all elements.
        this.doForVisibleElements(
            (type: any, e: any, obj: any) => {
                obj.hovered = false;
                obj.highlighted = false;
                if (obj instanceof Tasklet) {
                    for (const t of obj.inputTokens)
                        t.highlighted = false;
                    for (const t of obj.outputTokens)
                        t.highlighted = false;
                }
            }
        );
        // Mark hovered and highlighted elements.
        this.doForVisibleElements(
            (type: any, e: any, obj: any) => {
                const intersected = obj.intersect(
                    this.mousepos!.x, this.mousepos!.y, 0, 0
                );

                // Highlight all edges of the memlet tree
                if (intersected && obj instanceof Edge &&
                    obj.parent_id !== null) {
                    const tree = this.get_nested_memlet_tree(obj);
                    tree.forEach(te => {
                        if (te !== obj && te !== undefined) {
                            te.highlighted = true;
                        }
                    });
                }

                // Highlight all access nodes with the same name in the same
                // nested sdfg
                if (intersected && obj instanceof AccessNode) {
                    traverseSDFGScopes(
                        this.cfg_list[obj.sdfg.cfg_list_id],
                        (node: any) => {
                            // If node is a state, then visit sub-scope
                            if (node instanceof State)
                                return true;
                            if (node instanceof AccessNode &&
                                node.data.node.label === obj.data.node.label)
                                node.highlighted = true;
                            // No need to visit sub-scope
                            return false;
                        }
                    );
                }

                if (intersected && obj instanceof Connector) {
                    // Highlight all access nodes with the same name as the
                    // hovered connector in the nested sdfg
                    if (e.graph) {
                        const nested_graph =
                            e.graph.node(obj.parent_id).data.graph;
                        if (nested_graph) {
                            traverseSDFGScopes(nested_graph, (node: any) => {
                                // If node is a state, then visit sub-scope
                                if (node instanceof State) {
                                    return true;
                                }
                                if (node instanceof AccessNode &&
                                    node.data.node.label === obj.label()) {
                                    node.highlighted = true;
                                }
                                // No need to visit sub-scope
                                return false;
                            });
                        }
                    }

                    // Similarly, highlight any identifiers in a connector's
                    // tasklet, if applicable.
                    if (obj.linkedElem && obj.linkedElem instanceof Tasklet) {
                        if (obj.connectorType === 'in') {
                            for (const token of obj.linkedElem.inputTokens) {
                                if (token.token === obj.data.name)
                                    token.highlighted = true;
                            }
                        } else {
                            for (const token of obj.linkedElem.outputTokens) {
                                if (token.token === obj.data.name)
                                    token.highlighted = true;
                            }
                        }
                    }
                }

                if (intersected)
                    obj.hovered = true;
            }
        );

        // If adding an edge, mark/highlight the first/from element, if it has
        // already been selected.
        if (this.mouse_mode === 'add' && this.add_type === 'Edge') {
            if (this.add_edge_start)
                this.add_edge_start.highlighted = true;
            if (this.add_edge_start_conn)
                this.add_edge_start_conn.highlighted = true;
        }

        if (evtype === 'mousemove') {
            // TODO: Draw only if elements have changed
            dirty = true;
        }

        if (evtype === 'dblclick') {
            const sdfg = (foreground_elem ? foreground_elem.sdfg : null);
            let sdfg_elem = null;
            if (foreground_elem instanceof State)
                sdfg_elem = foreground_elem.data.state;
            else if (foreground_elem instanceof ControlFlowRegion)
                sdfg_elem = foreground_elem.data.block;
            else if (foreground_elem instanceof SDFGNode) {
                sdfg_elem = foreground_elem.data.node;

                // If a scope exit node, use entry instead
                if (sdfg_elem.type.endsWith('Exit') &&
                    foreground_elem.parent_id !== null)
                    sdfg_elem = sdfg.nodes[foreground_elem.parent_id].nodes[
                        sdfg_elem.scope_entry
                    ];
            } else
                sdfg_elem = null;

            // Toggle collapsed state
            if (sdfg_elem && 'is_collapsed' in sdfg_elem.attributes) {
                sdfg_elem.attributes.is_collapsed =
                    !sdfg_elem.attributes.is_collapsed;

                this.emit('collapse_state_changed');

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
                    const elements_in_selection: any[] = [];
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
                    this.doForIntersectedElements(start_x, start_y, w, h,
                        (type: any, e: any, obj: any) => {
                            if (obj.contained_in(start_x, start_y, w, h))
                                elements_in_selection.push(obj);
                        });
                    if (event.shiftKey && !this.ctrl_key_selection) {
                        elements_in_selection.forEach((el) => {
                            if (!this.selected_elements.includes(el))
                                this.selected_elements.push(el);
                        });
                    } else if (event.ctrlKey && !this.ctrl_key_selection) {
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
                    multi_selection_changed = true;
                }

                if (this.mouse_mode === 'move') {
                    this.emit('element_position_changed', 'manual_move');
                }
            } else {
                if (this.mouse_mode === 'add') {
                    if (check_valid_add_position(
                        this.add_type, foreground_elem, this.add_mode_lib,
                        this.mousepos
                    )) {
                        if (this.add_type === SDFGElementType.Edge) {
                            if (this.add_edge_start) {
                                const start = this.add_edge_start;
                                this.add_edge_start = undefined;
                                this.emit(
                                    'add_element',
                                    this.add_type,
                                    get_uuid_graph_element(
                                        foreground_elem
                                    ),
                                    undefined,
                                    get_uuid_graph_element(start),
                                    this.add_edge_start_conn ?
                                        this.add_edge_start_conn.data.name :
                                        undefined,
                                    foreground_connector ?
                                        foreground_connector.data.name :
                                        undefined
                                );
                            } else {
                                this.add_edge_start = foreground_elem;
                                this.add_edge_start_conn = foreground_connector;
                                this.update_toggle_buttons();
                            }
                        } else if (this.add_type ===
                            SDFGElementType.LibraryNode) {
                            this.add_position = this.mousepos;
                            this.emit(
                                'add_element',
                                this.add_type,
                                get_uuid_graph_element(
                                    foreground_elem
                                ),
                                this.add_mode_lib || undefined
                            );
                        } else {
                            this.add_position = this.mousepos;
                            if (this.add_type)
                                this.emit(
                                    'add_element',
                                    this.add_type,
                                    get_uuid_graph_element(
                                        foreground_elem
                                    )
                                );
                        }

                        if (!event.ctrlKey && !(
                                this.add_type === SDFGElementType.Edge &&
                                this.add_edge_start
                            )) {
                            // Cancel add mode.
                            if (this.panmode_btn?.onclick)
                                this.panmode_btn.onclick(event);
                        }
                    }
                }

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

                        // Indicate that the multi-selection changed.
                        multi_selection_changed = true;
                    } else if (event.shiftKey) {
                        // TODO: Implement shift-clicks for path selection.
                    } else {
                        // Clicked an element, select it and nothing else.
                        // If there was a multi-selection prior to this,
                        // indicate that it changed.
                        if (this.selected_elements.length > 1)
                            multi_selection_changed = true;

                        this.selected_elements.forEach((el) => {
                            el.selected = false;
                        });
                        this.selected_elements = [foreground_elem];
                        selection_changed = true;
                    }
                } else {
                    // Clicked nothing, clear the selection.

                    // If there was a multi-selection prior to this, indicate
                    // that it changed.
                    if (this.selected_elements.length > 1)
                        multi_selection_changed = true;

                    this.selected_elements.forEach((el) => {
                        el.selected = false;
                    });
                    this.selected_elements = [];
                    selection_changed = true;
                }
                dirty = true;
                element_focus_changed = true;
            }
        }
        this.selected_elements.forEach((el) => {
            el.selected = true;
        });

        if (evtype === 'contextmenu') {
            if (this.mouse_mode === 'move') {
                let elements_to_reset = [foreground_elem];
                if (this.selected_elements.includes(foreground_elem))
                    elements_to_reset = this.selected_elements;

                let element_moved = false;
                let relayout_necessary = false;
                for (const el of elements_to_reset) {
                    const position = getPositioningInfo(el);
                    if (el && !(el instanceof Connector) && position) {
                        // Reset the position of the element (if it has been
                        // manually moved)
                        if (el instanceof Edge) {
                            if (!position.points)
                                continue;

                            const edge_el: Edge = el;
                            // Create inverted points to move it back
                            const new_points = new Array(
                                edge_el.get_points().length
                            );
                            for (
                                let j = 1;
                                j < edge_el.get_points().length - 1;
                                j++
                            ) {
                                new_points[j] = {
                                    dx: - position.points[j].dx,
                                    dy: - position.points[j].dy
                                };
                                // Reset the point movement
                                position.points[j].dx = 0;
                                position.points[j].dy = 0;
                            }

                            // Move it to original position
                            this.canvas_manager?.translate_element(
                                edge_el, { x: 0, y: 0 }, { x: 0, y: 0 },
                                this.graph, this.cfg_list,
                                this.state_parent_list, undefined, false, false,
                                new_points
                            );

                            element_moved = true;
                        } else {
                            if (!position.dx && !position.dy)
                                continue;

                            // Calculate original position with the relative
                            // movement
                            const new_x = el.x - position.dx;
                            const new_y = el.y - position.dy;

                            position.dx = 0;
                            position.dy = 0;

                            // Move it to original position
                            this.canvas_manager?.translate_element(
                                el, { x: el.x, y: el.y },
                                { x: new_x, y: new_y }, this.graph,
                                this.cfg_list, this.state_parent_list,
                                undefined, false, false, undefined
                            );

                            element_moved = true;
                        }

                        if (el instanceof EntryNode) {
                            // Also update scope position
                            position.scope_dx = 0;
                            position.scope_dy = 0;

                            if (!el.data.node.attributes.is_collapsed)
                                relayout_necessary = true;
                        }
                    }
                }

                if (relayout_necessary)
                    this.relayout();

                this.draw_async();

                if (element_moved) {
                    this.emit('element_position_changed', 'manual_move');
                }

            } else if (this.mouse_mode === 'add') {
                // Cancel add mode
                if (this.panmode_btn?.onclick)
                    this.panmode_btn?.onclick(event);
            }
        }

        const mouse_x = comp_x_func(event);
        const mouse_y = comp_y_func(event);
        if (this.external_mouse_handler) {
            const ends_pan = ends_drag && !multi_selection_changed;
            const ext_mh_dirty = this.external_mouse_handler(
                evtype, event, { x: mouse_x, y: mouse_y }, elements,
                this, this.selected_elements, this.sdfv_instance, ends_pan
            );
            dirty = dirty || ext_mh_dirty;
        }

        if (this.overlay_manager !== null) {
            const ol_manager_dirty = this.overlay_manager.on_mouse_event(
                evtype,
                event,
                { x: mouse_x, y: mouse_y },
                elements,
                foreground_elem,
                ends_drag
            );
            dirty = dirty || ol_manager_dirty;
        }

        if (dirty)
            this.draw_async();

        if (element_focus_changed || selection_changed)
            this.emit('selection_changed', multi_selection_changed);

        return false;
    }

    public get_inclusive_ranges(): boolean {
        return SDFVSettings.inclusiveRanges;
    }

    public get_canvas(): HTMLCanvasElement | null {
        return this.canvas;
    }

    public get_canvas_manager(): CanvasManager | null {
        return this.canvas_manager;
    }

    public get_context(): CanvasRenderingContext2D | null {
        return this.ctx;
    }

    public get_overlay_manager(): OverlayManager {
        return this.overlay_manager;
    }

    public get_visible_rect(): SimpleRect | null {
        return this.visible_rect;
    }

    public get_mouse_mode(): string {
        return this.mouse_mode;
    }

    public get_bgcolor(): string {
        return (this.bgcolor ? this.bgcolor : '');
    }

    public get_sdfg(): JsonSDFG {
        return this.sdfg;
    }

    public get_graph(): DagreSDFG | null {
        return this.graph;
    }

    public get_in_vscode(): boolean {
        return this.in_vscode;
    }

    public get_mousepos(): Point2D | null {
        return this.mousepos;
    }

    public get_tooltip_container(): HTMLElement | null {
        return this.tooltip_container;
    }

    public get_selected_elements(): SDFGElement[] {
        return this.selected_elements;
    }

    public set_tooltip(tooltip_func: SDFVTooltipFunc): void {
        this.tooltip = tooltip_func;
    }

    public set_bgcolor(bgcolor: string): void {
        this.bgcolor = bgcolor;
    }

    public on_selection_changed(): void {
        if (this.localViewBtn) {
            if (this.isLocalViewViable())
                this.localViewBtn.show();
            else
                this.localViewBtn.hide();
        }

        if (this.cutoutBtn) {
            if (this.selected_elements.length > 0)
                this.cutoutBtn.show();
            else
                this.cutoutBtn.hide();
        }
    }

    private isLocalViewViable(): boolean {
        if (this.selected_elements.length > 0) {
            if (this.selected_elements.length === 1 &&
                this.selected_elements[0] instanceof State)
                return true;

            // Multiple elements are selected. The local view is only a viable
            // option if all selected elements are inside the same state. If a
            // state is selected alongside other elements, all elements must be
            // inside that state.
            let parentStateId = null;
            for (const elem of this.selected_elements) {
                if (elem instanceof State) {
                    if (parentStateId === null)
                        parentStateId = elem.id;
                    else if (parentStateId !== elem.id)
                        return false;
                } else if (elem instanceof Connector || elem instanceof Edge) {
                    continue;
                } else {
                    if (elem.parent_id === null)
                        return false;
                    else if (parentStateId === null)
                        parentStateId = elem.parent_id;
                    else if (parentStateId !== elem.parent_id)
                        return false;
                }
            }
            return true;
        }
        return false;
    }

    public deselect(): void {
        this.selected_elements.forEach((el) => {
            el.selected = false;
        });
        this.selected_elements = [];
        this.on_selection_changed();
    }

    public exitLocalView(): void {
        reload_file(this.sdfv_instance);
    }

    public async localViewSelection(): Promise<void> {
        if (!this.graph)
            return;

        // Transition to the local view by first cutting out the selection.
        try {
            this.cutout_selection(true);
            const lRenderer =
                new LViewRenderer(this.sdfv_instance, this.container);
            const lGraph = await LViewParser.parseGraph(this.graph, lRenderer);
            if (lGraph) {
                LViewLayouter.layoutGraph(lGraph);
                lRenderer.graph = lGraph;

                // Set a button to exit the local view again.
                const exitBtn = document.createElement('button');
                exitBtn.className = 'button';
                exitBtn.innerHTML = '<i class="material-icons">close</i>';
                exitBtn.style.paddingBottom = '0px';
                exitBtn.style.userSelect = 'none';
                exitBtn.style.position = 'absolute';
                exitBtn.style.top = '10px';
                exitBtn.style.left = '10px';
                exitBtn.title = 'Exit local view';
                exitBtn.onclick = () => {
                    this.exitLocalView();
                    this.container.removeChild(exitBtn);
                };
                this.container.appendChild(exitBtn);

                this.sdfv_instance.setLocalViewRenderer(lRenderer);
            }
        } catch (e) {
            if (e instanceof LViewGraphParseError) {
                showErrorModal(e.message);
            } else {
                throw e;
            }
        }
    }

    public cutout_selection(_suppressSave: boolean = false): void {
        /* Rule set for creating a cutout subgraph:
         * Edges are selected according to the subgraph nodes - all edges
         * between subgraph nodes are preserved.
         * In any element that contains other elements (state, nested SDFG,
         * scopes), the full contents are used.
         * If more than one element is selected from different contexts (two
         * nodes from two states), the parents will be preserved.
         */
        // Collect nodes and states
        const sdfgs: Set<number> = new Set<number>();
        const cfg_list: { [key: string]: JsonSDFG } = {};
        const states: { [key: string]: Array<number> } = {};
        const nodes: { [key: string]: Array<number> } = {};
        for (const elem of this.selected_elements) {
            // Ignore edges and connectors
            if (elem instanceof Edge || elem instanceof Connector)
                continue;
            const sdfg_id = elem.sdfg.cfg_list_id;
            cfg_list[sdfg_id] = elem.sdfg;
            sdfgs.add(sdfg_id);
            let state_id: number = -1;
            if (elem.parent_id !== null) {
                const state_uid: string = JSON.stringify(
                    [sdfg_id, elem.parent_id]
                );
                if (state_uid in nodes)
                    nodes[state_uid].push(elem.id);
                else
                    nodes[state_uid] = [elem.id];
                state_id = elem.parent_id;
            } else {
                // Add all nodes from state
                const state_uid: string = JSON.stringify([sdfg_id, elem.id]);
                nodes[state_uid] = [...elem.data.state.nodes.keys()];
                state_id = elem.id;
            }
            // Register state
            if (sdfg_id in states)
                states[sdfg_id].push(state_id);
            else
                states[sdfg_id] = [state_id];
        }

        // Clear selection and redraw
        this.deselect();

        if (Object.keys(nodes).length === 0) {  // Nothing to cut out
            this.draw_async();
            return;
        }

        // Find root SDFG and root state (if possible)
        const root_sdfg_id = find_root_sdfg(sdfgs, this.sdfg_tree);
        if (root_sdfg_id !== null) {
            const root_sdfg = cfg_list[root_sdfg_id];

            // For every participating state, filter out irrelevant nodes and
            // memlets.
            for (const nkey of Object.keys(nodes)) {
                const [sdfg_id, state_id] = JSON.parse(nkey);
                const sdfg = cfg_list[sdfg_id];
                delete_sdfg_nodes(sdfg, state_id, nodes[nkey], true);
            }

            // For every participating SDFG, filter out irrelevant states and
            // interstate edges.
            for (const sdfg_id of Object.keys(states)) {
                const sdfg = cfg_list[sdfg_id];
                delete_sdfg_states(sdfg, states[sdfg_id], true);
            }

            // Set root SDFG as the new SDFG
            this.set_sdfg(root_sdfg);
        }

    }
}


function calculateNodeSize(
    sdfg: JsonSDFG, node: any, ctx: CanvasRenderingContext2D
): { width: number, height: number } {
    let label;
    switch (node.type) {
        case SDFGElementType.AccessNode:
            label = node.label;
            if (SDFVSettings.showDataDescriptorSizes) {
                const nodedesc = sdfg.attributes._arrays[label];
                if (nodedesc && nodedesc.attributes.shape)
                    label = ' ' + sdfg_property_to_string(
                        nodedesc.attributes.shape
                    );
            }
            break;
        default:
            label = node.label;
            break;
    }

    const labelsize = ctx.measureText(label).width;
    const inconnsize = 2 * SDFV.LINEHEIGHT * Object.keys(
        node.attributes.layout.in_connectors
    ).length - SDFV.LINEHEIGHT;
    const outconnsize = 2 * SDFV.LINEHEIGHT * Object.keys(
        node.attributes.layout.out_connectors
    ).length - SDFV.LINEHEIGHT;
    const maxwidth = Math.max(labelsize, inconnsize, outconnsize);
    let maxheight = 2 * SDFV.LINEHEIGHT;
    maxheight += 4 * SDFV.LINEHEIGHT;

    const size = { width: maxwidth, height: maxheight };

    // add something to the size based on the shape of the node
    switch (node.type) {
        case SDFGElementType.AccessNode:
            size.height -= 4 * SDFV.LINEHEIGHT;
            size.width += size.height;
            break;
        case SDFGElementType.MapEntry:
        case SDFGElementType.ConsumeEntry:
        case SDFGElementType.PipelineEntry:
        case SDFGElementType.MapExit:
        case SDFGElementType.ConsumeExit:
        case SDFGElementType.PipelineExit:
            size.width += 2.0 * size.height;
            size.height /= 1.75;
            break;
        case SDFGElementType.Tasklet:
            size.width += 2.0 * (size.height / 3.0);
            size.height /= 1.75;
            break;
        case SDFGElementType.LibraryNode:
            size.width += 2.0 * (size.height / 3.0);
            size.height /= 1.75;
            break;
        case SDFGElementType.Reduce:
            size.height -= 4 * SDFV.LINEHEIGHT;
            size.width *= 2;
            size.height = size.width / 3.0;
            break;
    }

    return size;
}

type StateMachineType = {
    nodes: JsonSDFGBlock[];
    edges: JsonSDFGEdge[];
};

function relayoutStateMachine(
    ctx: CanvasRenderingContext2D, stateMachine: StateMachineType,
    sdfg: JsonSDFG, sdfgList: CFGListType, stateParentList: any[],
    omitAccessNodes: boolean, parent?: SDFGElement
): DagreSDFG {
    const BLOCK_MARGIN = 3 * SDFV.LINEHEIGHT;

    // Layout the state machine as a dagre graph.
    const g: DagreSDFG = new dagre.graphlib.Graph();
    g.setGraph({});
    g.setDefaultEdgeLabel(() => { return {}; });

    if (!parent)
        parent = new SDFG(sdfg);

    // layout each block individually to get its size.
    for (const block of stateMachine.nodes) {
        let blockInfo: {
            label?: string,
            width: number,
            height: number,
        } = {
            label: undefined,
            width: 0,
            height: 0,
        };

        const btype =
            block.type === SDFGElementType.SDFGState ? 'State' : block.type;
        const blockElem = new SDFGElements[btype](
            { layout: { width: 0, height: 0 } }, block.id, sdfg, null, parent
        );
        if (block.type === SDFGElementType.SDFGState ||
            block.type === SDFGElementType.ContinueState ||
            block.type === SDFGElementType.BreakState)
            blockElem.data.state = block;
        else
            blockElem.data.block = block;

        blockInfo.label = block.id.toString();
        let blockGraph = null;
        if (block.attributes.is_collapsed) {
            blockInfo.height = SDFV.LINEHEIGHT;
            if (blockElem instanceof LoopRegion) {
                const oldFont = ctx.font;
                ctx.font = LoopRegion.LOOP_STATEMENT_FONT;
                const labelWidths = [
                    ctx.measureText(
                        (block.attributes.scope_condition?.string_data ?? '') +
                        'while'
                    ).width,
                    ctx.measureText(
                        (block.attributes.init_statement?.string_data ?? '') +
                        'init'
                    ).width,
                    ctx.measureText(
                        (block.attributes.update_statement?.string_data ?? '') +
                        'update'
                    ).width,
                ];
                const maxLabelWidth = Math.max(...labelWidths);
                ctx.font = oldFont;
                blockInfo.width = Math.max(
                    maxLabelWidth, ctx.measureText(block.label).width
                ) + 3 * LoopRegion.META_LABEL_MARGIN;
            } else {
                blockInfo.width = ctx.measureText(blockInfo.label).width;
            }
        } else {
            blockGraph = relayoutSDFGBlock(
                ctx, block, sdfg, sdfgList, stateParentList, omitAccessNodes,
                blockElem
            );
            if (blockGraph)
                blockInfo = calculateBoundingBox(blockGraph);
        }
        blockInfo.width += 2 * BLOCK_MARGIN;
        blockInfo.height += 2 * BLOCK_MARGIN;

        if (blockElem instanceof LoopRegion) {
            // Add spacing for the condition if the loop is not inverted.
            if (!block.attributes.inverted)
                blockInfo.height += LoopRegion.CONDITION_SPACING;
            // If there's an init statement, add space for it.
            if (block.attributes.init_statement)
                blockInfo.height += LoopRegion.INIT_SPACING;
            // If there's an update statement, also add space for it.
            if (block.attributes.update_statement)
                blockInfo.height += LoopRegion.UPDATE_SPACING;
        }

        blockElem.data.layout = blockInfo;
        blockElem.data.graph = blockGraph;
        blockElem.set_layout();
        g.setNode(block.id.toString(), blockElem);
    }

    for (let id = 0; id < stateMachine.edges.length; id++) {
        const edge = stateMachine.edges[id];
        g.setEdge(edge.src, edge.dst, new InterstateEdge(
            edge.attributes.data, id, sdfg, parent.id, parent, edge.src,
            edge.dst
        ));
    }

    if (SDFVSettings.useVerticalStateMachineLayout) {
        // Fall back to dagre for anything that cannot be laid out with
        // the vertical layout (e.g., irreducible control flow).
        try {
            SMLayouter.layoutDagreCompat(g, sdfg.start_block?.toString());
        } catch (_ignored) {
            dagre.layout(g);
        }
    } else {
        dagre.layout(g);
    }

    // Annotate the sdfg with its layout info
    for (const block of stateMachine.nodes) {
        const gnode = g.node(block.id.toString());
        block.attributes.layout = {};
        block.attributes.layout.x = gnode.x;
        block.attributes.layout.y = gnode.y;
        block.attributes.layout.width = gnode.width;
        block.attributes.layout.height = gnode.height;
    }

    for (const edge of stateMachine.edges) {
        const gedge = g.edge(edge.src, edge.dst);
        const bb = calculateEdgeBoundingBox(gedge);
        // Convert from top-left to center
        (bb as any).x += bb.width / 2.0;
        (bb as any).y += bb.height / 2.0;

        gedge.x = (bb as any).x;
        gedge.y = (bb as any).y;
        gedge.width = bb.width;
        gedge.height = bb.height;
        edge.attributes.layout = {};
        edge.attributes.layout.width = bb.width;
        edge.attributes.layout.height = bb.height;
        edge.attributes.layout.x = (bb as any).x;
        edge.attributes.layout.y = (bb as any).y;
        edge.attributes.layout.points = gedge.points;
    }

    // Offset node and edge locations to be in state margins
    for (let blockId = 0; blockId < stateMachine.nodes.length; blockId++) {
        const block = stateMachine.nodes[blockId];
        if (!block.attributes.is_collapsed) {
            const gBlock: any = g.node(blockId.toString());
            const topleft = gBlock.topleft();
            if (block.type === SDFGElementType.SDFGState) {
                offset_state(block as JsonSDFGState, gBlock, {
                    x: topleft.x + BLOCK_MARGIN,
                    y: topleft.y + BLOCK_MARGIN
                });
            } else {
                // Base spacing for the inside.
                let topSpacing = BLOCK_MARGIN;

                if (gBlock instanceof LoopRegion) {
                    // Add spacing for the condition if the loop isn't inverted.
                    if (!block.attributes.inverted)
                        topSpacing += LoopRegion.CONDITION_SPACING;
                    // If there's an init statement, add space for it.
                    if (block.attributes.init_statement)
                        topSpacing += LoopRegion.INIT_SPACING;
                }
                offset_sdfg(block as any, gBlock.data.graph, {
                    x: topleft.x + BLOCK_MARGIN,
                    y: topleft.y + topSpacing,
                });
            }
        }
    }

    const bb = calculateBoundingBox(g);
    (g as any).width = bb.width;
    (g as any).height = bb.height;

    // Add SDFG to global store.
    sdfgList[sdfg.cfg_list_id] = g;

    return g;
}

function relayoutSDFGState(
    ctx: CanvasRenderingContext2D, state: JsonSDFGState,
    sdfg: JsonSDFG, sdfgList: JsonSDFG[], stateParentList: any[],
    omitAccessNodes: boolean, parent: State
): DagreSDFG | null {
    // layout the sdfg block as a dagre graph.
    const g: DagreSDFG = new dagre.graphlib.Graph({ multigraph: true });

    // Set layout options and a simpler algorithm for large graphs.
    const layoutOptions: any = { ranksep: 30 };
    if (state.nodes.length >= 1000)
        layoutOptions.ranker = 'longest-path';

    g.setGraph(layoutOptions);

    // Set an object for the graph label.
    g.setDefaultEdgeLabel(() => { return {}; });

    // Add nodes to the graph. The first argument is the node id. The
    // second is metadata about the node (label, width, height),
    // which will be updated by dagre.layout (will add x,y).

    // Process nodes hierarchically.
    let topLevelNodes = state.scope_dict[-1];
    if (topLevelNodes === undefined)
        topLevelNodes = Object.keys(state.nodes);
    const drawnNodes: Set<string> = new Set();
    const hiddenNodes = new Map();

    function layoutNode(node: any) {
        if (omitAccessNodes && node.type === SDFGElementType.AccessNode) {
            // add access node to hidden nodes; source and destinations will be
            // set later.
            hiddenNodes.set(
                node.id.toString(), { node: node, src: null, dsts: [] }
            );
            return;
        }

        let nestedGraph = null;
        node.attributes.layout = {};

        // Set connectors prior to computing node size
        node.attributes.layout.in_connectors = node.attributes.in_connectors ?? [];
        if ('is_collapsed' in node.attributes && node.attributes.is_collapsed &&
            node.type !== SDFGElementType.NestedSDFG &&
            node.type !== SDFGElementType.ExternalNestedSDFG)
            node.attributes.layout.out_connectors = find_exit_for_entry(
                state.nodes, node
            )?.attributes.out_connectors ?? [];
        else
            node.attributes.layout.out_connectors =
                node.attributes.out_connectors ?? [];

        const nodeSize = calculateNodeSize(sdfg, node, ctx);
        node.attributes.layout.width = nodeSize.width;
        node.attributes.layout.height = nodeSize.height;
        node.attributes.layout.label = node.label;

        // Recursively lay out nested SDFGs.
        if (node.type === SDFGElementType.NestedSDFG ||
            node.type === SDFGElementType.ExternalNestedSDFG) {
            if (node.attributes.sdfg &&
                node.attributes.sdfg.type !== 'SDFGShell') {
                nestedGraph = relayoutStateMachine(
                    ctx, node.attributes.sdfg, node.attributes.sdfg, sdfgList,
                    stateParentList, omitAccessNodes, parent
                );
                const sdfgInfo = calculateBoundingBox(nestedGraph);
                node.attributes.layout.width =
                    sdfgInfo.width + 2 * SDFV.LINEHEIGHT;
                node.attributes.layout.height =
                    sdfgInfo.height + 2 * SDFV.LINEHEIGHT;
            } else {
                const emptyNSDFGLabel = 'No SDFG loaded';
                const textMetrics = ctx.measureText(emptyNSDFGLabel);
                node.attributes.layout.width =
                    textMetrics.width + 2 * SDFV.LINEHEIGHT;
                node.attributes.layout.height = 4 * SDFV.LINEHEIGHT;
            }
        }

        // Dynamically create node type.
        const obj = new SDFGElements[node.type](
            { node: node, graph: nestedGraph }, node.id, sdfg, state.id, parent
        );

        // If it's a nested SDFG, we need to record the node as all of its
        // state's parent node.
        if ((node.type === SDFGElementType.NestedSDFG ||
             node.type === SDFGElementType.ExternalNestedSDFG) &&
            node.attributes.sdfg && node.attributes.sdfg.type !== 'SDFGShell')
            stateParentList[node.attributes.sdfg.cfg_list_id] = obj;

        // Add input connectors.
        let i = 0;
        let conns;
        if (Array.isArray(node.attributes.layout.in_connectors))
            conns = node.attributes.layout.in_connectors;
        else
            conns = Object.keys(node.attributes.layout.in_connectors);
        for (const cname of conns) {
            const conn = new Connector({ name: cname }, i, sdfg, node.id);
            conn.connectorType = 'in';
            conn.linkedElem = obj;
            obj.in_connectors.push(conn);
            i += 1;
        }

        // Add output connectors -- if collapsed, uses exit node connectors.
        i = 0;
        if (Array.isArray(node.attributes.layout.out_connectors))
            conns = node.attributes.layout.out_connectors;
        else
            conns = Object.keys(node.attributes.layout.out_connectors);
        for (const cname of conns) {
            const conn = new Connector({ name: cname }, i, sdfg, node.id);
            conn.connectorType = 'out';
            conn.linkedElem = obj;
            obj.out_connectors.push(conn);
            i += 1;
        }

        g.setNode(node.id, obj);
        drawnNodes.add(node.id.toString());

        // Recursively draw nodes.
        if (node.id in state.scope_dict) {
            if (node.attributes.is_collapsed)
                return;
            state.scope_dict[node.id].forEach((nodeid: number) => {
                const node = state.nodes[nodeid];
                layoutNode(node);
            });
        }
    }


    topLevelNodes.forEach((nodeid: number) => {
        const node = state.nodes[nodeid];
        layoutNode(node);
    });

    // Add info to calculate shortcut edges.
    function addEdgeInfoIfHidden(edge: any) {
        const hiddenSrc = hiddenNodes.get(edge.src);
        const hiddenDst = hiddenNodes.get(edge.dst);

        if (hiddenSrc && hiddenDst) {
            // If we have edges from an AccessNode to an AccessNode then just
            // connect destinations.
            hiddenSrc.dsts = hiddenDst.dsts;
            edge.attributes.data.attributes.shortcut = false;
        } else if (hiddenSrc) {
            // If edge starts at hidden node, then add it as destination.
            hiddenSrc.dsts.push(edge);
            edge.attributes.data.attributes.shortcut = false;
            return true;
        } else if (hiddenDst) {
            // If edge ends at hidden node, then add it as source.
            hiddenDst.src = edge;
            edge.attributes.data.attributes.shortcut = false;
            return true;
        }

        // If it is a shortcut edge, but we don't omit access nodes, then ignore
        // this edge.
        if (!omitAccessNodes && edge.attributes.data.attributes.shortcut)
            return true;

        return false;
    }

    state.edges.forEach((edge: any, id: any) => {
        if (addEdgeInfoIfHidden(edge))
            return;
        edge = check_and_redirect_edge(edge, drawnNodes, state);

        if (!edge)
            return;

        const e = new Memlet(edge.attributes.data, id, sdfg, state.id);
        edge.attributes.data.edge = e;
        (e as any).src_connector = edge.src_connector;
        (e as any).dst_connector = edge.dst_connector;
        g.setEdge(edge.src, edge.dst, e, id);
    });

    hiddenNodes.forEach(hiddenNode => {
        if (hiddenNode.src) {
            hiddenNode.dsts.forEach((e: any) => {
                // Create shortcut edge with new destination.
                const tmpEdge = e.attributes.data.edge;
                e.attributes.data.edge = null;
                const shortCutEdge = deepCopy(e);
                e.attributes.data.edge = tmpEdge;
                shortCutEdge.src = hiddenNode.src.src;
                shortCutEdge.src_connector = hiddenNode.src.src_connector;
                shortCutEdge.dst_connector = e.dst_connector;
                // Attribute that only shortcut edges have; if it is explicitly
                // false, then edge is ignored in omit access node mode.
                shortCutEdge.attributes.data.attributes.shortcut = true;

                // Draw the redirected edge.
                const redirectedEdge = check_and_redirect_edge(
                    shortCutEdge, drawnNodes, state
                );
                if (!redirectedEdge) return;

                // Abort if shortcut edge already exists.
                const edges = g.outEdges(redirectedEdge.src);
                if (edges) {
                    for (const oe of edges) {
                        if (oe.w === e.dst && oe.name &&
                            state.edges[
                                parseInt(oe.name)
                            ].dst_connector === e.dst_connector
                        ) {
                            return;
                        }
                    }
                }

                // Add shortcut edge (redirection is not done in this list).
                state.edges.push(shortCutEdge);

                // Add redirected shortcut edge to graph.
                const edgeId = state.edges.length - 1;
                const newShortCutEdge = new Memlet(
                    deepCopy(redirectedEdge.attributes.data), edgeId, sdfg,
                    state.id
                );
                (newShortCutEdge as any).src_connector =
                    redirectedEdge.src_connector;
                (newShortCutEdge as any).dst_connector =
                    redirectedEdge.dst_connector;
                newShortCutEdge.data.attributes.shortcut = true;

                g.setEdge(
                    redirectedEdge.src, redirectedEdge.dst, newShortCutEdge,
                    edgeId.toString()
                );
            });
        }
    });

    dagre.layout(g);

    // Layout connectors and nested SDFGs.
    state.nodes.forEach((node: JsonSDFGNode, id: number) => {
        const gnode: any = g.node(id.toString());
        if (!gnode || (omitAccessNodes && gnode instanceof AccessNode)) {
            // Rgnore nodes that should not be drawn.
            return;
        }
        const topleft = gnode.topleft();

        // Offset nested SDFG.
        if (node.type === SDFGElementType.NestedSDFG && node.attributes.sdfg) {

            offset_sdfg(node.attributes.sdfg, gnode.data.graph, {
                x: topleft.x + SDFV.LINEHEIGHT,
                y: topleft.y + SDFV.LINEHEIGHT
            });
        }
        // Write back layout information.
        node.attributes.layout.x = gnode.x;
        node.attributes.layout.y = gnode.y;
        // Connector management.
        const SPACING = SDFV.LINEHEIGHT;
        const iConnLength = (SDFV.LINEHEIGHT + SPACING) * Object.keys(
            node.attributes.layout.in_connectors
        ).length - SPACING;
        const oConnLength = (SDFV.LINEHEIGHT + SPACING) * Object.keys(
            node.attributes.layout.out_connectors
        ).length - SPACING;
        let iConnX = gnode.x - iConnLength / 2.0 + SDFV.LINEHEIGHT / 2.0;
        let oConnX = gnode.x - oConnLength / 2.0 + SDFV.LINEHEIGHT / 2.0;

        for (const c of gnode.in_connectors) {
            c.width = SDFV.LINEHEIGHT;
            c.height = SDFV.LINEHEIGHT;
            c.x = iConnX;
            iConnX += SDFV.LINEHEIGHT + SPACING;
            c.y = topleft.y;
        }
        for (const c of gnode.out_connectors) {
            c.width = SDFV.LINEHEIGHT;
            c.height = SDFV.LINEHEIGHT;
            c.x = oConnX;
            oConnX += SDFV.LINEHEIGHT + SPACING;
            c.y = topleft.y + gnode.height;
        }
    });

    state.edges.forEach((edge: JsonSDFGEdge, id: number) => {
        const nedge = check_and_redirect_edge(edge, drawnNodes, state);
        if (!nedge) return;
        edge = nedge;
        const gedge = g.edge(edge.src, edge.dst, id.toString());
        if (!gedge || (omitAccessNodes &&
            gedge.data.attributes.shortcut === false
            || !omitAccessNodes && gedge.data.attributes.shortcut)) {
            // If access nodes omitted, don't draw non-shortcut edges and
            // vice versa.
            return;
        }

        // Reposition first and last points according to connectors.
        let srcConn = null;
        let dstConn = null;
        if (edge.src_connector) {
            const src_node: SDFGNode = g.node(edge.src);
            let cindex = -1;
            for (let i = 0; i < src_node.out_connectors.length; i++) {
                if (
                    src_node.out_connectors[i].data.name === edge.src_connector
                ) {
                    cindex = i;
                    break;
                }
            }
            if (cindex >= 0) {
                gedge.points[0].x = src_node.out_connectors[cindex].x;
                gedge.points[0].y = src_node.out_connectors[cindex].y;
                srcConn = src_node.out_connectors[cindex];
            }
        }
        if (edge.dst_connector) {
            const dstNode: SDFGNode = g.node(edge.dst);
            let cindex = -1;
            for (let i = 0; i < dstNode.in_connectors.length; i++) {
                const c = dstNode.in_connectors[i];
                if (c.data.name === edge.dst_connector) {
                    cindex = i;
                    break;
                }
            }
            if (cindex >= 0) {
                gedge.points[gedge.points.length - 1].x =
                    dstNode.in_connectors[cindex].x;
                gedge.points[gedge.points.length - 1].y =
                    dstNode.in_connectors[cindex].y;
                dstConn = dstNode.in_connectors[cindex];
            }
        }

        const n = gedge.points.length - 1;
        if (srcConn !== null)
            gedge.points[0] = intersectRect(srcConn, gedge.points[n]);
        if (dstConn !== null)
            gedge.points[n] = intersectRect(dstConn, gedge.points[0]);

        if (gedge.points.length === 3 &&
            gedge.points[0].x === gedge.points[n].x)
            gedge.points = [gedge.points[0], gedge.points[n]];

        const bb = calculateEdgeBoundingBox(gedge);
        // Convert from top-left to center
        (bb as any).x += bb.width / 2.0;
        (bb as any).y += bb.height / 2.0;

        edge.width = bb.width;
        edge.height = bb.height;
        edge.x = (bb as any).x;
        edge.y = (bb as any).y;
        gedge.width = bb.width;
        gedge.height = bb.height;
        gedge.x = (bb as any).x;
        gedge.y = (bb as any).y;
    });

    return g;
}

function relayoutSDFGBlock(
    ctx: CanvasRenderingContext2D, block: JsonSDFGBlock,
    sdfg: JsonSDFG, sdfgList: JsonSDFG[], stateParentList: any[],
    omitAccessNodes: boolean, parent: SDFGElement
): DagreSDFG | null {
    switch (block.type) {
        case SDFGElementType.LoopRegion:
        case SDFGElementType.ControlFlowRegion:
            return relayoutStateMachine(
                ctx, block as StateMachineType, sdfg, sdfgList, stateParentList,
                omitAccessNodes, parent
            );
        case SDFGElementType.SDFGState:
        case SDFGElementType.BasicBlock:
        default:
            return relayoutSDFGState(
                ctx, block as JsonSDFGState, sdfg, sdfgList, stateParentList,
                omitAccessNodes, parent
            );
    }
}

