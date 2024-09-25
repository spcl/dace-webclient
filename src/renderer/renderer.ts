// Copyright 2019-2024 ETH Zurich and the DaCe authors. All rights reserved.

import $ from 'jquery';

import dagre from 'dagre';
import EventEmitter from 'events';
import {
    DagreGraph,
    GenericSdfgOverlay,
    JsonSDFG,
    JsonSDFGBlock,
    JsonSDFGConditionalBlock,
    JsonSDFGControlFlowRegion,
    JsonSDFGEdge,
    JsonSDFGElement,
    JsonSDFGNode,
    JsonSDFGState,
    MemoryLocationOverlay,
    MemoryVolumeOverlay,
    ModeButtons,
    Point2D,
    SDFVTooltipFunc,
    SimpleRect,
    checkCompatSave,
    parse_sdfg,
    stringify_sdfg,
} from '../index';
import { SMLayouter } from '../layouter/state_machine/sm_layouter';
import { LViewLayouter } from '../local_view/lview_layouter';
import { LViewGraphParseError, LViewParser } from '../local_view/lview_parser';
import { LViewRenderer } from '../local_view/lview_renderer';
import { OverlayManager } from '../overlay_manager';
import { LogicalGroupOverlay } from '../overlays/logical_group_overlay';
import { ISDFV, SDFV, WebSDFV } from '../sdfv';
import {
    boundingBox,
    calculateBoundingBox,
    calculateEdgeBoundingBox,
} from '../utils/bounding_box';
import { sdfg_property_to_string } from '../utils/sdfg/display';
import { memletTreeComplete } from '../utils/sdfg/memlet_trees';
import {
    check_and_redirect_edge, deletePositioningInfo, deleteSDFGNodes,
    deleteCFGBlocks, findExitForEntry, findGraphElementByUUID,
    getPositioningInfo, getGraphElementUUID, findRootCFG,
} from '../utils/sdfg/sdfg_utils';
import { traverseSDFGScopes } from '../utils/sdfg/traversal';
import {
    SDFVSettingKey,
    SDFVSettingValT,
    SDFVSettings,
} from '../utils/sdfv_settings';
import { deepCopy, intersectRect, showErrorModal } from '../utils/utils';
import { CanvasManager } from './canvas_manager';
import {
    AccessNode, Connector,
    ControlFlowBlock,
    ControlFlowRegion,
    Edge, EntryNode, InterstateEdge, LoopRegion, Memlet, NestedSDFG,
    ScopeNode,
    SDFG,
    SDFGElement,
    SDFGElementType,
    SDFGElements,
    SDFGNode,
    State,
    Tasklet,
    drawSDFG,
    offset_sdfg,
    offset_state,
    ConditionalBlock,
    offset_conditional_region,
} from './renderer_elements';
import { cfgToDotGraph } from '../utils/sdfg/dotgraph';

// External, non-typescript libraries which are presented as previously loaded
// scripts and global javascript variables:
declare const blobStream: any;
declare const canvas2pdf: any;

// Some global functions and variables which are only accessible within VSCode:
declare const vscode: any | null;

export type SDFGElementGroup = ('states' | 'nodes' | 'edges' | 'isedges' |
    'connectors' | 'controlFlowRegions' |
    'controlFlowBlocks');
export interface SDFGElementInfo {
    sdfg: JsonSDFG,
    id: number,
    cfgId: number,
    stateId: number,
    connector?: number,
    conntype?: string,
}

export interface GraphElementInfo extends SDFGElementInfo {
    graph: DagreGraph,
    obj?: SDFGElement,
}

interface JsonSDFGElementInfo extends SDFGElementInfo {
    graph: JsonSDFGControlFlowRegion,
    obj?: JsonSDFGElement,
}

type GraphElemFunction = (
    elementGroup: SDFGElementGroup,
    elementInfo: GraphElementInfo,
    element: SDFGElement,
) => any;

type JsonSDFGElemFunction = (
    elementGroup: SDFGElementGroup,
    elementInfo: JsonSDFGElementInfo,
    element: JsonSDFGElement,
) => any;

// If type is explicitly set, dagre typecheck fails with integer node ids
//export type CFGListType = any[];//{ [key: number]: DagreGraph };
export type CFGListType = {
    [id: string]: {
        jsonObj: JsonSDFGControlFlowRegion,
        graph: DagreGraph | null,
        nsdfgNode: NestedSDFG | null,
    }
};

export type VisibleElementsType = {
    type: string,
    stateId: number,
    cfgId: number,
    id: number,
}[];

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

export type RendererUIFeature = (
    'menu' | 'settings' | 'overlays_menu' | 'zoom_to_fit_all' |
    'zoom_to_fit_width' | 'collapse' | 'expand' | 'add_mode' | 'pan_mode' |
    'move_mode' | 'box_select_mode' | 'cutout_selection' | 'local_view' |
    'minimap'
);

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
    'element_focus_changed': (selectionChanged: boolean) => void;
    'symbol_definition_changed': (symbol: string, definition?: number) => void;
    'active_overlays_changed': () => void;
    'backend_data_requested': (type: string, overlay: string) => void;
    'settings_changed': (
        settings: ReadonlyMap<SDFVSettingKey, SDFVSettingValT>
    ) => void;
}

/* eslint-disable @typescript-eslint/no-unsafe-declaration-merging */
export interface SDFGRenderer {

    on<U extends keyof SDFGRendererEvent>(
        event: U, listener: SDFGRendererEvent[U]
    ): this;

    emit<U extends keyof SDFGRendererEvent>(
        event: U, ...args: Parameters<SDFGRendererEvent[U]>
    ): boolean;

}

/* eslint-disable @typescript-eslint/no-unsafe-declaration-merging */
export class SDFGRenderer extends EventEmitter {

    protected cfgList: CFGListType = {};
    protected graph: DagreGraph | null = null;
    protected graphBoundingBox: DOMRect | null = null;
    // Parent-pointing CFG tree.
    protected cfgTree: { [key: number]: number } = {};
    // List of all state's parent elements.
    protected state_parent_list: any = {};
    protected in_vscode: boolean = false;
    protected dace_daemon_connected: boolean = false;

    // Rendering related fields.
    protected ctx: CanvasRenderingContext2D | null = null;
    protected canvas: HTMLCanvasElement | null = null;
    protected minimap_ctx: CanvasRenderingContext2D | null = null;
    protected minimap_canvas: HTMLCanvasElement | null = null;
    protected minimapBounds = { minX: 0, minY: 0, maxX: 0, maxY: 0 };
    protected canvas_manager: CanvasManager | null = null;
    protected last_dragged_element: SDFGElement | null = null;
    protected tooltip: SDFVTooltipFunc | null = null;
    protected tooltip_container: HTMLElement | null = null;
    public readonly overlayManager: OverlayManager;
    protected visible_rect: SimpleRect | null = null;
    protected static cssProps: { [key: string]: string } = {};
    protected hovered_elements_cache: Set<SDFGElement> = new Set<SDFGElement>();

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

    // Determine whether rendering only happens in the viewport or also outside.
    protected _viewportOnly: boolean = true;
    // Determine whether content should adaptively be hidden when zooming out.
    // Controlled by the SDFVSettings.
    protected _adaptiveHiding: boolean = true;

    protected readonly diffMode: boolean = false;

