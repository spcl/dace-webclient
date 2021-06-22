import { DIODE_Context } from "./context";


export class DIODE_Context_PerfTimes extends DIODE_Context {
    constructor(diode, gl_container, state) {
        super(diode, gl_container, state);
        this._chart = null;
    }

    setupEvents(project) {
        super.setupEvents(project);

        const eh = this.diode.goldenlayout.eventHub;
        const transthis = this;

        this.on(this.project().eventString('-req-new-time'), (msg) => {
            setTimeout(x => eh.emit(transthis.project().eventString('new-time'), 'ok'), 1);
            this.addTime(msg.time);
        });
    }

    create() {
        const elem = this.container.getElement()[0];
        elem.innerHTML = "";

        // Create the graph
        const canvas = document.createElement("canvas");
        elem.appendChild(canvas);

        const oldstate = this.getState();
        if (oldstate.runtimes === undefined) {
            oldstate.runtimes = [];
        }

        console.log("Execution times loaded", oldstate.runtimes);

        const labels = [];
        for (let i = 0; i < oldstate.runtimes.length; ++i) {
            labels.push(i);
        }

        this._chart = new Chart(canvas.getContext("2d"), {
            type: 'bar',

            data: {
                labels: labels,
                datasets: [{
                    label: 'Exec. times in s',
                    backgroundColor: "blue",
                    data: oldstate.runtimes.map(x => x)
                }]
            },
            options: {
                responsive: true,
                scales: {
                    yAxes: [{
                        display: true,
                        ticks: {
                            beginAtZero: true
                        }
                    }],
                    xAxes: [{
                        display: true,
                        ticks: {
                            autoSkip: true
                        }
                    }]
                },
                legend: {
                    //display: false,
                    position: 'top',
                },
                title: {
                    display: true,
                    text: 'Execution times'
                }
            }
        });
        this._chart.update();
    }

    addTime(runtime) {
        const oldstate = this.getState();
        if (oldstate.runtimes === undefined) {
            oldstate.runtimes = [];
        }
        oldstate.runtimes.push(runtime);
        this.resetState(oldstate);

        this.create();
    }

}
