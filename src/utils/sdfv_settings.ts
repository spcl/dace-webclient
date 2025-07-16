// Copyright 2019-2025 ETH Zurich and the DaCe authors. All rights reserved.

import $ from 'jquery';

import EventEmitter from 'events';
import { Modal } from 'bootstrap';
import * as settingsManifest from '../settings_manifest.json';
import { AllFields } from './utils';
import * as defaultBlueTheme from '../color_themes/default_blue.json';
import * as defaultGreenTheme from '../color_themes/default_green.json';

export type SDFVSettingValT = boolean | string | number | null;

export type SDFVSettingCategories = keyof (
    typeof settingsManifest.viewerSettings.categories
);
export type SDFVSettingKey = keyof AllFields<
    typeof settingsManifest.viewerSettings.categories[
        SDFVSettingCategories
    ]['settings']
>;
export type SDFVColorThemeColor = keyof (
    typeof
        settingsManifest.viewerSettings.categories.customizeColorTheme.settings
);

interface SDFVSetting {
    type: string;
    default: SDFVSettingValT;
    label: string;
    hidden?: boolean;
    relayout?: boolean;
    redrawUI?: boolean;
    redraw?: boolean;
    externalEvent?: boolean;
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

interface SDFVSettingColor extends SDFVSetting {
    type: 'color';
    default: string;
}

interface SDFVSettingSelect extends SDFVSetting {
    type: 'select';
    default: string;
    choices: {
        label: string,
        value: string,
    }[];
}

const AVAILABLE_THEMES: Record<string, Record<SDFVColorThemeColor, string>> = {
    'DefaultBlue': defaultBlueTheme,
    'DefaultGreen': defaultGreenTheme,
};

interface SDFVSettingsEvent {
    'setting_changed': (setting: SDFVSetting, key: SDFVSettingKey) =>  void,
}

/* eslint-disable @typescript-eslint/no-unsafe-declaration-merging */
export interface SDFVSettings {

    on<U extends keyof SDFVSettingsEvent>(
        event: U, listener: SDFVSettingsEvent[U]
    ): this;

    emit<U extends keyof SDFVSettingsEvent>(
        event: U, ...args: Parameters<SDFVSettingsEvent[U]>
    ): boolean;

}

/* eslint-disable @typescript-eslint/no-unsafe-declaration-merging */
export class SDFVSettings extends EventEmitter {

    private readonly _settingsDict = new Map<
        SDFVSettingKey, SDFVSettingValT
    >();

    private static readonly INSTANCE: SDFVSettings = new SDFVSettings();

    private constructor() {
        super();

        const categories = settingsManifest.viewerSettings.categories;
        for (const category of Object.values(categories)) {
            for (const [sName, pSetting] of Object.entries(category.settings)) {
                const setting = pSetting as SDFVSetting;
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

    private addSelect(
        root: JQuery, category: string, key: SDFVSettingKey,
        setting: SDFVSettingSelect
    ): void {
        const settingRow = $('<div>', {
            id: 'SDFVSettings-' + category + '_' + key,
            class: 'row',
        }).appendTo(root);
        const settingContainer = $('<div>', {
            class: 'col-12',
        }).appendTo(settingRow);
        const inputContainer = $('<div>', {
            class: 'input-group input-group-sm',
        }).appendTo(settingContainer);
        const inputId = 'SDFVSettings-' + category + '_' + key + '-input';
        $('<label>', {
            class: 'input-group-text',
            for: inputId,
            text: setting.label,
        }).appendTo(inputContainer);
        const input = $('<select>', {
            class: 'form-select',
            id: inputId,
            change: () => {
                const nVal = input.val();
                if (nVal !== undefined && typeof nVal === 'string')
                    this._settingsDict.set(key, nVal);
                if (setting.externalEvent === false)
                    this.internalHandler(key, setting);
                else
                    this.emit('setting_changed', setting, key);
            },
        }).appendTo(inputContainer);
        for (const choice of setting.choices) {
            if (choice.value === setting.default) {
                input.append($('<option>', {
                    selected: 'selected',
                    value: choice.value,
                    text: choice.label,
                }));
            } else {
                input.append($('<option>', {
                    value: choice.value,
                    text: choice.label,
                }));
            }
        }
    }

    private addColorPicker(
        root: JQuery, category: string, key: SDFVSettingKey,
        setting: SDFVSettingColor
    ): void {
        const settingRow = $('<div>', {
            id: 'SDFVSettings-' + category + '_' + key,
            class: 'row',
        }).appendTo(root);
        const settingContainer = $('<div>', {
            class: 'col-12',
        }).appendTo(settingRow);
        const inputContainer = $('<div>', {
            css: {
                'display': 'flex',
                'align-items': 'center',
            },
        }).appendTo(settingContainer);
        const input = $('<input>', {
            class: 'form-control form-control-color',
            type: 'color',
            value: this._settingsDict.get(key),
            css: {
                'margin-right': '.3rem',
            },
            change: () => {
                const nVal = input.val();
                if (nVal !== undefined && typeof nVal === 'string')
                    this._settingsDict.set(key, nVal);
                if (setting.externalEvent === false)
                    this.internalHandler(key, setting);
                else
                    this.emit('setting_changed', setting, key);
            },
        }).appendTo(inputContainer);
        const resetBtn = $('<span>', {
            class: 'material-symbols-outlined text-secondary',
            text: 'reset_settings',
            title: 'Reset to default value',
            css: {
                'margin-right': '.3rem',
                'user-select': 'none',
            },
        }).appendTo(inputContainer);
        $('<label>', {
            class: 'form-label',
            css: {
                'margin-bottom': '0',
            },
            text: setting.label,
        }).appendTo(inputContainer);
        resetBtn.on('click', () => {
            input.val(setting.default);
            this._settingsDict.set(key, setting.default);
            if (setting.externalEvent === false)
                this.internalHandler(key, setting);
            else
                this.emit('setting_changed', setting, key);
        });
    }

    private addSlider(
        root: JQuery, category: string, key: SDFVSettingKey,
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
        const min = (setting.minimum ?? 0).toPrecision(2);
        const max = (setting.maximum ?? 100).toPrecision(2);
        const step = (setting.step ?? 1).toPrecision(2);
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
                if (setting.externalEvent === false)
                    this.internalHandler(key, setting);
                else
                    this.emit('setting_changed', setting, key);
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
                if (setting.externalEvent === false)
                    this.internalHandler(key, setting);
                else
                    this.emit('setting_changed', setting, key);
            }
        });
        resetBtn.on('click', () => {
            numberInput.val(setting.default);
            sliderInput.val(setting.default);
            this._settingsDict.set(key, setting.default);
            if (setting.externalEvent === false)
                this.internalHandler(key, setting);
            else
                this.emit('setting_changed', setting, key);
        });
    }