    public constructor(
        protected sdfg: JsonSDFG,
        protected container: HTMLElement,
        protected sdfv_instance?: ISDFV,
        protected external_mouse_handler: (
            (...args: any[]) => boolean
        ) | null = null,
        protected initialUserTransform: DOMMatrix | null = null,
        public debug_draw = false,
        protected backgroundColor: string | null = null,
        protected modeButtons: ModeButtons | null = null,
        protected enableMaskUI?: RendererUIFeature[]
    ) {
        super();

        this.overlayManager = new OverlayManager(this);

        this.in_vscode = false;
        try {
            vscode;
            if (vscode)
                this.in_vscode = true;
        } catch (ex) { }

        this.init_elements();

        this.setSDFG(this.sdfg, false).then(() => {
            this.on('collapse_state_changed', () => {
                this.emit('graph_edited');
            });
            this.on('element_position_changed', () => {
                this.emit('graph_edited');
            });
            this.on('selection_changed', () => {
                this.on_selection_changed();
            });
            this.on('graph_edited', () => {
                this.draw_async();
            });
        });

        SDFVSettings.getInstance().on('setting_changed', (setting) => {
            if (setting.relayout) {
                this.add_loading_animation();
                setTimeout(() => {
                    this.relayout();
                    this.draw_async();
                }, 10);
            }

            if (setting.redrawUI)
                this.initUI();

            if (setting.redraw !== false && !setting.relayout)
                this.draw_async();
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
            inclusive_ranges: SDFVSettings.get<boolean>('inclusiveRanges'),
            omit_access_nodes: !SDFVSettings.get<boolean>('showAccessNodes'),
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

        if (this.panmode_btn)
            this.panmode_btn.classList.remove('selected');

        if (this.movemode_btn)
            this.movemode_btn.classList.remove('selected');

        if (this.selectmode_btn)
            this.selectmode_btn.classList.remove('selected');

        this.mouse_follow_element.innerHTML = null;

        for (const add_btn of this.addmode_btns) {
            const btn_type = add_btn.getAttribute('type');
            if (btn_type === this.add_type && this.add_type) {
                add_btn.classList.add('selected');
                this.mouse_follow_element.innerHTML =
                    this.mouse_follow_svgs[this.add_type];
            } else {
                add_btn.classList.remove('selected');
            }
        }

        switch (this.mouse_mode) {
            case 'move':
                if (this.movemode_btn)
                    this.movemode_btn.classList.add('selected');
                if (this.interaction_info_box)
                    this.interaction_info_box.style.display = 'block';
                if (this.interaction_info_text) {
                    this.interaction_info_text.innerHTML =
                        'Middle Mouse: Pan view<br>' +
                        'Right Click: Reset position';
                }
                break;
            case 'select':
                if (this.selectmode_btn)
                    this.selectmode_btn.classList.add('selected');
                if (this.interaction_info_box)
                    this.interaction_info_box.style.display = 'block';
                if (this.interaction_info_text) {
                    if (this.ctrl_key_selection) {
                        this.interaction_info_text.innerHTML =
                            'Middle Mouse: Pan view';
                    } else {
                        this.interaction_info_text.innerHTML =
                            'Shift: Add to selection<br>' +
                            'Ctrl: Remove from selection<br>' +
                            'Middle Mouse: Pan view';
                    }
                }
                break;
            case 'add':
                if (this.interaction_info_box)
                    this.interaction_info_box.style.display = 'block';
                if (this.interaction_info_text) {
                    if (this.add_type === 'Edge') {
                        if (this.add_edge_start) {
                            this.interaction_info_text.innerHTML =
                                'Left Click: Select second element (to)<br>' +
                                'Middle Mouse: Pan view<br>' +
                                'Right Click / Esc: Abort';
                        } else {
                            this.interaction_info_text.innerHTML =
                                'Left Click: Select first element (from)<br>' +
                                'Middle Mouse: Pan view<br>' +
                                'Right Click / Esc: Abort';
                        }
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

    /**
     * Initialize the UI based on the user's settings.
     */
    public initUI(): void {
        if (!this.enableMaskUI || this.enableMaskUI.includes('minimap')) {
            if (SDFVSettings.get<boolean>('minimap'))
                this.enableMinimap();
            else
                this.disableMinimap();
        } else {
            this.disableMinimap();
        }

        if (SDFVSettings.get<boolean>('toolbar')) {
            // If the toolbar is already present, don't do anything.
            if (this.toolbar)
                return;

            // Construct the toolbar.
            this.toolbar = $('<div>', {
                class: 'button-bar',
                css: {
                    position: 'absolute',
                    top: '10px',
                    left: '10px',
                },
            });
            this.container.appendChild(this.toolbar[0]);

            // Construct menu.
            if (!this.enableMaskUI || this.enableMaskUI.includes('menu')) {
                const menuDropdown = $('<div>', {
                    class: 'dropdown',
                });
                $('<button>', {
                    class: 'btn btn-secondary btn-sm btn-material',
                    html: '<i class="material-symbols-outlined">menu</i>',
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
                $('<li>').appendTo(menu).append($('<span>', {
                    class: 'dropdown-item',
                    text: 'Export top-level CFG as DOT graph',
                    click: () => {
                        this.save(
                            (this.sdfg.attributes?.name ?? 'program') + '.dot',
                            'data:text/plain;charset=utf-8,' +
                            encodeURIComponent(cfgToDotGraph(this.sdfg))
                        );
                    },
                }));

                $('<li>').appendTo(menu).append($('<hr>', {
                    class: 'dropdown-divider',
                }));

                $('<li>').appendTo(menu).append($('<span>', {
                    class: 'dropdown-item',
                    text: 'Reset positions',
                    click: () => this.reset_positions(),
                }));
            }

            // SDFV Options.
            if (!this.enableMaskUI || this.enableMaskUI.includes('settings')) {
                $('<button>', {
                    class: 'btn btn-secondary btn-sm btn-material',
                    html: '<i class="material-symbols-outlined">settings</i>',
                    title: 'Settings',
                    click: () => {
                        SDFVSettings.getInstance().show();
                    },
                }).appendTo(this.toolbar);
            }

            // Overlays menu.
            if ((!this.enableMaskUI ||
                 this.enableMaskUI.includes('overlays_menu')) &&
                !this.in_vscode) {
                const overlayDropdown = $('<div>', {
                    class: 'dropdown',
                });
                $('<button>', {
                    class: 'btn btn-secondary btn-sm btn-material',
                    html: '<i class="material-symbols-outlined">' +
                        'saved_search</i>',
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
                    txt: string, ol: typeof GenericSdfgOverlay,
                    default_state: boolean
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
                        checked: default_state,
                        change: () => {
                            if (olInput.prop('checked'))
                                this.overlayManager.register_overlay(ol);
                            else
                                this.overlayManager.deregister_overlay(ol);
                        },
                    }).appendTo(olContainer);
                    $('<label>', {
                        class: 'form-check-label',
                        text: txt,
                    }).appendTo(olContainer);
                };

                // Register overlays that are turned on by default.
                this.overlayManager.register_overlay(LogicalGroupOverlay);
                addOverlayToMenu('Logical groups', LogicalGroupOverlay, true);

                // Add overlays that are turned off by default.
                addOverlayToMenu(
                    'Storage locations', MemoryLocationOverlay, false
                );
                addOverlayToMenu(
                    'Logical data movement volume', MemoryVolumeOverlay, false
                );
            }

            const zoomButtonGroup = $('<div>', {
                class: 'btn-group',
                role: 'group',
            }).appendTo(this.toolbar);
            if (!this.enableMaskUI ||
                 this.enableMaskUI.includes('zoom_to_fit_all')) {
                // Zoom to fit.
                $('<button>', {
                    class: 'btn btn-secondary btn-sm btn-material',
                    html: '<i class="material-symbols-outlined">fit_screen</i>',
                    title: 'Zoom to fit SDFG',
                    click: () => {
                        this.zoom_to_view();
                    },
                }).appendTo(zoomButtonGroup);
            }
            if (!this.enableMaskUI ||
                 this.enableMaskUI.includes('zoom_to_fit_width')) {
                $('<button>', {
                    class: 'btn btn-secondary btn-sm btn-material',
                    html: '<i class="material-symbols-outlined">fit_width</i>',
                    title: 'Zoom to fit width',
                    click: () => {
                        this.zoomToFitWidth();
                    },
                }).appendTo(zoomButtonGroup);
            }

            const collapseButtonGroup = $('<div>', {
                class: 'btn-group',
                role: 'group',
            }).appendTo(this.toolbar);
            if (!this.enableMaskUI ||
                 this.enableMaskUI.includes('collapse')) {
                // Collapse all.
                $('<button>', {
                    class: 'btn btn-secondary btn-sm btn-material',
                    html: '<i class="material-symbols-outlined">' +
                        'unfold_less</i>',
                    title: 'Collapse next level (Shift+click to collapse all)',
                    click: (e: MouseEvent) => {
                        if (e.shiftKey)
                            this.collapseAll();
                        else
                            this.collapseNextLevel();
                    },
                }).appendTo(collapseButtonGroup);
            }

            if (!this.enableMaskUI ||
                 this.enableMaskUI.includes('expand')) {
                // Expand all.
                $('<button>', {
                    class: 'btn btn-secondary btn-sm btn-material',
                    html: '<i class="material-symbols-outlined">' +
                        'unfold_more</i>',
                    title: 'Expand next level (Shift+click to expand all)',
                    click: (e: MouseEvent) => {
                        if (e.shiftKey)
                            this.expandAll();
                        else
                            this.expandNextLevel();
                    },
                }).appendTo(collapseButtonGroup);
            }

            if (this.modeButtons) {
                // If we get the "external" mode buttons we are in vscode and do
                // not need to create them.
                this.panmode_btn = this.modeButtons.pan;
                this.movemode_btn = this.modeButtons.move;
                this.selectmode_btn = this.modeButtons.select;
                this.addmode_btns = this.modeButtons.add_btns;
                if (!this.enableMaskUI ||
                    this.enableMaskUI.includes('add_mode')) {
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
                                    <SDFGElementType>add_btn.getAttribute(
                                        'type'
                                    );
                                this.add_mode_lib = null;
                                this.add_edge_start = null;
                                this.add_edge_start_conn = null;
                                this.update_toggle_buttons();
                            };
                        }
                    }
                }
                this.mode_selected_bg_color = '#22A4FE';
            } else {
                // Mode buttons are empty in standalone SDFV.
                this.addmode_btns = [];

                const modeButtonGroup = $('<div>', {
                    class: 'btn-group',
                    role: 'group',
                }).appendTo(this.toolbar);

                // Enter pan mode.
                if (!this.enableMaskUI ||
                    this.enableMaskUI.includes('pan_mode')) {
                    this.panmode_btn = $('<button>', {
                        class: 'btn btn-secondary btn-sm btn-material selected',
                        html: '<i class="material-symbols-outlined">' +
                            'pan_tool</i>',
                        title: 'Pan mode',
                    }).appendTo(modeButtonGroup)[0];
                }

                // Enter move mode.
                if (!this.enableMaskUI ||
                    this.enableMaskUI.includes('move_mode')) {
                    this.movemode_btn = $('<button>', {
                        class: 'btn btn-secondary btn-sm btn-material',
                        html: '<i class="material-symbols-outlined">' +
                            'open_with</i>',
                        title: 'Object moving mode',
                    }).appendTo(modeButtonGroup)[0];
                }

                // Enter box select mode.
                if (!this.enableMaskUI ||
                    this.enableMaskUI.includes('box_select_mode')) {
                    this.selectmode_btn = $('<button>', {
                        class: 'btn btn-secondary btn-sm btn-material',
                        html: '<i class="material-symbols-outlined">select</i>',
                        title: 'Select mode',
                    }).appendTo(modeButtonGroup)[0];
                }
            }

            // Enter pan mode
            if (this.panmode_btn) {
                if (!this.enableMaskUI ||
                    this.enableMaskUI.includes('pan_mode')) {
                    $(this.panmode_btn).prop('disabled', false);
                    this.panmode_btn.onclick = () => {
                        this.mouse_mode = 'pan';
                        this.add_type = null;
                        this.add_mode_lib = null;
                        this.add_edge_start = null;
                        this.add_edge_start_conn = null;
                        this.update_toggle_buttons();
                    };
                } else {
                    $(this.panmode_btn).prop('disabled', true);
                }
            }

            // Enter object moving mode
            if (this.movemode_btn) {
                if (!this.enableMaskUI ||
                    this.enableMaskUI.includes('move_mode')) {
                    $(this.movemode_btn).prop('disabled', false);
                    this.movemode_btn.onclick = (
                        _: MouseEvent,
                        shift_click: boolean | undefined = undefined
                    ): void => {
                        // shift_click is false if shift key has been released
                        // and undefined if it has been a normal mouse click.
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
                } else {
                    $(this.movemode_btn).prop('disabled', true);
                }
            }

            // Enter box selection mode
            if (this.selectmode_btn) {
                if (!this.enableMaskUI ||
                    this.enableMaskUI.includes('box_select_mode')) {
                    $(this.selectmode_btn).prop('disabled', false);
                    this.selectmode_btn.onclick = (
                        _: MouseEvent,
                        ctrl_click: boolean | undefined = undefined
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
                } else {
                    $(this.selectmode_btn).prop('disabled', true);
                }
            }

            // React to ctrl and shift key presses
            document.addEventListener('keydown', (e) => this.onKeyEvent(e));
            document.addEventListener('keyup', (e) => this.onKeyEvent(e));
            document.addEventListener('visibilitychange', () => {
                this.clear_key_events();
            });

            // Filter graph to selection (visual cutout).
            if (!this.enableMaskUI ||
                this.enableMaskUI.includes('cutout_selection')) {
                this.cutoutBtn = $('<button>', {
                    id: 'cutout-button',
                    class: 'btn btn-secondary btn-sm btn-material',
                    css: {
                        'display': 'none',
                    },
                    html: '<i class="material-symbols-outlined">' +
                        'content_cut</i>',
                    title: 'Filter selection (cutout)',
                    click: () => {
                        this.cutoutSelection();
                    },
                }).appendTo(this.toolbar);
            }

            // Transition to local view with selection.
            if (!this.enableMaskUI ||
                this.enableMaskUI.includes('local_view')) {
                this.localViewBtn = $('<button>', {
                    id: 'local-view-button',
                    class: 'btn btn-secondary btn-sm btn-material',
                    css: {
                        'display': 'none',
                    },
                    html: '<i class="material-symbols-outlined">memory</i>',
                    title: 'Inspect access patterns (local view)',
                    click: () => {
                        this.localViewSelection();
                    },
                }).appendTo(this.toolbar);
            }

            // Exit previewing mode.
            if (this.in_vscode) {
                const exitPreviewBtn = $('<button>', {
                    id: 'exit-preview-button',
                    class: 'btn btn-secondary btn-sm btn-material',
                    css: {
                        'display': 'none',
                    },
                    html: '<i class="material-symbols-outlined">close</i>',
                    title: 'Exit preview',
                    click: () => {
                        exitPreviewBtn.hide();
                        this.emit('exit_preview');
                    },
                }).appendTo(this.toolbar);
            }
        } else {
            if (this.toolbar) {
                this.container.removeChild(this.toolbar[0]);
                this.toolbar = null;
            }
        }
    }

    // Initializes the DOM
    public init_elements(): void {
        // Set up the canvas.
        this.canvas = document.createElement('canvas');
        this.canvas.classList.add('sdfg_canvas');
        if (this.backgroundColor)
            this.canvas.style.backgroundColor = this.backgroundColor;
        else
            this.canvas.style.backgroundColor = 'inherit';
        this.container.append(this.canvas);

        this.initUI();

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
        error_popover_dismiss.innerHTML =
            '<span class="material-symbols-outlined">close</span>';
        this.error_popover_container.appendChild(error_popover_dismiss);
        this.error_popover_container.appendChild(this.error_popover_text);
        this.container.appendChild(this.error_popover_container);

        this.ctx = this.canvas.getContext('2d');

        // This setting decouples the canvas paint cycle from the main event
        // loop. Not supported on Firefox, but can be enabled and Firefox will
        // ignore it. No fps difference measured on the SDFV webclient, but the
        // setting could become useful in the future in certain setups or
        // situations.
        // this.ctx = this.canvas.getContext('2d', {desynchronized: true});

        // WARNING: This setting will force CPU main thread rendering. Use for
        // testing only.
        // this.ctx = this.canvas.getContext('2d', {willReadFrequently: true});

        if (!this.ctx) {
            console.error('Failed to get canvas context, aborting');
            return;
        }

        // Translation/scaling management
        this.canvas_manager = new CanvasManager(this.ctx, this, this.canvas);
        if (this.initialUserTransform !== null)
            this.canvas_manager.set_user_transform(this.initialUserTransform);

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
        if (!this.backgroundColor) {
            this.backgroundColor =
                window.getComputedStyle(this.canvas).backgroundColor;
        }

        this.updateCFGList();

        // Create the initial SDFG layout
        // Loading animation already started in the file_read_complete function
        // in sdfv.ts to also include the JSON parsing step.
        this.relayout();

        // Set mouse event handlers
        this.set_mouse_handlers();

        // Set initial zoom, if not already set
        if (this.initialUserTransform === null)
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
        this._adaptiveHiding = SDFVSettings.get<boolean>(
            'adaptiveContentHiding'
        );
        this.clearCssPropertyCache();
        this.canvas_manager?.draw_async();
    }

    public setSDFVInstance(instance: ISDFV): void {
        this.sdfv_instance = instance;
    }

    public updateCFGList() {
        // Update SDFG metadata
        this.cfgTree = {};
        this.cfgList = {};
        this.cfgList[this.sdfg.cfg_list_id] = {
            jsonObj: this.sdfg,
            graph: null,
            nsdfgNode: null,
        };

        this.doForAllSDFGElements(
            (_oGroup, oInfo, obj) => {
                const cfgId = (obj as JsonSDFGControlFlowRegion).cfg_list_id;
                if (obj.type === SDFGElementType.NestedSDFG &&
                    obj.attributes.sdfg) {
                    this.cfgTree[obj.attributes.sdfg.cfg_list_id] =
                        oInfo.sdfg.cfg_list_id;
                    this.cfgList[obj.attributes.sdfg.cfg_list_id] = {
                        jsonObj: obj.attributes.sdfg as JsonSDFG,
                        graph: null,
                        nsdfgNode: null,
                    };
                } else if (cfgId !== undefined && cfgId >= 0) {
                    this.cfgTree[cfgId] = oInfo.cfgId;
                    this.cfgList[cfgId] = {
                        jsonObj: obj as JsonSDFGControlFlowRegion,
                        graph: null,
                        nsdfgNode: null,
                    };
                }
            }
        );
    }

    public async setSDFG(
        new_sdfg: JsonSDFG, layout: boolean = true
    ): Promise<void> {
        return new Promise((resolve)=> {
            this.sdfg = new_sdfg;

            // Update info box
            if (this.selected_elements.length === 1) {
                const uuid = getGraphElementUUID(this.selected_elements[0]);
                if (this.graph) {
                    this.sdfv_instance?.linkedUI.showElementInfo(
                        findGraphElementByUUID(this.cfgList, uuid), this
                    );
                }
            }

            if (layout) {
                this.updateCFGList();

                this.add_loading_animation();
                setTimeout(() => {
                    this.relayout();
                    this.draw_async();
                    resolve();
                }, 1);
            }

            this.all_memlet_trees_sdfg = memletTreeComplete(this.sdfg);

            this.update_fast_memlet_lookup();

            if (!layout)
                resolve();
        });
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
            'mousedown',
            'mousemove',
            'mouseup',
            'touchstart',
            'touchmove',
            'touchend',
            'wheel',
            'click',
            'dblclick',
            'contextmenu',
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
            for (const edge of tree)
                s.add(edge.attributes.data.edge);
            this.all_memlet_trees.push(s);
        }
    }

    // Add loading animation if not already present.
    // Appends a div of class "loader" to task-info-field
    // and task-info-field-settings divs.
    public add_loading_animation() {
        const info_field = document.getElementById('task-info-field');
        if (info_field && info_field.innerHTML === '') {
            const loaderDiv = document.createElement('div');
            loaderDiv.classList.add('loader');
            info_field.appendChild(loaderDiv);
        }
        const info_field_settings = document.getElementById(
            'task-info-field-settings'
        );
        if (info_field_settings && info_field_settings.innerHTML === '') {
            const loaderDiv = document.createElement('div');
            loaderDiv.classList.add('loader');
            info_field_settings.appendChild(loaderDiv);
        }
    }

    // Re-layout graph and nested graphs
    public relayout(instigator: SDFGElement | null = null): DagreGraph {
        if (!this.ctx)
            throw new Error('No context found while performing layouting');

        // Collect currently-visible elements for reorientation
        const elements = this.getVisibleElementsAsObjects(true);
        if (instigator)
            elements.push(instigator);

        for (const cfgId in this.cfgList) {
            this.cfgList[cfgId].graph = null;
            this.cfgList[cfgId].nsdfgNode = null;
        }
        this.graph = relayoutStateMachine(
            this.sdfg, this.sdfg, undefined, this.ctx, this.cfgList,
            this.state_parent_list,
            !SDFVSettings.get<boolean>('showAccessNodes')
        );
        const topLevelBlocks: SDFGElement[] = [];
        for (const bId of this.graph.nodes())
            topLevelBlocks.push(this.graph.node(bId));
        this.graphBoundingBox = boundingBox(topLevelBlocks);

        // Reorient view based on an approximate set of visible elements
        this.reorient(elements);

        this.onresize();

        this.update_fast_memlet_lookup();

        // Move the elements based on its positioning information
        this.translateMovedElements();

        // Make sure all visible overlays get recalculated if there are any.
        this.overlayManager.refresh();

        // If we're in a VSCode context, we also want to refresh the outline.
        if (this.in_vscode)
            this.sdfv_instance?.outline();

        // Remove loading animation
        const info_field = document.getElementById('task-info-field');
        if (info_field)
            info_field.innerHTML = '';
        const info_field_settings = document.getElementById(
            'task-info-field-settings'
        );
        if (info_field_settings)
            info_field_settings.innerHTML = '';

        return this.graph;
    }

    public reorient(old_visible_elements: SDFGElement[]): void {
        // Reorient view based on an approximate set of visible elements

        // Nothing to reorient to
        if (!old_visible_elements || old_visible_elements.length === 0)
            return;

        // If the current view contains everything that was visible before,
        // no need to change anything.
        const new_visible_elements = this.getVisibleElementsAsObjects(true);
        const old_nodes = old_visible_elements.filter(x => (
            x instanceof ControlFlowBlock ||
            x instanceof SDFGNode));
        const new_nodes = new_visible_elements.filter(x => (
            x instanceof ControlFlowBlock ||
            x instanceof SDFGNode));
        const old_set = new Set(old_nodes.map(x => x.guid()));
        const new_set = new Set(new_nodes.map(x => x.guid()));
        const diff = old_set.difference(new_set);
        if (diff.size === 0)
            return;

        // Reorient based on old visible elements refreshed to new locations
        const old_elements_in_new_layout: SDFGElement[] = [];
        this.doForAllGraphElements((group: SDFGElementGroup,
            info: GraphElementInfo, elem: SDFGElement) => {
            if (elem instanceof ControlFlowBlock || elem instanceof SDFGNode) {
                const guid = elem.guid();
                if (guid && old_set.has(guid))
                    old_elements_in_new_layout.push(elem);
            }
        });
        this.zoom_to_view(old_elements_in_new_layout, true, undefined, false);
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
                    if (scope_entry_node)
                        addScopeMovement(scope_entry_node);
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
                if (this.graph) {
                    this.canvas_manager?.translate_element(
                        node, { x: node.x, y: node.y },
                        { x: node.x + dx, y: node.y + dy }, this.graph,
                        this.cfgList, this.state_parent_list, undefined, false
                    );
                }
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
                    if (this.graph) {
                        this.canvas_manager?.translate_element(
                            edge, { x: 0, y: 0 },
                            { x: 0, y: 0 }, this.graph, this.cfgList,
                            this.state_parent_list, undefined, false, false,
                            final_pos_d
                        );
                    }
                }
            });
            return true;
        });
    }

