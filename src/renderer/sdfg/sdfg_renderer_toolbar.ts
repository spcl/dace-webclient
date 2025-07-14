// Copyright 2019-2025 ETH Zurich and the DaCe authors. All rights reserved.

/*
import $ from 'jquery';

import type { SDFGRenderer } from './sdfg_renderer';
import { cfgToDotGraph } from '../../utils/sdfg/dotgraph';
import type {
    GenericSdfgOverlay,
} from '../../overlays/common/generic_sdfg_overlay';
import { LogicalGroupOverlay } from '../../overlays/logical_group_overlay';
import { SDFVSettings } from '../../utils/sdfv_settings';
import { MemoryLocationOverlay } from '../../overlays/memory_location_overlay';
import { MemoryVolumeOverlay } from '../../overlays/memory_volume_overlay';
*/


export type RendererUIFeature = (
    'menu' | 'settings' | 'overlays_menu' | 'zoom_to_fit_all' |
    'zoom_to_fit_width' | 'collapse' | 'expand' | 'add_mode' | 'pan_mode' |
    'move_mode' | 'box_select_mode' | 'cutout_selection' | 'local_view' |
    'minimap' | 'zoom_in_out'
);

/*
export class SDFGRendererUI {

    private readonly toolbarElem: JQuery;
    private linkedRenderer: SDFGRenderer | undefined;

    public readonly localViewBtn?: JQuery;
    public readonly cutoutBtn?: JQuery;

    public constructor(
        private readonly container: JQuery,
        enabledFeatures?: RendererUIFeature[],
        renderer?: SDFGRenderer,
        inVSCode: boolean = false
    ) {
        this.linkedRenderer = renderer;

        // Construct the toolbar.
        this.toolbarElem = $('<div>', {
            class: 'button-bar',
            css: {
                position: 'absolute',
                top: '10px',
                left: '10px',
            },
        });

        // Construct menu.
        if (!enabledFeatures || enabledFeatures.includes('menu')) {
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
            }).appendTo(this.toolbarElem).append(menuDropdown);

            $('<li>').appendTo(menu).append($('<span>', {
                class: 'dropdown-item',
                text: 'Save SDFG',
                click: () => {
                    this.linkedRenderer?.saveSDFG();
                },
            }));
            $('<li>').appendTo(menu).append($('<span>', {
                class: 'dropdown-item',
                text: 'Save view as PNG',
                click: () => {
                    if (this.linkedRenderer) {
                        const filename = (
                            this.linkedRenderer.getSDFGName() + '.png'
                        );
                        this.linkedRenderer.saveCanvasAsPng(filename);
                    }
                },
            }));
            if (this.linkedRenderer?.canSaveToPDF) {
                $('<li>').appendTo(menu).append($('<span>', {
                    class: 'dropdown-item',
                    text: 'Save view as PDF',
                    click: () => {
                        if (this.linkedRenderer) {
                            const filename = (
                                this.linkedRenderer.getSDFGName() + '.pdf'
                            );
                            this.linkedRenderer.saveAsPDF(filename, false);
                        }
                    },
                }));
                $('<li>').appendTo(menu).append($('<span>', {
                    class: 'dropdown-item',
                    text: 'Save SDFG as PDF',
                    click: () => {
                        if (this.linkedRenderer) {
                            const filename = (
                                this.linkedRenderer.getSDFGName() + '.pdf'
                            );
                            this.linkedRenderer.saveAsPDF(filename, true);
                        }
                    },
                }));
            }
            $('<li>').appendTo(menu).append($('<span>', {
                class: 'dropdown-item',
                text: 'Export top-level CFG as DOT graph',
                click: () => {
                    if (!this.linkedRenderer?.sdfg)
                        return;
                    const filename = this.linkedRenderer.getSDFGName() + '.dot';
                    this.linkedRenderer.save(
                        filename,
                        'data:text/plain;charset=utf-8,' +
                        encodeURIComponent(
                            cfgToDotGraph(this.linkedRenderer.sdfg)
                        )
                    );
                },
            }));

            $('<li>').appendTo(menu).append($('<hr>', {
                class: 'dropdown-divider',
            }));

            $('<li>').appendTo(menu).append($('<span>', {
                class: 'dropdown-item',
                text: 'Reset positions',
                click: () => {
                    this.linkedRenderer?.resetElementPositions();
                },
            }));
        }

        // SDFV Options.
        if (!enabledFeatures || enabledFeatures.includes('settings')) {
            $('<button>', {
                class: 'btn btn-secondary btn-sm btn-material',
                html: '<i class="material-symbols-outlined">settings</i>',
                title: 'Settings',
                click: () => {
                    SDFVSettings.getInstance().show();
                },
            }).appendTo(this.toolbarElem);
        }

        // Overlays menu.
        if ((!enabledFeatures || enabledFeatures.includes('overlays_menu')) &&
            !inVSCode) {
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
            }).appendTo(this.toolbarElem).append(overlayDropdown);

            const addOverlayToMenu = (
                txt: string, ol: typeof GenericSdfgOverlay,
                defaultState: boolean
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
                    checked: defaultState,
                    change: () => {
                        const oMan = this.linkedRenderer?.overlayManager;
                        if (olInput.prop('checked'))
                            oMan?.registerOverlay(ol);
                        else
                            oMan?.deregisterOverlay(ol);
                    },
                }).appendTo(olContainer);
                $('<label>', {
                    class: 'form-check-label',
                    text: txt,
                }).appendTo(olContainer);
            };

            // Register overlays that are turned on by default.
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
        }).appendTo(this.toolbarElem);
        if (!enabledFeatures || enabledFeatures.includes('zoom_to_fit_all')) {
            // Zoom to fit.
            $('<button>', {
                class: 'btn btn-secondary btn-sm btn-material',
                html: '<i class="material-symbols-outlined">fit_screen</i>',
                title: 'Zoom to fit SDFG',
                click: () => {
                    this.linkedRenderer?.zoomToFitContents();
                },
            }).appendTo(zoomButtonGroup);
        }
        if (!enabledFeatures || enabledFeatures.includes('zoom_to_fit_width')) {
            $('<button>', {
                class: 'btn btn-secondary btn-sm btn-material',
                html: '<i class="material-symbols-outlined">fit_width</i>',
                title: 'Zoom to fit width',
                click: () => {
                    this.linkedRenderer?.zoomToFitWidth();
                },
            }).appendTo(zoomButtonGroup);
        }

        const collapseButtonGroup = $('<div>', {
            class: 'btn-group',
            role: 'group',
        }).appendTo(this.toolbarElem);
        if (!enabledFeatures || enabledFeatures.includes('collapse')) {
            // Collapse all.
            $('<button>', {
                class: 'btn btn-secondary btn-sm btn-material',
                html: '<i class="material-symbols-outlined">' +
                    'unfold_less</i>',
                title: 'Collapse next level (Shift+click to collapse all)',
                click: (e: MouseEvent) => {
                    if (e.shiftKey)
                        this.linkedRenderer?.collapseAll();
                    else
                        this.linkedRenderer?.collapseNextLevel();
                },
            }).appendTo(collapseButtonGroup);
        }

        if (!enabledFeatures || enabledFeatures.includes('expand')) {
            // Expand all.
            $('<button>', {
                class: 'btn btn-secondary btn-sm btn-material',
                html: '<i class="material-symbols-outlined">' +
                    'unfold_more</i>',
                title: 'Expand next level (Shift+click to expand all)',
                click: (e: MouseEvent) => {
                    if (e.shiftKey)
                        this.linkedRenderer?.expandAll();
                    else
                        this.linkedRenderer?.expandNextLevel();
                },
            }).appendTo(collapseButtonGroup);
        }

        if (!enabledFeatures || enabledFeatures.includes('zoom_in_out')) {
            const zoomInOutContainer = $('<div>', {
                class: 'zoom-in-out-container btn-group-vertical',
                role: 'group',
                css: {
                    position: 'absolute',
                    bottom: '10px', // Position at the bottom
                    right: '10px',  // Position at the right
                    display: 'flex',
                    flexDirection: 'column',
                },
            }).appendTo(this.container);
            // Add Zoom In Button
            $('<button>', {
                class: 'btn btn-secondary btn-sm btn-material',
                html: '<i class="material-symbols-outlined">add</i>',
                title: 'Zoom In',
                click: (e: MouseEvent) => {
                    this.linkedRenderer?.zoomIn(e);
                },
            }).appendTo(zoomInOutContainer);
            // Add Zoom Out Button
            $('<button>', {
                class: 'btn btn-secondary btn-sm btn-material',
                html: '<i class="material-symbols-outlined">remove</i>',
                title: 'Zoom Out',
                click: (e:MouseEvent) => {
                    this.linkedRenderer?.zoomOut(e);
                },
            }).appendTo(zoomInOutContainer);
        }

        if (this.modeButtons?.pan || this.modeButtons?.move ||
            this.modeButtons?.select || this.modeButtons?.addBtns) {
            // If we get the "external" mode buttons we are in vscode and do
            // not need to create them.
            this.panModeBtn = this.modeButtons.pan;
            this.moveModeBtn = this.modeButtons.move;
            this.selectModeBtn = this.modeButtons.select;
            this.addModeButtons = this.modeButtons.addBtns;
            if (!this.enableMaskUI ||
                this.enableMaskUI.includes('add_mode')) {
                for (const addBtn of this.addModeButtons) {
                    const addBtnType = addBtn.attr(
                        'type'
                    ) as SDFGElementType;
                    if (addBtnType === SDFGElementType.LibraryNode) {
                        addBtn.on('click', () => {
                            const libNodeCallback = () => {
                                this._mouseMode = 'add';
                                this.addElementType =
                                    SDFGElementType.LibraryNode;
                                this.addEdgeStart = undefined;
                                this.addEdgeStartConnector = undefined;
                                this.updateToggleButtons();
                            };
                            this.emit('query_libnode', libNodeCallback);
                        });
                    } else {
                        addBtn.on('click', () => {
                            this._mouseMode = 'add';
                            this.addElementType = addBtnType;
                            this.addModeLib = undefined;
                            this.addEdgeStart = undefined;
                            this.addEdgeStartConnector = undefined;
                            this.updateToggleButtons();
                        });
                    }
                }
            }
            this.modeBtnSelectedBGColor = '#22A4FE';
        } else {
            // Mode buttons are empty in standalone SDFV.
            this.addModeButtons = [];

            const modeButtonGroup = $('<div>', {
                class: 'btn-group',
                role: 'group',
            }).appendTo(this.toolbar);

            // Enter pan mode.
            if (!this.enableMaskUI ||
                this.enableMaskUI.includes('pan_mode')) {
                this.panModeBtn = $('<button>', {
                    class: 'btn btn-secondary btn-sm btn-material selected',
                    html: '<i class="material-symbols-outlined">' +
                        'pan_tool</i>',
                    title: 'Pan mode',
                }).appendTo(modeButtonGroup) as JQuery<HTMLButtonElement>;
            }

            // Enter move mode.
            if (!this.enableMaskUI ||
                this.enableMaskUI.includes('move_mode')) {
                this.moveModeBtn = $('<button>', {
                    class: 'btn btn-secondary btn-sm btn-material',
                    html: '<i class="material-symbols-outlined">' +
                        'open_with</i>',
                    title: 'Object moving mode',
                }).appendTo(modeButtonGroup) as JQuery<HTMLButtonElement>;
            }

            // Enter box select mode.
            if (!this.enableMaskUI ||
                this.enableMaskUI.includes('box_select_mode')) {
                this.selectModeBtn = $('<button>', {
                    class: 'btn btn-secondary btn-sm btn-material',
                    html: '<i class="material-symbols-outlined">select</i>',
                    title: 'Select mode',
                }).appendTo(modeButtonGroup) as JQuery<HTMLButtonElement>;
            }
        }

        // Enter pan mode
        if (this.panModeBtn) {
            if (!this.enableMaskUI ||
                this.enableMaskUI.includes('pan_mode')) {
                this.panModeBtn.prop('disabled', false);
                this.panModeBtn.on('click', () => {
                    this._mouseMode = 'pan';
                    this.addElementType = undefined;
                    this.addModeLib = undefined;
                    this.addEdgeStart = undefined;
                    this.addEdgeStartConnector = undefined;
                    this.updateToggleButtons();
                });
            } else {
                this.panModeBtn.prop('disabled', true);
            }
        }

        // Enter object moving mode
        if (this.moveModeBtn) {
            if (!this.enableMaskUI ||
                this.enableMaskUI.includes('move_mode')) {
                this.moveModeBtn.prop('disabled', false);
                this.moveModeBtn.on('click', (e): void => {
                    // shift_click is false if shift key has been released
                    // and undefined if it has been a normal mouse click.
                    if (this.shiftKeyMovement && !e.shiftKey)
                        this._mouseMode = 'pan';
                    else
                        this._mouseMode = 'move';
                    this.addElementType = undefined;
                    this.addModeLib = undefined;
                    this.addEdgeStart = undefined;
                    this.addEdgeStartConnector = undefined;
                    this.shiftKeyMovement = e.shiftKey;
                    this.updateToggleButtons();
                });
            } else {
                this.moveModeBtn.prop('disabled', true);
            }
        }

        // Enter box selection mode
        if (this.selectModeBtn) {
            if (!this.enableMaskUI ||
                this.enableMaskUI.includes('box_select_mode')) {
                this.selectModeBtn.prop('disabled', false);
                this.selectModeBtn.on('click', (e): void => {
                    // ctrl_click is false if ctrl key has been released and
                    // undefined if it has been a normal mouse click
                    if (this.ctrlKeySelection && !e.ctrlKey)
                        this._mouseMode = 'pan';
                    else
                        this._mouseMode = 'select';
                    this.addElementType = undefined;
                    this.addModeLib = undefined;
                    this.addEdgeStart = undefined;
                    this.addEdgeStartConnector = undefined;
                    this.ctrlKeySelection = e.ctrlKey;
                    this.linkedRenderer?.updateToggleButtons();
                });
            } else {
                this.selectModeBtn.prop('disabled', true);
            }
        }

        // Filter graph to selection (visual cutout).
        if (!enabledFeatures || enabledFeatures.includes('cutout_selection')) {
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
                    void this.linkedRenderer?.cutoutSelection();
                },
            }).appendTo(this.toolbarElem);
        }

        // Transition to local view with selection.
        if (!enabledFeatures || enabledFeatures.includes('local_view')) {
            this.localViewBtn = $('<button>', {
                id: 'local-view-button',
                class: 'btn btn-secondary btn-sm btn-material',
                css: {
                    'display': 'none',
                },
                html: '<i class="material-symbols-outlined">memory</i>',
                title: 'Inspect access patterns (local view)',
                click: () => {
                    void this.linkedRenderer?.localViewSelection();
                },
            }).appendTo(this.toolbarElem);
        }

        // Exit previewing mode.
        if (inVSCode) {
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
                    this.linkedRenderer?.emit('exit_preview');
                },
            }).appendTo(this.toolbarElem);
        }

        this.container.append(this.toolbarElem);
    }

    public destroy(): void {
        this.container.empty();
    }

    public linkRenderer(renderer: SDFGRenderer): void {
        this.linkedRenderer = renderer;
    }

    public unlinkRenderer(): void {
        this.linkedRenderer = undefined;
    }

}
*/
