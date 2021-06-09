import * as _ from "lodash";

export default class Timer {
    private static _timers: Map<string, Array<number>> = new Map();
    private static _measurements: Map<string, Array<number>> = new Map();

    public static start(path: Array<string>): void {
        const id = path.join("|");
        let timers = Timer._timers.get(id);
        if (timers === undefined) {
            timers = [];
            Timer._timers.set(id, timers);
        }
        timers.push(Date.now());
    }

    public static stop(path: Array<string>): void {
        const stopTime = Date.now();
        const id = path.join("|");
        const timers = Timer._timers.get(id);
        const startTime = timers[timers.length - 1];
        timers.length = timers.length - 1;
        let measurements = Timer._measurements.get(id);
        if (measurements === undefined) {
            measurements = [];
            Timer._measurements.set(id, measurements);
        }
        if (timers.length === 0) {
            measurements.push(stopTime - startTime); // for recursive calls, only add outermost
        }
    }

    public static printTimes(): void {
        const timePerPath = {children: {}};
        Timer._measurements.forEach((measurements, id) => {
            const path = id.split("|");
            let slot = timePerPath;
            _.forEach(path, part => {
                if (slot.children[part] === undefined) {
                    slot.children[part] = {
                        children: {},
                    }
                }
                slot = slot.children[part];
            });
            slot["sum"] = _.sum(measurements);
            slot["mean"] = _.mean(measurements);
            slot["count"] = measurements.length;
        });
        const printTimes = (slot, name = "", level = 0, parentTime = 0) => {
            if (level > 0) {
                let timeString = (slot.sum > 1000 ? ((slot.sum / 1000).toFixed(1) + " s") : (slot.sum + " ms"));
                if (level > 1) {
                    timeString += "; " + (100 * slot.sum / parentTime).toFixed(0) + "% of parent";
                }
                timeString += "; called " + slot.count + " times; average: ";
                timeString += (slot.mean > 1000 ? ((slot.mean / 1000).toFixed(1) + " s") : (slot.mean.toFixed(1) + " ms"));
                console.log(_.repeat("| ", level - 1) + name + ": " + timeString);
            }
            for (let name in slot.children) {
                printTimes(slot.children[name], name, level + 1, slot.sum);
            }
        };
        printTimes(timePerPath);
    }
}