    // Change translation and scale such that the chosen elements
    // (or entire graph if null) is in view
    public zoom_to_view(
        elements: any = null, animate: boolean = true, padding?: number,
        redraw: boolean = true
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
        if (padding > 0 && this.canvas) {
            paddingAbs = Math.min(
                (this.canvas.width / 100) * padding,
                (this.canvas.height / 100) * padding
            );
        }

        const bb = boundingBox(elements, paddingAbs);
        this.canvas_manager?.set_view(bb, animate);

        if (redraw)
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
            collapsible: NestedSDFG | EntryNode | ControlFlowBlock,
            parentElement: SDFGElement | null,
            graph: DagreGraph
        ): boolean {
            if (collapsible.attributes().is_collapsed)
                return false;
            let collapsedSomething = false;
            const collapsibles = [];
            const nParent = collapsible;
            let nGraph = graph;
            if (collapsible instanceof NestedSDFG ||
                collapsible instanceof ControlFlowRegion) {
                for (const nid of collapsible.data.graph.nodes())
                    collapsibles.push(collapsible.data.graph.node(nid));
                nGraph = collapsible.data.graph;
            } else if (collapsible instanceof State) {
                const scopeNodeIds = collapsible.data.state.scope_dict[-1];
                for (const nid of scopeNodeIds)
                    collapsibles.push(collapsible.data.graph.node(nid));
                nGraph = collapsible.data.graph;
            } else {
                if (parentElement && parentElement instanceof State) {
                    const scopeNodeIds = parentElement.data.state.scope_dict[
                        collapsible.id
                    ];
                    for (const nid of scopeNodeIds)
                        collapsibles.push(graph.node(nid.toString()));
                }
            }

            for (const node of collapsibles) {
                if (node instanceof NestedSDFG || node instanceof State ||
                    node instanceof EntryNode ||
                    node instanceof ControlFlowRegion) {
                    const recursiveRes = recursiveCollapse(
                        node, nParent, nGraph
                    );
                    collapsedSomething ||= recursiveRes;
                }
            }

            if (!collapsedSomething)
                collapsible.attributes().is_collapsed = true;
            return true;
        }

        let collapsed = false;
        for (const sId of this.graph.nodes()) {
            const state = this.graph.node(sId);
            const res = recursiveCollapse(state, null, this.graph);
            collapsed ||= res;
        }

