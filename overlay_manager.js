class GenericSdfgOverlay {

    constructor(renderer) {
        this.renderer = renderer;
        this.active = false;
    }

    enable() {
        this.active = true;
    }

    disable () {
        this.active = false;
    }

    draw() {
    }

    on_mouse_event(type, ev, mousepos, elements, foreground_elem, ends_drag) {
        return false;
    }

}

class MemoryVolumeOverlay extends GenericSdfgOverlay {

    constructor(renderer) {
        super(renderer);

        // Indicate which volume is considered 'maximum badness', meaning that
        // the badness color scale tops out at this volume.
        this.cutoff_high_volume = 10;
        // The highest observed volume can be used to adjust the 'temperature'
        // scale.
        this.highest_observed_volume = 0;

        // Initialize an empty symbol - value mapping.
        this.symbol_value_map = {};
        this.symbols_to_define = [];

        this.init_overlay_popup_dialogue();
    }

    disable() {
        super.disable();

        // Reset any modifications made during overlay activity.
        this.symbol_value_map = {};
        this.symbols_to_define = [];
        this.highest_observed_volume = 0;
    }

    prompt_define_symbol() {
        if (this.symbols_to_define.length > 0) {
            let symbol = this.symbols_to_define.pop();
            this.popup_dialogue._show(symbol, this.symbol_value_map);
        }
    }

    parse_volume(volume_string, prompt_completion=false) {
        let expression_tree = math.parse(volume_string);
        let volume = undefined;
        if (prompt_completion) {
            expression_tree.forEach((node, path, parent) => {
                if (node.type === 'SymbolNode') {
                    if (!this.symbol_value_map[node.name]) {
                        // This is an undefined symbol.
                        // Ask for it to be defined.
                        this.symbols_to_define.push(node.name);
                    }
                }
            });
            this.prompt_define_symbol();
        } else {
            try {
                let evaluation = expression_tree.evaluate(this.symbol_value_map);
                if (evaluation && !isNaN(evaluation) && Number.isInteger(+evaluation))
                    volume = +evaluation;
                else
                    volume = undefined;
            } catch (e) {
                volume = undefined;
            }
        }
        return volume;
    }

    init_overlay_popup_dialogue() {
        let dialogue_background = createElement('div', '', ['modal_background'],
            document.body);
        dialogue_background._show = function () {
            this.style.display = 'block';
        };
        dialogue_background._hide = function () {
            this.style.display = 'none';
        };

        let popup_dialogue = createElement('div', 'sdfv_overlay_dialogue',
            ['modal'], dialogue_background);
        popup_dialogue.addEventListener('click', (ev) => {
            ev.stopPropagation();
        });
        popup_dialogue.style.display = 'none';
        this.popup_dialogue = popup_dialogue;

        let header_bar = createElement('div', '', ['modal_title_bar'],
            this.popup_dialogue);
        this.popup_dialogue._title = createElement('span', '', ['modal_title'],
            header_bar);
        let close_button = createElement('div', '', ['modal_close'],
            header_bar);
        close_button.innerHTML = '<i class="material-icons">close</i>';
        close_button.addEventListener('click', () => {
            popup_dialogue._hide();
        });

        let content_box = createElement('div', '', ['modal_content_box'],
            this.popup_dialogue);
        this.popup_dialogue._content = createElement('div', '',
            ['modal_content'], content_box);
        this.popup_dialogue._input = createElement('input', 'symbol_input',
            ['modal_input_text'], this.popup_dialogue._content);
        
        let that = this;
        function set_val() {
            if (popup_dialogue._map && popup_dialogue._symbol) {
                let val = popup_dialogue._input.value;
                if (val && !isNaN(val) && Number.isInteger(+val) && val > 0) {
                    popup_dialogue._map[popup_dialogue._symbol] = val;
                    popup_dialogue._hide();
                    that.prompt_define_symbol();
                    return;
                }
            }
            popup_dialogue._input.setCustomValidity('Invalid, not an integer');
        }
        this.popup_dialogue._input.addEventListener('keypress', (ev) => {
            if (ev.which === 13)
                set_val();
        });

        let footer_bar = createElement('div', '', ['modal_footer_bar'],
            this.popup_dialogue);
        let confirm_button = createElement('div', '',
            ['button', 'modal_confirm_button'], footer_bar);
        confirm_button.addEventListener('click', (ev) => { set_val(); });
        let confirm_button_text = createElement('span', '', [], confirm_button);
        confirm_button_text.innerText = 'Confirm';
        createElement('div', '', ['clearfix'], footer_bar);

        this.popup_dialogue._show = function (symbol, map) {
            this.style.display = 'block';
            popup_dialogue._title.innerText = 'Define symbol ' + symbol;
            popup_dialogue._symbol = symbol;
            popup_dialogue._map = map;
            dialogue_background._show();
        };
        this.popup_dialogue._hide = function () {
            this.style.display = 'none';
            popup_dialogue._title.innerText = '';
            popup_dialogue._input.value = '';
            popup_dialogue._input.setCustomValidity('');
            dialogue_background._hide();
        };
        dialogue_background.addEventListener('click', (ev) => {
            popup_dialogue._hide();
        });
    }

    draw() {
        this.renderer.for_all_elements(0, 0, 0, 0,
            (type, element, object, intersect) => {
                if (object instanceof Edge) {
                    object.draw_memory_volume_overlay(this.renderer,
                        this.renderer.ctx, this, this.cutoff_high_volume);
                }
            }
        );
    }

    on_mouse_event(type, ev, mousepos, elements, foreground_elem, ends_drag) {
        if ((type === 'click' && !ends_drag) || type === 'dblclick') {
            if (foreground_elem && foreground_elem.data &&
                foreground_elem.data.attributes &&
                foreground_elem.data.attributes.volume) {
                this.parse_volume(foreground_elem.data.attributes.volume, true);
            }
        }
        return false;
    }

}

class OverlayManager {

    constructor (renderer) {
        this.renderer = renderer;

        this.memory_volume_overlay = new MemoryVolumeOverlay(this.renderer);

        this.overlays = [
            this.memory_volume_overlay,
        ];
    }

    draw() {
        this.overlays.forEach(overlay => {
            if (overlay.active)
                overlay.draw();
        });
    }

    on_mouse_event(type, ev, mousepos, elements, foreground_elem, ends_drag) {
        this.overlays.forEach(overlay => {
            if (overlay.active)
                overlay.on_mouse_event(type, ev, mousepos, elements,
                    foreground_elem, ends_drag);
        });
    }

}