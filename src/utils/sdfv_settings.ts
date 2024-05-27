// Copyright 2019-2024 ETH Zurich and the DaCe authors. All rights reserved.

import $ from 'jquery';

import {
    Modal,
} from 'bootstrap';
import { SDFGRenderer } from '../renderer/renderer';

type RangeT = {
    value: number,
    min?: number,
    max?: number,
};

export type SDFVSettingValT = boolean | string | number | RangeT;

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

    private readonly settingsDict: Record<string, SDFVSettingValT> = {
        // User modifiable settings fields.
        'minimap': true,
        'alwaysOnISEdgeLabels': true,
        'showAccessNodes': true,
        'showStateNames': true,
        'showMapSchedules': true,
        'showDataDescriptorSizes': false,
        'summarizeLargeNumbersOfEdges': false,
        'inclusiveRanges': false,
        'useVerticalStateMachineLayout': false,
        'useVerticalScrollNavigation': false,
        'adaptiveContentHiding': true,
        'curvedEdges': true,
        'ranksep': {
            value: 30,
            min: 10,
            max: 100,
        },
        'nodesep': {
            value: 50,
            min: 0,
            max: 100,
        },
        // Hidden settings fields.
        'toolbar': true,
    };

    private addSlider(
        root: JQuery<HTMLElement>, label: string, valueKey: string,
        requiresRelayout: boolean = false, customCallback?: CallableFunction
    ): void {
        const settingRow = $('<div>', {
            class: 'row',
        }).appendTo(root);
        const settingContainer = $('<div>', {
            class: 'col-12',
        }).appendTo(settingRow);
        $('<label>', {
            class: 'form-label',
            text: label,
        }).appendTo(settingContainer);
        const settingsEntry = this.settingsDict[valueKey] as RangeT;
        const input = $('<input>', {
            class: 'form-range',
            type: 'range',
            value: settingsEntry.value,
            min: settingsEntry.min ?? 0,
            max: settingsEntry.max ?? 100,
            change: () => {
                const nVal = input.val();
                if (nVal !== undefined) {
                    settingsEntry.value = +nVal;
                    if (customCallback)
                        customCallback(settingsEntry);
                    this.onSettingsChanged(requiresRelayout);
                }
            },
        }).appendTo(settingContainer);
    }

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

    private addSettingsGroup(
        root: JQuery<HTMLElement>, title: string, idSuffix: string,
        defaultShow: boolean = false
    ): JQuery<HTMLElement> {
        const settingsGroup = $('<div>', {
            class: 'accordion-item',
        }).appendTo(root);
        $('<h6>', {
            class: 'accordion-header',
        }).append($('<button>', {
            text: title,
            class: 'accordion-button' + (defaultShow ? '' : ' collapsed'),
            type: 'button',
            'data-bs-toggle': 'collapse',
            'data-bs-target': '#SDFVSettingsAccordion-' + idSuffix,
            'aria-expanded': 'true',
            'aria-controls': 'SDFVSettingsAccordion-' + idSuffix,
        })).appendTo(settingsGroup);
        const settingsGroupContainerWrapper = $('<div>', {
            id: 'SDFVSettingsAccordion-' + idSuffix,
            class: 'accordion-collapse collapse' + (defaultShow ? ' show' : ''),
            'data-bs-parent': '#SDFVSettingsAccordion',
        }).appendTo(settingsGroup);
        const settingsGroupContainer = $('<div>', {
            class: 'accordion-body',
        }).appendTo(settingsGroupContainerWrapper);
        return settingsGroupContainer;
    }

    private constructSettings(root: JQuery<HTMLElement>): void {
        // ---------------------------
        // - View / Drawing Settings -
        // ---------------------------
        const viewGroup = this.addSettingsGroup(
            root, 'View Settings', 'viewSettings', true
        );
        this.addToggle(
            viewGroup,
            'Show minimap', 'minimap', false, (value: boolean) => {
                if (value)
                    this.renderer?.enableMinimap();
                else
                    this.renderer?.disableMinimap();
            }
        );
        this.addToggle(
            viewGroup,
            'Always show interstate edge labels', 'alwaysOnISEdgeLabels',
            true
        );
        this.addToggle(viewGroup, 'Show access nodes', 'showAccessNodes', true);
        this.addToggle(viewGroup, 'Show state names', 'showStateNames');
        this.addToggle(viewGroup, 'Show map schedules', 'showMapSchedules');
        this.addToggle(
            viewGroup,
            'Show data descriptor sizes on access nodes ' +
            '(hides data container names)',
            'showDataDescriptorSizes', true
        );
        this.addToggle(
            viewGroup, 'Use inclusive ranges', 'inclusiveRanges', true
        );
        this.addToggle(
            viewGroup, 'Use vertical state machine layout',
            'useVerticalStateMachineLayout', true
        );
        this.addSlider(viewGroup, 'Vertical node spacing', 'ranksep', true);
        this.addSlider(viewGroup, 'Horizontal node spacing', 'nodesep', true);

        // ------------------
        // - Mouse Settings -
        // ------------------
        const mouseGroup = this.addSettingsGroup(
            root, 'Mouse Settings', 'mouseSettings'
        );
        this.addToggle(
            mouseGroup, 'Use vertical scroll navigation',
            'useVerticalScrollNavigation', false
        );

        // ------------------------
        // - Performance Settings -
        // ------------------------
        const perfGroup = this.addSettingsGroup(
            root, 'Performance Settings', 'performanceSettings'
        );
        this.addToggle(
            perfGroup,
            'Adaptively hide content when zooming out (Warning: turning this \
                off can cause performance issues on big graphs)',
            'adaptiveContentHiding', false, (value: boolean) => {
                if (this.renderer)
                    (this.renderer.get_context() as any).lod = value;
            }
        );
        this.addToggle(
            perfGroup, 'Curved Edges (turn off in case of performance issues)',
            'curvedEdges', false
        );
        this.addToggle(
            perfGroup,
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
            class: 'accordion',
            id: 'SDFVSettingsAccordion',
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

    public static get ranksep(): number {
        return (this.getInstance().settingsDict['ranksep'] as RangeT).value;
    }

    public static get nodesep(): number {
        return (this.getInstance().settingsDict['nodesep'] as RangeT).value;
    }

}