        if (collapsed) {
            this.emit('collapse_state_changed', false, true);

            this.add_loading_animation();
            // Use timeout function with low delay to force the browser
            // to reload the dom with the above loader element.
            setTimeout(() => {
                this.relayout();
                this.draw_async();
            }, 10);
        }
    }

    public collapseAll(): void {
        this.doForAllSDFGElements(
            (_t, _d, obj) => {
                if ('is_collapsed' in obj.attributes &&
                    !obj.type.endsWith('Exit'))
                    obj.attributes.is_collapsed = true;
            }
        );

        this.emit('collapse_state_changed', true, true);

        this.add_loading_animation();
        // Use timeout function with low delay to force the browser
        // to reload the dom with the above loader element.
        setTimeout(() => {
            this.relayout();
            this.draw_async();
        }, 10);
    }

    public expandNextLevel(): void {
        if (!this.graph)
            return;

        traverseSDFGScopes(
            this.graph, (node: SDFGNode, _: DagreGraph) => {
                if (node.attributes().is_collapsed) {
                    node.attributes().is_collapsed = false;
                    return false;
                }
                return true;
            }
        );

        this.emit('collapse_state_changed', false, true);

        this.add_loading_animation();
        // Use timeout function with low delay to force the browser
        // to reload the dom with the above loader element.
        setTimeout(() => {
            this.relayout();
            this.draw_async();
        }, 10);
    }

    public expandAll(): void {
        this.doForAllSDFGElements(
            (_t, _d, obj) => {
                if ('is_collapsed' in obj.attributes &&
                    !obj.type.endsWith('Exit'))
                    obj.attributes.is_collapsed = false;
            }
        );

        this.emit('collapse_state_changed', false, true);

        this.add_loading_animation();
        // Use timeout function with low delay to force the browser
        // to reload the dom with the above loader element.
        setTimeout(() => {
            this.relayout();
            this.draw_async();
        }, 10);
    }

    public reset_positions(): void {
        this.doForAllSDFGElements(
            (_t, _d, obj) => {
                deletePositioningInfo(obj);
            }
        );

        this.emit('element_position_changed', 'reset');

        this.add_loading_animation();
        // Use timeout function with low delay to force the browser
        // to reload the dom with the above loader element.
        setTimeout(() => {
            this.relayout();
            this.draw_async();
        }, 10);
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
        this.add_loading_animation();

        // Use setTimeout to force browser to update the DOM with the above
        // loading animation.
        setTimeout(() => {
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

            const ctx = new canvas2pdf.PdfContext(stream, { size: size });
            const oldctx = this.ctx;
            this.ctx = ctx;

            // Necessary for "what you see is what you get" in the exported pdf
            // file.
            const oldViewportOnly = this._viewportOnly;
            const oldAdaptiveHiding = this._adaptiveHiding;
            if (!save_all) {
                // User wants to save the view as they see it on the screen.
                this._viewportOnly = true;
                this._adaptiveHiding = SDFVSettings.get<boolean>(
                    'adaptiveContentHiding'
                );
            } else {
                // User wants to save all details in the view.
                this._viewportOnly = false;
                this._adaptiveHiding = false;
            }
            (this.ctx as any).pdf = true;
            // Center on saved region
            if (!save_all)
                this.ctx?.translate(-(curx ? curx : 0), -(cury ? cury : 0));

            this.draw_async();

            ctx.stream.on('finish', () => {
                const name = this.sdfg.attributes.name;
                this.save(
                    name + '.pdf', ctx.stream.toBlobURL('application/pdf')
                );
                this.ctx = oldctx;
                this._viewportOnly = oldViewportOnly;
                this._adaptiveHiding = oldAdaptiveHiding;
                this.draw_async();
                // Remove loading animation
                const info_field = document.getElementById('task-info-field');
                if (info_field)
                    info_field.innerHTML = '';
                const info_field_settings = document.getElementById(
                    'task-info-field-settings'
                );
                if (info_field_settings)
                    info_field_settings.innerHTML = '';
            });
        }, 10);
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
            targetHeight = Math.floor(this.canvas.height * maxPercentage);
        if (targetWidth > this.canvas.width * maxPercentage)
            targetWidth = Math.floor(this.canvas.width * maxPercentage);

        // Prevent forced style reflow if nothing changed
        // Can save about 0.5ms of computation
        if (this.minimap_canvas.height !== targetHeight) {
            this.minimap_canvas.height = targetHeight;
            this.minimap_canvas.style.height = targetHeight.toString() + 'px';
        }
        if (this.minimap_canvas.width !== targetWidth) {
            this.minimap_canvas.width = targetWidth;
            this.minimap_canvas.style.width = targetWidth.toString() + 'px';
        }

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

        this.minimapBounds.minX = 0 - originX / scale;
        this.minimapBounds.minY = 0 - originY / scale;
        this.minimapBounds.maxX = this.minimapBounds.minX + (
            this.minimap_canvas.width / scale
        );
        this.minimapBounds.maxY = this.minimapBounds.minY + (
            this.minimap_canvas.height / scale
        );
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
            h: curh,
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
        this.overlayManager.draw();

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
                const problemElem = findGraphElementByUUID(
                    this.cfgList, sdfg_id + '/' + state_id + '/' + el_id + '/-1'
                );
                if (problemElem) {
                    if (problemElem && problemElem instanceof SDFGElement)
                        this.zoom_to_view([problemElem]);
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

    public getVisibleElements(): VisibleElementsType {
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
            (group, objInfo, _obj) => {
                let elType = 'other';
                if (group === 'nodes')
                    elType = 'node';
                else if (group === 'states')
                    elType = 'state';
                else if (group === 'edges')
                    elType = 'edge';
                else if (group === 'isedges')
                    elType = 'isedge';
                else if (group === 'connectors')
                    elType = 'connector';
                else if (group === 'controlFlowRegions')
                    elType = 'controlFlowRegion';
                else if (group === 'controlFlowBlocks')
                    elType = 'controlFlowBlock';
                elements.push({
                    type: elType,
                    cfgId: objInfo.cfgId,
                    stateId: objInfo.stateId,
                    id: objInfo.id,
                });
            }
        );
        return elements;
    }

    public getVisibleElementsAsObjects(
        entirely_visible: boolean
    ): SDFGElement[] {
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
            (group, objInfo, _obj) => {
                if (entirely_visible &&
                    !_obj.contained_in(curx, cury, curw, curh))
                    return;
                elements.push(_obj);
            }
        );
        return elements;
    }

    public doForVisibleElements(func: GraphElemFunction): void {
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
    // states, controlFlowRegions, controlFlowBlocks, nodes, connectors, edges,
    // isedges (interstate edges).
    // For example:
    // {
    //  'states': [{sdfg: sdfg_name, state: 1}, ...],
    //  'nodes': [{sdfg: sdfg_name, state: 1, node: 5}, ...],
    //  'edges': [],
    //  'isedges': [],
    //  'connectors': [],
    //  'controlFlowRegions': [],
    //  'controlFlowBlocks': [],
    // }
    public elementsInRect(
        x: number, y: number, w: number, h: number
    ): Record<SDFGElementGroup, GraphElementInfo[]> {
        const elements: any = {
            states: [],
            nodes: [],
            connectors: [],
            edges: [],
            isedges: [],
            controlFlowRegions: [],
            controlFlowBlocks: [],
        };
        this.doForIntersectedElements(
            x, y, w, h, (group, objInfo, obj) => {
                objInfo.obj = obj;
                elements[group].push(objInfo);
            }
        );
        return elements;
    }

    public doForIntersectedElements(
        x: number, y: number, w: number, h: number, func: GraphElemFunction
    ): void {
        if (!this.graph)
            return;

        // Traverse nested SDFGs recursively.
        function doRecursive(
            g: DagreGraph, cfg: JsonSDFGControlFlowRegion, sdfg: JsonSDFG
        ): void {
            g.nodes().forEach((blockIdString: string) => {
                const block: ControlFlowBlock = g.node(blockIdString);
                if (!block)
                    return;

                const blockId = Number(blockIdString);
                if (block.intersect(x, y, w, h)) {
                    const elemInfo = {
                        sdfg: sdfg,
                        graph: g,
                        id: blockId,
                        cfgId: cfg.cfg_list_id,
                        stateId: -1,
                    };
                    let elemGroup: SDFGElementGroup;
                    if (block instanceof State)
                        elemGroup = 'states';
                    else if (block instanceof ControlFlowRegion)
                        elemGroup = 'controlFlowRegions';
                    else
                        elemGroup = 'controlFlowBlocks';
                    func(elemGroup, elemInfo, block);

                    if (block.attributes()?.is_collapsed)
                        return;

                    const ng = block.data.graph;
                    if (!ng)
                        return;

                    if (block instanceof State) {
                        ng.nodes().forEach((nodeIdString: string) => {
                            const node = ng.node(nodeIdString);
                            const nodeId = Number(nodeIdString);
                            if (node.intersect(x, y, w, h)) {
                                // Selected nodes
                                func(
                                    'nodes',
                                    {
                                        sdfg: sdfg,
                                        graph: ng,
                                        id: nodeId,
                                        cfgId: cfg.cfg_list_id,
                                        stateId: blockId,
                                    },
                                    node
                                );

                                // If nested SDFG, traverse recursively
                                if (node.data.node.type ===
                                    SDFGElementType.NestedSDFG &&
                                    node.attributes().sdfg) {
                                    const nsdfg = node.attributes().sdfg;
                                    doRecursive(node.data.graph, nsdfg, nsdfg);
                                }
                            }
                            // Connectors
                            node.in_connectors.forEach(
                                (c: Connector, i: number) => {
                                    if (c.intersect(x, y, w, h)) {
                                        func(
                                            'connectors',
                                            {
                                                sdfg: sdfg,
                                                graph: ng,
                                                id: nodeId,
                                                cfgId: cfg.cfg_list_id,
                                                stateId: blockId,
                                                connector: i,
                                                conntype: 'in',
                                            },
                                            c
                                        );
                                    }
                                }
                            );
                            node.out_connectors.forEach(
                                (c: Connector, i: number) => {
                                    if (c.intersect(x, y, w, h)) {
                                        func(
                                            'connectors',
                                            {
                                                sdfg: sdfg,
                                                graph: ng,
                                                id: nodeId,
                                                cfgId: cfg.cfg_list_id,
                                                stateId: blockId,
                                                connector: i,
                                                conntype: 'out',
                                            },
                                            c
                                        );
                                    }
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
                                        sdfg: sdfg,
                                        graph: g,
                                        id: edge.id,
                                        cfgId: cfg.cfg_list_id,
                                        stateId: blockId,
                                    },
                                    edge
                                );
                            }
                        });
                    } else {
                        doRecursive(
                            block.data.graph, block.data.block, sdfg
                        );
                    }
                }
            });

            // Selected inter-state edges
            g.edges().forEach(isedge_id => {
                const isedge = g.edge(isedge_id) as InterstateEdge;
                if (isedge.intersect(x, y, w, h)) {
                    func(
                        'isedges',
                        {
                            sdfg: sdfg,
                            graph: g,
                            id: isedge.id,
                            cfgId: cfg.cfg_list_id,
                            stateId: -1,
                        },
                        isedge
                    );
                }
            });
        }

        // Start with top-level SDFG.
        doRecursive(this.graph, this.sdfg, this.sdfg);
    }

    public doForAllSDFGElements(func: JsonSDFGElemFunction): void {
        // Traverse nested SDFGs recursively
        function doRecursive(cfg: JsonSDFGControlFlowRegion, sdfg: JsonSDFG) {
            cfg.nodes.forEach((block: JsonSDFGBlock, blockId: number) => {
                if (block.type === SDFGElementType.SDFGState) {
                    func(
                        'states', {
                            sdfg: sdfg,
                            graph: cfg,
                            id: blockId,
                            cfgId: cfg.cfg_list_id,
                            stateId: -1,
                        }, block
                    );

                    const state: JsonSDFGState = block as JsonSDFGState;
                    state.nodes.forEach((node: JsonSDFGNode, nId: number) => {
                        // Nodes
                        func(
                            'nodes',
                            {
                                sdfg: sdfg,
                                graph: cfg,
                                id: nId,
                                cfgId: cfg.cfg_list_id,
                                stateId: blockId,
                            },
                            node
                        );

                        // If nested SDFG, traverse recursively
                        if (node.type === SDFGElementType.NestedSDFG &&
                            node.attributes.sdfg) {
                            doRecursive(
                                node.attributes.sdfg, node.attributes.sdfg
                            );
                        }
                    });

                    // Edges
                    state.edges.forEach(
                        (edge: JsonSDFGEdge, edgeId: number) => {
                            func(
                                'edges',
                                {
                                    sdfg: sdfg,
                                    graph: cfg,
                                    id: edgeId,
                                    cfgId: cfg.cfg_list_id,
                                    stateId: blockId,
                                },
                                edge
                            );
                        }
                    );
                } else if (
                    'start_block' in block && 'cfg_list_id' in block &&
                    'nodes' in block && 'edges' in block
                ) {
                    // Control flow region.
                    func('controlFlowRegions', {
                        sdfg: sdfg,
                        graph: cfg,
                        id: blockId,
                        cfgId: cfg.cfg_list_id,
                        stateId: -1,
                    }, block);
                    doRecursive(block as JsonSDFGControlFlowRegion, sdfg);
                } else if ('branches' in block) {
                    func('controlFlowBlocks', {
                        sdfg: sdfg,
                        graph: cfg,
                        id: blockId,
                        cfgId: cfg.cfg_list_id,
                        stateId: block.id,
                    }, block);
                    const conditRegion = block as JsonSDFGConditionalBlock;
                    for (const el of conditRegion.branches) {
                        // Control flow region.
                        func('controlFlowRegions', {
                            sdfg: sdfg,
                            graph: cfg,
                            id: blockId,
                            cfgId: cfg.cfg_list_id,
                            stateId: -1,
                        }, el[1]);
                        doRecursive(el[1] as JsonSDFGControlFlowRegion, sdfg);
                    }
                }
            });

            // Selected inter-state edges
            cfg.edges.forEach((isedge: JsonSDFGEdge, isEdgeId: number) => {
                func('isedges', {
                    sdfg: sdfg,
                    graph: cfg,
                    id: isEdgeId,
                    cfgId: cfg.cfg_list_id,
                    stateId: -1,
                }, isedge);
            });
        }

        // Start with top-level SDFG
        doRecursive(this.sdfg, this.sdfg);
    }

    public doForAllGraphElements(func: GraphElemFunction): void {
        // Traverse nested SDFGs recursively
        function doRecursive(
            g: DagreGraph | null, cfg: JsonSDFGControlFlowRegion, sdfg: JsonSDFG
        ) {
            g?.nodes().forEach(blockIdString => {
                const block: ControlFlowBlock = g.node(blockIdString);
                if (!block)
                    return;
                const blockId = Number(blockIdString);

                if (block instanceof State) {
                    // States
                    func(
                        'states',
                        {
                            sdfg: sdfg,
                            graph: g,
                            id: blockId,
                            cfgId: cfg.cfg_list_id,
                            stateId: -1,
                        },
                        block
                    );

                    if (block.data.state.attributes.is_collapsed)
                        return;

                    const ng = block.data.graph;
                    if (!ng)
                        return;
                    ng.nodes().forEach((nodeIdString: string) => {
                        const node = ng.node(nodeIdString);
                        const nodeId = Number(nodeIdString);
                        // Selected nodes
                        func(
                            'nodes',
                            {
                                sdfg: sdfg,
                                graph: ng,
                                id: nodeId,
                                cfgId: cfg.cfg_list_id,
                                stateId: blockId,
                            },
                            node
                        );

                        // If nested SDFG, traverse recursively
                        if (node.data.node.type ===
                            SDFGElementType.NestedSDFG) {
                            doRecursive(
                                node.data.graph,
                                node.data.node.attributes.sdfg,
                                node.data.node.attributes.sdfg
                            );
                        }

                        // Connectors
                        node.in_connectors.forEach(
                            (c: Connector, i: number) => {
                                func(
                                    'connectors', {
                                        sdfg: sdfg,
                                        graph: ng,
                                        id: nodeId,
                                        cfgId: cfg.cfg_list_id,
                                        stateId: blockId,
                                        connector: i,
                                        conntype: 'in',
                                    }, c
                                );
                            }
                        );
                        node.out_connectors.forEach(
                            (c: Connector, i: number) => {
                                func(
                                    'connectors', {
                                        sdfg: sdfg,
                                        graph: ng,
                                        id: nodeId,
                                        cfgId: cfg.cfg_list_id,
                                        stateId: blockId,
                                        connector: i,
                                        conntype: 'out',
                                    }, c
                                );
                            }
                        );
                    });

                    // Selected edges
                    ng.edges().forEach((edge_id: number) => {
                        const edge = ng.edge(edge_id);
                        func(
                            'edges',
                            {
                                sdfg: sdfg,
                                graph: ng,
                                id: edge.id,
                                cfgId: cfg.cfg_list_id,
                                stateId: blockId,
                            },
                            edge
                        );
                    });
                } else if (block instanceof ControlFlowRegion) {
                    // Control Flow Regions.
                    func(
                        'controlFlowRegions',
                        {
                            sdfg: sdfg,
                            graph: g,
                            id: blockId,
                            cfgId: cfg.cfg_list_id,
                            stateId: -1,
                        },
                        block
                    );
                    const ng = block.data.graph;
                    if (ng)
                        doRecursive(ng, block.data.block, sdfg);
                } else {
                    // Other (unknown) control flow blocks.
                    func(
                        'controlFlowBlocks',
                        {
                            sdfg: sdfg,
                            graph: g,
                            id: blockId,
                            cfgId: cfg.cfg_list_id,
                            stateId: -1,
                        },
                        block
                    );
                }
            });

            // Selected inter-state edges
            g?.edges().forEach(isedge_id => {
                const isedge = g.edge(isedge_id) as InterstateEdge;
                func(
                    'isedges',
                    {
                        sdfg: sdfg,
                        graph: g,
                        id: isedge.id,
                        cfgId: cfg.cfg_list_id,
                        stateId: -1,
                    },
                    isedge
                );
            });
        }

        // Start with top-level SDFG
        doRecursive(this.graph, this.sdfg, this.sdfg);
    }

    public getNestedMemletTree(edge: Edge): Set<Edge> {
        for (const tree of this.all_memlet_trees) {
            if (tree.has(edge))
                return tree;
        }
        return new Set<Edge>();
    }

    public find_elements_under_cursor(
        mouse_pos_x: number, mouse_pos_y: number
    ): {
        total_elements: number,
        elements: Record<SDFGElementGroup, GraphElementInfo[]>,
        foreground_elem: SDFGElement | null,
        foreground_connector: Connector | null,
    } {
        // Find all elements under the cursor.
        const elements = this.elementsInRect(mouse_pos_x, mouse_pos_y, 0, 0);
        const clicked_states = elements.states;
        const clicked_nodes = elements.nodes;
        const clicked_edges = elements.edges;
        const clicked_interstate_edges = elements.isedges;
        const clicked_connectors = elements.connectors;
        const clicked_cfg_regions = elements.controlFlowRegions;
        const clicked_cfg_blocks = elements.controlFlowBlocks;
        const total_elements =
            clicked_states.length + clicked_nodes.length +
            clicked_edges.length + clicked_interstate_edges.length +
            clicked_connectors.length + clicked_cfg_regions.length +
            clicked_cfg_blocks.length;
        let foreground_elem = null, foreground_surface = -1;
        let foreground_connector = null;

        // Find the top-most element under the mouse cursor (i.e. the one with
        // the smallest dimensions).
        const categories = [
            clicked_states,
            clicked_interstate_edges,
            clicked_nodes,
            clicked_edges,
            clicked_cfg_regions,
            clicked_cfg_blocks,
        ];
        for (const category of categories) {
            for (let i = 0; i < category.length; i++) {
                const obj = category[i].obj;
                const s = obj!.width * obj!.height;
                if (foreground_surface < 0 || s < foreground_surface) {
                    foreground_surface = s;
                    foreground_elem = category[i].obj ?? null;
                }
            }
        }

        for (const c of clicked_connectors) {
            const s = c.obj!.width * c.obj!.height;
            if (foreground_surface < 0 || s < foreground_surface) {
                foreground_surface = s;
                foreground_connector = c.obj as Connector ?? null;
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

    public onKeyEvent(event: KeyboardEvent): boolean {
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
                } else if (e instanceof Memlet) {
                    const state: JsonSDFGState = e.parentElem?.data.state;
                    if (state) {
                        state.edges = state.edges.filter(
                            (_, ind: number) => ind !== e.id
                        );
                    }
                } else if (e instanceof InterstateEdge) {
                    if (!e.parentElem ||
                        (e.parentElem && e.parentElem instanceof SDFG)) {
                        e.sdfg.edges = e.sdfg.edges.filter(
                            (_, ind: number) => ind !== e.id
                        );
                    } else {
                        const tGraph = e.parentElem.data.block;
                        tGraph.edges = tGraph.edges.filter(
                            (_: any, ind: number) => ind !== e.id
                        );
                    }
                } else if (e instanceof ControlFlowBlock) {
                    if (e.parentElem &&
                        e.parentElem instanceof ControlFlowRegion)
                        deleteCFGBlocks(e.parentElem.data.block, [e.id]);
                    else
                        deleteCFGBlocks(e.sdfg, [e.id]);
                } else {
                    deleteSDFGNodes(e.sdfg, e.parent_id!, [e.id]);
                }
            }
            this.deselect();
            this.setSDFG(this.sdfg).then(() => {
                this.emit('graph_edited');
            });
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

    // Checks if pan mouse movement is in the bounds of the graph.
    // Takes the current visible_rect as input and computes if its center is
    // within the graph bounds. The pan mouse movement (movX, movY) is
    // corrected accordingly to have a smooth view pan blocking.
    // Returns: corrected movement x/y coordinates to input into
    // this.canvas_manager?.translate()
    public pan_movement_in_bounds(
        visible_rect: SimpleRect, movX: number, movY: number
    ) {
        if (!SDFVSettings.get<boolean>('bindToViewport') ||
            !this.graphBoundingBox) {
            return {
                x: movX,
                y: movY,
            };
        }

        // Compute where the visible_rectCenter is out of bounds:
        // outofboundsX/Y === 0 means not out of bounds
        let outofboundsX = 0;
        let outofboundsY = 0;

        const padding = 50;
        if (visible_rect.x + visible_rect.w <
            (this.graphBoundingBox.left + padding))
            outofboundsX = -1;
        else if (visible_rect.x > (this.graphBoundingBox.right - padding))
            outofboundsX = 1;

        if (visible_rect.y + visible_rect.h <
            (this.graphBoundingBox.top + padding))
            outofboundsY = -1;
        else if (visible_rect.y > (this.graphBoundingBox.bottom) - padding)
            outofboundsY = 1;

        // Take uncorrected mouse event movement as default
        const correctedMovement = {
            x: movX,
            y: movY,
        };

        // Correct mouse movement if necessary
        if ((outofboundsX === -1 && correctedMovement.x > 0) ||
            (outofboundsX === 1 && correctedMovement.x < 0))
            correctedMovement.x = 0;
        if ((outofboundsY === -1 && correctedMovement.y > 0) ||
            (outofboundsY === 1 && correctedMovement.y < 0))
            correctedMovement.y = 0;

        return correctedMovement;
    }

    // Toggles collapsed state of foreground_elem if applicable.
    // Returns true if re-layout occured and re-draw is necessary.
    public toggle_element_collapse(
        foreground_elem: SDFGElement | null
    ): boolean {
        if (!foreground_elem)
            return false;

        const sdfg = (foreground_elem ? foreground_elem.sdfg : null);
        let sdfg_elem = null;
        if (foreground_elem instanceof State) {
            sdfg_elem = foreground_elem.data.state;
        } else if (foreground_elem instanceof ControlFlowBlock) {
            sdfg_elem = foreground_elem.data.block;
        } else if (foreground_elem instanceof SDFGNode) {
            sdfg_elem = foreground_elem.data.node;

            // If a scope exit node, use entry instead
            if (sdfg_elem.type.endsWith('Exit') &&
                foreground_elem.parent_id !== null) {
                const parent = sdfg!.nodes[foreground_elem.parent_id];
                if (parent.nodes)
                    sdfg_elem = parent.nodes[sdfg_elem.scope_entry];
            }
        } else {
            sdfg_elem = null;
        }

        // Toggle collapsed state
        if (foreground_elem.COLLAPSIBLE) {
            this.emit('collapse_state_changed');

            // Re-layout SDFG
            this.add_loading_animation();
            setTimeout(() => {
                if ('is_collapsed' in sdfg_elem.attributes) {
                    sdfg_elem.attributes.is_collapsed =
                        !sdfg_elem.attributes.is_collapsed;
                } else {
                    sdfg_elem.attributes['is_collapsed'] = true;
                }

                this.relayout(foreground_elem);
                this.draw_async();
            }, 10);

            return true;
        }

        return false;
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
            this.onKeyEvent(event);

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
                y: comp_y_func(event),
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
                                        this.cfgList[list_id].graph?.node(
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
                            if (old_mousepos) {
                                this.canvas_manager?.translate_element(
                                    el, old_mousepos, this.mousepos,
                                    this.graph, this.cfgList,
                                    this.state_parent_list,
                                    this.drag_start,
                                    true,
                                    move_entire_edge
                                );
                            }
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
                    // Mouse move in panning mode
                    if (this.visible_rect) {
                        // Check if mouse panning is in bounds (near graph)
                        // and restrict/correct it.
                        const correctedMovement = this.pan_movement_in_bounds(
                            this.visible_rect, event.movementX, event.movementY
                        );

                        this.canvas_manager?.translate(
                            correctedMovement.x, correctedMovement.y
                        );

                        // Mark for redraw
                        dirty = true;
                    }
                }
            } else if (this.drag_start && event.buttons & 4) {
                // Pan the view with the middle mouse button
                this.dragging = true;
                if (this.visible_rect) {
                    // Check if mouse panning is in bounds (near graph)
                    // and restrict/correct it.
                    const correctedMovement = this.pan_movement_in_bounds(
                        this.visible_rect, event.movementX, event.movementY
                    );

                    this.canvas_manager?.translate(
                        correctedMovement.x, correctedMovement.y
                    );
                    dirty = true;
                }
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
                if (this.visible_rect) {
                    const movX = (
                        event.touches[0].clientX -
                        this.drag_start.touches[0].clientX
                    );
                    const movY = (
                        event.touches[0].clientY -
                        this.drag_start.touches[0].clientY
                    );

                    // Check if panning is in bounds (near graph)
                    // and restrict/correct it.
                    const correctedMovement = this.pan_movement_in_bounds(
                        this.visible_rect, movX, movY
                    );

                    this.canvas_manager?.translate(
                        correctedMovement.x, correctedMovement.y
                    );
                }
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

                if (this.visible_rect) {
                    // First, translate according to movement of center point
                    const movX = newCenter[0] - oldCenter[0];
                    const movY = newCenter[1] - oldCenter[1];

                    // Check if movement is in bounds (near graph)
                    // and restrict/correct it.
                    const correctedMovement = this.pan_movement_in_bounds(
                        this.visible_rect, movX, movY
                    );

                    this.canvas_manager?.translate(
                        correctedMovement.x, correctedMovement.y
                    );

                    // Then scale
                    this.canvas_manager?.scale(
                        currentDistance / initialDistance, newCenter[0],
                        newCenter[1]
                    );
                }

                this.drag_start = event;

                // Mark for redraw
                dirty = true;
                this.draw_async();
                return false;
            }
        } else if (evtype === 'wheel') {
            const useScrollNav = SDFVSettings.get<boolean>(
                'useVerticalScrollNavigation'
            );
            if (useScrollNav && !event.ctrlKey ||
                !useScrollNav && event.ctrlKey) {
                // If vertical scroll navigation is turned on, use this to
                // move the viewport up and down. If the control key is held
                // down while scrolling, treat it as a typical zoom operation.
                if (this.visible_rect) {
                    const movX = 0;
                    const movY = -event.deltaY;

                    // Check if scroll is in bounds (near graph)
                    // and restrict/correct it.
                    const correctedMovement = this.pan_movement_in_bounds(
                        this.visible_rect, movX, movY
                    );

                    this.canvas_manager?.translate(
                        correctedMovement.x, correctedMovement.y
                    );
                    dirty = true;
                    element_focus_changed = true;
                }
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
                    // For collapsed nodes, show a cursor shape that indicates
                    // this can be expanded.
                    if (foreground_elem?.attributes()?.is_collapsed)
                        this.canvas.style.cursor = 'alias';
                    else
                        this.canvas.style.cursor = 'pointer';
                }
            } else {
                this.canvas.style.cursor = 'auto';
            }
        }

        this.tooltip = null;

        // Add newly hovered elements under the mouse cursor to the cache.
        // The cache then contains hovered elements of the previous frame that
        // are highlighted and the newly hovered elements of the current frame
        // that need to be highlighted.
        for (const elInfo of Object.entries(elements)) {
            const elemTypeArray = elInfo[1];
            for (let j = 0; j < elemTypeArray.length; ++j) {
                const hovered_element = elemTypeArray[j].obj;
                if (hovered_element !== undefined)
                    this.hovered_elements_cache.add(hovered_element);
            }
        }

        // New cache for the next frame, which only contains the
        // hovered/highlighted elements of the current frame.
        const new_hovered_elements_cache = new Set<SDFGElement>();

        // Only do highlighting re-computation if view is close enough to
        // actually see the highlights. Done by points-per-pixel metric using
        // SDFV.NODE_LOD as the threshold. Hence, the highlights only
        // update/become visible if there are nodes visible to hover over. This
        // creatly reduces CPU utilization when moving/hovering the mouse over
        // large graphs.
        if (this.canvas_manager) {
            const ppp = this.canvas_manager.points_per_pixel();
            if (ppp < SDFVSettings.get<number>('nodeLOD')) {
                // Global change boolean. Determines if repaint necessary.
                let highlighting_changed = false;

                // Mark hovered and highlighted elements.
                for (const obj of this.hovered_elements_cache) {
                    const intersected = obj.intersect(
                        this.mousepos!.x, this.mousepos!.y, 0, 0
                    );

                    // Local change boolean, for each visible element
                    // checked. Prevents recursion if nothing changed.
                    let hover_changed = false;

                    // Change hover status
                    if (intersected && !obj.hovered) {
                        obj.hovered = true;
                        highlighting_changed = true;
                        hover_changed = true;
                    } else if (!intersected && obj.hovered) {
                        obj.hovered = false;
                        highlighting_changed = true;
                        hover_changed = true;
                    }

                    // If element is hovered in the current frame then
                    // remember it for the next frame.
                    if (obj.hovered)
                        new_hovered_elements_cache.add(obj);

                    // Highlight all edges of the memlet tree
                    if (obj instanceof Edge && obj.parent_id !== null) {
                        if (obj.hovered && hover_changed) {
                            const tree = this.getNestedMemletTree(obj);
                            tree.forEach(te => {
                                if (te !== obj && te !== undefined)
                                    te.highlighted = true;
                            });
                        } else if (!obj.hovered && hover_changed) {
                            const tree = this.getNestedMemletTree(obj);
                            tree.forEach(te => {
                                if (te !== obj && te !== undefined)
                                    te.highlighted = false;
                            });
                        }
                    }

                    // Highlight all access nodes with the same name in the
                    // same nested sdfg.
                    if (obj instanceof AccessNode) {
                        if (obj.hovered && hover_changed) {
                            traverseSDFGScopes(
                                this.cfgList[obj.sdfg.cfg_list_id].graph!,
                                (node: any) => {
                                    // If node is a state, then visit
                                    // sub-scope.
                                    if (node instanceof State)
                                        return true;
                                    if (node instanceof AccessNode &&
                                        node.data.node.label ===
                                        obj.data.node.label)
                                        node.highlighted = true;
                                    // No need to visit sub-scope
                                    return false;
                                }
                            );
                        } else if (!obj.hovered && hover_changed) {
                            traverseSDFGScopes(
                                this.cfgList[obj.sdfg.cfg_list_id].graph!,
                                (node: any) => {
                                    // If node is a state, then visit
                                    // sub-scope.
                                    if (node instanceof State)
                                        return true;
                                    if (node instanceof AccessNode &&
                                        node.data.node.label ===
                                        obj.data.node.label)
                                        node.highlighted = false;
                                    // No need to visit sub-scope
                                    return false;
                                }
                            );
                        }
                    }

                    if (obj instanceof Connector) {
                        // Highlight the incoming/outgoing Edge
                        const parent_node = obj.linkedElem;
                        if (obj.hovered &&
                            (hover_changed || (!parent_node?.hovered))) {
                            const state = obj.linkedElem?.parentElem;
                            if (state && state instanceof State &&
                                state.data) {
                                const state_json = state.data.state;
                                const state_graph = state.data.graph;
                                state_json.edges.forEach(
                                    (edge: JsonSDFGEdge, id: number) => {
                                        if (edge.src_connector ===
                                            obj.data.name ||
                                            edge.dst_connector ===
                                            obj.data.name) {
                                            const gedge = state_graph.edge(
                                                edge.src, edge.dst,
                                                id.toString()
                                            ) as Memlet;
                                            if (gedge)
                                                gedge.highlighted = true;
                                        }
                                    }
                                );
                            }
                        }
                        if (!obj.hovered && hover_changed) {
                            // Prevent de-highlighting of edge if parent is
                            // already hovered (to show all edges).
                            if (parent_node && !parent_node.hovered) {
                                const state = obj.linkedElem?.parentElem;
                                if (state && state instanceof State &&
                                    state.data) {
                                    const state_json = state.data.state;
                                    const state_graph = state.data.graph;
                                    state_json.edges.forEach((
                                        edge: JsonSDFGEdge,
                                        id: number
                                    ) => {
                                        if (edge.src_connector ===
                                            obj.data.name ||
                                            edge.dst_connector ===
                                            obj.data.name) {
                                            const gedge = state_graph.edge(
                                                edge.src, edge.dst,
                                                id.toString()
                                            ) as Memlet;
                                            if (gedge)
                                                gedge.highlighted = false;
                                        }
                                    });
                                }
                            }
                        }


                        // Highlight all access nodes with the same name as
                        // the hovered connector in the nested sdfg.
                        if (obj.hovered && hover_changed) {
                            const nGraph = obj.parentElem?.data.graph;
                            if (nGraph) {
                                traverseSDFGScopes(nGraph, (node: any) => {
                                    // If node is a state, then visit
                                    // sub-scope.
                                    if (node instanceof State ||
                                        node instanceof ControlFlowRegion)
                                        return true;

                                    if (node instanceof AccessNode &&
                                        node.data.node.label ===
                                        obj.label())
                                        node.highlighted = true;
                                    // No need to visit sub-scope
                                    return false;
                                });
                            }
                        } else if (!obj.hovered && hover_changed) {
                            const nGraph = obj.parentElem?.data.graph;
                            if (nGraph) {
                                traverseSDFGScopes(nGraph, (node: any) => {
                                    // If node is a state, then visit
                                    // sub-scope.
                                    if (node instanceof State ||
                                        node instanceof ControlFlowRegion)
                                        return true;

                                    if (node instanceof AccessNode &&
                                        node.data.node.label ===
                                        obj.label())
                                        node.highlighted = false;
                                    // No need to visit sub-scope
                                    return false;
                                });
                            }
                        }

                        // Similarly, highlight any identifiers in a
                        // connector's tasklet, if applicable.
                        if (obj.hovered && hover_changed) {
                            if (obj.linkedElem && obj.linkedElem instanceof
                                Tasklet) {
                                if (obj.connectorType === 'in') {
                                    for (const token of
                                        obj.linkedElem.inputTokens) {
                                        if (token.token === obj.data.name)
                                            token.highlighted = true;
                                    }
                                } else {
                                    for (const token of
                                        obj.linkedElem.outputTokens) {
                                        if (token.token === obj.data.name)
                                            token.highlighted = true;
                                    }
                                }
                            }
                        } else if (!obj.hovered && hover_changed) {
                            if (obj.linkedElem && obj.linkedElem instanceof
                                Tasklet) {
                                if (obj.connectorType === 'in') {
                                    for (const token of
                                        obj.linkedElem.inputTokens) {
                                        if (token.token === obj.data.name)
                                            token.highlighted = false;
                                    }
                                } else {
                                    for (const token of
                                        obj.linkedElem.outputTokens) {
                                        if (token.token === obj.data.name)
                                            token.highlighted = false;
                                    }
                                }
                            }
                        }
                    }

                    // Make all edges of a node visible and remove the edge
                    // summary symbol.
                    if (obj.hovered && hover_changed &&
                        obj instanceof SDFGNode &&
                        (obj.in_summary_has_effect ||
                            obj.out_summary_has_effect)) {
                        // Setting these to false will cause the summary
                        // symbol not to be drawn in renderer_elements.ts
                        obj.summarize_in_edges = false;
                        obj.summarize_out_edges = false;
                        const state = obj.parentElem;
                        if (state && state instanceof State && state.data) {
                            const state_json = state.data.state;
                            const state_graph = state.data.graph;
                            state_json.edges.forEach(
                                (edge: JsonSDFGEdge, id: number) => {
                                    if (edge.src === obj.id.toString() ||
                                        edge.dst === obj.id.toString()) {
                                        const gedge = state_graph.edge(
                                            edge.src, edge.dst,
                                            id.toString()
                                        ) as Memlet;
                                        if (gedge)
                                            gedge.highlighted = true;
                                    }
                                }
                            );
                        }
                    } else if (!obj.hovered && hover_changed) {
                        obj.summarize_in_edges = true;
                        obj.summarize_out_edges = true;
                        const state = obj.parentElem;
                        if (state && state instanceof State && state.data) {
                            const state_json = state.data.state;
                            const state_graph = state.data.graph;
                            state_json.edges.forEach((
                                edge: JsonSDFGEdge, id: number
                            ) => {
                                if (edge.src === obj.id.toString() ||
                                    edge.dst === obj.id.toString()) {
                                    const gedge = state_graph.edge(
                                        edge.src, edge.dst, id.toString()
                                    ) as Memlet;
                                    if (gedge)
                                        gedge.highlighted = false;
                                }
                            });
                        }
                    }
                }

                if (highlighting_changed)
                    dirty = true;
            }
        }

        // Set the cache for the next frame to only contain
        // the currently hovered/highlighted elements.
        this.hovered_elements_cache = new_hovered_elements_cache;

        // If adding an edge, mark/highlight the first/from element, if it has
        // already been selected.
        if (this.mouse_mode === 'add' && this.add_type === 'Edge') {
            if (this.add_edge_start) {
                this.add_edge_start.highlighted = true;
                dirty = true;
            }
            if (this.add_edge_start_conn) {
                this.add_edge_start_conn.highlighted = true;
                dirty = true;
            }
        }

        if (evtype === 'dblclick') {
            const relayout_happened = this.toggle_element_collapse(
                foreground_elem
            );
            if (relayout_happened) {
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
                        (_group, _objInfo, obj) => {
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

                if (this.mouse_mode === 'move')
                    this.emit('element_position_changed', 'manual_move');
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
                                    getGraphElementUUID(
                                        foreground_elem
                                    ),
                                    undefined,
                                    getGraphElementUUID(start),
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
                                getGraphElementUUID(
                                    foreground_elem
                                ),
                                this.add_mode_lib || undefined
                            );
                        } else {
                            this.add_position = this.mousepos;
                            if (this.add_type) {
                                this.emit(
                                    'add_element',
                                    this.add_type,
                                    getGraphElementUUID(
                                        foreground_elem
                                    )
                                );
                            }
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

        // Handle right-clicks
        if (evtype === 'contextmenu') {
            if (this.mouse_mode === 'move') {
                let elements_to_reset = [foreground_elem];
                if (foreground_elem && this.selected_elements.includes(
                    foreground_elem
                ))
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
                                    dy: - position.points[j].dy,
                                };
                                // Reset the point movement
                                position.points[j].dx = 0;
                                position.points[j].dy = 0;
                            }

                            // Move it to original position
                            this.canvas_manager?.translate_element(
                                edge_el, { x: 0, y: 0 }, { x: 0, y: 0 },
                                this.graph, this.cfgList,
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
                                this.cfgList, this.state_parent_list,
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

                if (relayout_necessary) {
                    this.add_loading_animation();
                    setTimeout(() => {
                        this.relayout();
                        this.draw_async();
                    }, 10);
                } else {
                    this.draw_async();
                }

                if (element_moved)
                    this.emit('element_position_changed', 'manual_move');
            } else if (this.mouse_mode === 'add') {
                // Cancel add mode
                if (this.panmode_btn?.onclick)
                    this.panmode_btn?.onclick(event);
            } else if (this.mouse_mode === 'pan') {
                // Shift + Rightclick to toggle expand/collapse
                if (event.shiftKey) {
                    const relayout_happened = this.toggle_element_collapse(
                        foreground_elem
                    );
                    if (relayout_happened) {
                        dirty = true;
                        element_focus_changed = true;
                    }
                }
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

        if (this.overlayManager) {
            const ol_manager_dirty = this.overlayManager.on_mouse_event(
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

        if (selection_changed || multi_selection_changed)
            this.emit('selection_changed', multi_selection_changed);
        if (element_focus_changed) {
            this.emit(
                'element_focus_changed',
                selection_changed || multi_selection_changed
            );
        }

        return false;
    }

    public registerExternalMouseHandler(
        handler: ((...args: any[]) => boolean) | null
    ): void {
        this.external_mouse_handler = handler;
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

    public get_visible_rect(): SimpleRect | null {
        return this.visible_rect;
    }

    public get_mouse_mode(): string {
        return this.mouse_mode;
    }

    public getBackgroundColor(): string {
        return (this.backgroundColor ? this.backgroundColor : '');
    }

    public get_sdfg(): JsonSDFG {
        return this.sdfg;
    }

    public getCFGList(): CFGListType {
        return this.cfgList;
    }

    public getCFGTree(): { [key: number]: number } {
        return this.cfgTree;
    }

    public get_graph(): DagreGraph | null {
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

    public setBackgroundColor(backgroundColor: string): void {
        this.backgroundColor = backgroundColor;
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
        this.draw_async();
    }

    public exitLocalView(): void {
        if (!(this.sdfv_instance instanceof SDFV))
            return;

        if (this.sdfv_instance instanceof WebSDFV)
            this.sdfv_instance.setSDFG(this.sdfg);
    }

    public async localViewSelection(): Promise<void> {
        if (!this.graph || !(this.sdfv_instance instanceof SDFV))
            return;

        // Transition to the local view by first cutting out the selection.
        try {
            const origSdfg = stringify_sdfg(this.sdfg);
            await this.cutoutSelection(true);
            const lRenderer =
                new LViewRenderer(this.sdfv_instance, this.container);
            const lGraph = await LViewParser.parseGraph(this.graph, lRenderer);
            if (lGraph) {
                LViewLayouter.layoutGraph(lGraph);
                lRenderer.graph = lGraph;

                // Set a button to exit the local view again.
                const exitBtn = document.createElement('button');
                exitBtn.className = 'button';
                exitBtn.innerHTML =
                    '<span class="material-symbols-outlined">close</span>';
                exitBtn.style.paddingBottom = '0px';
                exitBtn.style.userSelect = 'none';
                exitBtn.style.position = 'absolute';
                exitBtn.style.top = '10px';
                exitBtn.style.left = '10px';
                exitBtn.title = 'Exit local view';
                exitBtn.onclick = () => {
                    this.sdfg = parse_sdfg(origSdfg);
                    this.exitLocalView();
                    this.container.removeChild(exitBtn);
                };
                this.container.appendChild(exitBtn);

                this.sdfv_instance.setLocalViewRenderer(lRenderer);

                if (this.canvas)
                    $(this.canvas).remove();
            }
        } catch (e) {
            if (e instanceof LViewGraphParseError)
                showErrorModal(e.message);
            else
                throw e;
        }
    }

    public async cutoutSelection(
        _suppressSave: boolean = false
    ): Promise<void> {
        /* Rule set for creating a cutout subgraph:
         * Edges are selected according to the subgraph nodes - all edges
         * between subgraph nodes are preserved.
         * In any element that contains other elements (state, nested SDFG,
         * scopes), the full contents are used.
         * If more than one element is selected from different contexts (two
         * nodes from two states), the parents will be preserved.
         */
        // Collect nodes and states
        const cfgs: Set<number> = new Set<number>();
        const blocks: { [key: string]: Set<number> } = {};
        const nodes: { [key: string]: Set<number> } = {};

        function addCutoutNode(cfgId: number, node: SDFGNode): void {
            const stateId = node.parent_id ?? -1;
            const stateUUID: string = JSON.stringify([cfgId, stateId]);
            if (stateUUID in nodes)
                nodes[stateUUID].add(node.id);
            else
                nodes[stateUUID] = new Set([node.id]);
            blocks[cfgId].add(stateId);
        }

        function addCutoutState(cfgId: number, state: State): void {
            // Add all nodes from the state to the filter.
            const uuid: string = JSON.stringify([cfgId, state.id]);
            nodes[uuid] = new Set([...state.data.state.nodes.keys()]);
            blocks[cfgId].add(state.id);
        }

        function addCutoutCFG(cfgId: number, cfgNode: ControlFlowRegion): void {
            // Add all contents of the CFG.
            const cfg: JsonSDFGControlFlowRegion = cfgNode.data.block;
            const ownCfgId = cfg.cfg_list_id;
            cfgs.add(ownCfgId);
            if (!(ownCfgId in blocks))
                blocks[ownCfgId] = new Set();

            if (cfgNode.data.graph) {
                for (const blockId of cfgNode.data.block.nodes.keys()) {
                    const block = cfgNode.data.graph.node(blockId);
                    if (block instanceof ControlFlowRegion) {
                        const nCfgId = block.data.block.cfg_list_id;
                        cfgs.add(nCfgId);
                        addCutoutCFG(ownCfgId, block);
                    } else {
                        addCutoutState(ownCfgId, block);
                    }
                }
            } else {
                for (const blockId of cfgNode.data.block.nodes.keys())
                    blocks[ownCfgId].add(blockId);
            }

            blocks[cfgId].add(cfgNode.id);
        }

        for (const elem of this.selected_elements) {
            // Ignore edges and connectors
            if (elem instanceof Edge || elem instanceof Connector)
                continue;

            const cfg = elem.cfg!;
            const cfgId = cfg.cfg_list_id;
            cfgs.add(cfgId);
            if (!(cfgId in blocks))
                blocks[cfgId] = new Set();

            if (elem instanceof ControlFlowRegion)
                addCutoutCFG(cfgId, elem);
            else if (elem instanceof State)
                addCutoutState(cfgId, elem);
            else
                addCutoutNode(cfgId, elem);
        }

        // Clear selection and redraw
        this.deselect();

        if (Object.keys(nodes).length + Object.keys(blocks).length === 0) {
            // Nothing to cut out
            this.draw_async();
            return;
        }

        // Find root SDFG and root state (if possible)
        const rootCFGId = findRootCFG(cfgs, this.cfgTree, this.cfgList, false);
        const rootSDFGId = findRootCFG(
            cfgs, this.cfgTree, this.cfgList, true
        );
        const needToFlatten = rootSDFGId !== rootCFGId;
        if (rootSDFGId !== null && rootCFGId !== null) {
            const rootSDFG = this.cfgList[rootSDFGId].jsonObj;
            const rootCFG = this.cfgList[rootCFGId].jsonObj;
            if (rootSDFG.type !== 'SDFG')
                throw Error('Cutout needs root CFG of type SDFG');

            // For every participating state, filter out irrelevant nodes and
            // memlets.
            for (const nkey of Object.keys(nodes)) {
                const [cfgId, stateId] = JSON.parse(nkey);
                const cfg = this.cfgList[cfgId].jsonObj;
                deleteSDFGNodes(
                    cfg, stateId, Array.from(nodes[nkey].values()), true
                );
            }

            // For every participating CFG, filter out irrelevant states and
            // interstate edges.
            for (const cfgId of Object.keys(blocks)) {
                const cfg = this.cfgList[cfgId].jsonObj;
                deleteCFGBlocks(cfg, Array.from(blocks[cfgId].values()), true);
            }

            // Ensure that the cutout contains only what is being cut out of
            // the target root CFG. The root SDFG is used to piggyback in the
            // necessary SDFG information.
            if (needToFlatten) {
                rootSDFG.nodes = rootCFG.nodes;
                rootSDFG.edges = rootCFG.edges;
            }

            // Set root SDFG as the new SDFG
            return this.setSDFG(rootSDFG as JsonSDFG);
        }
    }

    public get viewportOnly(): boolean {
        return this._viewportOnly;
    }

    public get adaptiveHiding(): boolean {
        return this._adaptiveHiding;
    }

}


function calculateNodeSize(
    sdfg: JsonSDFG, node: any, ctx?: CanvasRenderingContext2D
): { width: number, height: number } {
    let label;
    switch (node.type) {
        case SDFGElementType.AccessNode:
            label = node.label;
            if (SDFVSettings.get<boolean>('showDataDescriptorSizes')) {
                const nodedesc = sdfg.attributes._arrays[label];
                if (nodedesc && nodedesc.attributes.shape) {
                    label = ' ' + sdfg_property_to_string(
                        nodedesc.attributes.shape
                    );
                }
            }
            break;
        default:
            label = node.label;
            break;
    }

    const labelsize = ctx ? ctx.measureText(label).width : 1;
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

export function relayoutStateMachine(
    stateMachine: JsonSDFGControlFlowRegion, sdfg: JsonSDFG,
    parent?: SDFGElement, ctx?: CanvasRenderingContext2D, cfgList?: CFGListType,
    stateParentList?: any[], omitAccessNodes: boolean = false
): DagreGraph {
    const BLOCK_MARGIN = 3 * SDFV.LINEHEIGHT;

    // Layout the state machine as a dagre graph.
    const g: DagreGraph = new dagre.graphlib.Graph();
    g.setGraph({});
    g.setDefaultEdgeLabel(() => {
        return {};
    });

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
            { layout: { width: 0, height: 0 } }, block.id, sdfg, stateMachine,
            null, parent
        );
        if (block.type === SDFGElementType.SDFGState)
            blockElem.data.state = block;
        else
            blockElem.data.block = block;

        blockInfo.label = block.id.toString();
        let blockGraph = null;
        if (block.attributes?.is_collapsed) {
            blockInfo.height = SDFV.LINEHEIGHT;
            if (blockElem instanceof LoopRegion && ctx) {
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
            } else if (blockElem instanceof ConditionalBlock && ctx) {
                const maxLabelWidth = Math.max(...blockElem.branches.map(
                    br => ctx.measureText(
                        br[0] ? br[0].string_data + 'if ' : 'else'
                    ).width
                ));
                blockInfo.width = Math.max(
                    maxLabelWidth, ctx.measureText(block.label).width
                ) + 3 * LoopRegion.META_LABEL_MARGIN;
                blockInfo.height += LoopRegion.CONDITION_SPACING;
            } else {
                if (ctx)
                    blockInfo.width = ctx.measureText(blockInfo.label).width;
                else
                    blockInfo.width = 1;
            }
        } else {
            blockGraph = relayoutSDFGBlock(
                block, sdfg, blockElem, ctx, cfgList, stateParentList,
                omitAccessNodes
            );
            if (block.type == SDFGElementType.ConditionalBlock && blockGraph &&
                ctx
            ) {
                const branches = (blockElem as ConditionalBlock).branches;
                for (const [condition, region] of branches) {
                    blockInfo.width = Math.max(blockInfo.width, region.width);
                    blockInfo.width = Math.max(
                        blockInfo.width, ctx.measureText(
                            condition ? 'if ' + condition.string_data : 'else'
                        ).width
                    );
                    blockInfo.height += region.height;
                }
            } else if (blockGraph) {
                blockInfo = calculateBoundingBox(blockGraph);
            }
        }
        if (block.type !== SDFGElementType.ConditionalBlock ||
            block.attributes?.is_collapsed
        ) {
            blockInfo.width += 2 * BLOCK_MARGIN;
            blockInfo.height += 2 * BLOCK_MARGIN;
        }

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
        } else if (blockElem instanceof ConditionalBlock) {
            blockInfo.height += (
                ConditionalBlock.CONDITION_SPACING * blockElem.branches.length
            );
        }

        blockElem.data.layout = blockInfo;
        blockElem.data.graph = blockGraph;
        blockElem.set_layout();
        g.setNode(block.id.toString(), blockElem);
    }

    for (let id = 0; id < stateMachine.edges.length; id++) {
        const edge = stateMachine.edges[id];
        g.setEdge(edge.src, edge.dst, new InterstateEdge(
            edge.attributes.data, id, sdfg, stateMachine, parent.id, parent,
            edge.src, edge.dst
        ));
    }

    if (SDFVSettings.get<boolean>('useVerticalStateMachineLayout')) {
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
        if (!block.attributes)
            block.attributes = {};
        block.attributes.layout = {};
        block.attributes.layout.x = gnode.x;
        block.attributes.layout.y = gnode.y;
        block.attributes.layout.width = gnode.width;
        block.attributes.layout.height = gnode.height;
        if (gnode instanceof ConditionalBlock) {
            let y = ConditionalBlock.CONDITION_SPACING;
            for (const [_, region] of gnode.branches) {
                region.x += region.width / 2
                region.y = y + region.height / 2;
                y += region.height + ConditionalBlock.CONDITION_SPACING
            }
        }
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
                    y: topleft.y + BLOCK_MARGIN,
                });
            } else if (block.type === SDFGElementType.ConditionalBlock) {
                offset_conditional_region(
                    block as JsonSDFGConditionalBlock, gBlock.data.graph, {
                        x: topleft.x,
                        y: topleft.y,
                    }
                );
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

    // Add CFG graph to global store.
    if (cfgList !== undefined)
        cfgList[stateMachine.cfg_list_id].graph = g;

    return g;
}

function relayoutConditionalRegion(
    region: JsonSDFGConditionalBlock, sdfg: JsonSDFG,
    parent?: ConditionalBlock, ctx?: CanvasRenderingContext2D,
    cfgList?: CFGListType, stateParentList?: any[],
    omitAccessNodes: boolean = false
): DagreGraph {
    const BLOCK_MARGIN = 3 * SDFV.LINEHEIGHT;

    // Layout the state machine as a dagre graph.
    const g: DagreGraph = new dagre.graphlib.Graph();
    g.setGraph({});
    g.setDefaultEdgeLabel(() => {
        return {};
    });

    // layout each block individually to get its size.
    for (let id = 0; id < region.branches.length; id++) {
        const [condition, block] = region.branches[id];
        block.id = id;
        let blockInfo: {
            label?: string,
            width: number,
            height: number,
        } = {
            label: undefined,
            width: 0,
            height: 0,
        };
        const blockElem = new ControlFlowRegion(
            { layout: { width: 0, height: 0 } }, block.id, sdfg, null,
            null, parent
        );
        g.setNode(block.id.toString(), blockElem);
        blockElem.data.block = block;
        parent?.branches.push([condition, blockElem]);

        blockInfo.label = block.id.toString();
        blockInfo.width = ctx?.measureText(
            condition?.string_data ?? 'else'
        ).width ?? 0;
        blockInfo.height = SDFV.LINEHEIGHT;
        if (!block.attributes?.is_collapsed) {
            const blockGraph = relayoutStateMachine(
                block, sdfg, blockElem, ctx, cfgList, stateParentList,
                omitAccessNodes,
            );
            blockInfo.width = Math.max(
                blockInfo.width, (blockGraph as any).width
            );
            blockInfo.height += (blockGraph as any).height;
            blockElem.data.graph = blockGraph;
        }
        blockInfo.width += 2 * BLOCK_MARGIN;
        blockInfo.height += 2 * BLOCK_MARGIN;
        blockElem.data.layout = blockInfo;
        blockElem.set_layout();
    }
    return g
}

function relayoutSDFGState(
    state: JsonSDFGState, sdfg: JsonSDFG, parent: State,
    ctx?: CanvasRenderingContext2D, sdfgList?: CFGListType,
    stateParentList?: any[], omitAccessNodes: boolean = false
): DagreGraph | null {
    if (!state.nodes && !state.edges)
        return null;

    // layout the sdfg block as a dagre graph.
    const g: DagreGraph = new dagre.graphlib.Graph({ multigraph: true });

    // Set layout options and a simpler algorithm for large graphs.
    const layoutOptions: any = { ranksep: SDFVSettings.get<number>('ranksep') };
    if (state.nodes.length >= 1000)
        layoutOptions.ranker = 'longest-path';

    layoutOptions.nodesep = SDFVSettings.get<number>('nodesep');
    g.setGraph(layoutOptions);

    // Set an object for the graph label.
    g.setDefaultEdgeLabel(() => {
        return {};
    });

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
        node.attributes.layout.in_connectors =
            node.attributes.in_connectors ?? [];
        if ('is_collapsed' in node.attributes && node.attributes.is_collapsed &&
            node.type !== SDFGElementType.NestedSDFG &&
            node.type !== SDFGElementType.ExternalNestedSDFG) {
            node.attributes.layout.out_connectors = findExitForEntry(
                state.nodes, node
            )?.attributes.out_connectors ?? [];
        } else {
            node.attributes.layout.out_connectors =
                node.attributes.out_connectors ?? [];
        }

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
                    node.attributes.sdfg, node.attributes.sdfg, parent, ctx,
                    sdfgList, stateParentList, omitAccessNodes
                );
                const sdfgInfo = calculateBoundingBox(nestedGraph);
                node.attributes.layout.width =
                    sdfgInfo.width + 2 * SDFV.LINEHEIGHT;
                node.attributes.layout.height =
                    sdfgInfo.height + 2 * SDFV.LINEHEIGHT;
            } else {
                const emptyNSDFGLabel = 'No SDFG loaded';
                if (ctx) {
                    const textMetrics = ctx.measureText(emptyNSDFGLabel);
                    node.attributes.layout.width =
                        textMetrics.width + 2 * SDFV.LINEHEIGHT;
                } else {
                    node.attributes.layout.width = 1;
                }
                node.attributes.layout.height = 4 * SDFV.LINEHEIGHT;
            }
        }

        // Dynamically create node type.
        const obj = new SDFGElements[node.type](
            { node: node, graph: nestedGraph }, node.id, sdfg, parent.cfg,
            state.id, parent
        );

        // If it's a nested SDFG, we need to record the node as all of its
        // state's parent node.
        if ((node.type === SDFGElementType.NestedSDFG ||
            node.type === SDFGElementType.ExternalNestedSDFG) &&
            node.attributes.sdfg && node.attributes.sdfg.type !== 'SDFGShell' &&
            stateParentList !== undefined && sdfgList !== undefined
        ) {
            stateParentList[node.attributes.sdfg.cfg_list_id] = obj;
            sdfgList[node.attributes.sdfg.cfg_list_id].nsdfgNode = obj;
        }

        // Add input connectors.
        let i = 0;
        let conns;
        if (Array.isArray(node.attributes.layout.in_connectors))
            conns = node.attributes.layout.in_connectors;
        else
            conns = Object.keys(node.attributes.layout.in_connectors);
        for (const cname of conns) {
            const conn = new Connector(
                { name: cname }, i, sdfg, parent.cfg, node.id, obj
            );
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
            const conn = new Connector(
                { name: cname }, i, sdfg, parent.cfg, node.id, obj
            );
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

        const e = new Memlet(
            edge.attributes.data, id, sdfg, parent.cfg, state.id, parent
        );
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
                if (!redirectedEdge)
                    return;

                // Abort if shortcut edge already exists.
                const edges = g.outEdges(redirectedEdge.src);
                if (edges) {
                    for (const oe of edges) {
                        if (oe.w === e.dst && oe.name &&
                            state.edges[
                                parseInt(oe.name)
                            ].dst_connector === e.dst_connector
                        )
                            return;
                    }
                }

                // Add shortcut edge (redirection is not done in this list).
                state.edges.push(shortCutEdge);

                // Add redirected shortcut edge to graph.
                const edgeId = state.edges.length - 1;
                const newShortCutEdge = new Memlet(
                    deepCopy(redirectedEdge.attributes.data), edgeId, sdfg,
                    parent.cfg, state.id
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
            // Ignore nodes that should not be drawn.
            return;
        }
        const topleft = gnode.topleft();

        // Offset nested SDFG.
        if (node.type === SDFGElementType.NestedSDFG && node.attributes.sdfg) {
            offset_sdfg(node.attributes.sdfg, gnode.data.graph, {
                x: topleft.x + SDFV.LINEHEIGHT,
                y: topleft.y + SDFV.LINEHEIGHT,
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

    // Re-order in_connectors for the edges to not intertwine
    state.nodes.forEach((node: JsonSDFGNode, id: number) => {
        const gnode: any = g.node(id.toString());
        if (!gnode || (omitAccessNodes && gnode instanceof AccessNode)) {
            // Ignore nodes that should not be drawn.
            return;
        }

        // Summarize edges for NestedSDFGs and ScopeNodes
        if (SDFVSettings.get<boolean>('summarizeLargeNumbersOfEdges')) {
            if (gnode instanceof NestedSDFG || gnode instanceof ScopeNode) {
                const n_of_in_connectors = gnode.in_connectors.length;
                const n_of_out_connectors = gnode.out_connectors.length;

                if (n_of_in_connectors > 10) {
                    gnode.summarize_in_edges = true;
                    gnode.in_summary_has_effect = true;
                }
                if (n_of_out_connectors > 10) {
                    gnode.summarize_out_edges = true;
                    gnode.out_summary_has_effect = true;
                }
            }
        }
        const SPACING = SDFV.LINEHEIGHT;
        const iConnLength = (SDFV.LINEHEIGHT + SPACING) * Object.keys(
            node.attributes.layout.in_connectors
        ).length - SPACING;
        let iConnX = gnode.x - iConnLength / 2.0 + SDFV.LINEHEIGHT / 2.0;

        // Dictionary that saves the x coordinates of each connector's source
        // node or source connector. This is later used to reorder the
        // in_connectors based on the sources' x coordinates.
        const sources_x_coordinates: { [key: string]: number } = {};

        // For each in_connector, find the x coordinate of the source node
        // connector.
        for (const c of gnode.in_connectors) {
            state.edges.forEach((edge: JsonSDFGEdge, id: number) => {
                if (edge.dst === gnode.id.toString() &&
                    edge.dst_connector === c.data.name) {
                    // If in-edges are to be summarized, set Memlet.summarized
                    const gedge = g.edge(
                        edge.src, edge.dst, id.toString()
                    ) as Memlet;
                    if (gedge && gnode.summarize_in_edges)
                        gedge.summarized = true;

                    const source_node: SDFGNode = g.node(edge.src);
                    if (source_node) {
                        // If source node doesn't have out_connectors, take
                        // the source node's own x coordinate
                        if (source_node.out_connectors.length === 0) {
                            sources_x_coordinates[c.data.name] = source_node.x;
                        } else {
                            // Find the corresponding out_connector and take its
                            // x coordinate.
                            const nOutConn = source_node.out_connectors.length;
                            for (let i = 0; i < nOutConn; ++i) {
                                if (source_node.out_connectors[i].data.name ===
                                    edge.src_connector) {
                                    sources_x_coordinates[c.data.name] =
                                        source_node.out_connectors[i].x;
                                    break;
                                }
                            }
                        }
                    }
                }
            });
        }

        // Sort the dictionary by x coordinate values
        const sources_x_coordinates_sorted = Object.entries(
            sources_x_coordinates
        );
        sources_x_coordinates_sorted.sort((a, b) => a[1] - b[1]);

        // In the order of the sorted source x coordinates, set the x
        // coordinates of the in_connectors.
        for (const element of sources_x_coordinates_sorted) {
            for (const c of gnode.in_connectors) {
                if (c.data.name === element[0]) {
                    c.x = iConnX;
                    iConnX += SDFV.LINEHEIGHT + SPACING;
                    continue;
                }
            }
        }

        // For out_connectors set Memlet.summarized for all out-edges if needed
        if (gnode.summarize_out_edges) {
            for (const c of gnode.out_connectors) {
                state.edges.forEach((edge: JsonSDFGEdge, id: number) => {
                    if (edge.src === gnode.id.toString() &&
                        edge.src_connector === c.data.name) {
                        const gedge = g.edge(
                            edge.src, edge.dst, id.toString()
                        ) as Memlet;
                        if (gedge)
                            gedge.summarized = true;
                    }
                });
            }
        }
    });

    state.edges.forEach((edge: JsonSDFGEdge, id: number) => {
        const nedge = check_and_redirect_edge(edge, drawnNodes, state);
        if (!nedge)
            return;
        edge = nedge;
        const gedge = g.edge(edge.src, edge.dst, id.toString());
        if (!gedge || (omitAccessNodes &&
            gedge.data.attributes.shortcut === false ||
            !omitAccessNodes && gedge.data.attributes.shortcut)) {
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
    block: JsonSDFGBlock, sdfg: JsonSDFG, parent: SDFGElement,
    ctx?: CanvasRenderingContext2D, sdfgList?: CFGListType,
    stateParentList?: any[], omitAccessNodes: boolean = false
): DagreGraph | null {
    switch (block.type) {
        case SDFGElementType.LoopRegion:
        case SDFGElementType.ControlFlowRegion:
            return relayoutStateMachine(
                block as JsonSDFGControlFlowRegion, sdfg, parent, ctx, sdfgList,
                stateParentList, omitAccessNodes
            );
        case SDFGElementType.SDFGState:
           return relayoutSDFGState(
                block as JsonSDFGState, sdfg, parent, ctx, sdfgList,
                stateParentList, omitAccessNodes
            ); 
        case SDFGElementType.ConditionalBlock:
            return relayoutConditionalRegion(
                block as JsonSDFGConditionalBlock, sdfg,
                parent as ConditionalBlock, ctx, sdfgList, stateParentList,
                omitAccessNodes
            );
        default:
            return null;
    }
}
