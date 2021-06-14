import { DIODE_Context } from "./context";
const { $ } = globalThis;

export class DIODE_Context_TransformationHistory extends DIODE_Context {
    constructor(diode, gl_container, state) {
        super(diode, gl_container, state);

    }

    setupEvents(project) {
        super.setupEvents(project);

        const eh = this.diode.goldenlayout.eventHub;

        this.on(this.project().eventString('-req-update-tfh'), msg => {

            // Load from project
            const hist = this.project().getTransformationHistory();
            this.create(hist);
            setTimeout(() => eh.emit(this.project().eventString('update-tfh'), 'ok'), 1);
        });
    }

    create(hist = []) {
        let parent_element = this.container.getElement();
        $(parent_element).css('overflow', 'auto');
        $(parent_element)[0].setAttribute("data-hint", '{"type": "DIODE_Element", "name": "TransformationHistory"}');

        parent_element = $(parent_element)[0];

        parent_element.innerHTML = '';

        const history_base_div = document.createElement("div");
        history_base_div.classList = "transformation_history_base";

        const history_scoll_div = document.createElement("div");
        history_scoll_div.classList = "transformation_history_list";

        this._history_scroll_div = history_scoll_div;

        history_base_div.appendChild(history_scoll_div);

        parent_element.innerHTML = "";
        parent_element.appendChild(history_base_div);

        let i = 0;
        for (const x of hist) {
            this.addElementToHistory(x, i);
            ++i;
        }
    }

    addElementToHistory(simple_node, index) {
        const hsd = this._history_scroll_div;

        const elem = document.createElement("div");
        elem.classList = "transformation_history_list_element";

        const title = document.createElement("div");
        title.classList = "transformation_history_list_element_title";
        title.innerText = Object.values(simple_node)[0][0].name;

        const ctrl = document.createElement("div");
        ctrl.classList = "flex_row transformation_history_list_element_control";

        {
            const revert = document.createElement("div");
            revert.classList = "revert-button";
            revert.title = "revert";
            revert.innerHTML = "<i class='material-icons'>undo</i>";
            $(revert).hover(() => {
                elem.classList.add("revert-hovered");
            }, () => {
                elem.classList.remove("revert-hovered");
            });

            revert.addEventListener('click', _x => {
                // Reset to the associated checkpoint
                const tsh = this.project().getTransformationSnapshots()[index];
                this.diode.multiple_SDFGs_available({ compounds: tsh[1] });

                // Remove the descending checkpoints
                this.project().discardTransformationsAfter(index);

                if (true) {
                    this.diode.gatherProjectElementsAndCompile(this, {}, {
                        sdfg_over_code: true,
                    });
                }
            });

            ctrl.appendChild(revert);
        }

        elem.appendChild(title);
        elem.appendChild(ctrl);
        hsd.appendChild(elem);

    }
}
