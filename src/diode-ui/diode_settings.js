
export class DIODE_Settings {
    constructor(denormalized = {}) {
        this.settings_values = denormalized;
        this.changed = {};
    }

    load() {
        // Load the settings from localStorage
        this.settings_values = window.localStorage.getItem("DIODE/Settings/confirmed");
        this.changed = window.localStorage.getItem("DIODE/Settings/changed");
    }

    store() {
        // Store the settings to localStorage
        window.localStorage.setItem("DIODE/Settings/confirmed", this.settings_values);
        window.localStorage.setItem("DIODE/Settings/changed", this.changed);
    }

    change(setting, value) {
        this.changed[setting.join('/')] = value;
    }

    hasChanged() {
        return this.changed != {};
    }

    changedValues() {
        return this.changed;
    }

    clearChanged() {
        this.changed = {};
    }

    values() {
        return this.settings_values;
    }

}
