// Copyright 2019-2024 ETH Zurich and the DaCe authors. All rights reserved.

import $ from 'jquery';

import {
    Modal,
} from 'bootstrap';
import { SDFGRenderer } from '../renderer/renderer';
import * as settingsManifest from '../settings_manifest.json';
import { AllFields } from './utils';

export type SDFVSettingValT = boolean | string | number | null;

export type SDFVSettingCategories = keyof (
    typeof settingsManifest.viewerSettings.categories
);
export type SDFVSettingKey = keyof AllFields<
    typeof settingsManifest.viewerSettings.categories[
        SDFVSettingCategories
    ]['settings']
>;

interface SDFVSetting {
    label: string;
    hidden?: boolean;
    relayout?: boolean;
    redrawUI?: boolean;
    redraw?: boolean;
}

interface SDFVSettingBoolean extends SDFVSetting {
    type: 'boolean';
    default: boolean;
}

interface SDFVSettingRange extends SDFVSetting {
    type: 'range';
    default: number;
    min?: number;
    max?: number;
    step?: number;
}

export class SDFVSettings {

    private readonly _settingsDict: Map<
        SDFVSettingKey, SDFVSettingValT
    > = new Map();

    private static readonly INSTANCE: SDFVSettings = new SDFVSettings();

    private constructor() {
        const categories = settingsManifest.viewerSettings.categories;
        for (const category of Object.values(categories)) {
            for (const [sName, setting] of Object.entries(category.settings)) {
                this._settingsDict.set(
                    sName as SDFVSettingKey, setting.default
                );
            }
        }
    }

    public static getInstance(): SDFVSettings {
        return this.INSTANCE;
    }

    private modal: Modal | null = null;
    private renderer: SDFGRenderer | null = null;

    private addSlider(
        root: JQuery<HTMLElement>, key: SDFVSettingKey,
        setting: SDFVSettingRange
    ): void {
        const settingRow = $('<div>', {
            class: 'row',
        }).appendTo(root);
        const settingContainer = $('<div>', {
            class: 'col-12',
        }).appendTo(settingRow);
        $('<label>', {
            class: 'form-label',
            text: setting.label,
        }).appendTo(settingContainer);
        const input = $('<input>', {
            class: 'form-range',
            type: 'range',
            value: this._settingsDict.get(key),
            min: setting.min ?? 0,
            max: setting.max ?? 100,
            step: setting.step ?? 1,
            change: () => {
                const nVal = input.val();
                if (nVal !== undefined) {
                    this._settingsDict.set(key, +nVal);
                    this.onSettingChanged(setting);
                }
            },
        }).appendTo(settingContainer);
    }

    private addToggle(
        root: JQuery<HTMLElement>, key: SDFVSettingKey,
        setting: SDFVSettingBoolean
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
            checked: this._settingsDict.get(key),
            change: () => {
                this._settingsDict.set(key, input.prop('checked'));
                this.onSettingChanged(setting);
            },
        }).appendTo(checkContainer);
        $('<label>', {
            class: 'form-check-label',
            text: setting.label,
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
        let first = true;
        const categories = settingsManifest.viewerSettings.categories;
        for (const [cName, category] of Object.entries(categories)) {
            const catContainer = this.addSettingsGroup(
                root, category.label, cName, first
            );
            first = false;
            for (const [sName, setting] of Object.entries(category.settings)) {
                if ((setting as SDFVSetting).hidden)
                    continue;

                switch (setting.type) {
                    case 'boolean':
                        this.addToggle(
                            catContainer, sName as SDFVSettingKey,
                            setting as SDFVSettingBoolean
                        );
                        break;
                    case 'range':
                        this.addSlider(
                            catContainer, sName as SDFVSettingKey,
                            setting as SDFVSettingRange
                        );
                        break;
                }
            }
        }
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
            css: {
                padding: 0,
            },
        }).appendTo(modalContents);

        const container = $('<div>', {
            class: 'accordion accordion-flush',
            id: 'SDFVSettingsAccordion',
        }).appendTo(modalBody);
        this.constructSettings(container);

        return modalElement;
    }

    private onSettingChanged(setting: SDFVSetting): void {
        if (setting.relayout) {
            this.renderer?.add_loading_animation();
            setTimeout(() => {
                this.renderer?.relayout();
            }, 10);
        }

        if (setting.redrawUI)
            this.renderer?.initUI();

        if (setting.redraw !== false)
            this.renderer?.draw_async();

        if (this.renderer?.get_in_vscode())
            this.renderer.emit('settings_changed', SDFVSettings.settingsDict);
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

    public static get settingsKeys(): SDFVSettingKey[] {
        return Array.from(SDFVSettings.getInstance()._settingsDict.keys());
    }

    public static get settingsDict(
    ): ReadonlyMap<SDFVSettingKey, SDFVSettingValT> {
        return SDFVSettings.getInstance()._settingsDict;
    }

    public static set<T extends SDFVSettingValT>(
        key: SDFVSettingKey, value: T
    ) {
        if (!SDFVSettings.getInstance()._settingsDict.has(key))
            throw Error('Key error, key ' + key + ' not in settings');
        SDFVSettings.getInstance()._settingsDict.set(key, value);
    }

    public static get<T extends SDFVSettingValT>(key: SDFVSettingKey): T {
        if (!SDFVSettings.getInstance()._settingsDict.has(key))
            throw Error('Key error, key ' + key + ' not in settings');
        return SDFVSettings.getInstance()._settingsDict.get(key)! as T;
    }

}
