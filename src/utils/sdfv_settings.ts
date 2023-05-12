// Copyright 2019-2022 ETH Zurich and the DaCe authors. All rights reserved.

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

    private _showAccessNodes: boolean = true;
    private _showStateNames: boolean = true;
    private _showMapSchedules: boolean = true;
    private _showDataDescriptorSizes: boolean = false;
    private _adaptiveContentHiding: boolean = true;
    private _inclusiveRanges: boolean = false;
    private _useVerticalStateMachineLayout: boolean = true;

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
            checked: (this as any)[valueKey],
            change: () => {
                (this as any)[valueKey] = input.prop('checked');
                if (customCallback)
                    customCallback((this as any)[valueKey]);
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
            text: 'View settings',
        }));
        $('<div>', {
            class: 'row',
        }).appendTo(root).append(viewSettingsTitle);

        this.addToggle(root, 'Show access nodes', '_showAccessNodes', true);
        this.addToggle(root, 'Show state names', '_showStateNames');
        this.addToggle(root, 'Show map schedules', '_showMapSchedules');
        this.addToggle(
            root,
            'Show data descriptor sizes on access nodes ' +
                '(hides data container names)',
            '_showDataDescriptorSizes', true
        );
        this.addToggle(
            root, 'Adaptively hide content when zooming out',
            '_adaptiveContentHiding', false, (value: boolean) => {
                if (this.renderer)
                    (this.renderer.get_context() as any).lod = value;
            }
        );
        this.addToggle(root, 'Use inclusive ranges', '_inclusiveRanges', true);
        this.addToggle(
            root, 'Use vertical state machine layout',
            '_useVerticalStateMachineLayout', true
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
        if (relayout)
            this.renderer?.relayout();
        this.renderer?.draw_async();
    }

    public show(renderer?: SDFGRenderer): void {
        if (!this.modal)
            this.modal = new Modal(this.constructModal()[0], {
            });

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

    public static get showAccessNodes(): boolean {
        return this.getInstance()._showAccessNodes;
    }

    public static get inclusiveRanges(): boolean {
        return this.getInstance()._inclusiveRanges;
    }

    public static get adaptiveContentHiding(): boolean {
        return this.getInstance()._adaptiveContentHiding;
    }

    public static get showStateNames(): boolean {
        return this.getInstance()._showStateNames;
    }

    public static get showMapSchedules(): boolean {
        return this.getInstance()._showMapSchedules;
    }

    public static get showDataDescriptorSizes(): boolean {
        return this.getInstance()._showDataDescriptorSizes;
    }

    public static get useVerticalStateMachineLayout(): boolean {
        return this.getInstance()._useVerticalStateMachineLayout;
    }

}
