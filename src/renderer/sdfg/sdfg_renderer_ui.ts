// Copyright 2019-2025 ETH Zurich and the DaCe authors. All rights reserved.

import $ from 'jquery';

import {
    RendererUI,
    RendererUIFeature,
} from 'rendure/src/renderer/core/common/renderer_ui';
import type { SDFGRenderer } from './sdfg_renderer';
import { SDFVSettings } from '../../utils/sdfv_settings';
import type {
    GenericSdfgOverlay,
} from '../../overlays/common/generic_sdfg_overlay';
import { LogicalGroupOverlay } from '../../overlays/logical_group_overlay';
import { MemoryLocationOverlay } from '../../overlays/memory_location_overlay';
import { MemoryVolumeOverlay } from '../../overlays/memory_volume_overlay';
import { cfgToDotGraph } from '../../utils/sdfg/dotgraph';
import { ModeButtons } from '../../types';
import { SDFGElementType } from './sdfg_elements';
import { StatsCollector } from '../../layout/layout_evaluator';


export type SDFGRendererUIFeature = (
    'settings' | 'overlaysMenu' | 'collapse' | 'expand' | 'addMode' |
    'panMode' | 'moveMode' | 'boxSelectMode' | 'cutoutSelection' | 'localView'
) | RendererUIFeature;

export class SDFGRendererUI extends RendererUI {

    public readonly cutoutBtn?: JQuery<HTMLButtonElement>;
    public readonly localViewBtn?: JQuery<HTMLButtonElement>;
    public readonly selectModeBtn?: JQuery<HTMLButtonElement>;
    public readonly panModeBtn?: JQuery<HTMLButtonElement>;
    public readonly moveModeBtn?: JQuery<HTMLButtonElement>;
    public readonly addModeButtons: JQuery<HTMLButtonElement>[] = [];
    private modeBtnSelectedBGColor: string = '#CCCCCC';

