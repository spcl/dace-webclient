import { REST_request } from "../../main";
import * as Roofline from "../../../renderer_dir/Roofline/main";
import { DIODE_Context } from "./context";


export class DIODE_Context_Roofline extends DIODE_Context {
    constructor(diode, gl_container, state) {
        super(diode, gl_container, state);
        this._proc_func = null;
    }

    setupEvents(project) {
        super.setupEvents(project);

        const eh = this.diode.goldenlayout.eventHub;
        const transthis = this;

        /*this.on(this.project().eventString('-req-new-time'), (msg) => {
            setTimeout(x => eh.emit(transthis.project().eventString('new-time'), 'ok'), 1);
            this.addTime(msg.time);
        });*/
    }

    create() {
        const parent = this.container.getElement()[0];
        parent.style.width = "100%";
        parent.style.height = "100%";

        const canvas = document.createElement("canvas");
        canvas.width = 1920;
        canvas.height = 1080;

        const redraw_func = Roofline.main(canvas, proc_func => {
            // Setup code, called on init. Incoming data must be passed to proc_func
            this._proc_func = proc_func;
        });

        const on_resize = () => {
            console.log("Resizing");
            canvas.width = parseInt(parent.style.width) - 20;
            canvas.height = parseInt(parent.style.height) - 20;

            // Reset then
            redraw_func();
        };

        parent.addEventListener("resize", on_resize);

        if (window.ResizeObserver) {
            new ResizeObserver(on_resize).observe(parent);
        } else {
            console.warn("ResizeObserver not available");
        }

        parent.appendChild(canvas);

        REST_request('/dace/api/v1.0/perfdata/roofline/', {
            client_id: this.diode.getClientID()
        }, xhr => {
            if (xhr.readyState === 4 && xhr.status === 200) {
                this._proc_func(JSON.parse(xhr.response));
            }
        });
    }


}