    private addToggle(
        root: JQuery, category: string, key: SDFVSettingKey,
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
                const isChecked = input.prop('checked') as boolean;

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
                if (setting.externalEvent === false)
                    this.internalHandler(key, setting);
                else
                    this.emit('setting_changed', setting, key);
            },
        }).appendTo(checkContainer);
        $('<label>', {
            class: 'form-check-label',
            text: setting.label,
        }).appendTo(checkContainer);
    }

    private addSettingsGroup(
        root: JQuery, title: string, idSuffix: string,
        defaultShow: boolean = false
    ): JQuery {
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

    private constructSettings(root: JQuery): void {
        let first = true;
        const categories = settingsManifest.viewerSettings.categories;
        for (const [cName, category] of Object.entries(categories)) {
            const catContainer = this.addSettingsGroup(
                root, category.label, cName, first
            );
            first = false;
            let firstSetting = true;
            for (const [sName, pSetting] of Object.entries(category.settings)) {
                const setting = pSetting as SDFVSetting;
                if (setting.hidden)
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
                    case 'color':
                        this.addColorPicker(
                            catContainer, cName, sName as SDFVSettingKey,
                            setting as SDFVSettingColor
                        );
                        break;
                    case 'select':
                        this.addSelect(
                            catContainer, cName, sName as SDFVSettingKey,
                            setting as SDFVSettingSelect
                        );
                        break;
                }
            }
        }
    }

    private constructModal(): JQuery {
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

    private updateColorTheme(
        key: SDFVSettingKey, setting: SDFVSettingSelect
    ): void {
        // Load and set all colors correctly according to the selected theme.
        const selection = this._settingsDict.get(key)! as string;
        const theme = AVAILABLE_THEMES[selection];
        for (const k in theme) {
            const colorKey = k as SDFVColorThemeColor;
            const colorVal = theme[colorKey];
            this._settingsDict.set(colorKey, colorVal);
            const colorInput = $(
                '#SDFVSettings-customizeColorTheme_' + colorKey
            ).find('input');
            colorInput.val(colorVal);
        }
        // Make the event externally visible so the renderer redraws.
        this.emit('setting_changed', setting, key);
    }

    private internalHandler(key: SDFVSettingKey, setting: SDFVSetting): void {
        switch (key) {
            case 'colorTheme':
                this.updateColorTheme(key, setting as SDFVSettingSelect);
                break;
        }
    }

    public show(): void {
        this.modal ??= new Modal(this.constructModal()[0], {});
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

    /* eslint-disable-next-line
       @typescript-eslint/no-unnecessary-type-parameters */
    public static set<T extends SDFVSettingValT>(
        key: SDFVSettingKey, value: T
    ): void {
        if (!SDFVSettings.getInstance()._settingsDict.has(key))
            throw Error('Key error, key ' + key + ' not in settings');
        SDFVSettings.getInstance()._settingsDict.set(key, value);
    }

    /* eslint-disable-next-line
       @typescript-eslint/no-unnecessary-type-parameters */
    public static get<T extends SDFVSettingValT>(key: SDFVSettingKey): T {
        if (!SDFVSettings.getInstance()._settingsDict.has(key))
            throw Error('Key error, key ' + key + ' not in settings');
        return SDFVSettings.getInstance()._settingsDict.get(key)! as T;
    }

}
