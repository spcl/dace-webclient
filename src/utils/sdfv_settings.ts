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
    toggleDisabled?: [string, boolean][];
}

interface SDFVSettingRange extends SDFVSetting {
    type: 'range';
    default: number;
    minimum?: number;
    maximum?: number;
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
        root: JQuery<HTMLElement>, category: string, key: SDFVSettingKey,
        setting: SDFVSettingRange
    ): void {
        const settingRow = $('<div>', {
            id: 'SDFVSettings-' + category + '_' + key,
            class: 'row',
        }).appendTo(root);
        const settingContainer = $('<div>', {
            class: 'col-12',
        }).appendTo(settingRow);
        $('<label>', {
            class: 'form-label',
            text: setting.label,
        }).appendTo(settingContainer);
        const min = (
            setting.minimum === undefined ? 0 : setting.minimum
        ).toPrecision(2);
        const max = (
            setting.maximum === undefined ? 100 : setting.maximum
        ).toPrecision(2);
        const step = (
            setting.step === undefined ? 1 : setting.step
        ).toPrecision(2);
        const inputContainer = $('<div>', {
            class: 'd-flex align-items-center',
        }).appendTo(settingContainer);
        const resetBtn = $('<span>', {
            class: 'material-symbols-outlined text-secondary',
            text: 'reset_settings',
            title: 'Reset to default value',
            css: {
                'margin-right': '.3rem',
                'user-select': 'none',
            },
        }).appendTo(inputContainer);
        const numberInput = $('<input>', {
            class: 'form-control form-control-sm',
            css: {
                'width': '18%',
            },
            type: 'number',
            min: min,
            max: max,
            step: step,
            value: this._settingsDict.get(key),
        }).appendTo(inputContainer);
        const sliderInput = $('<input>', {
            class: 'form-range',
            css: {
                'width': '72%',
                'margin-left': 'auto',
                'user-select': 'none',
            },
            type: 'range',
            min: min,
            max: max,
            step: step,
            value: this._settingsDict.get(key),
        }).appendTo(inputContainer);
        sliderInput.on('change', () => {
            let nVal = sliderInput.val();
            if (nVal !== undefined) {
                nVal = +nVal;
                numberInput.val(nVal);
                this._settingsDict.set(key, nVal);
                this.onSettingChanged(setting);
            }
        });
        numberInput.on('change', () => {
            let nVal = numberInput.val();
            if (nVal !== undefined) {
                nVal = +nVal;

                if (nVal < (setting.minimum ?? 0)) {
                    nVal = setting.minimum ?? 0;
                    numberInput.val(nVal);
                } else if (nVal > (setting.maximum ?? 100)) {
                    nVal = setting.maximum ?? 100;
                    numberInput.val(nVal);
                }

                sliderInput.val(nVal);
                this._settingsDict.set(key, nVal);
                this.onSettingChanged(setting);
            }
        });
        resetBtn.on('click', () => {
            numberInput.val(setting.default);
            sliderInput.val(setting.default);
            this._settingsDict.set(key, setting.default);
            this.onSettingChanged(setting);
        });
    }

    private addToggle(
        root: JQuery<HTMLElement>, category: string, key: SDFVSettingKey,
        setting: SDFVSettingBoolean
    ): void {
        const settingRow = $('<div>', {
            id: 'SDFVSettings-' + category + '_' + key,
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
                const isChecked = input.prop('checked');

                if (setting.toggleDisabled) {
                    for (const disableEntry of setting.toggleDisabled) {
                        const toggleInputs = $(
                            '#SDFVSettings-' +
                            disableEntry[0].replaceAll('.', '_') +
                            ' :input'
                        );
                        for (const toToggle of toggleInputs) {
                            $(toToggle).prop(
                                'disabled', disableEntry[1] === isChecked
                            );
                        }
                    }
                }

                this._settingsDict.set(key, isChecked);
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
            let firstSetting = true;
            for (const [sName, setting] of Object.entries(category.settings)) {
                if ((setting as SDFVSetting).hidden)
                    continue;

                if (!firstSetting) {
                    $('<hr>', {
                        class: 'sdfv-setting-separator',
                    }).appendTo(catContainer);
                }

                firstSetting = false;
                switch (setting.type) {
                    case 'boolean':
                        this.addToggle(
                            catContainer, cName, sName as SDFVSettingKey,
                            setting as SDFVSettingBoolean
                        );
                        break;
                    case 'range':
                        this.addSlider(
                            catContainer, cName, sName as SDFVSettingKey,
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
            class: 'modal-dialog modal-dialog-centered modal-dialog-scrollable',
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
                this.renderer?.draw_async();
            }, 10);
        }

        if (setting.redrawUI)
            this.renderer?.initUI();

        if (setting.redraw !== false && !setting.relayout)
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
