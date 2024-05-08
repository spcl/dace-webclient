// Copyright 2019-2024 ETH Zurich and the DaCe authors. All rights reserved.

import $ from 'jquery';

import {
    Modal,
} from 'bootstrap';
import { SDFGRenderer } from '../renderer/renderer';

export class SDFVSettings {

    private static readonly INSTANCE: SDFVSettings = new SDFVSettings();

    private constructor() {
        // Noop
    }

    public static getInstance(): SDFVSettings {
        return this.INSTANCE;
    }

    private modal: Modal | null = null;
    private renderer: SDFGRenderer | null = null;

    private readonly settingsDict: Record<string, boolean | string | number> = {
        // User modifiable settings fields.
        'minimap': true,
        'alwaysOnISEdgeLabels': true,
        'showAccessNodes': true,
        'showStateNames': true,
        'showMapSchedules': true,
        'showDataDescriptorSizes': false,
        'summarizeLargeNumbersOfEdges': true,
        'inclusiveRanges': false,
        'useVerticalStateMachineLayout': false,
        'useVerticalScrollNavigation': false,
        'adaptiveContentHiding': true,
        'curvedEdges': true,
        // Hidden settings fields.
        'toolbar': true,
    };

    private addToggle(
        root: JQuery<HTMLElement>, label: string, valueKey: string,
        requiresRelayout: boolean = false, customCallback?: CallableFunction
    ): void {
        const settingRow = $('<div>', {
            class: 'row',
        }).appendTo(root);
        const settingContainer = $('<div>', {
            class: 'col-12',
        }).appendTo(settingRow);
        const checkContainer = $('<div>', {
            class: 'form-check form-switch',
        }).appendTo(settingContainer);
        const input = $('<input>', {
            class: 'form-check-input',
            type: 'checkbox',
            checked: this.settingsDict[valueKey],
            change: () => {
                this.settingsDict[valueKey] = input.prop('checked');
                if (customCallback)
                    customCallback(this.settingsDict[valueKey]);
                this.onSettingsChanged(requiresRelayout);
            },
        }).appendTo(checkContainer);
        $('<label>', {
            class: 'form-check-label',
            text: label,
        }).appendTo(checkContainer);
    }

    private constructSettings(root: JQuery<HTMLElement>): void {
        const viewSettingsTitle = $('<div>', {
            class: 'col-12',
        }).append($('<h6>', {
            text: 'View Settings',
            css: {
                'font-weight': 'bold',
            },
        }));
        $('<div>', {
            class: 'row',
        }).appendTo(root).append(viewSettingsTitle);

        this.addToggle(
            root, 'Show minimap', 'minimap', false, (value: boolean) => {
                if (value)
                    this.renderer?.enableMinimap();
                else
                    this.renderer?.disableMinimap();
            }
        );
        this.addToggle(
            root, 'Always show interstate edge labels', 'alwaysOnISEdgeLabels',
            true
        );
        this.addToggle(root, 'Show access nodes', 'showAccessNodes', true);
        this.addToggle(root, 'Show state names', 'showStateNames');
        this.addToggle(root, 'Show map schedules', 'showMapSchedules');
        this.addToggle(
            root,
            'Show data descriptor sizes on access nodes ' +
            '(hides data container names)',
            'showDataDescriptorSizes', true
        );
        this.addToggle(root, 'Use inclusive ranges', 'inclusiveRanges', true);
        this.addToggle(
            root, 'Use vertical state machine layout',
            'useVerticalStateMachineLayout', true
        );

        const mouseSettingsTitle = $('<div>', {
            class: 'col-12',
        }).append($('<h6>', {
            text: '',
        })).append($('<h6>', {
            text: 'Mouse Settings',
            css: {
                'font-weight': 'bold',
            },
        }));
        $('<div>', {
            class: 'row',
        }).appendTo(root).append(mouseSettingsTitle);

        this.addToggle(
            root, 'Use vertical scroll navigation',
            'useVerticalScrollNavigation', false
        );

        const performanceSettingsTitle = $('<div>', {
            class: 'col-12',
        }).append($('<h6>', {
            text: '',
        })).append($('<h6>', {
            text: 'Performance Settings',
            css: {
                'font-weight': 'bold',
            },
        }));
        $('<div>', {
            class: 'row',
        }).appendTo(root).append(performanceSettingsTitle);

        // TODO: Remove this setting as disabling the adaptive content hiding
        // can cause massive performance issues. TODO: add sliders for LOD
        // thresholds of sdfv.ts into an advanced settings menu.
        this.addToggle(
            root,
            'Adaptively hide content when zooming out (Warning: turning this \
                off can cause huge performance issues on big graphs)',
                'adaptiveContentHiding', false, (value: boolean) => {
                    if (this.renderer)
                        (this.renderer.get_context() as any).lod = value;
                }
            );
            
            this.addToggle(
                root, 'Curved Edges (turn off in case of performance issues)',
                'curvedEdges', false
            );
            this.addToggle(
                root,
                'Hide / summarize edges for nodes where a large number of ' +
                    'edges are connected',
                'summarizeLargeNumbersOfEdges', true
            );
        }

