import { REST_request, FormBuilder } from "../../main";
import { Appearance } from "../diode_appearance";
import { DIODE_Context } from "./context";
import { DIODE } from "../diode";


export class DIODE_Context_DIODESettings extends DIODE_Context {
    constructor(diode, gl_container, state) {
        super(diode, gl_container, state);

        this._settings_container = null;

        this._editor_themes = this.getThemes();
    }

    getThemes() {
        REST_request('/dace/api/v1.0/diode/themes', undefined, xhr => {
            if (xhr.readyState === 4 && xhr.status === 200) {
                this._editor_themes = JSON.parse(xhr.response);
                console.log("Got editor themes", this._editor_themes);

                this.create();
            }
        }, "GET");
    }

    themeNames() {
        return this._editor_themes.map(x => x.substr("theme-".length).slice(0, -3));
    }

    setContainer(elem) {
        this._settings_container = elem;
    }

    create() {
        // Editor theme
        {
            const cont = FormBuilder.createContainer(undefined);
            const label = FormBuilder.createLabel(undefined, "editor theme", "Sets the ace editor theme");
            const theme_names = this.themeNames();
            const input = FormBuilder.createSelectInput(undefined, x => {
                const val = x.value;

                DIODE.setTheme(val);
                DIODE.loadTheme().then(x => {
                    this.diode._appearance.setFromAceEditorTheme(val);
                }
                );
            }, theme_names, DIODE.editorTheme());

            cont.append(label);
            cont.append(input);

            this._settings_container.append(cont);
        }
        // Auto-Compile
        {
            const cont = FormBuilder.createContainer(undefined);
            const label = FormBuilder.createLabel(undefined, "Compile on property change", "When false, the program is not recompiled after a property change");

            const input = FormBuilder.createToggleSwitch(undefined, x => {
                const val = x.checked;
                DIODE.setRecompileOnPropertyChange(val);
            }, DIODE.recompileOnPropertyChange());

            cont.append(label);
            cont.append(input);

            this._settings_container.append(cont);
        }
        // (Debug) mode
        {
            const cont = FormBuilder.createContainer(undefined);
            const label = FormBuilder.createLabel(undefined, "DaCe Debug mode", "When true, the program shows elements primarily useful for debugging and developing DaCe/DIODE.");

            const input = FormBuilder.createToggleSwitch(undefined, x => {
                const val = x.checked;
                DIODE.setDebugDevMode(val);
            }, DIODE.debugDevMode());

            cont.append(label);
            cont.append(input);

            this._settings_container.append(cont);
        }
        // UI font
        {
            const cont = FormBuilder.createContainer(undefined);
            const label = FormBuilder.createLabel(undefined, "UI Font", "Select the font used in the UI (does not affect code panes and SDFG renderers)");

            const current = Appearance.getClassProperties("diode_appearance")['fontFamily'];

            const input = FormBuilder.createSelectInput(undefined, x => {
                const val = x.value;

                this.diode._appearance.setFont(val);
                this.diode._appearance.apply();
            }, Appearance.fonts(), current);

            cont.append(label);
            cont.append(input);

            this._settings_container.append(cont);
        }
    }

}