    public constructor(
        container: JQuery,
        protected readonly renderer: SDFGRenderer,
        protected readonly modeButtons?: ModeButtons,
        protected readonly _featuresMask: Partial<Record<
            SDFGRendererUIFeature, boolean
        >> = {
            menu: true,
            zoomToFit: true,
            zoomToFitWidth: true,
            minimap: true,
            zoomBtns: true,
            settings: true,
            overlaysMenu: true,
            collapse: true,
            expand: true,
            addMode: true,
            panMode: true,
            moveMode: true,
            boxSelectMode: true,
            cutoutSelection: true,
            localView: true,
        }
    ) {
        _featuresMask.minimap = SDFVSettings.get<boolean>('minimap');

        super(
            container, renderer, _featuresMask,
            SDFVSettings.get<boolean>('toolbar')
        );

        if (this._featuresMask.menu) {
            this.addMenuItem(
                'Save SDFG', this.renderer.saveSDFG.bind(this.renderer), -1,
                false
            );
            this.addMenuItem(
                'Save view as PNG', () => {
                    const filename = this.renderer.getSDFGName() + '.png';
                    this.renderer.saveCanvasAsPng(filename);
                }, -1, false
            );
            if (this.renderer.canSaveToPDF) {
                this.addMenuItem(
                    'Save view as PDF', () => {
                        const filename = this.renderer.getSDFGName() + '.pdf';
                        this.renderer.saveAsPDF(filename, false);
                    }, -1, false
                );
                this.addMenuItem(
                    'Save SDFG as PDF', () => {
                        const filename = this.renderer.getSDFGName() + '.pdf';
                        this.renderer.saveAsPDF(filename, true);
                    }, -1, false
                );
            }
            this.addMenuItem(
                'Export top-level CFG as DOT graph', () => {
                    if (!this.renderer.sdfg)
                        return;
                    const filename = this.renderer.getSDFGName() + '.dot';
                    this.renderer.save(
                        filename,
                        'data:text/plain;charset=utf-8,' + encodeURIComponent(
                            cfgToDotGraph(this.renderer.sdfg)
                        )
                    );
                }, -1, false
            );
            this.addMenuItem(
                'Clear stats', () => {
                    StatsCollector.getInstance().clearStats();
                }, -1, false
            );
            this.addMenuItem(
                'Save stats', () => {
                    StatsCollector.getInstance().dumpStatsCSV('stats.csv');
                }, -1, false
            );
            this.addMenuDivider();
            this.addMenuItem(
                'Reset element positions',
                this.renderer.resetElementPositions.bind(this.renderer), -1,
                true
            );
        }

        if (this._featuresMask.settings) {
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
        if (this._featuresMask.overlaysMenu && !this.renderer.inVSCode) {
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
                        if (olInput.prop('checked'))
                            this.renderer.overlayManager.registerOverlay(ol);
                        else
                            this.renderer.overlayManager.deregisterOverlay(ol);
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

        if (this._featuresMask.collapse || this._featuresMask.expand) {
            const collapseButtonGroup = $('<div>', {
                class: 'btn-group',
                role: 'group',
            }).appendTo(this.toolbar);
            if (this._featuresMask.collapse) {
                // Collapse all.
                $('<button>', {
                    class: 'btn btn-secondary btn-sm btn-material',
                    html: '<i class="material-symbols-outlined">' +
                        'unfold_less</i>',
                    title: 'Collapse next level (Shift+click to collapse all)',
                    click: (e: MouseEvent) => {
                        if (e.shiftKey)
                            this.renderer.collapseAll();
                        else
                            this.renderer.collapseNextLevel();
                    },
                }).appendTo(collapseButtonGroup);
            }
            if (this._featuresMask.expand) {
                // Expand all.
                $('<button>', {
                    class: 'btn btn-secondary btn-sm btn-material',
                    html: '<i class="material-symbols-outlined">' +
                        'unfold_more</i>',
                    title: 'Expand next level (Shift+click to expand all)',
                    click: (e: MouseEvent) => {
                        if (e.shiftKey)
                            this.renderer.expandAll();
                        else
                            this.renderer.expandNextLevel();
                    },
                }).appendTo(collapseButtonGroup);
            }
        }

        if (this.modeButtons?.pan || this.modeButtons?.move ||
            this.modeButtons?.select || this.modeButtons?.addBtns) {
            // If we get the "external" mode buttons we are in vscode and do
            // not need to create them.
            this.panModeBtn = this.modeButtons.pan;
            this.moveModeBtn = this.modeButtons.move;
            this.selectModeBtn = this.modeButtons.select;
            this.addModeButtons = this.modeButtons.addBtns;
            if (this._featuresMask.addMode) {
                for (const addBtn of this.addModeButtons) {
                    const addBtnType = addBtn.attr(
                        'type'
                    ) as SDFGElementType;
                    if (addBtnType === SDFGElementType.LibraryNode) {
                        addBtn.on('click', () => {
                            const libNodeCallback = () => {
                                this.renderer.mouseMode = 'add';
                                this.renderer.addElementType =
                                    SDFGElementType.LibraryNode;
                                this.renderer.addEdgeStart = undefined;
                                this.renderer.addEdgeStartConnector = undefined;
                                this.updateToggleButtons();
                            };
                            this.renderer.emit(
                                'query_libnode', libNodeCallback
                            );
                        });
                    } else {
                        addBtn.on('click', () => {
                            this.renderer.mouseMode = 'add';
                            this.renderer.addElementType = addBtnType;
                            this.renderer.addModeLib = undefined;
                            this.renderer.addEdgeStart = undefined;
                            this.renderer.addEdgeStartConnector = undefined;
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
            if (this._featuresMask.panMode) {
                this.panModeBtn = $('<button>', {
                    class: 'btn btn-secondary btn-sm btn-material selected',
                    html: '<i class="material-symbols-outlined">' +
                        'pan_tool</i>',
                    title: 'Pan mode',
                }).appendTo(modeButtonGroup) as JQuery<HTMLButtonElement>;
            }

            // Enter move mode.
            if (this._featuresMask.moveMode) {
                this.moveModeBtn = $('<button>', {
                    class: 'btn btn-secondary btn-sm btn-material',
                    html: '<i class="material-symbols-outlined">' +
                        'open_with</i>',
                    title: 'Object moving mode',
                }).appendTo(modeButtonGroup) as JQuery<HTMLButtonElement>;
            }

            // Enter box select mode.
            if (this._featuresMask.boxSelectMode) {
                this.selectModeBtn = $('<button>', {
                    class: 'btn btn-secondary btn-sm btn-material',
                    html: '<i class="material-symbols-outlined">select</i>',
                    title: 'Select mode',
                }).appendTo(modeButtonGroup) as JQuery<HTMLButtonElement>;
            }
        }

        // Enter pan mode
        if (this.panModeBtn) {
            if (this._featuresMask.panMode) {
                this.panModeBtn.prop('disabled', false);
                this.panModeBtn.on('click', () => {
                    this.renderer.mouseMode = 'pan';
                    this.renderer.addElementType = undefined;
                    this.renderer.addModeLib = undefined;
                    this.renderer.addEdgeStart = undefined;
                    this.renderer.addEdgeStartConnector = undefined;
                    this.updateToggleButtons();
                });
            } else {
                this.panModeBtn.prop('disabled', true);
            }
        }

        // Enter object moving mode
        if (this.moveModeBtn) {
            if (this._featuresMask.moveMode) {
                this.moveModeBtn.prop('disabled', false);
                this.moveModeBtn.on('click', (e): void => {
                    // shift_click is false if shift key has been released
                    // and undefined if it has been a normal mouse click.
                    if (this.renderer.shiftKeyMovement && !e.shiftKey)
                        this.renderer.mouseMode = 'pan';
                    else
                        this.renderer.mouseMode = 'move';
                    this.renderer.addElementType = undefined;
                    this.renderer.addModeLib = undefined;
                    this.renderer.addEdgeStart = undefined;
                    this.renderer.addEdgeStartConnector = undefined;
                    this.renderer.shiftKeyMovement = e.shiftKey;
                    this.updateToggleButtons();
                });
            } else {
                this.moveModeBtn.prop('disabled', true);
            }
        }

        // Enter box selection mode
        if (this.selectModeBtn) {
            if (this._featuresMask.boxSelectMode) {
                this.selectModeBtn.prop('disabled', false);
                this.selectModeBtn.on('click', (e): void => {
                    // ctrl_click is false if ctrl key has been released and
                    // undefined if it has been a normal mouse click
                    if (this.renderer.ctrlKeySelection && !e.ctrlKey)
                        this.renderer.mouseMode = 'pan';
                    else
                        this.renderer.mouseMode = 'select';
                    this.renderer.addElementType = undefined;
                    this.renderer.addModeLib = undefined;
                    this.renderer.addEdgeStart = undefined;
                    this.renderer.addEdgeStartConnector = undefined;
                    this.renderer.ctrlKeySelection = e.ctrlKey;
                    this.updateToggleButtons();
                });
            } else {
                this.selectModeBtn.prop('disabled', true);
            }
        }

        // Filter graph to selection (visual cutout).
        if (this._featuresMask.cutoutSelection) {
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
                    void this.renderer.cutoutSelection();
                },
            }).appendTo(this.toolbar) as JQuery<HTMLButtonElement>;
        }

        // Transition to local view with selection.
        if (this._featuresMask.localView) {
            this.localViewBtn = $('<button>', {
                id: 'local-view-button',
                class: 'btn btn-secondary btn-sm btn-material',
                css: {
                    'display': 'none',
                },
                html: '<i class="material-symbols-outlined">memory</i>',
                title: 'Inspect access patterns (local view)',
                click: () => {
                    void this.renderer.localViewSelection();
                },
            }).appendTo(this.toolbar) as JQuery<HTMLButtonElement>;
        }

        // Exit previewing mode.
        if (this.renderer.inVSCode) {
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
                    this.renderer.emit('exit_preview');
                },
            }).appendTo(this.toolbar);
        }
    }

    // Updates buttons based on cursor mode
    public updateToggleButtons(): void {
        // First clear out of all modes, then jump in to the correct mode.
        this.renderer.canvas.style.cursor = 'default';
        this.renderer.hideInteractionInfo();

        if (this.panModeBtn)
            this.panModeBtn.removeClass('selected');

        if (this.moveModeBtn)
            this.moveModeBtn.removeClass('selected');

        if (this.selectModeBtn)
            this.selectModeBtn.removeClass('selected');

        this.renderer.mouseFollowElement?.html('');

        for (const addBtn of this.addModeButtons) {
            const btnType = addBtn.attr('type') as SDFGElementType;
            if (btnType === this.renderer.addElementType) {
                addBtn.addClass('selected');
                const svgHtml = this.renderer.mouseFollowSVGs?.[btnType];
                if (svgHtml)
                    this.renderer.mouseFollowElement?.html(svgHtml);
            } else {
                addBtn.removeClass('selected');
            }
        }

        switch (this.renderer.mouseMode) {
            case 'move':
                if (this.moveModeBtn)
                    this.moveModeBtn.addClass('selected');
                this.renderer.showInteractionInfo(
                    'Middle Mouse: Pan view<br/>Right Click: Reset position',
                    true
                );
                break;
            case 'select':
                if (this.selectModeBtn)
                    this.selectModeBtn.addClass('selected');
                if (this.renderer.ctrlKeySelection) {
                    this.renderer.showInteractionInfo('Middle Mouse: Pan view');
                } else {
                    this.renderer.showInteractionInfo(
                        'Shift: Add to selection<br/>' +
                        'Ctrl: Remove from selection<br/>' +
                        'Middle Mouse: Pan view',
                        true
                    );
                }
                break;
            case 'add':
                if (this.renderer.addElementType?.toString() === 'Edge') {
                    if (this.renderer.addEdgeStart) {
                        this.renderer.showInteractionInfo(
                            'Left Click: Select second element (to)<br/>' +
                            'Middle Mouse: Pan view<br/>' +
                            'Right Click / Esc: Abort',
                            true
                        );
                    } else {
                        this.renderer.showInteractionInfo(
                            'Left Click: Select first element (from)<br/>' +
                            'Middle Mouse: Pan view<br/>' +
                            'Right Click / Esc: Abort',
                            true
                        );
                    }
                } else {
                    this.renderer.showInteractionInfo(
                        'Left Click: Place element<br>' +
                        'Ctrl + Left Click: Place and stay in Add ' +
                        'Mode<br/>' +
                        'Middle Mouse: Pan view<br/>' +
                        'Right Click / Esc: Abort',
                        true
                    );
                }
                break;
            case 'pan':
            default:
                if (this.panModeBtn)
                    this.panModeBtn.addClass('selected');
                break;
        }
    }

    private onModeButtonClick(e: JQuery.Event): void {
        if (this.renderer.ctrlKeySelection && !e.ctrlKey)
            this.renderer.mouseMode = 'pan';
        else
            this.renderer.mouseMode = 'select';
        this.renderer.addElementType = undefined;
        this.renderer.addModeLib = undefined;
        this.renderer.addEdgeStart = undefined;
        this.renderer.addEdgeStartConnector = undefined;
        this.renderer.ctrlKeySelection = e.ctrlKey ?? false;
        this.updateToggleButtons();
    }

}