    private constructModal(): JQuery<HTMLElement> {
        const modalElement = $('<div>', {
            class: 'modal fade',
            tabindex: '-1',
            id: 'sdfv-settings-modal',
        });
        document.body.appendChild(modalElement[0]);

        const modalContents = $('<div>', {
            class: 'modal-content',
        });
        $('<div>', {
            class: 'modal-dialog modal-dialog-centered',
        }).appendTo(modalElement).append(modalContents);

        // Construct the modal header.
        $('<div>', {
            class: 'modal-header',
        }).appendTo(modalContents).append($('<h1>', {
            class: 'modal-title fs-5',
            text: 'Settings',
        })).append($('<div>', {
            id: 'task-info-field-settings',
            style: 'margin-left: 15px;',
        })).append($('<button>', {
            type: 'button',
            class: 'btn-close',
            'data-bs-dismiss': 'modal',
            'aria-label': 'Close',
        }));

        const modalBody = $('<div>', {
            class: 'modal-body',
        }).appendTo(modalContents);
        const container = $('<div>', {
            class: 'container-fluid',
        }).appendTo(modalBody);
        this.constructSettings(container);

        // Construct the modal footer.
        $('<div>', {
            class: 'modal-footer',
        }).appendTo(modalContents).append($('<button>', {
            type: 'button',
            class: 'btn btn-secondary',
            text: 'Close',
            'data-bs-dismiss': 'modal',
        }));

        return modalElement;
    }

    private onSettingsChanged(relayout: boolean): void {
        if (relayout) {
            this.renderer?.add_loading_animation();
            setTimeout(() => {
                this.renderer?.relayout();
            }, 10);
        }
        this.renderer?.draw_async();

        if (this.renderer?.get_in_vscode())
            this.renderer.emit('settings_changed', this.settingsDict);
    }

    public show(renderer?: SDFGRenderer): void {
        if (!this.modal)
            this.modal = new Modal(this.constructModal()[0], {});

        if (renderer)
            this.renderer = renderer;

        this.modal.show();
    }

    public hide(): void {
        this.modal?.hide();
    }

    public toggle(): void {
        if (!this.modal)
            this.show();
        else
            this.modal.toggle();
    }

    public static get settingsKeys(): string[] {
        return Object.keys(SDFVSettings.getInstance().settingsDict);
    }

    public static setDefault(setting: string, def: any): void {
        SDFVSettings.getInstance().settingsDict[setting] = def;
    }

    public static get toolbar(): boolean {
        return SDFVSettings.getInstance().settingsDict['toolbar'] as boolean;
    }

    public static get minimap(): boolean {
        return SDFVSettings.getInstance().settingsDict['minimap'] as boolean;
    }

    public static get alwaysOnISEdgeLabels(): boolean {
        return SDFVSettings.getInstance().settingsDict[
            'alwaysOnISEdgeLabels'
        ] as boolean;
    }

    public static get showAccessNodes(): boolean {
        return SDFVSettings.getInstance().settingsDict[
            'showAccessNodes'
        ] as boolean;
    }

    public static get inclusiveRanges(): boolean {
        return SDFVSettings.getInstance().settingsDict[
            'inclusiveRanges'
        ] as boolean;
    }

    public static get adaptiveContentHiding(): boolean {
        return SDFVSettings.getInstance().settingsDict[
            'adaptiveContentHiding'
        ] as boolean;
    }

    public static get showStateNames(): boolean {
        return SDFVSettings.getInstance().settingsDict[
            'showStateNames'
        ] as boolean;
    }

    public static get showMapSchedules(): boolean {
        return SDFVSettings.getInstance().settingsDict[
            'showMapSchedules'
        ] as boolean;
    }

    public static get showDataDescriptorSizes(): boolean {
        return SDFVSettings.getInstance().settingsDict[
            'showDataDescriptorSizes'
        ] as boolean;
    }

    public static get summarizeLargeNumbersOfEdges(): boolean {
        return SDFVSettings.getInstance().settingsDict[
            'summarizeLargeNumbersOfEdges'
        ] as boolean;
    }

    public static get useVerticalStateMachineLayout(): boolean {
        return this.getInstance().settingsDict[
            'useVerticalStateMachineLayout'
        ] as boolean;
    }

    public static get useVerticalScrollNavigation(): boolean {
        return this.getInstance().settingsDict[
            'useVerticalScrollNavigation'
        ] as boolean;
    }

    public static get curvedEdges(): boolean {
        return this.getInstance().settingsDict[
            'curvedEdges'
        ] as boolean;
    }

}
